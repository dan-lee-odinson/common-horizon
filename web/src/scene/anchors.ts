// Screen positions of things in the 3D scene that the HUD points at (the Sun, Earth, the selected
// site, the lander). The scene writes them once per frame; leader lines and floating labels read
// them. Positions are in CSS pixels from the top left of the scene.

export interface Anchor {
  x: number;
  y: number;
  /** False when the thing is off screen, behind the camera or hidden behind the Moon. */
  visible: boolean;
  /** Radius of the thing on screen, in pixels (0 for a point). */
  r: number;
}

export type AnchorName = 'sun' | 'earth' | 'subsolar' | 'subearth' | 'site' | 'lander' | 'moon' | 'lon0' | 'lon90' | 'lon180' | 'lon270';

export const anchors: Record<AnchorName, Anchor> = {
  sun: { x: 0, y: 0, visible: false, r: 0 },
  earth: { x: 0, y: 0, visible: false, r: 0 },
  subsolar: { x: 0, y: 0, visible: false, r: 0 },
  subearth: { x: 0, y: 0, visible: false, r: 0 },
  site: { x: 0, y: 0, visible: false, r: 0 },
  lander: { x: 0, y: 0, visible: false, r: 0 },
  moon: { x: 0, y: 0, visible: false, r: 0 },
  lon0: { x: 0, y: 0, visible: false, r: 0 },
  lon90: { x: 0, y: 0, visible: false, r: 0 },
  lon180: { x: 0, y: 0, visible: false, r: 0 },
  lon270: { x: 0, y: 0, visible: false, r: 0 },
};

export function hideAnchors(...names: AnchorName[]): void {
  for (const n of names.length ? names : (Object.keys(anchors) as AnchorName[])) anchors[n].visible = false;
}
