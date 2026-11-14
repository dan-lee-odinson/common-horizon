# Moon texture slot

This folder is reserved for the Moon's surface colour map.

Planned source: NASA's CGI Moon Kit colour map (NASA's Scientific Visualization Studio, item 4720).
Credit line to show: "NASA's Scientific Visualization Studio".

The download was blocked in the environment where the website was built, so the Moon is a plain
grey sphere for now. To switch the texture on:

1. Save two equirectangular JPEG images of the colour map here, with longitude 0° in the centre of
   the image and north at the top:
   * `moon-color-2k.jpg` (2048 × 1024, used on phones)
   * `moon-color-4k.jpg` (4096 × 2048, used on desktop)
2. In `web/src/scene/textures.ts`, set `enabled: true`.
3. Run `npm run build` and check the Moon in the browser. The credit line appears under the Moon.
4. Add the file names, the source page and the licence to `web/SOURCES-web.md`.
