"""Moon Trek tile math, checked against the live service (Apollo 15 lands on Hadley Rille, the ridge site on Shackleton's rim).

Builds one picture centered on a site from Moon Trek WMTS tiles. Two grids:
  EQ  equirectangular, degrees, top-left (-180, 90), 180/(256*2^z) degrees per pixel
  SP  south polar stereographic on a 1,737,400 m sphere, meters, per-layer origin and scale
"""
import io, json, math, os, re, subprocess, sys
from PIL import Image, ImageDraw

R_MOON = 1_737_400.0
BASE = "https://trek.nasa.gov/tiles/Moon"
CACHE = os.path.join(os.path.dirname(os.path.abspath(__file__)), "cache")
os.makedirs(CACHE, exist_ok=True)


def fetch(url, name):
    path = os.path.join(CACHE, name)
    if not os.path.exists(path):
        r = subprocess.run(["curl", "-sS", "-m", "40", "-o", path, "-w", "%{http_code}", url], capture_output=True, text=True)
        if r.stdout.strip() != "200":
            if os.path.exists(path):
                os.remove(path)
            return None
    return path


def layer(grid, label):
    """Read a layer's tile grid from its WMTS capabilities file."""
    p = fetch(f"{BASE}/{grid}/{label}/1.0.0/WMTSCapabilities.xml", f"caps_{grid}_{label}.xml")
    if p is None:
        raise SystemExit(f"no capabilities for {grid}/{label}")
    t = re.sub(r"<!--.*?-->", "", open(p).read(), flags=re.S)
    ext = re.search(r"\{TileCol\}\.(\w+)", t).group(1)
    levels = []
    for m in re.finditer(r"<TileMatrix>(.*?)</TileMatrix>", t, flags=re.S):
        b = m.group(1)
        g = lambda tag: re.search(rf"<(?:ows:)?{tag}>([^<]+)<", b).group(1)
        x0, y0 = (float(v) for v in g("TopLeftCorner").split())
        levels.append(dict(z=int(g("Identifier")), scale=float(g("ScaleDenominator")), x0=x0, y0=y0,
                           mw=int(float(g("MatrixWidth"))), mh=int(float(g("MatrixHeight")))))
    return dict(grid=grid, label=label, ext=ext, levels=levels)


def project(grid, lat, lon_east):
    """Site position in the grid's own units (degrees for EQ, meters for SP)."""
    if grid == "EQ":
        lon = ((lon_east + 180.0) % 360.0) - 180.0
        return lon, lat
    phi, lam = math.radians(lat), math.radians(lon_east)
    r = 2.0 * R_MOON * math.tan(math.pi / 4.0 + phi / 2.0)
    return r * math.sin(lam), r * math.cos(lam)


def units_per_pixel(lyr, z):
    lv = next(l for l in lyr["levels"] if l["z"] == z)
    if lyr["grid"] == "EQ":
        return 180.0 / (256.0 * 2 ** z), lv
    return lv["scale"] * 0.00028, lv


def composite(lyr, lat, lon_east, z, w=640, h=420, marker=True):
    upp, lv = units_per_pixel(lyr, z)
    x, y = project(lyr["grid"], lat, lon_east)
    px, py = (x - lv["x0"]) / upp, (lv["y0"] - y) / upp
    left, top = px - w / 2.0, py - h / 2.0
    img = Image.new("RGBA", (w, h), (20, 20, 24, 255))
    got = miss = 0
    for row in range(int(math.floor(top / 256)), int(math.floor((top + h) / 256)) + 1):
        for col in range(int(math.floor(left / 256)), int(math.floor((left + w) / 256)) + 1):
            if row < 0:
                continue
            # The global grid wraps at 180 degrees: column 2^(z+1) is column 0 again. The polar grids do not wrap.
            tcol = col % (2 ** (z + 1)) if lyr["grid"] == "EQ" else col
            if tcol < 0:
                continue
            url = f"{BASE}/{lyr['grid']}/{lyr['label']}/1.0.0/default/default028mm/{z}/{row}/{tcol}.{lyr['ext']}"
            p = fetch(url, f"{lyr['grid']}_{lyr['label']}_{z}_{row}_{tcol}.{lyr['ext']}")
            if p is None:
                miss += 1
                continue
            got += 1
            tile = Image.open(p).convert("RGBA")
            img.paste(tile, (int(round(col * 256 - left)), int(round(row * 256 - top))), tile)
    if marker:
        d = ImageDraw.Draw(img)
        cx, cy = w // 2, h // 2
        d.ellipse([cx - 9, cy - 9, cx + 9, cy + 9], outline=(255, 190, 60, 255), width=2)
        d.line([cx - 16, cy, cx - 4, cy], fill=(255, 190, 60, 255), width=2)
        d.line([cx + 4, cy, cx + 16, cy], fill=(255, 190, 60, 255), width=2)
        d.line([cx, cy - 16, cx, cy - 4], fill=(255, 190, 60, 255), width=2)
        d.line([cx, cy + 4, cx, cy + 16], fill=(255, 190, 60, 255), width=2)
    if lyr["grid"] == "EQ":
        meters_per_px = upp * math.pi * R_MOON / 180.0  # north-south
    else:
        k = 2.0 / (1.0 + math.sin(math.radians(abs(lat))))  # stereographic scale factor at this latitude
        meters_per_px = upp / k
    return img, dict(z=z, tiles=got, missing=miss, meters_per_px=round(meters_per_px, 2), pixel=(round(px, 1), round(py, 1)))
