"""Build small height files for the website's Site view from NASA Moon Trek LOLA elevation.

For each preset site: a NEAR grid (129 x 129 posts, 10 m apart, 1.28 km across) from the finest LOLA
model Moon Trek has there; and a FAR grid (257 x 257 posts, 250 m apart, 64 km across) from the 100 m south
polar model for sites south of 60 S and from the global 128 pixel-per-degree model elsewhere. Heights are meters above the horizontal plane through
the site (the Moon's curvature is already taken out of the far grid, so far ground drops away as it
does on the real Moon). Row 0 is the north edge, column 0 the west edge.
"""
import json, math, os, subprocess, sys, datetime, tempfile
import numpy as np
import rasterio

R = 1_737_400.0
SUBSET = "https://trek.nasa.gov/moon/TrekWS/rest/transform/latlon/subset/stream/tiff"
RAW = os.environ.get("SITE_TERRAIN_RAW", os.path.join(tempfile.gettempdir(), "site-terrain-raw"))
os.makedirs(RAW, exist_ok=True)


def fetch(name, layer, ulx, uly, lrx, lry):
    path = os.path.join(RAW, name)
    if not os.path.exists(path):
        url = f"{SUBSET}?src={layer}&ulx={ulx}&uly={uly}&lrx={lrx}&lry={lry}"
        r = subprocess.run(["curl", "-sS", "-m", "180", "-o", path, "-w", "%{http_code}", url], capture_output=True, text=True)
        if r.stdout.strip() != "200":
            os.remove(path)
            raise RuntimeError(f"{layer}: HTTP {r.stdout.strip()}")
    return path


def polar_xy(lat, lon_east):
    r = 2.0 * R * np.tan(np.pi / 4.0 + np.radians(lat) / 2.0)
    lam = np.radians(lon_east)
    return r * np.sin(lam), r * np.cos(lam)


def local_grid(lat0, lon0, n, spacing):
    """Latitude and longitude of an n x n grid of posts in the site's east/north tangent plane."""
    half = (n - 1) / 2.0 * spacing
    east = np.linspace(-half, half, n)[None, :].repeat(n, 0)
    north = np.linspace(half, -half, n)[:, None].repeat(n, 1)
    d = np.hypot(east, north)
    psi = d / R
    theta = np.arctan2(east, north)
    p1 = math.radians(lat0)
    lat = np.arcsin(np.sin(p1) * np.cos(psi) + np.cos(p1) * np.sin(psi) * np.cos(theta))
    lon = math.radians(lon0) + np.arctan2(np.sin(theta) * np.sin(psi) * np.cos(p1), np.cos(psi) - np.sin(p1) * np.sin(lat))
    return np.degrees(lat), np.degrees(lon), d


def sample(path, xs, ys):
    """Bilinear sample of a GeoTIFF at map coordinates (the file's own units)."""
    with rasterio.open(path) as ds:
        a = ds.read(1).astype("float64")
        nod = ds.nodata
        t = ds.transform
    if nod is not None:
        a[a == nod] = np.nan
    col = (xs - t.c) / t.a - 0.5
    row = (ys - t.f) / t.e - 0.5
    c0 = np.clip(np.floor(col).astype(int), 0, a.shape[1] - 2)
    r0 = np.clip(np.floor(row).astype(int), 0, a.shape[0] - 2)
    fc = np.clip(col - c0, 0, 1)
    fr = np.clip(row - r0, 0, 1)
    out = (a[r0, c0] * (1 - fc) * (1 - fr) + a[r0, c0 + 1] * fc * (1 - fr) + a[r0 + 1, c0] * (1 - fc) * fr + a[r0 + 1, c0 + 1] * fc * fr)
    inside = (col >= -0.5) & (col <= a.shape[1] - 0.5) & (row >= -0.5) & (row <= a.shape[0] - 0.5)
    out[~inside] = np.nan
    return out


def polar_patch(sid, layer, lat0, lon0, half_m, tag):
    x0, y0 = polar_xy(lat0, lon0)
    m = half_m * 1.5 + 200
    return fetch(f"{sid}.{tag}.{layer}.tif", layer, round(x0 - m), round(y0 + m), round(x0 + m), round(y0 - m))


def grid_sample(g, sp, e, nn):
    n = g.shape[0]
    half = (n - 1) / 2.0 * sp
    col = (e + half) / sp
    row = (half - nn) / sp
    c0 = np.clip(np.floor(col).astype(int), 0, n - 2)
    r0 = np.clip(np.floor(row).astype(int), 0, n - 2)
    fc, fr = col - c0, row - r0
    return g[r0, c0] * (1 - fc) * (1 - fr) + g[r0, c0 + 1] * fc * (1 - fr) + g[r0 + 1, c0] * (1 - fc) * fr + g[r0 + 1, c0 + 1] * fc * fr


def skyline(near, sp, far, sp2, eye_m=2.0):
    """Highest ground seen from 2 m above the site, in each of 720 directions, out to 31.9 km."""
    dn = np.arange(60.0, 640.0, 5.0)
    df = np.arange(640.0, 31900.0, 125.0)
    best = []
    for az in np.radians(np.arange(0.0, 360.0, 0.5)):
        y = np.concatenate([grid_sample(near, sp, dn * np.sin(az), dn * np.cos(az)), grid_sample(far, sp2, df * np.sin(az), df * np.cos(az))])
        best.append(np.degrees(np.max(np.arctan2(y - eye_m, np.concatenate([dn, df])))))
    best = np.array(best)
    i = int(best.argmax())
    return {"what": "highest ground in view from 2 m above the site, out to 31.9 km, worked out from these two files",
            "highest_deg": round(float(best.max()), 2), "highest_at_azimuth_deg": i * 0.5,
            "lowest_deg": round(float(best.min()), 2), "share_of_directions_above_1_deg": round(float((best > 1.0).mean()), 3)}


