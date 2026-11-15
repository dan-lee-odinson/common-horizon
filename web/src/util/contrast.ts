// Colour contrast, as WCAG 2 defines it. Used by the checks that keep text readable on glass.

export interface Rgba {
  r: number;
  g: number;
  b: number;
  a: number;
}

/** Parse "#rgb", "#rrggbb", "rgb(r g b)", "rgb(r g b / a)" or "rgb(r, g, b)" / "rgba(r, g, b, a)". */
export function parseColor(text: string): Rgba {
  const s = text.trim().toLowerCase();
  const hex = /^#([0-9a-f]{3}|[0-9a-f]{6})$/.exec(s);
  if (hex) {
    const h = hex[1].length === 3 ? [...hex[1]].map((c) => c + c).join('') : hex[1];
    return { r: parseInt(h.slice(0, 2), 16), g: parseInt(h.slice(2, 4), 16), b: parseInt(h.slice(4, 6), 16), a: 1 };
  }
  const fn = /^rgba?\(([^)]+)\)$/.exec(s);
  if (fn) {
    const parts = fn[1].split(/[\s,/]+/).filter(Boolean).map(Number);
    if (parts.length >= 3 && parts.every(Number.isFinite)) return { r: parts[0], g: parts[1], b: parts[2], a: parts[3] ?? 1 };
  }
  throw new Error(`Cannot read the colour "${text}"`);
}

/** Lay a (possibly translucent) colour over an opaque one. */
export function over(top: Rgba, bottom: Rgba): Rgba {
  const a = top.a;
  return { r: top.r * a + bottom.r * (1 - a), g: top.g * a + bottom.g * (1 - a), b: top.b * a + bottom.b * (1 - a), a: 1 };
}

/** Dim an opaque colour, as backdrop-filter: brightness() does. */
export function dim(c: Rgba, factor: number): Rgba {
  return { r: c.r * factor, g: c.g * factor, b: c.b * factor, a: c.a };
}

export function luminance(c: Rgba): number {
  const lin = (v: number) => {
    const x = v / 255;
    return x <= 0.03928 ? x / 12.92 : ((x + 0.055) / 1.055) ** 2.4;
  };
  return 0.2126 * lin(c.r) + 0.7152 * lin(c.g) + 0.0722 * lin(c.b);
}

/** Contrast ratio between two opaque colours, 1..21. */
export function contrast(a: Rgba, b: Rgba): number {
  const la = luminance(a);
  const lb = luminance(b);
  return (Math.max(la, lb) + 0.05) / (Math.min(la, lb) + 0.05);
}
