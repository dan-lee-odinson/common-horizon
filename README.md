# Common Horizon

## Physics Engine Data Sources
The physics engine uses NASA/JPL SPICE kernels for lunar ephemerides and
reference frames, and NASA LOLA digital elevation models (DEMs) for
lunar terrain elevation and horizon calculations.

### 1. SPICE Kernels
Download the following four files from NASA/JPL NAIF:
Leap seconds: `naif0012.tls` https://naif.jpl.nasa.gov/pub/naif/generic_kernels/lsk/
Sun/Earth/Moon Positions: `de440s.bsp` https://naif.jpl.nasa.gov/pub/naif/generic_kernels/spk/planets/
Moon orientation:`moon_pa_de440_200625.bpc` https://naif.jpl.nasa.gov/pub/naif/generic_kernels/pck/moon_pa_de440_200625.bpc
Moon reference frame: `moon_de440_250416.tf` https://naif.jpl.nasa.gov/pub/naif/generic_kernels/fk/satellites/

Place all four files in:
`backend/app/physics/data/datasets/spice/`

### 2. LOLA Elevation Models
The physics engine uses these three LOLA DEM products: https://pgda.gsfc.nasa.gov/data/LOLA_20mpp/
`LDEM_80S_80MPP_ADJ.tiff` 80 m/pixel 80°S to south pole
`LDEM_60S_240MPP_ADJ.tiff`  240 m/pixel 60°S to south pole
`Lunar_LRO_LOLA_Global_LDEM_118m_Mar2014.tif` 118 m/pixel Global in Google Drive

Place all three files in:
`backend/app/physics/data/datasets/lola/`