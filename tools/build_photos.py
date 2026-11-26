#!/usr/bin/env python3
"""
Готовит фото для разделов archive / 2025 / 2026.

Как пользоваться:
  1. Экспортируешь из Lightroom прямо в папку раздела, например images/2025/
     (sRGB; AVIF или JPEG — любое качество, хоть максимальное; размер любой, лучше от 2000px).
     Подходят avif, webp, jpg, png.
  2. Запускаешь из корня сайта:
        python3 tools/build_photos.py            # все разделы
        python3 tools/build_photos.py 2025       # только один
  3. Скрипт сам:
     - пережимает каждое новое фото в AVIF 2000px по длинной стороне свежим кодировщиком
       (avifenc ≥ 1.4, 4:4:4, 10 бит, q60): по весу примерно вдвое легче экспорта
       из Lightroom, а на глаз неотличимо (проверено слепым сравнением на самых
       тёмных и зернистых кадрах). Уже пережатые помнит в tools/optimized.json
       и второй раз не трогает.
     - делает версии для телефона images/<раздел>/phone/*.avif (1170px по ширине —
       столько пикселей у экрана iPhone)
     - делает маленькие превью images/<раздел>/thumb/*.webp (до 640px)
     - пересоздаёт превью и версии для телефона только для новых/изменённых фото
     - удаляет их, если фото удалено
     - пишет список фото в <раздел>/photos.js

Нужен avifenc (brew install libavif). Без него фото идут на сайт как есть.

Порядок фото на странице — по имени файла (с учётом чисел: 2 идёт раньше 10).
Чтобы поменять порядок, переименуй файлы, например добавь префикс 001_, 002_ ...

В общий overview (главная) эти фото не попадают никогда.
"""
import hashlib
import io
import json
import re
import shutil
import subprocess
import sys
import tempfile
from concurrent.futures import ThreadPoolExecutor
from pathlib import Path

try:
    from PIL import Image, ImageCms, ImageOps
except ImportError:
    sys.exit("Нужен Pillow: python3 -m pip install Pillow")

ROOT = Path(__file__).resolve().parent.parent
SECTIONS = ["archive", "2025", "2026"]
THUMB_EDGE, THUMB_QUALITY = 640, 78
EXTS = {".avif", ".webp", ".jpg", ".jpeg", ".png"}  # то, что браузер показывает сам
FULL_EDGE = 2000       # длинная сторона фото на сайте
AVIF_Q = 60            # качество avifenc ≥ 1.4 (не путать с качеством Lightroom/Pillow — шкалы разные)
PHONE_W = 1170         # ширина версии для телефона
WARN_EDGE = 2600       # больше — скорее всего забыл Resize to Fit при экспорте (если нет avifenc)
WARN_MB = 2

AVIFENC = shutil.which("avifenc")
AVIFDEC = shutil.which("avifdec")
MANIFEST = ROOT / "tools" / "optimized.json"
SRGB = ImageCms.createProfile("sRGB")


def natural_key(name):
    return [int(t) if t.isdigit() else t.lower() for t in re.split(r"(\d+)", name)]


def sha1(path):
    return hashlib.sha1(Path(path).read_bytes()).hexdigest()


def open_rgb(src):
    """Открыть фото как sRGB RGB (с учётом поворота из EXIF и цветового профиля)."""
    im = Image.open(src)
    icc = im.info.get("icc_profile")
    im = ImageOps.exif_transpose(im)
    if im.mode not in ("RGB", "RGBA"):
        im = im.convert("RGB")
    if icc:  # не sRGB-профиль (Adobe RGB, P3...) — переводим в sRGB, сайт помечает файлы как sRGB
        try:
            src_prof = ImageCms.ImageCmsProfile(io.BytesIO(icc))
            im = ImageCms.profileToProfile(im, src_prof, SRGB, outputMode="RGB")
        except Exception:
            pass
    return im.convert("RGB")


