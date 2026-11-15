import { beforeAll, describe, expect, it } from 'vitest';
import sitesJson from '../api/examples/sites.json';
import { configureMock } from '../api/mock';
import { horizonFor, TRANSIT_DAYS } from '../api/mock/model';
import type { SiteRef } from '../api/types';
import { clearGeometryCache, loadTrack } from '../state/geometry';
import { earthWidthDeg, sunWidthDeg } from '../util/bodies';
import { DEG, RAD, sampleProfile } from '../util/geo';
import { skyAt } from '../util/quantities';
import { DAY_MS, HOUR_MS, SYNODIC_MONTH_DAYS } from '../util/time';
import type { GeometryTrack } from '../util/track';
import {
  arrivalAzimuth,
  arrivalPitch,
  bandProfile,
  bandTopAt,
  clearUpDeg,
  DESCENT,
  descentPose,
  domePoint,
  earthDiscRadius,
  facePose,
  frameShift,
  groundCutDeg,
  groundSunTerm,
  insideFrame,
  lookUpLimit,
  orbitPosition,
  restPose,
  SITE_VIEW,
  skylineMinDeg,
  sunDiscRadius,
  sunPathOnDome,
  type SiteFrame,
} from './siteView';

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

// ---------- the sky dome ----------

const LAUNCH = Date.UTC(2027, 1, 10, 15, 0, 0);
const LANDING = LAUNCH + TRANSIT_DAYS * DAY_MS;
const SITES = sitesJson.sites as SiteRef[];
const site = (id: string) => SITES.find((s) => s.id === id)!;

/** The direction of a point of the dome, read back as azimuth and elevation. */
function direction(p: { x: number; y: number; z: number }): { az: number; el: number; distance: number } {
  const distance = Math.hypot(p.x, p.y, p.z);
  return { az: (Math.atan2(p.x, -p.z) * RAD + 360) % 360, el: Math.asin(p.y / distance) * RAD, distance };
}

describe('the Sun and Earth on the sky dome', () => {
  let track: GeometryTrack;
  beforeAll(async () => {
    configureMock({ latencyMs: 0, scenario: { mode: 'normal', assistant: 'on' } });
    clearGeometryCache();
    track = await loadTrack(LAUNCH, SYNODIC_MONTH_DAYS);
  });

  it('are drawn as wide as they look from the site, whatever the dome\u2019s radius', () => {
    for (const dome of [90, 9000, 123456]) {
      // A ball of radius r seen from a distance L to its centre is 2 asin(r / L) wide.
      expect(2 * Math.asin(sunDiscRadius(dome) / dome) * RAD).toBeCloseTo(sunWidthDeg(), 12);
      for (const el of [-5, 0, 30, 77.5, 90]) expect(2 * Math.asin(earthDiscRadius(el, dome) / dome) * RAD).toBeCloseTo(earthWidthDeg(el), 12);
    }
    expect(2 * Math.asin(sunDiscRadius() / SITE_VIEW.dome) * RAD).toBeCloseTo(0.5329, 3);
    expect(2 * Math.asin(earthDiscRadius(90) / SITE_VIEW.dome) * RAD).toBeCloseTo(1.9079, 3);
    expect(2 * Math.asin(earthDiscRadius(0) / SITE_VIEW.dome) * RAD).toBeCloseTo(1.8993, 3);
    // Earth is about 3.6 times as wide as the Sun.
    expect(earthDiscRadius(45) / sunDiscRadius()).toBeGreaterThan(3.5);
    expect(earthDiscRadius(45) / sunDiscRadius()).toBeLessThan(3.7);
  });

  it('stand on the dome in the direction the readouts give, at every instant', () => {
    for (const id of ['shackleton-ridge', 'apollo-11', 'apollo-14']) {
      const s = site(id);
      for (let k = 0; k < 40; k++) {
        const tMs = LANDING + k * 8.3 * HOUR_MS;
        const sky = skyAt({ track, tMs, landingMs: LANDING, site: s, horizon: null });
        for (const body of [sky.sun!, sky.earth!]) {
          const back = direction(domePoint(body.az, body.el));
          expect(back.distance).toBeCloseTo(SITE_VIEW.dome, 6);
          expect(back.el).toBeCloseTo(body.el, 9);
          // Azimuth means nothing straight overhead; elsewhere it must come back.
          if (Math.abs(body.el) < 89.9) expect(Math.abs(((back.az - body.az + 540) % 360) - 180)).toBeLessThan(1e-7);
        }
      }
    }
  });

  it('the Sun stands above the skyline band exactly when the horizon answer says the site is lit', () => {
    let lit = 0;
    let dark = 0;
    for (const s of SITES) {
      const horizon = horizonFor(s, LANDING, LANDING + 14 * DAY_MS, 0.25);
      const profile = bandProfile(horizon.skyline);
      for (let k = 0; k <= 14 * 24; k++) {
        const tMs = LANDING + k * HOUR_MS;
        const sky = skyAt({ track, tMs, landingMs: LANDING, site: s, horizon });
        const sun = direction(domePoint(sky.sun!.az, sky.sun!.el));
        const clearance = sun.el - bandTopAt(profile, sun.az);
        // Right at the skyline the two may differ by the width of a hair: the band is drawn from
        // whole degrees of azimuth, and the answer times a crossing between two samples.
        if (Math.abs(clearance) < 0.06) continue;
        expect(clearance > 0, `${s.id} at +${k} h: ${clearance.toFixed(3)} deg`).toBe(sky.lit);
        if (sky.lit) lit++;
        else dark++;
      }
    }
    expect(lit).toBeGreaterThan(500);
    expect(dark).toBeGreaterThan(500);
  });
});

