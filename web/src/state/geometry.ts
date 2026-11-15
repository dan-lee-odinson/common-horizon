// Loads the geometry track: where the Sun and Earth are overhead on the Moon, across a window.
//
// The backend gives those two points for one instant per call (the `geometry` field of
// POST /evaluate, at the landing time). To follow them through time the website asks once for each
// day of the window, with the launch moved a day at a time, and joins the answers (util/track.ts).
// Answers are cached, so moving the launch delay by a day asks only for the one new day.
//
// The answers are always a day apart, whatever the window length. Earth's overhead point swings
// with a period of about 27 days, and a curve through answers two or more days apart no longer
// carries the two decimals the readouts show.

import { api, isMockMode } from '../api/client';
import { ApiError, abortError } from '../api/errors';
import type { SiteRef } from '../api/types';
import { DAY_MS, toIsoUtc } from '../util/time';
import { buildTrack, isWholeSample, type GeometryTrack, type TrackSample } from '../util/track';

/**
 * The point the geometry questions are asked for. Only the answer's `geometry` is read, and that
 * does not depend on the site.
 */
export const GEOMETRY_PROBE: SiteRef = { id: 'geometry-probe', name: 'Geometry probe', lat: 0, lon_east: 0 };

/**
 * Most answers asked for one window. The longest window the controls allow, a 365.25-day stay after
 * a 30-day delay, takes 399: one a day across its 395.25 days, plus the spare answers at the ends.
 */
export const MAX_TRACK_SAMPLES = 400;

/** A question with no answer after this long is given up, so it leaves the cache and can be asked again. */
export const GEOMETRY_TIMEOUT_MS = 20_000;

/**
 * The furthest apart two neighbouring answers may be for the track to be used. They are asked for a
 * day apart; up to a day and a quarter still keeps the curve within half of the last digit shown.
 */
const MAX_ANSWER_GAP_MS = 1.25 * DAY_MS;

/** A real backend is asked a few questions at a time; the mock answers in the browser, all at once. */
function concurrency(): number {
  return isMockMode() ? MAX_TRACK_SAMPLES : 6;
}

const cache = new Map<number, Promise<TrackSample>>();

/**
 * Sun and Earth overhead points at the landing that follows a launch at `launchMs` (cached).
 * The request is its own: it is not tied to any one caller's signal, because later loads share it.
 * It rejects, and leaves the cache, when it fails, when the answer cannot be read, or when no
 * answer has come after GEOMETRY_TIMEOUT_MS.
 */
export function geometryForLaunch(launchMs: number): Promise<TrackSample> {
  const hit = cache.get(launchMs);
  if (hit) return hit;
  const controller = new AbortController();
  const call = new Promise<TrackSample>((resolve, reject) => {
    const timer = setTimeout(() => {
      // Not an abort error: nobody cancelled this, so the screen must show the failure and "Try again".
      reject(new ApiError('network', 'The backend took too long to answer. Try again.'));
      controller.abort();
    }, GEOMETRY_TIMEOUT_MS);
    Promise.resolve()
      .then(() => api.evaluate({ sites: [GEOMETRY_PROBE], launch_utc: toIsoUtc(launchMs), slip_days: 0, stay_days: 1, hardware: [], storage_kwh: 0 }, controller.signal))
      .then((r) => {
        const sample: TrackSample = { tMs: Date.parse(r.landing_utc), geometry: r.geometry };
        // A missing landing time or a missing value is no answer: it is not joined into the track.
        if (!isWholeSample(sample)) throw new ApiError('parse', 'The backend sent a geometry answer the website could not read.');
        return sample;
      })
      .then(resolve, reject)
      .finally(() => clearTimeout(timer));
  });
  cache.set(launchMs, call);
  call.catch(() => {
    // Only this request's own entry: the cache may have been cleared and asked again meanwhile.
    if (cache.get(launchMs) === call) cache.delete(launchMs);
  });
  return call;
}

/** For tests: forget every cached answer. */
export function clearGeometryCache(): void {
  cache.clear();
}

/**
 * Launch instants to ask about so the answers cover `spanDays` after the planned landing, a day
 * apart, with one spare answer on each side (the curve needs a neighbour beyond each end).
 * Never more than MAX_TRACK_SAMPLES: a longer span than the controls allow is covered only as far
 * as that reaches, and the track's valid range ends there.
 */
export function trackLaunchTimes(launchUtcMs: number, spanDays: number): number[] {
  const wanted = Number.isFinite(spanDays) ? Math.max(1, Math.ceil(spanDays)) : 1;
  const days = Math.min(wanted, MAX_TRACK_SAMPLES - 3);
  const out: number[] = [];
  for (let k = -1; k <= days + 1; k++) out.push(launchUtcMs + k * DAY_MS);
  return out;
}

/** Follows a promise, but rejects with the abort error as soon as the signal aborts. */
function untilAborted<T>(work: Promise<T>, signal?: AbortSignal): Promise<T> {
  if (!signal) return work;
  return new Promise<T>((resolve, reject) => {
    const onAbort = () => reject(abortError());
    if (signal.aborted) onAbort();
    else signal.addEventListener('abort', onAbort, { once: true });
    work.then(resolve, reject).finally(() => signal.removeEventListener('abort', onAbort));
  });
}

/**
 * The track for `spanDays` after the planned landing (the landing that follows a launch at
 * `launchUtcMs` with no delay). Its valid range is that span: readouts are taken from there and
 * not from the spare answers at the ends.
 *
 * It resolves only with every answer in hand. An abort rejects with the abort error at once,
 * without waiting for requests still on their way; a failed or unanswered request rejects the load.
 */
export async function loadTrack(launchUtcMs: number, spanDays: number, signal?: AbortSignal): Promise<GeometryTrack> {
  if (signal?.aborted) throw abortError();
  const launches = trackLaunchTimes(launchUtcMs, spanDays);
  const answers: TrackSample[] = new Array(launches.length);
  let next = 0;
  let stopped = false;
  async function worker() {
    while (next < launches.length && !stopped) {
      const i = next++;
      answers[i] = await geometryForLaunch(launches[i]);
    }
  }
  try {
    await untilAborted(Promise.all(Array.from({ length: Math.min(concurrency(), launches.length) }, worker)), signal);
  } finally {
    // An abort or a failed request ends this load: it asks no more questions.
    stopped = true;
  }
  if (signal?.aborted) throw abortError();

  // Every answer must be there, in step with the launches and close enough to its neighbour.
  // A track is never built from part of the set, and never stretched across a hole.
  for (let i = 0; i < launches.length; i++) {
    const gap = i === 0 ? 1 : answers[i]?.tMs - answers[i - 1]?.tMs;
    if (!isWholeSample(answers[i]) || !(gap > 0 && gap <= MAX_ANSWER_GAP_MS)) {
      throw new ApiError('parse', 'The geometry answers do not cover the window a day at a time.');
    }
  }
  // launches[1] is the planned launch itself, so answers[1] is the planned landing. The last answer
  // is a spare, so the range ends at the one before it at the latest.
  const startMs = answers[1].tMs;
  const span = Number.isFinite(spanDays) ? Math.max(0, spanDays) : 0;
  const endMs = Math.min(startMs + span * DAY_MS, answers[answers.length - 2].tMs);
  const track = buildTrack(answers, { startMs, endMs });
  if (!track) throw new Error('No geometry answers came back.');
  return track;
}
