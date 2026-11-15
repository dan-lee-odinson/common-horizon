
from pathlib import Path
import rasterio

lola_dir = Path(__file__).resolve().parent / "data" / "datasets" / "lola"

for path in sorted(lola_dir.iterdir()):
    if not path.is_file():
        continue

    print("\n" + "=" * 60)
    print(f"FILE: {path.name}")
    print("=" * 60)

    with rasterio.open(path) as dem:
        print("CRS:", dem.crs)
        print("Dimensions:", dem.width, "x", dem.height)
        print("Resolution:", dem.res)
        print("Bounds:", dem.bounds)
        print("Transform:", dem.transform)
        print("Data type:", dem.dtypes)
        print("NoData:", dem.nodata)
        print("Band count:", dem.count)
        print("Metadata:", dem.tags())
        print("Band metadata:", dem.tags(1))