describe('the Sun\u2019s path across the sky', () => {
  it('runs through the horizon answer\u2019s own samples, each on the dome in its own direction', () => {
    const horizon = horizonFor(site('apollo-11'), LANDING, LANDING + 14 * DAY_MS, 1);
    const points = sunPathOnDome(horizon.sun_path);
    expect(points).toHaveLength(horizon.sun_path.length * 3);
    for (let i = 0; i < horizon.sun_path.length; i += 17) {
      const back = direction({ x: points[i * 3], y: points[i * 3 + 1], z: points[i * 3 + 2] });
      expect(back.distance).toBeCloseTo(SITE_VIEW.dome, 6);
      expect(back.el).toBeCloseTo(horizon.sun_path[i].el, 9);
      if (Math.abs(horizon.sun_path[i].el) < 89.9) expect(Math.abs(((back.az - horizon.sun_path[i].az + 540) % 360) - 180)).toBeLessThan(1e-7);
    }
    // A sample that is not a number is left out, not drawn at the origin.
    expect(sunPathOnDome([{ az: 10, el: 5 }, { az: Number.NaN, el: 5 }, { az: 20, el: 6 }])).toHaveLength(6);
    expect(sunPathOnDome([])).toEqual([]);
  });
});

describe('the skyline band', () => {
  const skyline = horizonFor(site('shackleton-ridge'), LANDING, LANDING + DAY_MS, 1).skyline;
  const profile = bandProfile(skyline);

  it('is the data\u2019s skyline at every whole degree, all the way round, with nothing clamped', () => {
    expect(profile).toHaveLength(361);
    expect(profile[360]).toBe(profile[0]);
    for (let az = 0; az < 360; az++) expect(profile[az]).toBe(sampleProfile(skyline, az));
    // The skyline dips below level somewhere at this site, and the band follows it down.
    const min = skylineMinDeg(skyline)!;
    expect(min).toBeLessThan(0);
    expect(Math.min(...profile)).toBeGreaterThanOrEqual(min);
    expect(Math.min(...profile)).toBeLessThan(0);
  });

  it('is read between whole degrees along a straight line, and wraps', () => {
    expect(bandTopAt(profile, 10)).toBe(profile[10]);
    expect(bandTopAt(profile, 10.25)).toBeCloseTo(profile[10] * 0.75 + profile[11] * 0.25, 12);
    expect(bandTopAt(profile, 359.5)).toBeCloseTo((profile[359] + profile[0]) / 2, 12);
    expect(bandTopAt(profile, -90)).toBe(profile[270]);
    expect(bandTopAt(profile, 725)).toBe(profile[5]);
    expect(bandTopAt([], 10)).toBe(0);
  });
});

