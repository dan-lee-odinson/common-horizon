"""Build one surface picture per preset site for the website's Site view, from NASA Moon Trek tiles.

Each picture covers the same 64 km square as the site's far terrain file (32 km each way from the
site, in the plane that touches the Moon at the site). 1024 x 1024 pixels, 62.5 m per pixel, row 0 is
the north edge and column 0 the west edge, so pixel (row, col) lies over the ground at
east = -32000 + (col + 0.5) * 62.5 m and north = 32000 - (row + 0.5) * 62.5 m.

Source layers: the LROC Wide Angle Camera mosaics served by Moon Trek.
"""
import json, math, os, sys, datetime
import numpy as np
from PIL import Image
sys.path.insert(0, os.path.join(os.path.dirname(os.path.abspath(__file__)), "..", "site-context"))
sys.path.insert(0, os.path.join(os.path.dirname(os.path.abspath(__file__)), "..", "site-terrain"))
import moon_trek_tiles as mt  # noqa: E402

R = 1_737_400.0
N, HALF = 1024, 32_000.0
EQ = ("EQ", "LRO_WAC_Mosaic_Global_303ppd_v02", 8)
SP = ("SP", "LRO_WAC_Mosaic_SPole60_100m_v02", 5)


def local_lat_lon(lat0, lon0):
    step = 2 * HALF / N
    east = (-HALF + (np.arange(N) + 0.5) * step)[None, :].repeat(N, 0)
    north = (HALF - (np.arange(N) + 0.5) * step)[:, None].repeat(N, 1)
    d = np.hypot(east, north)
    psi, theta = d / R, np.arctan2(east, north)
    p1 = math.radians(lat0)
    lat = np.arcsin(np.sin(p1) * np.cos(psi) + np.cos(p1) * np.sin(psi) * np.cos(theta))
    lon = math.radians(lon0) + np.arctan2(np.sin(theta) * np.sin(psi) * np.cos(p1), np.cos(psi) - np.sin(p1) * np.sin(lat))
    return np.degrees(lat), np.degrees(lon)


def build(site):
    lat0, lon0 = site["lat"], site["lon_east"]
    grid, label, z = SP if lat0 <= -60.0 else EQ
    lyr = mt.layer(grid, label)
    upp, lv = mt.units_per_pixel(lyr, z)
    lat, lon = local_lat_lon(lat0, lon0)
    if grid == "EQ":
        l180 = ((lon + 180.0) % 360.0) - 180.0
        px, py = (l180 - lv["x0"]) / upp, (lv["y0"] - lat) / upp
        native_m = upp * math.pi * R / 180.0
    else:
        r = 2.0 * R * np.tan(np.pi / 4.0 + np.radians(lat) / 2.0)
        lam = np.radians(lon)
        px, py = (r * np.sin(lam) - lv["x0"]) / upp, (lv["y0"] - r * np.cos(lam)) / upp
        native_m = upp / (2.0 / (1.0 + math.sin(math.radians(abs(lat0)))))
    c0, c1 = int(math.floor(px.min() / 256)), int(math.floor(px.max() / 256))
    r0, r1 = int(math.floor(py.min() / 256)), int(math.floor(py.max() / 256))
    if (c1 - c0 + 1) * (r1 - r0 + 1) > 400:
        raise RuntimeError(f"{site['id']}: too many tiles ({c0}..{c1}, {r0}..{r1}); the square crosses the 180 degree line")
    mosaic = np.zeros(((r1 - r0 + 1) * 256, (c1 - c0 + 1) * 256), dtype="float32")
    got = miss = 0
    for row in range(r0, r1 + 1):
        for col in range(c0, c1 + 1):
            tcol = col % (2 ** (z + 1)) if grid == "EQ" else col
            url = f"{mt.BASE}/{grid}/{label}/1.0.0/default/default028mm/{z}/{row}/{tcol}.{lyr['ext']}"
            p = mt.fetch(url, f"{grid}_{label}_{z}_{row}_{tcol}.{lyr['ext']}") if row >= 0 and tcol >= 0 else None
            if p is None:
                miss += 1
                continue
            got += 1
            mosaic[(row - r0) * 256:(row - r0 + 1) * 256, (col - c0) * 256:(col - c0 + 1) * 256] = np.asarray(Image.open(p).convert("L"), dtype="float32")
    x, y = px - c0 * 256 - 0.5, py - r0 * 256 - 0.5
    x0 = np.clip(np.floor(x).astype(int), 0, mosaic.shape[1] - 2)
    y0 = np.clip(np.floor(y).astype(int), 0, mosaic.shape[0] - 2)
    fx, fy = np.clip(x - x0, 0, 1), np.clip(y - y0, 0, 1)
    out = (mosaic[y0, x0] * (1 - fx) * (1 - fy) + mosaic[y0, x0 + 1] * fx * (1 - fy) + mosaic[y0 + 1, x0] * (1 - fx) * fy + mosaic[y0 + 1, x0 + 1] * fx * fy)
    return np.clip(out, 0, 255).astype("uint8"), dict(file=f"{site['id']}.jpg", layer=label, grid=grid, zoom=z, layer_pixel_m=round(native_m, 1),
                                                       tiles=got, tiles_missing=miss, mean_brightness=round(float(out.mean()), 1))


