# Textures

`moon/` holds the Moon's surface maps, made from NASA's CGI Moon Kit (NASA's Scientific
Visualization Studio). Its own `README.md` gives the source, the credit, the checksums of the
downloads and what was changed to make each file. Those files are used as they are and are not
edited here.

The website loads the 4096 x 2048 pair on desktop and the 2048 x 1024 pair on phones
(`web/src/scene/textures.ts`), from its own files only.
