// The site stage's picture, as plain arithmetic. Kept free of 3D-library code so it can be checked
// by tests.
//
// The HUD measures the part of the window its panels leave free (src/stages/SiteHud.tsx writes
// `siteFrame`); the scene centres the landing point in it, and shows a marker's tag only while the
// marker is inside it.

import { createStore } from '../state/store';

export interface SiteFrame {
  /** False until the HUD has measured its panels (and on phones before the dock is laid out). */
  measured: boolean;
  /** The window, in CSS pixels. */
  width: number;
  height: number;
  /** The free rectangle: right of the left wing, left of the right wing, below the top strip, above the console. */
  left: number;
  top: number;
  right: number;
  bottom: number;
}

export const siteFrame = createStore<SiteFrame>({ measured: false, width: 0, height: 0, left: 0, top: 0, right: 0, bottom: 0 });

/**
 * How far the picture is shifted so that the middle of the view lands in the middle of the free
 * rectangle, in pixels: positive x moves the picture right, positive y moves it up (the same signs
 * as the Moon stages' picture shift). Zero until the panels are measured.
 */
export function frameShift(frame: SiteFrame, viewWidth: number, viewHeight: number): { x: number; y: number } {
  if (!frame.measured || !(frame.right > frame.left) || !(frame.bottom > frame.top)) return { x: 0, y: 0 };
  const cx = (frame.left + frame.right) / 2;
  const cy = (frame.top + frame.bottom) / 2;
  return { x: Math.round(cx - viewWidth / 2), y: Math.round(viewHeight / 2 - cy) };
}

/** True when a point (in pixels) is inside the free rectangle, at least `inset` pixels from its edges. */
export function insideFrame(frame: SiteFrame, x: number, y: number, inset = 0): boolean {
  if (!frame.measured) return true;
  return x >= frame.left + inset && x <= frame.right - inset && y >= frame.top + inset && y <= frame.bottom - inset;
}

/**
 * The compass direction the camera faces on arrival, so the thing worth watching is in the clear
 * middle of the view: just beside the Sun while it is low (the Sun and its raking light together),
 * well to one side of a high Sun, toward Earth when the Sun is far below level, and north with
 * nothing to go by. Degrees clockwise from north.
 */
export function arrivalAzimuth(sun: { az: number; el: number } | null, earth: { az: number; el: number } | null): number {
  const wrap = (deg: number) => ((deg % 360) + 360) % 360;
  if (sun && Number.isFinite(sun.az) && Number.isFinite(sun.el)) {
    if (sun.el >= 25) return wrap(sun.az + 60);
    if (sun.el >= -5) return wrap(sun.az + 12);
  }
  if (earth && Number.isFinite(earth.az) && earth.el > 0) return wrap(earth.az + 12);
  return 0;
}
