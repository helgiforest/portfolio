#!/usr/bin/env python3
"""
Готовит фото для главной (overview).

Как пользоваться:
  1. Кладёшь фото в images/full/ (лучше всего — экспорт из Lightroom в максимальном
     качестве; если есть исходник крупнее, можно положить его в images/originals/
     с тем же именем — тогда скрипт возьмёт его).
  2. Запускаешь из корня сайта:  python3 tools/build_overview.py
  3. Скрипт сам:
     - пережимает каждое новое фото в AVIF (avifenc ≥ 1.4, 4:4:4, 10 бит, q60):
       images/full/<имя>.avif — 2400px для лайтбокса,
       images/thumb/<имя>.avif — 1400px для сетки главной;
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

FULL_EDGE, GRID_EDGE = 2400, 1400
EXTS = {".avif", ".webp", ".jpg", ".jpeg", ".png"}
FULL_DIR, GRID_DIR, ORIG_DIR = ROOT / "images" / "full", ROOT / "images" / "thumb", ROOT / "images" / "originals"
INDEX = ROOT / "index.html"


def used_elsewhere():
    """Имена файлов из images/full и images/thumb, на которые ссылаются другие страницы."""
    names = set()
    for page in ROOT.rglob("*.html"):
        if page == INDEX or "research_notes" in page.parts or "reports" in page.parts:
            continue
        for m in re.finditer(r"images/(?:full|thumb)/([^\"'?#]+)", page.read_text(encoding="utf-8")):
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

    made = added = 0
    for stem, files in stems.items():
        avif = FULL_DIR / f"{stem}.avif"
        grid = GRID_DIR / f"{stem}.avif"
        if avif.exists() and grid.exists() and done.get(stem) == sha1(avif):
            continue
        # исходник: крупный оригинал, если есть; иначе то, что лежит в images/full
        orig = [p for p in ORIG_DIR.glob(f"{stem}.*")] if ORIG_DIR.exists() else []
        src = orig[0] if orig else next((p for p in files if p.suffix.lower() != ".avif"), files[0])
        im = open_rgb(src)
        w, h = encode(im, FULL_EDGE, avif.with_suffix(".tmp.avif"))
        encode(im, GRID_EDGE, grid)
        avif.with_suffix(".tmp.avif").replace(avif)
        for old in [*files, GRID_DIR / f"{stem}.webp", GRID_DIR / f"{stem}.jpg"]:
            if old.exists() and old != avif and old.name not in keep:
                old.unlink()
        done[stem] = sha1(avif)
        made += 1
        print(f"  ≈ {stem}.avif  {avif.stat().st_size // 1000} КБ, сетка {grid.stat().st_size // 1000} КБ")

        # index.html: старые адреса → .avif; нового фото нет — добавляем в конец сетки
        pat = re.compile(r'(images/(?:thumb|full)/)' + re.escape(stem) + r'\.(?:webp|jpe?g|png|avif)')
        if pat.search(html):
            html = pat.sub(lambda m: f"{m.group(1)}{stem}.avif", html)
        else:
            k = 1600 / max(w, h)
            item = (f'        <div class="m-item"><img data-src="images/thumb/{stem}.avif" '
                    f'data-full="images/full/{stem}.avif" alt="" width="{round(w * k)}" height="{round(h * k)}"></div>\n')
            html = html.replace("    </main>", item + "    </main>", 1)
            added += 1
            print(f"  + в сетку главной: {stem}")

    INDEX.write_text(html, encoding="utf-8")
    MANIFEST.write_text(json.dumps(manifest, indent=1, sort_keys=True) + "\n")
    print(f"overview: пережато {made}, добавлено в сетку {added}")


if __name__ == "__main__":
    main()