def build(site):
    sid, lat0, lon0 = site["id"], site["lat"], site["lon_east"]
    out = {"latitude_deg": lat0, "longitude_east_deg": lon0}
    # NEAR
    n, sp = 129, 10.0
    lat, lon, d = local_grid(lat0, lon0, n, sp)
    if lat0 <= -87.6:
        layer, px = "LRO_LOLA_DEM_SPole875_5mp_v04", 5.0
    elif lat0 <= -75.0:
        layer, px = "LRO_LOLA_DEM_SPole75_30mp_v04", 30.0
    else:
        layer, px = "LRO_LOLA_DEM_Global_128ppd_v04", round(math.pi * R / 180.0 / 128.0, 1)
    if layer.startswith("LRO_LOLA_DEM_SPole"):
        path = polar_patch(sid, layer, lat0, lon0, 640, "near")
        xs, ys = polar_xy(lat, lon)
        h = sample(path, xs, ys)
    else:
        l180 = ((lon0 + 180.0) % 360.0) - 180.0
        fx, fy = math.floor(l180), math.floor(lat0)
        path = fetch(f"{sid}.near.{layer}.tif", layer, fx - 1, fy + 2, fx + 2, fy - 1)
        h = sample(path, ((lon + 180.0) % 360.0) - 180.0, lat)
    if np.isnan(h).any():
        raise RuntimeError(f"{sid}: near grid has gaps in {layer}")
    c = (n - 1) // 2
    h0 = h[c, c]
    near = (h - h0).astype("<f4")
    out["near"] = {"file": f"{sid}.near.f32", "posts": n, "spacing_m": sp, "layer": layer, "layer_pixel_m": px,
                   "site_elevation_m": round(float(h0), 1), "min_m": round(float(near.min()), 1), "max_m": round(float(near.max()), 1)}
    # FAR, every site
    n2, sp2 = 257, 250.0
    lat2, lon2, d2 = local_grid(lat0, lon0, n2, sp2)
    if lat0 <= -60.0:
        layer2, px2 = "LRO_LOLA_DEM_SPole45_100mp_v04", 100.0
        path2 = polar_patch(sid, layer2, lat0, lon0, 32000, "far")
        xs, ys = polar_xy(lat2, lon2)
        h2 = sample(path2, xs, ys)
    else:
        layer2, px2 = "LRO_LOLA_DEM_Global_128ppd_v04", round(math.pi * R / 180.0 / 128.0, 1)
        l180 = ((lon0 + 180.0) % 360.0) - 180.0
        fx, fy = math.floor(l180), math.floor(lat0)
        path2 = fetch(f"{sid}.far.{layer2}.tif", layer2, fx - 2, fy + 3, fx + 3, fy - 2)
        h2 = sample(path2, ((lon2 + 180.0) % 360.0) - 180.0, lat2)
    if np.isnan(h2).any():
        raise RuntimeError(f"{sid}: far grid has gaps in {layer2}")
    c2 = (n2 - 1) // 2
    hc = h2[c2, c2]
    psi = d2 / R
    y = (R + h2) * np.cos(psi) - (R + hc)          # height above the site's horizontal plane
    far = y.astype("<f4")
    out["far"] = {"file": f"{sid}.far.f32", "posts": n2, "spacing_m": sp2, "layer": layer2, "layer_pixel_m": px2,
                  "site_elevation_m": round(float(hc), 1), "min_m": round(float(far.min()), 1), "max_m": round(float(far.max()), 1),
                  "curvature": "included"}
    out["skyline_from_these_files"] = skyline(near, sp, far, sp2)
    return out, near, far


if __name__ == "__main__":
    sites = json.load(open(sys.argv[1]))
    sites = sites if isinstance(sites, list) else sites["sites"]
    outdir = sys.argv[2]
    horizon_dir = sys.argv[3] if len(sys.argv) > 3 else None
    os.makedirs(outdir, exist_ok=True)
    man = {"format": "common-horizon/site-terrain", "format_version": 1,
           "what": "Heights around each preset site, in meters above the horizontal plane through the site. Row 0 is the north edge, column 0 the west edge. Little-endian 32-bit floats, row by row.",
           "source": "NASA Moon Trek (https://trek.nasa.gov/moon/), LOLA elevation layers, subset service " + SUBSET,
           "fetched_utc": datetime.datetime.now(datetime.timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ"), "sites": {}}
    for s in sites:
        try:
            meta, near, far = build(s)
        except Exception as e:
            print(s["id"], "FAILED", e); continue
        near.tofile(os.path.join(outdir, meta["near"]["file"]))
        far.tofile(os.path.join(outdir, meta["far"]["file"]))
        if horizon_dir:
            meta["engine_sunlight_uses_terrain_skyline"] = os.path.exists(os.path.join(horizon_dir, s["id"] + ".json"))
        man["sites"][s["id"]] = meta
        k = meta["skyline_from_these_files"]
        print(f"{s['id']:18s} engine_terrain={meta.get('engine_sunlight_uses_terrain_skyline')!s:5s} far {meta['far']['layer_pixel_m']:g} m  {meta['far']['min_m']:8.0f} {meta['far']['max_m']:7.0f} m | skyline highest {k['highest_deg']:6.2f} deg at az {k['highest_at_azimuth_deg']:5.1f}, lowest {k['lowest_deg']:6.2f}, above 1 deg in {k['share_of_directions_above_1_deg']*100:3.0f}% of directions")
    json.dump(man, open(os.path.join(outdir, "manifest.json"), "w"), indent=1)
