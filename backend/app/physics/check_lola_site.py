
from pathlib import Path
import rasterio
from rasterio.warp import transform

PHYSICS_DIR = Path(__file__).resolve().parent
LOLA_DIR = PHYSICS_DIR / "data" / "datasets" / "lola"

latitude = -89.684
longitude = 196.739

for filename in [
    "LDEM_80S_80MPP_ADJ.tiff",
    "LDEM_60S_240MPP_ADJ.tiff",
]:
    path = LOLA_DIR / filename

    print("\n" + "=" * 55)
    print(filename)

    with rasterio.open(path) as dem:
        # Convert geographic coordinates to the DEM projection
        xs, ys = transform(
            dem.crs.geodetic_crs,
            dem.crs,
            [longitude],
            [latitude],
        )

        x, y = xs[0], ys[0]

        print("Projected X:", x)
        print("Projected Y:", y)
        print("DEM bounds:", dem.bounds)

        if dem.bounds.left <= x <= dem.bounds.right and \
           dem.bounds.bottom <= y <= dem.bounds.top:

            row, col = dem.index(x, y)
            elevation = next(dem.sample([(x, y)]))[0]
            print("Pixel row:", row)
            print("Pixel column:", col)
            print("Elevation:", elevation, "m")
            print("Inside DEM: YES")
        else:
            print("Inside DEM: NO")
