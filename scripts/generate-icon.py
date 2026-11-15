"""生成 electron-builder 所需的 Windows 多尺寸 icon.ico。

纯标准库实现（无 Pillow / ImageMagick / .NET 依赖），可跨平台复现：

  * 优先使用 electron/build/icon-source.png（项目正式图标设计资产）；
    源图是白底 RGB PNG，脚本会把与边界连通的近白区域转成透明，
    再按双线性 + 预乘 alpha 缩放到各尺寸，避免白边。
  * 源图缺失时回退到程序化绘制的品牌色占位图形。

输出 electron/build/icon.ico（传统 32bpp BMP 格式，兼容性优于 PNG 条目）
与 icon-preview.png（256×256，便于人工核对）。

用法： pnpm icon   或   python scripts/generate-icon.py
"""

from __future__ import annotations

from collections import deque
import shutil
import struct
import subprocess
import zlib
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
SIZES = (16, 24, 32, 48, 64, 128, 256)
BUILD_DIR = ROOT / "electron" / "build"
# 唯一权威图标源：应用首页 / 标签页使用的 SVG 矢量原图
SOURCE_SVG = ROOT / "frontend" / "public" / "favicon.svg"
# 由 SVG 渲染出的高分辨率位图缓存（生成物，不是设计源）
SOURCE_FILE = BUILD_DIR / "icon-source.png"
RENDER_HTML = ROOT / ".packaging" / "tmp" / "icon-render.html"
ICO_FILE = BUILD_DIR / "icon.ico"          # Windows
ICNS_FILE = BUILD_DIR / "icon.icns"        # macOS
ICON_PNG = BUILD_DIR / "icon.png"          # Linux（512×512 RGBA）
PREVIEW_FILE = BUILD_DIR / "icon-preview.png"

BRAND = (79, 70, 229)  # #4F46E5
WHITE = (255, 255, 255)
Pixel = tuple[int, int, int, int]  # RGBA


# ---------------------------------------------------------------------------
# 最小 PNG 解码器：8bit、非隔行、颜色类型 0/2/4/6，filter 0-4
# ---------------------------------------------------------------------------

