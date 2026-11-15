"""Fetch one stored context picture per preset site from NASA Moon Trek WMTS tiles."""
import json, math, os, sys, datetime
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from moon_trek_tiles import layer, composite
from PIL import Image

W, H = 960, 600
sites = json.load(open(sys.argv[1]))
sites = sites if isinstance(sites, list) else sites["sites"]
out = sys.argv[2]
os.makedirs(out, exist_ok=True)
manifest = {"retrieved_utc": datetime.datetime.now(datetime.timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ"),
            "service": "NASA Moon Trek WMTS, https://trek.nasa.gov/moon/", "width_px": W, "height_px": H, "sites": {}}
for s in sites:
    lat, lon = s["lat"], s["lon_east"]
    if lat <= -87.5:
        grid, label, z, title = "SP", "LRO_LOLA_ClrShade_SPole875_5mp_v04", 7, "LRO LOLA DEM, S Pole, 87.5 deg, ColorHillshade"
    elif lat <= -60.0:
        grid, label, z, title = "SP", "LRO_WAC_Mosaic_SPole60_100m_v02", 5, "LRO WAC Mosaic, S Pole v2"
    else:
        grid, label, z, title = "EQ", "LRO_WAC_Mosaic_Global_303ppd_v02", 7, "LRO WAC Mosaic v2"
    lyr = layer(grid, label)
    squeeze = math.cos(math.radians(lat)) if grid == "EQ" else 1.0
    img, info = composite(lyr, lat, lon, z, int(round(W / squeeze)), H, marker=False)
    if squeeze != 1.0:
        img = img.resize((W, H), Image.LANCZOS)
    img.convert("RGB").save(os.path.join(out, f"{s['id']}.jpg"), quality=82, optimize=True)
    manifest["sites"][s["id"]] = {"file": f"{s['id']}.jpg", "grid": grid, "layer": label, "layer_title": title, "zoom": z,
                                  "meters_per_pixel": info["meters_per_px"], "latitude_deg": lat, "longitude_east_deg": lon,
                                  "tiles": info["tiles"], "missing_tiles": info["missing"]}
    print(s["id"], grid, z, info)
json.dump(manifest, open(os.path.join(out, "manifest.json"), "w"), indent=2)
