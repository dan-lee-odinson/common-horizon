// Loads the geometry track: where the Sun and Earth are overhead on the Moon, across a window.
//
// The backend gives those two points for one instant per call (the `geometry` field of
// POST /evaluate, at the landing time). To follow them through time the website asks once for each
// day of the window, with the launch moved a day at a time, and joins the answers (util/track.ts).
// Answers are cached, so moving the launch delay by a day asks only for the one new day.

import { api, isMockMode } from '../api/client';
import type { SiteRef } from '../api/types';
import { DAY_MS, toIsoUtc } from '../util/time';
import { buildTrack, type GeometryTrack, type TrackSample } from '../util/track';

/**
 * The point the geometry questions are asked for. Only the answer's `geometry` is read, and that
 * does not depend on the site.
 */
export const GEOMETRY_PROBE: SiteRef = { id: 'geometry-probe', name: 'Geometry probe', lat: 0, lon_east: 0 };

/** Most answers asked for one window; longer windows are sampled more coarsely. */
export const MAX_TRACK_SAMPLES = 96;

/** A real backend is asked a few questions at a time; the mock answers in the browser. */
function concurrency(): number {
  return isMockMode() ? 64 : 6;
}

const cache = new Map<number, Promise<TrackSample>>();

/** Sun and Earth overhead points at the landing that follows a launch at `launchMs` (cached). */
export function geometryForLaunch(launchMs: number): Promise<TrackSample> {
  const hit = cache.get(launchMs);
  if (hit) return hit;
  const call = api
    .evaluate({ sites: [GEOMETRY_PROBE], launch_utc: toIsoUtc(launchMs), slip_days: 0, stay_days: 1, hardware: [], storage_kwh: 0 })
    .then((r) => ({ tMs: Date.parse(r.landing_utc), geometry: r.geometry }));
  cache.set(launchMs, call);
  call.catch(() => cache.delete(launchMs));
  return call;
}

/** For tests: forget every cached answer. */
export function clearGeometryCache(): void {
  cache.clear();
}

/**
 * Launch instants to ask about so the answers cover `spanDays` after the planned landing, with one
 * spare answer on each side (the curve needs a neighbour beyond each end).
 */
export function trackLaunchTimes(launchUtcMs: number, spanDays: number): number[] {
  const stepDays = Math.max(1, Math.ceil(spanDays / (MAX_TRACK_SAMPLES - 3)));
  const last = Math.ceil(spanDays / stepDays) + 1;
  const out: number[] = [];
  for (let k = -1; k <= last; k++) out.push(launchUtcMs + k * stepDays * DAY_MS);
  return out;
}

export async function loadTrack(launchUtcMs: number, spanDays: number, signal?: AbortSignal): Promise<GeometryTrack> {
  const launches = trackLaunchTimes(launchUtcMs, spanDays);
  const samples: TrackSample[] = new Array(launches.length);
  let next = 0;
  async function worker() {
    while (next < launches.length && !signal?.aborted) {
      const i = next++;
      samples[i] = await geometryForLaunch(launches[i]);
    }
  }
  await Promise.all(Array.from({ length: Math.min(concurrency(), launches.length) }, worker));
  const track = buildTrack(samples.filter(Boolean));
  if (!track) throw new Error('No geometry answers came back.');
  return track;
}