def encode_avif(png, out):
    subprocess.run(
        [AVIFENC, "-y", "444", "-d", "10", "-s", "4", "-q", str(AVIF_Q),
         "--cicp", "1/13/6", "-r", "full", "-j", "2", str(png), str(out)],
        check=True, capture_output=True,
    )


def make_thumb(src, thumb):
    im = open_rgb(src)
    im.thumbnail((THUMB_EDGE, THUMB_EDGE), Image.LANCZOS)
    thumb.parent.mkdir(parents=True, exist_ok=True)
    im.save(thumb, "WEBP", quality=THUMB_QUALITY, method=6)


def phone_png(src, png):
    im = open_rgb(src)
    im.thumbnail((PHONE_W, 100000), Image.LANCZOS)  # ограничиваем только ширину
    im.save(png)


def make_phone(src, out):
    out.parent.mkdir(parents=True, exist_ok=True)
    if not AVIFENC:  # запасной путь без avifenc
        im = open_rgb(src)
        im.thumbnail((PHONE_W, 100000), Image.LANCZOS)
        im.save(out, "AVIF", quality=70)
        return
    with tempfile.TemporaryDirectory() as tmp:
        png = Path(tmp) / "p.png"
        phone_png(src, png)
        encode_avif(png, out)


def optimize(src, phone_out):
    """Пережать фото в AVIF FULL_EDGE px. Версию для телефона делаем из исходника
    (а не из уже пережатого), чтобы не сжимать дважды. Возвращает путь нового файла."""
    with tempfile.TemporaryDirectory() as tmp:
        tmp = Path(tmp)
        full_png, small_png, out = tmp / "full.png", tmp / "phone.png", tmp / "out.avif"
        with Image.open(src) as probe:
            w, h = ImageOps.exif_transpose(probe).size
        if src.suffix.lower() == ".avif" and AVIFDEC and max(w, h) <= FULL_EDGE:
            # AVIF из Lightroom 10-битный — распаковываем в 16-битный PNG, чтобы не терять точность
            subprocess.run([AVIFDEC, "--depth", "16", str(src), str(full_png)], check=True, capture_output=True)
        else:
            im = open_rgb(src)
            im.thumbnail((FULL_EDGE, FULL_EDGE), Image.LANCZOS)
            im.save(full_png)
        make_small = min(w, h) and (w * FULL_EDGE / max(w, h, FULL_EDGE)) > PHONE_W * 1.1
        if make_small:
            phone_png(src, small_png)
        encode_avif(full_png, out)
        new = src.with_suffix(".avif")
        shutil.move(str(out), str(new))
        if new != src:
            src.unlink()
        if make_small:  # после замены исходника — чтобы версия для телефона была «новее» его
            phone_out.parent.mkdir(parents=True, exist_ok=True)
            encode_avif(small_png, phone_out)
    return new


