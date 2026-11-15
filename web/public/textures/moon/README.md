# Moon surface maps

Four images of the Moon's surface for the website's 3D Moon. All are full-globe maps in a simple
cylindrical (equirectangular) layout: north is up, the centre column is 0° longitude, and the
left and right edges are 180°.

| File | Size | What it is |
|---|---|---|
| `moon-color-4k.jpg` | 4096 x 2048 | Surface color |
| `moon-color-2k.jpg` | 2048 x 1024 | Surface color, smaller, for phones |
| `moon-normal-4k.jpg` | 4096 x 2048 | Terrain relief as a normal map |
| `moon-normal-2k.jpg` | 2048 x 1024 | Terrain relief as a normal map, smaller |

## Source

NASA's CGI Moon Kit, Scientific Visualization Studio, Goddard Space Flight Center:
<https://svs.gsfc.nasa.gov/4720>. Credit: NASA's Scientific Visualization Studio (visualizer
Ernie Wright, scientist Noah Petro). The color map comes from Lunar Reconnaissance Orbiter Camera
imagery and the heights from the Lunar Orbiter Laser Altimeter. NASA describes the color map as
made for visual use, not for science. Downloaded 15 November 2026.

| NASA file | SHA-256 of the download |
|---|---|
| `lroc_color_16bit_srgb_4k.tif` | `9731fa8af425b6c2f88f277ecca82bf8c603f3743894f64ed7b25c5bfefa22ff` |
| `lroc_color_2k.jpg` | `f7130a1822681fa7512d7dcfd40db8c10b9ba4f06777910348698260ed7a2170` |
| `ldem_16_uint.tif` | `45a2b32d56e81ed30db07fead8abc842b249b6511219d9ca2c53f81bc2dc5d62` |

## What was changed

- `moon-color-4k.jpg`: NASA's 16-bit TIFF saved as an 8-bit JPEG. Same pixels, same size.
- `moon-color-2k.jpg`: NASA's file, renamed, otherwise untouched.
- `moon-normal-*.jpg`: computed from NASA's height map at 16 pixels per degree. Each value was
  turned into meters, (value - 20000) / 2, relative to a sphere of radius 1,737.4 km, as NASA's
  page describes. The map was resized, and the surface slope toward east and toward north was
  worked out at each pixel on that sphere, at true scale with no exaggeration. Red is the eastward
  tilt, green the northward tilt (green up, the OpenGL convention), blue the outward direction.
  Near the poles the east-west spacing is held at its value for 87° latitude to avoid dividing by
  nearly zero.

## Check

Plotted on the color map, Tycho (43.3° S, 348.6° E), Copernicus (9.6° N, 339.9° E) and the
Apollo 11 site (0.674° N, 23.473° E) fall on their features. The heights read from the source
run from -8,981.5 m to +10,685.5 m.

These are SI/AI-assisted conversions of NASA's files; no part of the images was generated.
