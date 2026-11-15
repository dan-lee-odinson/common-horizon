
from pathlib import Path
import math
import numpy as np
import rasterio
from rasterio.warp import transform

# Locate project data
PHYSICS_DIR = Path(__file__).resolve().parent
LOLA_DIR = PHYSICS_DIR / "data" / "datasets" / "lola"

# Landing sites: latitude, east-positive longitude
SITES = {
    "Shackleton Connecting Ridge": (-89.684, 196.739),
    "Mons Mouton": (-85.42088, 31.6218),
    "IM-2 Athena": (-84.7906, 29.1957),
    "IM-1 Odysseus": (-80.13, 1.44),
    "Chandrayaan-3": (-69.373, 32.319),
    "Apollo 11": (0.67416, 23.47314),
    "Apollo 12": (-3.0128, 336.5781),
    "Apollo 14": (-3.64589, 342.52806),
    "Apollo 15": (26.13239, 3.63330),
    "Apollo 16": (-8.9734, 15.5011),
    "Apollo 17": (20.1911, 30.7723),
    "Blue Ghost Mission 1": (18.562, 61.810),
    "SLIM": (-13.3160, 25.2510),
}

# Preferred DEM order:
# 80 m polar, 240 m polar, then 118 m global fallback.git statusgit status
DEM_FILES = [
    ("80 m polar", "LDEM_80S_80MPP_ADJ.tiff"),
    ("240 m polar", "LDEM_60S_240MPP_ADJ.tiff"),
    ("118 m global", "Lunar_LRO_LOLA_Global_LDEM_118m_Mar2014.tif"),
]

results = []

for site_name, (latitude, longitude) in SITES.items():

    print("\n" + "=" * 65)
    print(site_name)
    print(f"Latitude: {latitude}, Longitude: {longitude} E")

    available_dems = []

    for dem_name, filename in DEM_FILES:

        path = LOLA_DIR / filename

        with rasterio.open(path) as dem:

            xs, ys = transform(
                dem.crs.geodetic_crs,
                dem.crs,
                [longitude],
                [latitude],
            )

            x, y = xs[0], ys[0]

            inside = (
                dem.bounds.left <= x <= dem.bounds.right
                and dem.bounds.bottom <= y <= dem.bounds.top
            )

            if not inside:
                print(f"{dem_name}: OUTSIDE")
                continue

            row, col = dem.index(x, y)
            value = next(dem.sample([(x, y)], masked=True))[0]

            valid = (
                not np.ma.is_masked(value)
                and math.isfinite(float(value))
            )

            if valid:
                raw_elevation = float(value)
                elevation = (
                    raw_elevation * dem.scales[0]
                    + dem.offsets[0]
                )
                print(
                    f"{dem_name}: COVERED | "
                    f"row={row}, col={col} | "
                    f"elevation={elevation:.2f} m"
                )
                available_dems.append(dem_name)
            else:
                print(f"{dem_name}: BOUNDS COVER SITE, PIXEL INVALID")

    if available_dems:
        # Prefer the 80 m polar DEM, then 240 m polar,
        # then global DEM.
        selected = available_dems[0]
    else:
        selected = "NO VALID DEM"

    print("SELECTED DEM:", selected)

    results.append((site_name, selected))

print("\n\n" + "=" * 65)
print("FINAL DEM COVERAGE SUMMARY")
print("=" * 65)

for site_name, selected in results:
    print(f"{site_name:<32} {selected}")