def build(section, manifest):
    base = ROOT / "images" / section
    base.mkdir(parents=True, exist_ok=True)
    thumb_dir = base / "thumb"
    phone_dir = base / "phone"
    done_hashes = manifest.setdefault(section, {})

    def list_files():
        return sorted(
            (p for p in base.iterdir()
             if p.is_file() and p.suffix.lower() in EXTS and not p.name.startswith(".")),
            key=lambda p: natural_key(p.stem),
        )

    skipped = [p.name for p in base.iterdir()
               if p.is_file() and not p.name.startswith(".") and p.suffix.lower() not in EXTS]
    for name in skipped:
        print(f"  ! {name}: браузер такой формат не покажет, выгрузи в avif/jpg")

    # 1. пережимаем новые фото (параллельно — avifenc на медленной скорости долгий)
    optimized = 0
    if AVIFENC:
        todo = [p for p in list_files() if done_hashes.get(p.stem) != sha1(p)]
        if todo:
            print(f"  пережимаю {len(todo)} фото...")

        def one(p):
            try:
                new = optimize(p, phone_dir / f"{p.stem}.avif")
                return p, new, None
            except Exception as e:
                return p, None, e

        with ThreadPoolExecutor(4) as ex:
            for p, new, err in ex.map(one, todo):
                if err:
                    print(f"  ! не получилось пережать {p.name}: {err}")
                    continue
                done_hashes[new.stem] = sha1(new)
                optimized += 1
                print(f"  ≈ {new.name}")
    else:
        print("  ! нет avifenc (brew install libavif) — фото не пережимаю, идут как есть")

    # 2. превью, версии для телефона, список
    photos, seen = [], set()
    made = made_phone = failed = removed = 0
    with_phone = set()
    for src in list_files():
        if src.stem in seen:
            print(f"  ! пропускаю {src.name}: фото с таким же именем уже есть (другое расширение)")
            continue

        thumb = thumb_dir / f"{src.stem}.webp"
        if not thumb.exists() or thumb.stat().st_mtime < src.stat().st_mtime:
            try:
                make_thumb(src, thumb)
                made += 1
                print(f"  + {src.name}")
            except Exception as e:  # битый файл / неподдерживаемый формат
                failed += 1
                print(f"  ! не получилось {src.name}: {e}")
                continue
        seen.add(src.stem)

        with Image.open(src) as im:
            w, h = ImageOps.exif_transpose(im).size
        mb = src.stat().st_size / 1024 / 1024
        if max(w, h) > WARN_EDGE or mb > WARN_MB:
            print(f"  ~ {src.name}: {w}x{h}, {mb:.1f} МБ — великовато, проверь Resize to Fit (2000px) в экспорте")
        photo = {"file": src.stem, "ext": src.suffix.lower().lstrip("."), "w": w, "h": h}

        # версия для телефона — только если фото заметно шире экрана телефона
        if w > PHONE_W * 1.1:
            phone = phone_dir / f"{src.stem}.avif"
            try:
                if not phone.exists() or phone.stat().st_mtime < src.stat().st_mtime:
                    make_phone(src, phone)
                    made_phone += 1
                photo["phone"] = 1
                with_phone.add(src.stem)
            except Exception as e:
                print(f"  ! версия для телефона не получилась {src.name}: {e}")
        photos.append(photo)

    if thumb_dir.exists():
        for f in thumb_dir.iterdir():
            if f.is_file() and not f.name.startswith(".") and f.stem not in seen:
                f.unlink()
                removed += 1
    if phone_dir.exists():
        for f in phone_dir.iterdir():
            if f.is_file() and not f.name.startswith(".") and f.stem not in with_phone:
                f.unlink()
                removed += 1
    for stem in list(done_hashes):
        if stem not in seen:
            del done_hashes[stem]

    out = ROOT / section / "photos.js"
    out.parent.mkdir(parents=True, exist_ok=True)
    body = ",\n".join("  " + json.dumps(p, ensure_ascii=False) for p in photos)
    out.write_text(
        "// Сгенерировано tools/build_photos.py — руками не править, перезапусти скрипт.\n"
        f"window.SECTION_PHOTOS = [\n{body}\n];\n",
        encoding="utf-8",
    )

    note = f"{len(photos)} фото, пережато {optimized}, новых превью {made}, новых версий для телефона {made_phone}"
    if removed:
        note += f", удалено лишних файлов {removed}"
    if failed:
        note += f", ошибок {failed}"
    print(f"{section}: {note}")


def main():
    wanted = sys.argv[1:] or SECTIONS
    unknown = [s for s in wanted if s not in SECTIONS]
    if unknown:
        sys.exit(f"Неизвестный раздел: {', '.join(unknown)}. Есть: {', '.join(SECTIONS)}")
    manifest = json.loads(MANIFEST.read_text()) if MANIFEST.exists() else {}
    try:
        for section in wanted:
            build(section, manifest)
    finally:
        MANIFEST.write_text(json.dumps(manifest, indent=1, sort_keys=True) + "\n")


if __name__ == "__main__":
    main()