describe('the level ground', () => {
  it('is cut off below the lowest point of the skyline, and never closer to level than half a degree', () => {
    expect(groundCutDeg(null)).toBe(-0.5);
    expect(groundCutDeg(Number.NaN)).toBe(-0.5);
    expect(groundCutDeg(1.2)).toBe(-0.5);
    expect(groundCutDeg(0)).toBe(-0.5);
    expect(groundCutDeg(-0.2)).toBeCloseTo(-0.5, 12);
    expect(groundCutDeg(-1.5)).toBeCloseTo(-1.8, 12);
    for (let min = -6; min <= 6; min += 0.25) {
      expect(groundCutDeg(min)).toBeLessThanOrEqual(min - 0.3 + 1e-12);
      expect(groundCutDeg(min)).toBeLessThanOrEqual(-0.5);
    }
  });

  it('never covers open sky at any preset site', () => {
    for (const s of SITES) {
      const skyline = horizonFor(s, LANDING, LANDING + DAY_MS, 1).skyline;
      const cut = groundCutDeg(skylineMinDeg(skyline));
      for (const p of skyline) expect(cut, s.id).toBeLessThan(p.el);
      // And the band reaches down past the cut, so nothing shows between them.
      expect(SITE_VIEW.bandFloorDeg).toBeLessThan(cut);
    }
  });

  it('shows direct sunlight by a curve that rises from nothing at level to full overhead', () => {
    expect(groundSunTerm(-3)).toBe(0);
    expect(groundSunTerm(0)).toBe(0);
    expect(groundSunTerm(Number.NaN)).toBe(0);
    expect(groundSunTerm(90)).toBeCloseTo(1, 12);
    let last = 0;
    for (let el = 0.1; el <= 90; el += 0.7) {
      const term = groundSunTerm(el);
      expect(term).toBeGreaterThan(last);
      last = term;
    }
    // Grazing light at a polar site is still readable: about a quarter of full at one degree.
    expect(groundSunTerm(1)).toBeGreaterThan(0.2);
    expect(groundSunTerm(1)).toBeLessThan(0.3);
  });
});

// ---------- the camera ----------