def decode_png(path: Path) -> tuple[int, int, list[list[Pixel]]]:
    data = path.read_bytes()
    if data[:8] != b"\x89PNG\r\n\x1a\n":
        raise ValueError(f"不是 PNG 文件：{path}")

    pos, idat = 8, bytearray()
    while pos < len(data):
        length = struct.unpack(">I", data[pos : pos + 4])[0]
        kind = data[pos + 4 : pos + 8]
        chunk = data[pos + 8 : pos + 8 + length]
        pos += 12 + length
        if kind == b"IDAT":
            idat += chunk
        elif kind == b"IEND":
            break

    width, height, depth, color, _, _, interlace = struct.unpack(
        ">IIBBBBB", data[16:29]
    )
    if depth != 8 or interlace != 0 or color not in (0, 2, 4, 6):
        raise ValueError(f"暂不支持的 PNG 格式：depth={depth} color={color} interlace={interlace}")

    channels = {0: 1, 2: 3, 4: 2, 6: 4}[color]
    raw = zlib.decompress(bytes(idat))
    stride = width * channels
    rows: list[bytearray] = []
    previous = bytearray(stride)
    offset = 0
    for _ in range(height):
        filter_type = raw[offset]
        offset += 1
        line = bytearray(raw[offset : offset + stride])
        offset += stride
        for x in range(stride):
            a = line[x - channels] if x >= channels else 0
            b = previous[x]
            c = previous[x - channels] if x >= channels else 0
            if filter_type == 1:
                line[x] = (line[x] + a) & 255
            elif filter_type == 2:
                line[x] = (line[x] + b) & 255
            elif filter_type == 3:
                line[x] = (line[x] + ((a + b) // 2)) & 255
            elif filter_type == 4:
                p = a + b - c
                pa, pb, pc = abs(p - a), abs(p - b), abs(p - c)
                predictor = a if pa <= pb and pa <= pc else (b if pb <= pc else c)
                line[x] = (line[x] + predictor) & 255
            elif filter_type != 0:
                raise ValueError(f"未知 PNG filter：{filter_type}")
        rows.append(line)
        previous = line

    pixels: list[list[Pixel]] = []
    for line in rows:
        row: list[Pixel] = []
        for x in range(width):
            o = x * channels
            if color == 6:
                r, g, b, a = line[o], line[o + 1], line[o + 2], line[o + 3]
            elif color == 2:
                r, g, b, a = line[o], line[o + 1], line[o + 2], 255
            elif color == 4:
                r = g = b = line[o]
                a = line[o + 1]
            else:
                r = g = b = line[o]
                a = 255
            row.append((r, g, b, a))
        pixels.append(row)
    return width, height, pixels


def crop_square(pixels: list[list[Pixel]], width: int, height: int) -> tuple[int, int, list[list[Pixel]]]:
    side = min(width, height)
    left = (width - side) // 2
    top = (height - side) // 2
    return side, side, [row[left : left + side] for row in pixels[top : top + side]]


def remove_white_background(pixels: list[list[Pixel]], size: int, threshold: int = 230) -> None:
    """把与边界连通的近白区域设为透明；图标内部的白色文档/星星不连通，予以保留。"""
    near_white = lambda p: min(p[0], p[1], p[2]) >= threshold
    visited = [[False] * size for _ in range(size)]
    queue: deque[tuple[int, int]] = deque()
    for x in range(size):
        for y in (0, size - 1):
            if near_white(pixels[y][x]):
                queue.append((x, y))
    for y in range(size):
        for x in (0, size - 1):
            if near_white(pixels[y][x]):
                queue.append((x, y))

    while queue:
        x, y = queue.popleft()
        if visited[y][x] or not near_white(pixels[y][x]):
            continue
        visited[y][x] = True
        r, g, b, _ = pixels[y][x]
        pixels[y][x] = (r, g, b, 0)
        for nx, ny in ((x - 1, y), (x + 1, y), (x, y - 1), (x, y + 1)):
            if 0 <= nx < size and 0 <= ny < size and not visited[ny][nx] and near_white(pixels[ny][nx]):
                queue.append((nx, ny))


def resize(pixels: list[list[Pixel]], src_size: int, size: int) -> list[list[Pixel]]:
    """双线性缩放；RGB 先预乘 alpha，避免透明背景在边缘产生白边。"""
    premultiplied = [
        [(r * a // 255, g * a // 255, b * a // 255, a) for r, g, b, a in row]
        for row in pixels
    ]

    def sample(x: float, y: float) -> tuple[int, int, int, int]:
        x0 = min(int(x), src_size - 1)
        y0 = min(int(y), src_size - 1)
        x1, y1 = min(x0 + 1, src_size - 1), min(y0 + 1, src_size - 1)
        fx, fy = x - x0, y - y0
        out = []
        for channel in range(4):
            top = premultiplied[y0][x0][channel] * (1 - fx) + premultiplied[y0][x1][channel] * fx
            bottom = premultiplied[y1][x0][channel] * (1 - fx) + premultiplied[y1][x1][channel] * fx
            out.append(int(top * (1 - fy) + bottom * fy))
        return out[0], out[1], out[2], out[3]

    result: list[list[Pixel]] = []
    for j in range(size):
        sy = max(0.0, min(float(src_size - 1), (j + 0.5) * src_size / size - 0.5))
        row: list[Pixel] = []
        for i in range(size):
            sx = max(0.0, min(float(src_size - 1), (i + 0.5) * src_size / size - 0.5))
            pr, pg, pb, pa = sample(sx, sy)
            alpha = max(0, min(255, pa))
            if alpha:
                row.append((
                    min(255, pr * 255 // alpha),
                    min(255, pg * 255 // alpha),
                    min(255, pb * 255 // alpha),
                    alpha,
                ))
            else:
                row.append((0, 0, 0, 0))
        result.append(row)
    return result


# ---------------------------------------------------------------------------
# SVG 原图 → 高分辨率透明 PNG（headless Chromium）
# ---------------------------------------------------------------------------

BROWSER_CANDIDATES = (
    r"C:\Program Files\Google\Chrome\Application\chrome.exe",
    r"C:\Program Files (x86)\Google\Chrome\Application\chrome.exe",
    r"C:\Program Files (x86)\Microsoft\Edge\Application\msedge.exe",
    r"C:\Program Files\Microsoft\Edge\Application\msedge.exe",
    "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
    "/Applications/Microsoft Edge.app/Contents/MacOS/Microsoft Edge",
    "/Applications/Chromium.app/Contents/MacOS/Chromium",
    "/usr/bin/google-chrome",
    "/usr/bin/google-chrome-stable",
    "/usr/bin/chromium",
    "/usr/bin/chromium-browser",
)


def find_browser() -> str | None:
    for candidate in BROWSER_CANDIDATES:
        if Path(candidate).exists():
            return candidate
    for name in (
        "chrome",
        "msedge",
        "chromium",
        "chromium-browser",
        "google-chrome",
        "google-chrome-stable",
    ):
        found = shutil.which(name)
        if found:
            return found
    return None


def render_svg_to_png(size: int = 1024) -> None:
    """把 favicon.svg 光栅化为 1024×1024 透明 PNG，作为 ICO 各尺寸的采样源。"""
    browser = find_browser()
    if not browser:
        raise RuntimeError("找不到 Chrome / Edge，无法把 favicon.svg 渲染成位图")

    RENDER_HTML.parent.mkdir(parents=True, exist_ok=True)
    RENDER_HTML.write_text(
        "<!doctype html><html><head><meta charset='utf-8'><style>"
        "html,body{margin:0;padding:0;width:100%;height:100%;background:transparent;overflow:hidden}"
        f"img{{display:block;width:{size}px;height:{size}px}}"
        f"</style></head><body><img src='{SOURCE_SVG.resolve().as_uri()}'></body></html>",
        encoding="utf-8",
    )

    command = [
        browser,
        "--headless=new",
        "--disable-gpu",
        "--no-sandbox",
        "--no-first-run",
        "--no-default-browser-check",
        "--hide-scrollbars",
        "--force-device-scale-factor=1",
        f"--window-size={size},{size}",
        "--default-background-color=00000000",
        f"--user-data-dir={RENDER_HTML.parent / 'icon-chrome-profile'}",
        f"--screenshot={SOURCE_FILE.resolve()}",
        RENDER_HTML.resolve().as_uri(),
    ]
    result = subprocess.run(command, capture_output=True, timeout=120)
    if not SOURCE_FILE.exists() or SOURCE_FILE.stat().st_size == 0:
        detail = result.stderr.decode("utf-8", "replace")[-400:] if result.stderr else "无错误输出"
        raise RuntimeError(f"headless 渲染未产出 PNG：{detail}")


# ---------------------------------------------------------------------------
# 兜底：源图缺失时的程序化品牌色图标
# ---------------------------------------------------------------------------

def rounded_rect(px: float, py: float, left: float, top: float, right: float, bottom: float, radius: float) -> bool:
    if px < left or px > right or py < top or py > bottom:
        return False
    cx = min(max(px, left + radius), right - radius)
    cy = min(max(py, top + radius), bottom - radius)
    return (px - cx) ** 2 + (py - cy) ** 2 <= radius**2


def render_procedural(size: int) -> list[list[Pixel]]:
    pixels: list[list[Pixel]] = []
    for y in range(size):
        row: list[Pixel] = []
        for x in range(size):
            px, py = x / size, y / size
            if rounded_rect(px, py, 0.04, 0.04, 0.96, 0.96, 0.22):
                if rounded_rect(px, py, 0.30, 0.22, 0.70, 0.78, 0.05):
                    color = BRAND if (0.36 <= py <= 0.41 or 0.48 <= py <= 0.53 or 0.60 <= py <= 0.65) else WHITE
                else:
                    color = BRAND
                row.append((*color, 255))
            else:
                row.append((0, 0, 0, 0))
        pixels.append(row)
    return pixels


# ---------------------------------------------------------------------------
# ICO / PNG 输出
# ---------------------------------------------------------------------------

def bmp_image(size: int, pixels: list[list[Pixel]]) -> bytes:
    mask_row = ((size + 31) // 32) * 4
    and_mask = bytearray(mask_row * size)
    xor = bytearray()
    for y in range(size - 1, -1, -1):  # BMP 自下而上
        src_y = size - 1 - y
        for x, (r, g, b, a) in enumerate(pixels[y]):
            xor += bytes((b, g, r, a))
        for x, (_, _, _, a) in enumerate(pixels[y]):
            if a == 0:
                and_mask[src_y * mask_row + x // 8] |= 1 << (7 - x % 8)

    header = struct.pack(
        "<IiiHHIIiiII",
        40,
        size,
        size * 2,  # XOR + AND
        1,
        32,
        0,
        size * size * 4 + len(and_mask),
        0,
        0,
        0,
        0,
    )
    return header + bytes(xor) + bytes(and_mask)


def build_ico(images: list[tuple[int, list[list[Pixel]]]]) -> bytes:
    payloads = [(size, bmp_image(size, pixels)) for size, pixels in images]
    out = bytearray(struct.pack("<HHH", 0, 1, len(payloads)))
    offset = 6 + 16 * len(payloads)
    for size, data in payloads:
        out += struct.pack("<BBBBHHII", size % 256, size % 256, 0, 0, 1, 32, len(data), offset)
        offset += len(data)
    for _, data in payloads:
        out += data
    return bytes(out)


def png_chunk(kind: bytes, data: bytes) -> bytes:
    return struct.pack(">I", len(data)) + kind + data + struct.pack(">I", zlib.crc32(kind + data) & 0xFFFFFFFF)


def encode_png(pixels: list[list[Pixel]], size: int) -> bytes:
    raw = b"".join(b"\x00" + bytes(v for pixel in row for v in pixel) for row in pixels)
    return (
        b"\x89PNG\r\n\x1a\n"
        + png_chunk(b"IHDR", struct.pack(">IIBBBBB", size, size, 8, 6, 0, 0, 0))
        + png_chunk(b"IDAT", zlib.compress(raw, 9))
        + png_chunk(b"IEND", b"")
    )


def write_preview(pixels: list[list[Pixel]], size: int) -> None:
    PREVIEW_FILE.write_bytes(encode_png(pixels, size))


# macOS .icns：容器内直接放 PNG 压缩条目（10.7+ 支持），无需 iconutil。
ICNS_TYPES = {16: b"icp4", 32: b"icp5", 128: b"ic07", 256: b"ic08", 512: b"ic09"}


def write_icns(images: dict[int, list[list[Pixel]]]) -> None:
    body = bytearray()
    for size, kind in ICNS_TYPES.items():
        png = encode_png(images[size], size)
        body += kind + struct.pack(">I", len(png) + 8) + png
    ICNS_FILE.write_bytes(b"icns" + struct.pack(">I", len(body) + 8) + bytes(body))


def main() -> None:
    BUILD_DIR.mkdir(parents=True, exist_ok=True)
    origin = ""
    if SOURCE_SVG.exists():
        try:
            render_svg_to_png()
            origin = f"{SOURCE_SVG.relative_to(ROOT)}（SVG 原图 → 1024×1024 透明位图）"
        except Exception as err:
            print(f"[icon] 警告：SVG 渲染失败（{err}），回退到已有的 icon-source.png")

    source: tuple[int, list[list[Pixel]]] | None = None
    if SOURCE_FILE.exists():
        width, height, pixels = decode_png(SOURCE_FILE)
        side, side, pixels = crop_square(pixels, width, height)
        remove_white_background(pixels, side)
        source = (side, pixels)
        origin = origin or f"{SOURCE_FILE.name}（{width}×{height}）"
    else:
        origin = origin or "程序化兜底图形"

    images: list[tuple[int, list[list[Pixel]]]] = []
    for size in SIZES:
        images.append((size, resize(source[1], source[0], size) if source else render_procedural(size)))

    by_size = {size: pixels for size, pixels in images}
    by_size[512] = resize(source[1], source[0], 512) if source else render_procedural(512)

    ICO_FILE.write_bytes(build_ico(images))
    ICON_PNG.write_bytes(encode_png(by_size[512], 512))
    write_icns({size: by_size[size] for size in ICNS_TYPES})
    write_preview(by_size[256], 256)

    print(f"[icon] 来源：{origin}")
    for path in (ICO_FILE, ICNS_FILE, ICON_PNG, PREVIEW_FILE):
        print(f"[icon] 已生成 {path}（{path.stat().st_size / 1024:.0f} KB）")


if __name__ == "__main__":
    main()
