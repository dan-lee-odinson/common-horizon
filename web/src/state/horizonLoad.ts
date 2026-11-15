// Loads a site's horizon answer for a window of any length, with samples never more than an hour
// apart.
//
// A sunrise or sunset is read between two samples of the Sun's path, and a lit or dark spell
// shorter than the spacing can fall between two samples and go unseen. So the spacing is kept at
// an hour or less however long the window is. One request carries a limited number of samples, so
// a long window (a stay of months) is asked for in several requests over sub-windows that meet end
// to end, and the answers are joined into one.

import { api } from '../api/client';
import { abortError } from '../api/errors';
import type { HorizonResponse, SiteRef, SkyBox } from '../api/types';
import { normalizeLon360, wrap180 } from '../util/geo';
import { HOUR_MS, toIsoUtc } from '../util/time';

/** Samples are never asked for further apart than this, in hours. */
export const MAX_SAMPLE_HOURS = 1;
/** Samples are never asked for closer than this, in hours. */
export const MIN_SAMPLE_HOURS = 0.25;
/** About this many points are asked for across a window, while the spacing stays inside its two limits. */
export const TARGET_POINTS = 2400;
/**
 * Most steps asked for in one request. The backend answers with at most 4,000 Sun path samples per
 * request (WEBSITE_API.md, POST /horizon), as does the example model; staying under it keeps the
 * spacing that was asked for. The answer's own `time_step_s` is read all the same (util/horizon.ts).
 */
export const STEPS_PER_REQUEST = 3600;

/**
 * Spacing of the samples for a window, in hours: about 2400 points across it, in quarter hours,
 * never finer than 15 minutes and never coarser than an hour. Windows up to 150 days fit one
 * request at that spacing; a longer one is split (see `horizonRequests`).
 */
export function horizonStepHours(startMs: number, endMs: number): number {
  const quarterHours = Math.round(((endMs - startMs) / HOUR_MS / TARGET_POINTS) * 4) / 4;
  return Math.min(MAX_SAMPLE_HOURS, Math.max(MIN_SAMPLE_HOURS, quarterHours));
}

export interface HorizonAsk {
  startMs: number;
  endMs: number;
  stepHours: number;
}

/**
 * The requests that cover a window: one, or several sub-windows that meet end to end, each with at
 * most STEPS_PER_REQUEST steps. Within each the step divides the sub-window exactly, so its samples
 * are evenly spaced and never more than MAX_SAMPLE_HOURS apart.
 */
export function horizonRequests(startMs: number, endMs: number): HorizonAsk[] {
  if (!Number.isFinite(startMs) || !Number.isFinite(endMs) || !(endMs > startMs)) return [];
  const step = horizonStepHours(startMs, endMs);
  const chunkMs = STEPS_PER_REQUEST * step * HOUR_MS;
  const out: HorizonAsk[] = [];
  for (let from = startMs; from < endMs; from += chunkMs) {
    const to = Math.min(endMs, from + chunkMs);
    const hours = (to - from) / HOUR_MS;
    // A whole number of steps, each no longer than the step wanted.
    const steps = Math.max(1, Math.ceil(hours / step - 1e-9));
    out.push({ startMs: from, endMs: to, stepHours: hours / steps });
  }
  return out;
}

/** The part of the sky that holds every one of the given boxes (their azimuth ranges may wrap past north). */
function joinBoxes(boxes: readonly SkyBox[]): SkyBox | null {
  if (boxes.length === 0) return null;
  // Azimuths are measured from the middle of the first box, so a range that wraps is one stretch.
  const span0 = normalizeLon360(boxes[0].az_max - boxes[0].az_min);
  const mid0 = boxes[0].az_min + span0 / 2;
  let lo = Infinity;
  let hi = -Infinity;
  for (const b of boxes) {
    const span = normalizeLon360(b.az_max - b.az_min);
    const from = wrap180(b.az_min + span / 2 - mid0) - span / 2;
    lo = Math.min(lo, from);
    hi = Math.max(hi, from + span);
  }
  const round = (v: number) => Math.round(v * 100) / 100;
  // Boxes that together go all the way round leave no gap to wrap across.
  const all = hi - lo >= 360;
  return {
    az_min: all ? 0 : round(normalizeLon360(mid0 + lo)),
    az_max: all ? 360 : round(normalizeLon360(mid0 + hi)),
    el_min: Math.min(...boxes.map((b) => b.el_min)),
    el_max: Math.max(...boxes.map((b) => b.el_max)),
  };
}

