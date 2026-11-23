#!/usr/bin/env python3
"""
Готовит фото для разделов archive / 2025 / 2026.

Как пользоваться:
  1. Экспортируешь из Lightroom прямо в папку раздела, например images/2025/
     (AVIF, длинная сторона 2000px, sRGB). Эти файлы идут на сайт как есть.
     Подходят avif, webp, jpg, png.
  2. Запускаешь из корня сайта:
        python3 tools/build_photos.py            # все разделы
        python3 tools/build_photos.py 2025       # только один
  3. Скрипт сам:
     - делает маленькие превью images/<раздел>/thumb/*.webp (до 640px)
     - пересоздаёт превью только для новых/изменённых фото
     - удаляет превью, если фото удалено
     - пишет список фото в <раздел>/photos.js

Порядок фото на странице — по имени файла (с учётом чисел: 2 идёт раньше 10).
Чтобы поменять порядок, переименуй файлы, например добавь префикс 001_, 002_ ...

В общий overview (главная) эти фото не попадают никогда.
"""
import json
import re
import sys
from pathlib import Path

try:
    from PIL import Image, ImageOps
except ImportError:
    sys.exit("Нужен Pillow: python3 -m pip install Pillow")

ROOT = Path(__file__).resolve().parent.parent
SECTIONS = ["archive", "2025", "2026"]
THUMB_EDGE, THUMB_QUALITY = 640, 78
EXTS = {".avif", ".webp", ".jpg", ".jpeg", ".png"}  # то, что браузер показывает сам
WARN_EDGE = 2600       # больше — скорее всего забыл Resize to Fit при экспорте
WARN_MB = 2


def natural_key(name):
    return [int(t) if t.isdigit() else t.lower() for t in re.split(r"(\d+)", name)]


def make_thumb(src, thumb):
    with Image.open(src) as im:
        icc = im.info.get("icc_profile")
        im = ImageOps.exif_transpose(im)
        if im.mode not in ("RGB", "RGBA"):
            im = im.convert("RGB")
        im.thumbnail((THUMB_EDGE, THUMB_EDGE), Image.LANCZOS)
        thumb.parent.mkdir(parents=True, exist_ok=True)
        kwargs = {"quality": THUMB_QUALITY, "method": 6}
        if icc:
            kwargs["icc_profile"] = icc
        im.save(thumb, "WEBP", **kwargs)


def build(section):
    base = ROOT / "images" / section
    base.mkdir(parents=True, exist_ok=True)
    thumb_dir = base / "thumb"

    files = sorted(
        (p for p in base.iterdir()
         if p.is_file() and p.suffix.lower() in EXTS and not p.name.startswith(".")),
        key=lambda p: natural_key(p.stem),
    )
    skipped = [p.name for p in base.iterdir()
               if p.is_file() and not p.name.startswith(".") and p.suffix.lower() not in EXTS]
    for name in skipped:
        print(f"  ! {name}: браузер такой формат не покажет, выгрузи в avif/jpg")

    photos, seen = [], set()
    made = failed = removed = 0
    for src in files:
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
        photos.append({"file": src.stem, "ext": src.suffix.lower().lstrip("."), "w": w, "h": h})

    if thumb_dir.exists():
        for f in thumb_dir.iterdir():
            if f.is_file() and not f.name.startswith(".") and f.stem not in seen:
                f.unlink()
                removed += 1

    out = ROOT / section / "photos.js"
    out.parent.mkdir(parents=True, exist_ok=True)
    body = ",\n".join("  " + json.dumps(p, ensure_ascii=False) for p in photos)
    out.write_text(
        "// Сгенерировано tools/build_photos.py — руками не править, перезапусти скрипт.\n"
        f"window.SECTION_PHOTOS = [\n{body}\n];\n",
        encoding="utf-8",
    )

    note = f"{len(photos)} фото, новых превью {made}"
    if removed:
        note += f", удалено лишних превью {removed}"
    if failed:
        note += f", ошибок {failed}"
    print(f"{section}: {note}")


def main():
    wanted = sys.argv[1:] or SECTIONS
    unknown = [s for s in wanted if s not in SECTIONS]
    if unknown:
        sys.exit(f"Неизвестный раздел: {', '.join(unknown)}. Есть: {', '.join(SECTIONS)}")
    for section in wanted:
        build(section)


if __name__ == "__main__":
    main()
