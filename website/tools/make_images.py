"""Makes the editor screenshots the website shows from the repository's readme-assets, as WebP at the widths the page
asks for, into website/static/images. Run it again only when a screenshot changes, with Pillow installed:
python3 website/tools/make_images.py

The window corners stay transparent; build_site.py rounds the picture by the same CORNER."""
from pathlib import Path
from PIL import Image

CORNER = 39
repo = Path(__file__).resolve().parents[2]
images = repo / "website/static/images"
images.mkdir(parents=True, exist_ok=True)
for name in ["10-circuit-build", "05-credentials", "08-run-summary", "04-ai-tool"]:
    im = Image.open(repo / "readme-assets" / f"{name}.png").convert("RGBA")
    corner = next(x for x in range(im.width) if im.getpixel((x, 0))[3] == 255)
    assert abs(corner - CORNER) <= 1, f"{name}: the window's corners changed radius, to {corner} px"
    # Premultiplied, so the transparent corners leave no dark fringe.
    premultiplied = im.convert("RGBa")
    for w in sorted({800, 1200, min(1600, im.width)}):
        h = round(im.height * w / im.width)
        resized = premultiplied.resize((w, h), Image.LANCZOS).convert("RGBA")
        resized.save(images / f"{name}-{w}.webp", "WEBP", quality=80, alpha_quality=90, method=6)
    print(name, im.size)
