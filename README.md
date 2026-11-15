# Common Horizon

## Physics Engine Data Sources
The physics engine uses NASA/JPL SPICE kernels to calculate time-dependent Sun and Earth positions relative to the Moon, transforming them into local azimuth and elevation at a landing site. Calculations use the `MOON_ME` reference frame, kilometer-based position vectors, planetocentric latitude, east-positive longitude, and azimuth measured clockwise from north, with a default observer height of 2.0 m. Terrain elevation and horizon calculations use NASA Lunar Orbiter Laser Altimeter (LOLA) digital elevation models, including 80 m and 240 m polar datasets and a 118 m global dataset. Precomputed terrain horizon profiles are used as the runtime skyline where available, while the engine's horizon calculation supports generating profiles and providing a fallback. In a direct comparison of our 80 m nearest-pixel horizon calculations against PR #12's stored profiles (generated using a 40 m DEM and bilinear interpolation), Nobile's mean absolute elevation difference was 1.43° for directions whose local skyline points were within 1 km and 0.0212° for directions whose local skyline points were beyond 30 km.

### 1. SPICE Kernels
Download the following four files from NASA/JPL NAIF for lunar ephemerides and reference frames:
Leap seconds: `naif0012.tls` https://naif.jpl.nasa.gov/pub/naif/generic_kernels/lsk/
Sun/Earth/Moon Positions: `de440s.bsp` https://naif.jpl.nasa.gov/pub/naif/generic_kernels/spk/planets/
Moon orientation:`moon_pa_de440_200625.bpc` https://naif.jpl.nasa.gov/pub/naif/generic_kernels/pck/moon_pa_de440_200625.bpc
Moon reference frame: `moon_de440_250416.tf` https://naif.jpl.nasa.gov/pub/naif/generic_kernels/fk/satellites/

Place all four files in:
`backend/app/physics/data/datasets/spice/`

### 2. LOLA Elevation Models
The physics engine uses these three LOLA DEM products for lunar terrain elevation and horizon calculations.: https://pgda.gsfc.nasa.gov/data/LOLA_20mpp/
`LDEM_80S_80MPP_ADJ.tiff` 80 m/pixel 80°S to south pole
`LDEM_60S_240MPP_ADJ.tiff`  240 m/pixel 60°S to south pole
`Lunar_LRO_LOLA_Global_LDEM_118m_Mar2014.tif` 118 m/pixel Global in Google Drive

Place all three files in:
`backend/app/physics/data/datasets/lola/`