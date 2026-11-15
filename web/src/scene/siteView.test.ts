import { describe, expect, it } from 'vitest';
import { arrivalAzimuth, frameShift, insideFrame, type SiteFrame } from './siteView';

const frame: SiteFrame = { measured: true, width: 1440, height: 900, left: 340, top: 112, right: 1100, bottom: 640 };

describe('the free rectangle of the site stage', () => {
  it('shifts the picture so the middle of the view lands in the middle of the free rectangle', () => {
    // Free centre (720, 376): level with the middle across, 74 px above it.
    expect(frameShift(frame, 1440, 900)).toEqual({ x: 0, y: 74 });
    expect(frameShift({ ...frame, left: 20, right: 1100 }, 1440, 900)).toEqual({ x: -160, y: 74 });
  });

  it('does not shift before the panels are measured, or for a rectangle with no room', () => {
    expect(frameShift({ ...frame, measured: false }, 1440, 900)).toEqual({ x: 0, y: 0 });
    expect(frameShift({ ...frame, right: 300 }, 1440, 900)).toEqual({ x: 0, y: 0 });
    expect(frameShift({ ...frame, bottom: 100 }, 1440, 900)).toEqual({ x: 0, y: 0 });
  });

  it('says whether a point is inside, with a margin', () => {
    expect(insideFrame(frame, 720, 300)).toBe(true);
    expect(insideFrame(frame, 345, 300)).toBe(true);
    expect(insideFrame(frame, 345, 300, 24)).toBe(false);
    expect(insideFrame(frame, 200, 300)).toBe(false);
    expect(insideFrame(frame, 720, 700)).toBe(false);
    // Unmeasured: nothing is in the way yet.
    expect(insideFrame({ ...frame, measured: false }, 5, 5, 24)).toBe(true);
  });
});

describe('which way the camera faces on arrival', () => {
  it('just beside a low Sun, well aside of a high one', () => {
    expect(arrivalAzimuth({ az: 100, el: 1.2 }, null)).toBe(112);
    expect(arrivalAzimuth({ az: 355, el: -4 }, { az: 10, el: 5 })).toBe(7);
    expect(arrivalAzimuth({ az: 100, el: 40 }, null)).toBe(160);
    expect(arrivalAzimuth({ az: 330, el: 25 }, null)).toBe(30);
  });

  it('toward Earth when the Sun is far below level, and north with nothing to go by', () => {
    expect(arrivalAzimuth({ az: 100, el: -20 }, { az: 200, el: 6 })).toBe(212);
    expect(arrivalAzimuth({ az: 100, el: -20 }, { az: 200, el: -3 })).toBe(0);
    expect(arrivalAzimuth(null, null)).toBe(0);
    expect(arrivalAzimuth({ az: Number.NaN, el: 2 }, null)).toBe(0);
  });
});
