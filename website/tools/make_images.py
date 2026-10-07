"""Makes the editor screenshots the website shows from the repository's readme-assets, as WebP at the widths the page
asks for, into website/static/images. Run it again only when a screenshot changes, with Pillow installed:
python3 website/tools/make_images.py"""
from pathlib import Path
from PIL import Image

repo = Path(__file__).resolve().parents[2]
images = repo / "website/static/images"
images.mkdir(parents=True, exist_ok=True)
for name in ["10-circuit-build", "05-credentials", "08-run-summary", "04-ai-tool"]:
    im = Image.open(repo / "readme-assets" / f"{name}.png").convert("RGB")
    for w in sorted({800, 1200, min(1600, im.width)}):
        h = round(im.height * w / im.width)
        im.resize((w, h), Image.LANCZOS).save(images / f"{name}-{w}.webp", "WEBP", quality=80, method=6)
    print(name, im.size)