describe('where the camera comes to rest', () => {
  const base = { heightM: 52, layoutRadius: 55, fovDeg: 42, freeShare: 0.57, viewAzDeg: 100 };

  it('stands back far enough for the lander to fill about three quarters of the free height', () => {
    const rest = restPose(base);
    // 52 m lander, 57 % of a 42 degree view: about 165 m.
    expect(rest.distance).toBeGreaterThan(160);
    expect(rest.distance).toBeLessThan(170);
    expect(rest.target).toEqual({ x: 0, y: 26, z: 0 });
    const lander = (2 * Math.atan(26 / rest.distance) * RAD) / (42 * 0.57);
    expect(lander).toBeGreaterThan(0.68);
    expect(lander).toBeLessThan(0.76);
  });

  it('keeps its distance between 14 and 260 m, and takes in a wide layout', () => {
    expect(restPose({ ...base, heightM: 2, layoutRadius: 0 }).distance).toBe(14);
    expect(restPose({ ...base, heightM: null, layoutRadius: 12 }).distance).toBeGreaterThan(14);
    expect(restPose({ ...base, heightM: 52, layoutRadius: 500 }).distance).toBe(260);
    expect(restPose({ ...base, layoutRadius: 128 }).distance).toBeGreaterThan(restPose(base).distance);
    // Less free height: further back. Not measured counts as all of it.
    expect(restPose({ ...base, freeShare: 0.4 }).distance).toBeGreaterThan(restPose(base).distance);
    expect(restPose({ ...base, freeShare: 5 }).distance).toBe(restPose({ ...base, freeShare: 1 }).distance);
  });

  it('looks at the middle of the lander (between 1.5 and 30 m up) from nine degrees above level, facing the given direction', () => {
    expect(restPose({ ...base, heightM: 2 }).target.y).toBe(1.5);
    expect(restPose({ ...base, heightM: null }).target.y).toBe(1.5);
    expect(restPose({ ...base, heightM: 100 }).target.y).toBe(30);
    const rest = restPose(base);
    const dx = rest.target.x - rest.position.x;
    const dy = rest.target.y - rest.position.y;
    const dz = rest.target.z - rest.position.z;
    expect(Math.hypot(dx, dy, dz)).toBeCloseTo(rest.distance, 9);
    expect(Math.asin(-dy / rest.distance) * RAD).toBeCloseTo(9, 9);
    expect((Math.atan2(dx, -dz) * RAD + 360) % 360).toBeCloseTo(100, 9);
    expect(rest.polarDeg).toBe(81);
  });

  it('comes lower while the Sun stands a few degrees up, so the Sun is inside the clear part of the window', () => {
    // 1440 x 900 with 516 px free: the clear part reaches about ten degrees above the middle.
    const up = clearUpDeg(516, 900, 42);
    expect(up).toBeGreaterThan(9.5);
    expect(up).toBeLessThan(11);
    expect(arrivalPitch({ az: 90, el: 1 }, up)).toBe(9);
    expect(arrivalPitch({ az: 90, el: 3.7 }, up)).toBeCloseTo(up - 3.7, 12);
    expect(arrivalPitch({ az: 90, el: 9 }, up)).toBe(3);
    // A high Sun, a Sun well below level, or none: the usual nine degrees.
    expect(arrivalPitch({ az: 90, el: 40 }, up)).toBe(9);
    expect(arrivalPitch({ az: 90, el: -20 }, up)).toBe(9);
    expect(arrivalPitch(null, up)).toBe(9);
    // With the pitch chosen so, a Sun up to seven degrees high is no higher in the picture than the clear part reaches.
    for (const el of [0.5, 2, 3.7, 6, 7]) expect(arrivalPitch({ az: 0, el }, up) + el).toBeLessThanOrEqual(up + 1e-9);
    expect(restPose({ ...base, pitchDeg: 4 }).polarDeg).toBe(86);
    expect(restPose({ ...base, pitchDeg: 0 }).polarDeg).toBe(87);
    expect(restPose({ ...base, pitchDeg: 30 }).polarDeg).toBe(81);
  });

  it('is never less than a metre above the ground, at any limit of the controls', () => {
    const polarMax = SITE_VIEW.maxPolar * RAD;
    const polarMin = SITE_VIEW.minPolar * RAD;
    for (const targetH of [1.5, 5, 26, 30]) {
      for (const distance of [SITE_VIEW.minDistance, 50, SITE_VIEW.maxDistance]) {
        for (const polar of [polarMin, 45, 81, polarMax]) {
          for (const az of [0, 133, 271]) expect(orbitPosition({ x: 0, y: targetH, z: 0 }, distance, az, polar).y).toBeGreaterThanOrEqual(1);
        }
      }
    }
    // The steepest the camera may look down is still short of straight overhead; the flattest is short of level.
    expect(polarMin).toBeGreaterThan(5);
    expect(polarMax).toBeLessThan(90);
  });

  it('may tip up to the sky close to a tall lander, but never to within reach of the ground', () => {
    // Far from a 52 m lander: a little below the point looked at. Close to it: steeply up.
    expect(lookUpLimit(26, 165) * RAD).toBeGreaterThan(95);
    expect(lookUpLimit(26, 165) * RAD).toBeLessThan(100);
    expect(lookUpLimit(26, 30) * RAD).toBeGreaterThan(140);
    expect(lookUpLimit(26, 8)).toBe(SITE_VIEW.maxPolarLookUp);
    // A low lander gives almost no room to look up, and never less than the usual limit.
    expect(lookUpLimit(1.5, 8) * RAD).toBeLessThan(93);
    expect(lookUpLimit(1.5, 400)).toBeGreaterThanOrEqual(SITE_VIEW.maxPolar);
    expect(lookUpLimit(0.5, 20)).toBe(SITE_VIEW.maxPolar);
    expect(lookUpLimit(Number.NaN, 20)).toBe(SITE_VIEW.maxPolar);
    for (const targetH of [1.5, 5, 26, 30]) {
      for (const distance of [SITE_VIEW.minDistance, 20, 50, 165, SITE_VIEW.maxDistance]) {
        const polar = lookUpLimit(targetH, distance) * RAD;
        expect(orbitPosition({ x: 0, y: targetH, z: 0 }, distance, 40, polar).y, `${targetH} m up, ${distance} m away`).toBeGreaterThanOrEqual(1);
      }
    }
    expect(SITE_VIEW.maxPolarLookUp).toBeLessThan(Math.PI);
  });
});

