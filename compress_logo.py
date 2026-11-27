import sys
from pathlib import Path
from PIL import Image

def compress_image(src: Path, dst: Path | None = None, max_size: int = 800, quality: int = 85) -> Path:
    img = Image.open(src)
    if max(img.size) > max_size:
        ratio = max_size / max(img.size)
        new_width = int(img.width * ratio)
        new_height = int(img.height * ratio)
        img = img.resize((new_width, new_height), Image.LANCZOS)
    if dst is None:
        dst = src.with_suffix('.compressed.jpg')
    else:
        dst = Path(dst)
    img.convert('RGB').save(dst, format='JPEG', quality=quality, optimize=True)
    return dst

def main() -> None:
    if len(sys.argv) < 2:
        print('Usage: python compress_logo.py <input_image> [output_image]')
        sys.exit(1)
    src_path = Path(sys.argv[1])
    out_path = Path(sys.argv[2]) if len(sys.argv) > 2 else None
    if not src_path.is_file():
        print(f'❌ Input file not found: {src_path}')
        sys.exit(1)
    try:
        out = compress_image(src_path, out_path)
        print(f'✅ Compressed image saved to: {out}')
    except Exception as e:
        print(f'❌ Compression error: {e}')
        sys.exit(1)

if __name__ == '__main__':
    main()
