// Moon surface texture slot.
//
// The plan is NASA's CGI Moon Kit colour map (NASA's Scientific Visualization Studio, item 4720):
// the 2K image on phones and the 4K image on desktop. The download was blocked in the build
// environment, so the Moon is a plain grey sphere for now. To switch the texture on:
//   1. Put the two equirectangular JPEG files (longitude 0° in the centre) in web/public/textures/
//      as moon-color-2k.jpg and moon-color-4k.jpg.
//   2. Set `enabled: true` below.
//   3. Keep the credit line "NASA's Scientific Visualization Studio" in the scene (it is already
//      shown when enabled) and in web/SOURCES-web.md.

export const MOON_TEXTURE = {
  enabled: false,
  phone: 'textures/moon-color-2k.jpg',
  desktop: 'textures/moon-color-4k.jpg',
  credit: "Moon colour map: NASA's Scientific Visualization Studio",
};