describe('turning the view to the Sun or to Earth', () => {
  const up = clearUpDeg(516, 900, 42);
  /** How far above the middle of the picture, and how far to the side of it, the body ends up. */
  const where = (body: { az: number; el: number }, pose: ReturnType<typeof facePose>) => ({ above: body.el - (pose.polarDeg - 90), aside: ((pose.azDeg - body.az + 540) % 360) - 180 });

  it('a low body: about the rest pose, turned to face a little to one side of it', () => {
    const body = { az: 232, el: 0.4 };
    const pose = facePose({ body, restTargetY: 26, distance: 165, clearUpDeg: up });
    expect(pose.target).toEqual({ x: 0, y: 26, z: 0 });
    expect(pose.distance).toBe(165);
    expect(pose.azDeg).toBe(244);
    // Looking down, as at rest, but no more than the rest pose does.
    expect(pose.polarDeg).toBeGreaterThanOrEqual(81);
    expect(pose.polarDeg).toBeLessThan(90);
    expect(where(body, pose).above).toBeLessThanOrEqual(up);
    expect(where(body, pose).above).toBeGreaterThan(0);
  });

  it('a high body: the camera comes down to the ground and looks up, and the body sits in the clear part of the picture', () => {
    for (const body of [{ az: 95, el: 77.5 }, { az: 259, el: 61 }, { az: 10, el: 30 }, { az: 359, el: 89 }]) {
      for (const [restTargetY, distance] of [[26, 165], [26, 20], [1.5, 14], [5, 400]] as const) {
        const pose = facePose({ body, restTargetY, distance, clearUpDeg: up });
        const at = where(body, pose);
        expect(at.aside).toBeCloseTo(12, 9);
        // Three quarters of the way up the clear part, or (straight overhead) as high as the camera may look.
        if (body.el < 80) expect(at.above).toBeCloseTo(0.75 * up, 9);
        expect(pose.polarDeg * DEG).toBeLessThan(SITE_VIEW.maxPolarLookUp);
        // Never under the ground: the point looked at is raised when it has to be, and never lowered.
        expect(pose.position.y).toBeGreaterThanOrEqual(SITE_VIEW.minCameraHeight);
        expect(pose.target.y).toBeGreaterThanOrEqual(restTargetY);
        expect(pose.target.x).toBe(0);
        expect(pose.target.z).toBe(0);
        // And inside what the controls allow from there, so they do not pull the camera back.
        expect(pose.polarDeg * DEG).toBeLessThanOrEqual(lookUpLimit(pose.target.y, pose.distance));
      }
    }
  });

  it('keeps the visitor\u2019s distance, within the limits of the controls', () => {
    const body = { az: 0, el: 20 };
    expect(facePose({ body, restTargetY: 26, distance: 3, clearUpDeg: up }).distance).toBe(SITE_VIEW.minDistance);
    expect(facePose({ body, restTargetY: 26, distance: 90, clearUpDeg: up }).distance).toBe(90);
    expect(facePose({ body, restTargetY: 26, distance: 9000, clearUpDeg: up }).distance).toBe(SITE_VIEW.maxDistance);
  });
});