def relief(site):
    """A neutral relief picture worked out from LOLA heights (lit evenly from four sides), for sites
    where the camera mosaic is mostly permanent shadow."""
    import fetch_site_terrain as ft
    lat0, lon0 = site["lat"], site["lon_east"]
    layer = "LRO_LOLA_DEM_SPole45_100mp_v04"
    path = ft.polar_patch(site["id"], layer, lat0, lon0, 32000, "far")
    lat, lon = local_lat_lon(lat0, lon0)
    xs, ys = ft.polar_xy(lat, lon)
    h = ft.sample(path, xs, ys)
    step = 2 * HALF / N
    gy, gx = np.gradient(h, step)
    nx, ny, nz = -gx, gy, np.ones_like(h)
    ln = np.sqrt(nx ** 2 + ny ** 2 + nz ** 2)
    total = np.zeros_like(h)
    alt = math.radians(35.0)
    for az in (45.0, 135.0, 225.0, 315.0):
        a = math.radians(az)
        total += np.clip((nx * math.sin(a) * math.cos(alt) + ny * math.cos(a) * math.cos(alt) + nz * math.sin(alt)) / ln, 0, 1)
    s = total / 4.0
    lo, hi = np.percentile(s, 1), np.percentile(s, 99)
    out = 70.0 + 150.0 * np.clip((s - lo) / (hi - lo + 1e-9), 0, 1)
    return out.astype("uint8"), dict(file=f"{site['id']}.jpg", layer=layer, grid="SP", zoom=None, layer_pixel_m=100.0, kind="relief worked out from LOLA heights, lit evenly from four sides",
                                     mean_brightness=round(float(out.mean()), 1))


if __name__ == "__main__":
    sites = json.load(open(sys.argv[1]))
    sites = sites if isinstance(sites, list) else sites["sites"]
    outdir = sys.argv[2]
    os.makedirs(outdir, exist_ok=True)
    man = {"format": "common-horizon/site-texture", "format_version": 1,
           "what": "One grayscale picture of the ground per preset site, 1024 x 1024 pixels over the same 64 km square as the site's far terrain file. Row 0 is the north edge, column 0 the west edge; 62.5 m per pixel.",
           "source": "NASA Moon Trek (https://trek.nasa.gov/moon/): LROC Wide Angle Camera mosaics (WMTS tiles); where more than a quarter of the mosaic is in shadow, a relief picture worked out from LOLA elevation instead",
           "credit": "Camera mosaics: NASA/GSFC/Arizona State University. LOLA elevation: NASA/GSFC.",
           "pixels": N, "half_width_m": HALF, "fetched_utc": datetime.datetime.now(datetime.timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ"), "sites": {}}
    for s in sites:
        try:
            img, meta = build(s)
            meta["kind"] = "camera mosaic"
            dark = float((img < 12).mean())
            meta["share_in_shadow"] = round(dark, 3)
            if dark > 0.25:
                img, meta = relief(s)
                meta["share_in_shadow_of_camera_mosaic"] = round(dark, 3)
        except Exception as e:
            print(s["id"], "FAILED", e)
            continue
        Image.fromarray(img, "L").save(os.path.join(outdir, meta["file"]), quality=86)
        man["sites"][s["id"]] = meta
        print(f"{s['id']:18s} {meta['kind'][:14]:14s} {meta['layer'][-22:]:22s} native {meta['layer_pixel_m']:6.1f} m/px mean {meta['mean_brightness']} shadow share {meta.get('share_in_shadow', meta.get('share_in_shadow_of_camera_mosaic'))}")
    json.dump(man, open(os.path.join(outdir, "manifest.json"), "w"), indent=1)