/**
 * The provenance of answers joined into one. They should all say the same; if they do not, the
 * joined answer is labelled synthetic as soon as any part is (its notice and sources are that
 * part's), so a mix is never shown as real physics.
 */
export function joinProvenance(parts: readonly Pick<HorizonResponse, 'provenance'>[]): HorizonResponse['provenance'] {
  const all = parts.map((p) => p.provenance).filter((p): p is HorizonResponse['provenance'] => Boolean(p));
  if (all.length === 0) return parts[0]?.provenance;
  const synthetic = all.find((p) => p.is_synthetic);
  return synthetic ?? all[0];
}

/**
 * Join the answers for sub-windows that meet end to end, in order, into one answer for the whole
 * window. The skyline is the site's and is the same in each. Where two sub-windows meet, both carry
 * a sample for the meeting instant: it is kept once. Earth's box becomes the box around all of them.
 * The added fields are kept: provenance (see joinProvenance), the warnings of every part (each
 * once), the skyline's source ("smooth_sphere", which says less, if any part says it) and the
 * largest time_step_s of the parts.
 */
export function mergeHorizon(parts: readonly HorizonResponse[]): HorizonResponse | null {
  if (parts.length === 0) return null;
  if (parts.length === 1) return parts[0];
  const first = parts[0];
  const sun_path = [...first.sun_path];
  let lastMs = sun_path.length ? Date.parse(sun_path[sun_path.length - 1].t) : -Infinity;
  for (const part of parts.slice(1)) {
    for (const p of part.sun_path) {
      const t = Date.parse(p.t);
      // Samples run forward in time: one at or before the last kept is the shared end sample.
      if (Number.isFinite(t) && Number.isFinite(lastMs) && t <= lastMs) continue;
      sun_path.push(p);
      if (Number.isFinite(t)) lastMs = t;
    }
  }
  const withSkyline = parts.find((p) => p.skyline && p.skyline.length > 0) ?? first;
  return {
    site_id: first.site_id,
    skyline: withSkyline.skyline,
    sun_path,
    earth_box: joinBoxes(parts.map((p) => p.earth_box).filter((b): b is SkyBox => b !== null && b !== undefined)),
    skyline_source: parts.some((p) => p.skyline_source === 'smooth_sphere') ? 'smooth_sphere' : withSkyline.skyline_source,
    // The coarsest spacing of any part: the joined answer is known no more finely than that.
    time_step_s: Math.max(...parts.map((p) => (Number.isFinite(p.time_step_s) ? p.time_step_s : 0))),
    provenance: joinProvenance(parts),
    // Each warning once, in the order the parts give them.
    warnings: [...new Set(parts.flatMap((p) => p.warnings ?? []))],
  };
}

/**
 * The horizon answer for a site over a window, however long: every request it takes is sent at
 * once and the answers are joined in order. Rejects if any request fails, and with the abort error
 * when the signal aborts.
 */
export async function loadHorizon(site: SiteRef, startMs: number, endMs: number, signal?: AbortSignal): Promise<HorizonResponse> {
  if (signal?.aborted) throw abortError();
  const asks = horizonRequests(startMs, endMs);
  const parts = await Promise.all(
    asks.map((ask) => api.horizon({ site, start_utc: toIsoUtc(ask.startMs), end_utc: toIsoUtc(ask.endMs), step_hours: ask.stepHours }, signal)),
  );
  const merged = mergeHorizon(parts);
  if (!merged) throw new RangeError('The horizon window has no length.');
  return merged;
}