describe('the descent to the rest pose', () => {
  const rest = restPose({ heightM: 52, layoutRadius: 55, fovDeg: 42, freeShare: 0.57, viewAzDeg: 100 });

  it('starts high over the landing point, looking almost straight down at it, with the picture not yet shifted', () => {
    const start = descentPose(0, rest);
    expect(start.target).toEqual({ x: 0, y: 0, z: 0 });
    expect(start.polarDeg).toBe(DESCENT.startPolarDeg);
    expect(start.shiftShare).toBe(0);
    expect(start.distance).toBeCloseTo(Math.min(DESCENT.startMax, Math.max(DESCENT.startMin, DESCENT.startFactor * rest.distance)), 9);
    // Within three degrees of straight above the landing point.
    expect(Math.atan2(Math.hypot(start.position.x, start.position.z), start.position.y) * RAD).toBeCloseTo(DESCENT.startPolarDeg, 9);
    expect(start.azDeg).toBe(rest.azDeg - DESCENT.turnDeg);
  });

  it('ends exactly at the rest pose', () => {
    const end = descentPose(1, rest);
    expect(end.distance).toBeCloseTo(rest.distance, 9);
    expect(end.polarDeg).toBeCloseTo(rest.polarDeg, 12);
    expect(end.azDeg).toBeCloseTo(rest.azDeg, 12);
    expect(end.target).toEqual(rest.target);
    expect(end.position.x).toBeCloseTo(rest.position.x, 9);
    expect(end.position.y).toBeCloseTo(rest.position.y, 9);
    expect(end.position.z).toBeCloseTo(rest.position.z, 9);
    expect(end.shiftShare).toBe(1);
    // Past the ends it holds the ends.
    expect(descentPose(1.4, rest)).toEqual(end);
    expect(descentPose(-1, rest)).toEqual(descentPose(0, rest));
  });

  it('comes down steadily: nearer, flatter and turning toward the rest direction all the way, never under the ground', () => {
    let last = descentPose(0, rest);
    for (let u = 0.02; u <= 1.0001; u += 0.02) {
      const pose = descentPose(u, rest);
      expect(pose.distance).toBeLessThan(last.distance);
      expect(pose.polarDeg).toBeGreaterThanOrEqual(last.polarDeg);
      expect(pose.azDeg).toBeGreaterThanOrEqual(last.azDeg);
      expect(pose.shiftShare).toBeGreaterThanOrEqual(last.shiftShare);
      expect(pose.target.y).toBeGreaterThanOrEqual(last.target.y);
      expect(pose.position.y).toBeGreaterThan(1);
      // The height falls on a log scale: the same share in every step.
      expect(pose.distance / last.distance).toBeCloseTo((rest.distance / descentPose(0, rest).distance) ** 0.02, 9);
      last = pose;
    }
  });

  it('starts between 600 and 1500 m up, whatever the rest distance', () => {
    const near = restPose({ heightM: 2, layoutRadius: 0, fovDeg: 42, freeShare: 1, viewAzDeg: 0 });
    const far = restPose({ heightM: 52, layoutRadius: 500, fovDeg: 42, freeShare: 0.5, viewAzDeg: 0 });
    expect(descentPose(0, near).distance).toBe(600);
    expect(descentPose(0, far).distance).toBe(1500);
    expect(Math.cos(DESCENT.startPolarDeg * DEG) * 1500).toBeLessThan(SITE_VIEW.far);
  });
});
