#!/usr/bin/env python3
"""
Готовит фото для главной (overview).

Как пользоваться:
  1. Кладёшь оригинал (экспорт из Lightroom в полном размере и максимальном качестве)
     в images/originals/overview/ — эта папка только у тебя на компьютере, на GitHub
     не попадает. Или сразу готовое фото в images/overview/full/.
  2. Запускаешь из корня сайта:  python3 tools/build_overview.py
  3. Скрипт сам:
     - пережимает каждое новое фото в AVIF (avifenc ≥ 1.4, 4:4:4, 10 бит, q70):
       images/overview/full/<имя>.avif — 2560px для лайтбокса,
       images/overview/thumb/<имя>.avif — 1400px для сетки главной;
       старые .webp/.jpg этого фото удаляет (если они не нужны другим страницам)
     - меняет адреса в index.html на .avif, а новые фото добавляет в конец сетки
     - помнит готовые в tools/optimized.json и второй раз не трогает

Файлы, которые используют другие страницы (например фото на about), не трогает.
"""
import json
import re
import sys
import tempfile
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))
from build_photos import AVIFENC, MANIFEST, ROOT, encode_avif, open_rgb, sha1  # noqa: E402
from PIL import Image  # noqa: E402

FULL_EDGE, GRID_EDGE = 2560, 1400
EXTS = {".avif", ".webp", ".jpg", ".jpeg", ".png"}
OVERVIEW = ROOT / "images" / "overview"
FULL_DIR, GRID_DIR = OVERVIEW / "full", OVERVIEW / "thumb"
ORIG_DIR = ROOT / "images" / "originals" / "overview"
INDEX = ROOT / "index.html"


def used_elsewhere():
    """Имена файлов главной, на которые ссылаются другие страницы."""
    names = set()
    for page in ROOT.rglob("*.html"):
        if page == INDEX or "research" in page.parts or "originals" in page.parts:
            continue
        for m in re.finditer(r"images/overview/(?:full|thumb)/([^\"'?#]+)", page.read_text(encoding="utf-8")):
            names.add(m.group(1))
    return names


def encode(im, edge, out):
    im = im.copy()
    im.thumbnail((edge, edge), Image.LANCZOS)
    with tempfile.TemporaryDirectory() as tmp:
        png = Path(tmp) / "p.png"
        im.save(png)
        encode_avif(png, out)
    return im.size


def main():
    if not AVIFENC:
        sys.exit("Нужен avifenc: brew install libavif")
    manifest = json.loads(MANIFEST.read_text()) if MANIFEST.exists() else {}
    done = manifest.setdefault("overview", {})
    keep = used_elsewhere()
    html = INDEX.read_text(encoding="utf-8")

    stems = {}
    for f in sorted(FULL_DIR.iterdir()):
        if f.is_file() and f.suffix.lower() in EXTS and not f.name.startswith(".") and f.name not in keep:
            stems.setdefault(f.stem, []).append(f)
    if ORIG_DIR.exists():
        for f in sorted(ORIG_DIR.iterdir()):
            if f.is_file() and f.suffix.lower() in EXTS | {".tif", ".tiff"} and not f.name.startswith("."):
                stems.setdefault(f.stem, [])

    made = added = 0
    for stem, files in stems.items():
        avif = FULL_DIR / f"{stem}.avif"
        grid = GRID_DIR / f"{stem}.avif"
        # исходник: оригинал из images/originals/overview, если есть; иначе то, что лежит в full
        orig = [p for p in ORIG_DIR.glob(f"{stem}.*") if not p.name.startswith(".")] if ORIG_DIR.exists() else []
        if not orig and avif.exists() and grid.exists() and done.get(stem) == sha1(avif):
            continue
        src = orig[0] if orig else next((p for p in files if p.suffix.lower() != ".avif"), files[0])
        # уже сделан из этого же оригинала — не трогаем
        if orig and avif.exists() and grid.exists() and done.get(stem) == sha1(avif) and done.get(stem + ":src") == sha1(src):
            continue
        im = open_rgb(src)
        w, h = encode(im, FULL_EDGE, avif.with_suffix(".tmp.avif"))
        encode(im, GRID_EDGE, grid)
        avif.with_suffix(".tmp.avif").replace(avif)
        for old in [*files, GRID_DIR / f"{stem}.webp", GRID_DIR / f"{stem}.jpg"]:
            if old.exists() and old != avif and old.name not in keep:
                old.unlink()
        done[stem] = sha1(avif)
        if orig:
            done[stem + ":src"] = sha1(src)
        made += 1
        print(f"  ≈ {stem}.avif  {avif.stat().st_size // 1000} КБ, сетка {grid.stat().st_size // 1000} КБ")

        # index.html: старые адреса → .avif; нового фото нет — добавляем в конец сетки
        pat = re.compile(r'(images/overview/(?:thumb|full)/)' + re.escape(stem) + r'\.(?:webp|jpe?g|png|avif)')
        k = 1600 / max(w, h)
        if pat.search(html):
            html = pat.sub(lambda m: f"{m.group(1)}{stem}.avif", html)
            # пропорции могли поменяться (новая кадрировка) — обновляем width/height в сетке
            line = re.compile(r'(<img data-src="images/overview/thumb/' + re.escape(stem) + r'\.avif"[^>]*?)width="\d+" height="\d+"')
            html = line.sub(lambda m: f'{m.group(1)}width="{round(w * k)}" height="{round(h * k)}"', html)
        else:
            item = (f'        <div class="m-item"><img data-src="images/overview/thumb/{stem}.avif" '
                    f'data-full="images/overview/full/{stem}.avif" alt="" width="{round(w * k)}" height="{round(h * k)}"></div>\n')
            html = html.replace("    </main>", item + "    </main>", 1)
            added += 1
            print(f"  + в сетку главной: {stem}")

    INDEX.write_text(html, encoding="utf-8")
    MANIFEST.write_text(json.dumps(manifest, indent=1, sort_keys=True) + "\n")
    print(f"overview: пережато {made}, добавлено в сетку {added}")


if __name__ == "__main__":
    main()
