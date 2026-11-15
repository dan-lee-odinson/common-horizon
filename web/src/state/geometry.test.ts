// The geometry track loader: answers a day apart whatever the window length, a valid range that
// leaves out the spare ends, requests that give up instead of hanging, and loads that stop on abort.

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { api } from '../api/client';
import { ApiError, isAbortError } from '../api/errors';
import { configureMock } from '../api/mock';
import { geometryAt, MOCK_PROVENANCE, subearthPoint, subsolarPoint, TRANSIT_DAYS } from '../api/mock/model';
import type { EvaluateRequest, EvaluateResponse } from '../api/types';
import { wrap180 } from '../util/geo';
import { DAY_MS, HOUR_MS, SYNODIC_MONTH_DAYS, toIsoUtc } from '../util/time';
import { trackCovers } from '../util/track';
import { clearGeometryCache, GEOMETRY_TIMEOUT_MS, geometryForLaunch, loadTrack, MAX_TRACK_SAMPLES, trackLaunchTimes } from './geometry';

const LAUNCH = Date.UTC(2027, 1, 10, 15, 0, 0);
const LANDING = LAUNCH + TRANSIT_DAYS * DAY_MS;

/** What a healthy backend answers (the mock model's figures), with no delay. */
function answerFor(req: EvaluateRequest): EvaluateResponse {
  const landingMs = Date.parse(req.launch_utc) + TRANSIT_DAYS * DAY_MS;
  return {
    launch_utc: req.launch_utc,
    landing_utc: toIsoUtc(landingMs),
    transit_days: TRANSIT_DAYS,
    slip_days: 0,
    stay_days: req.stay_days,
    time_step_s: 3600,
    geometry: geometryAt(landingMs),
    results: [],
    provenance: MOCK_PROVENANCE,
    warnings: [],
  };
}

/** A request that never answers: a stalled connection. */
function never<T>(): Promise<T> {
  return new Promise<T>(() => {});
}

/** How a promise ended, without throwing: 'resolved', or the error it rejected with. */
function outcomeOf(p: Promise<unknown>): Promise<unknown> {
  return p.then(
    () => 'resolved',
    (err: unknown) => err,
  );
}

beforeEach(() => {
  configureMock({ latencyMs: 0, scenario: { mode: 'normal', assistant: 'on' } });
  clearGeometryCache();
});

afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
  vi.unstubAllEnvs();
});

describe('which launches a track asks about', () => {
  it.each([1, 14, SYNODIC_MONTH_DAYS, 93, 94, 186, 365.25, 395.25])('asks for answers one day apart for a %s-day window, with a spare at each end', (days) => {
    const launches = trackLaunchTimes(LAUNCH, days);
    for (let i = 1; i < launches.length; i++) expect(launches[i] - launches[i - 1]).toBe(DAY_MS);
    expect(launches[0]).toBe(LAUNCH - DAY_MS);
    expect(launches[1]).toBe(LAUNCH);
    // The second-to-last answer is at or past the end of the window; the last one is the spare.
    expect(launches[launches.length - 2]).toBeGreaterThanOrEqual(LAUNCH + days * DAY_MS);
    expect(launches[launches.length - 2]).toBeLessThan(LAUNCH + (days + 1) * DAY_MS);
    expect(launches.length).toBeLessThanOrEqual(MAX_TRACK_SAMPLES);
  });

  it('never asks for more than the cap, and still a day apart', () => {
    const launches = trackLaunchTimes(LAUNCH, 2000);
    expect(launches).toHaveLength(MAX_TRACK_SAMPLES);
    for (let i = 1; i < launches.length; i++) expect(launches[i] - launches[i - 1]).toBe(DAY_MS);
    // A span that is not a number asks for the shortest window rather than nothing or everything.
    expect(trackLaunchTimes(LAUNCH, Number.NaN)).toHaveLength(4);
    expect(trackLaunchTimes(LAUNCH, Infinity)).toHaveLength(4);
  });
});

describe('loading a track in example mode', () => {
  // The readouts show Earth's and the Sun's overhead points to 0.01°. The longest window the
  // controls allow is a 365.25-day stay after a 30-day delay.
  it.each([186, 365.25, 395])('follows the mock model to 0.005° over a %s-day window', async (days) => {
    const track = await loadTrack(LAUNCH, days);
    for (let i = 1; i < track.samples.length; i++) expect(track.samples[i].tMs - track.samples[i - 1].tMs).toBe(DAY_MS);
    expect(track.validStartMs).toBe(LANDING);
    expect(track.validEndMs).toBe(LANDING + days * DAY_MS);
    let worstSun = 0;
    let worstEarth = 0;
    for (let t = LANDING; t <= LANDING + days * DAY_MS; t += 0.5 * HOUR_MS) {
      expect(trackCovers(track, t)).toBe(true);
      const got = track.at(t);
      const sun = subsolarPoint(t);
      const earth = subearthPoint(t);
      worstSun = Math.max(worstSun, Math.abs(got.subsolar_lat - sun.lat), Math.abs(wrap180(got.subsolar_lon_east - sun.lonEast)));
      worstEarth = Math.max(worstEarth, Math.abs(got.subearth_lat - earth.lat), Math.abs(wrap180(got.subearth_lon_east - earth.lonEast)));
    }
    expect(worstEarth).toBeLessThan(0.005);
    expect(worstSun).toBeLessThan(0.001);
  });

  it('sets the valid range to the window asked for, leaving out the spare answers at the ends', async () => {
    const track = await loadTrack(LAUNCH, SYNODIC_MONTH_DAYS);
    expect(track.startMs).toBe(LANDING - DAY_MS);
    expect(track.validStartMs).toBe(LANDING);
    expect(track.validEndMs).toBe(LANDING + SYNODIC_MONTH_DAYS * DAY_MS);
    expect(track.endMs).toBeGreaterThan(track.validEndMs!);
    expect(trackCovers(track, LANDING)).toBe(true);
    expect(trackCovers(track, LANDING + SYNODIC_MONTH_DAYS * DAY_MS)).toBe(true);
    // Inside the answers, outside the window: a spare end interval.
    expect(trackCovers(track, LANDING - HOUR_MS)).toBe(false);
    expect(trackCovers(track, track.endMs - HOUR_MS)).toBe(false);
  });

  it('covers the last instant of the Orbit preview and of the stay, for every launch delay', async () => {
    // The app asks for the delay plus the longer of the stay and one lunar day (state/data.tsx), and
    // works out the ends of its windows from the delayed landing. The two sums can differ in the last
    // bit of a millisecond; the end of a window must still be inside the track.
    for (const stayDays of [1, 14, 45.25, 365.25]) {
      for (let slipDays = 0; slipDays <= 30; slipDays += stayDays > 100 ? 15 : 1) {
        const track = await loadTrack(LAUNCH, slipDays + Math.max(stayDays, SYNODIC_MONTH_DAYS));
        const landingMs = LANDING + slipDays * DAY_MS;
        expect(trackCovers(track, LANDING)).toBe(true);
        expect(trackCovers(track, landingMs)).toBe(true);
        expect(trackCovers(track, landingMs + SYNODIC_MONTH_DAYS * DAY_MS)).toBe(true);
        expect(trackCovers(track, landingMs + stayDays * DAY_MS)).toBe(true);
        // A second past the longer of the two is outside.
        expect(trackCovers(track, landingMs + Math.max(stayDays, SYNODIC_MONTH_DAYS) * DAY_MS + 1000)).toBe(false);
      }
    }
  });

  it('ends the valid range where the answers end when the window is longer than the cap', async () => {
    const track = await loadTrack(LAUNCH, 2000);
    expect(track.samples).toHaveLength(MAX_TRACK_SAMPLES);
    expect(track.validStartMs).toBe(LANDING);
    expect(track.validEndMs).toBe(LANDING + (MAX_TRACK_SAMPLES - 3) * DAY_MS);
    expect(trackCovers(track, LANDING + 2000 * DAY_MS)).toBe(false);
  });

  it('asks about each launch once and reuses the answers for the next window', async () => {
    const spy = vi.spyOn(api, 'evaluate');
    await loadTrack(LAUNCH, 30);
    expect(spy).toHaveBeenCalledTimes(33);
    // The launch moved by a day: one new day to ask about.
    await loadTrack(LAUNCH + DAY_MS, 30);
    expect(spy).toHaveBeenCalledTimes(34);
  });
});

describe('a geometry request that never answers', () => {
  it('is given up after the timeout with an error the screen can show, and leaves the cache', async () => {
    vi.useFakeTimers();
    const signals: (AbortSignal | undefined)[] = [];
    const spy = vi.spyOn(api, 'evaluate').mockImplementation((_req, signal) => {
      signals.push(signal);
      return never();
    });
    const call = geometryForLaunch(LAUNCH);
    const outcome = outcomeOf(call);
    await vi.advanceTimersByTimeAsync(GEOMETRY_TIMEOUT_MS - 1);
    // Still waiting: the same request is shared, nothing new is sent.
    expect(geometryForLaunch(LAUNCH)).toBe(call);
    expect(spy).toHaveBeenCalledTimes(1);
    await vi.advanceTimersByTimeAsync(1);
    const err = await outcome;
    expect(err).toBeInstanceOf(ApiError);
    expect((err as ApiError).kind).toBe('network');
    // Not an abort error: the screens ignore those, and this failure must be shown.
    expect(isAbortError(err)).toBe(false);
    // The stalled request itself is cancelled.
    expect(signals[0]?.aborted).toBe(true);

    // It left the cache, so asking again really asks again.
    spy.mockImplementation((req) => Promise.resolve(answerFor(req)));
    const again = await geometryForLaunch(LAUNCH);
    expect(spy).toHaveBeenCalledTimes(2);
    expect(again).toEqual({ tMs: LANDING, geometry: geometryAt(LANDING) });
  });

  it('does not block a later load of the same window', async () => {
    vi.useFakeTimers();
    const spy = vi.spyOn(api, 'evaluate').mockImplementation(() => never());
    const first = outcomeOf(loadTrack(LAUNCH, 30));
    await vi.advanceTimersByTimeAsync(GEOMETRY_TIMEOUT_MS);
    const err = await first;
    expect(err).toBeInstanceOf(ApiError);
    expect(isAbortError(err)).toBe(false);

    spy.mockImplementation((req) => Promise.resolve(answerFor(req)));
    const track = await loadTrack(LAUNCH, 30);
    expect(track.samples).toHaveLength(33);
    expect(track.validStartMs).toBe(LANDING);
  });

  it('leaves no timer running once the answer is in', async () => {
    vi.useFakeTimers();
    vi.spyOn(api, 'evaluate').mockImplementation((req) => Promise.resolve(answerFor(req)));
    await loadTrack(LAUNCH, 30);
    expect(vi.getTimerCount()).toBe(0);
  });
});

describe('aborting a load', () => {
  it('rejects with the abort error when its signal is already aborted, and asks nothing', async () => {
    const spy = vi.spyOn(api, 'evaluate');
    const controller = new AbortController();
    controller.abort();
    const err = await outcomeOf(loadTrack(LAUNCH, 30, controller.signal));
    expect(isAbortError(err)).toBe(true);
    expect(spy).not.toHaveBeenCalled();
  });

  it('stops waiting as soon as its signal aborts, even with requests that never answer', async () => {
    vi.useFakeTimers();
    vi.spyOn(api, 'evaluate').mockImplementation(() => never());
    const controller = new AbortController();
    const outcome = outcomeOf(loadTrack(LAUNCH, 30, controller.signal));
    await vi.advanceTimersByTimeAsync(0);
    controller.abort();
    // No timer is advanced: the abort alone ends the wait.
    expect(isAbortError(await outcome)).toBe(true);
  });

  it('never resolves with part of the set', async () => {
    vi.useFakeTimers();
    const launches = trackLaunchTimes(LAUNCH, 30);
    // The first six days answer; the rest are still on their way when the load is aborted.
    vi.spyOn(api, 'evaluate').mockImplementation((req) => (Date.parse(req.launch_utc) <= launches[5] ? Promise.resolve(answerFor(req)) : never()));
    const controller = new AbortController();
    let settled: unknown = 'pending';
    const outcome = outcomeOf(loadTrack(LAUNCH, 30, controller.signal)).then((o) => (settled = o));
    await vi.advanceTimersByTimeAsync(0);
    expect(settled).toBe('pending');
    controller.abort();
    await outcome;
    expect(isAbortError(settled)).toBe(true);
  });

  it('asks no further questions after an abort', async () => {
    vi.useFakeTimers();
    // A slow backend that is asked a few questions at a time: each answer takes a second.
    vi.stubEnv('VITE_API_BASE', 'http://backend.test');
    const spy = vi.spyOn(api, 'evaluate').mockImplementation((req) => new Promise((resolve) => setTimeout(() => resolve(answerFor(req)), 1000)));
    const controller = new AbortController();
    const outcome = outcomeOf(loadTrack(LAUNCH, 30, controller.signal));
    await vi.advanceTimersByTimeAsync(1500);
    const asked = spy.mock.calls.length;
    expect(asked).toBeLessThan(33);
    controller.abort();
    expect(isAbortError(await outcome)).toBe(true);
    await vi.advanceTimersByTimeAsync(60_000);
    expect(spy).toHaveBeenCalledTimes(asked);
  });
});

describe('a failed or unreadable answer', () => {
  it('rejects the load, and the next load asks again only for the answer that failed', async () => {
    const failing = toIsoUtc(LAUNCH + 7 * DAY_MS);
    const spy = vi
      .spyOn(api, 'evaluate')
      .mockImplementation((req) => (req.launch_utc === failing ? Promise.reject(new ApiError('http', 'The backend answered with an error (HTTP 500).', 500)) : Promise.resolve(answerFor(req))));
    const err = await outcomeOf(loadTrack(LAUNCH, 30));
    expect(err).toBeInstanceOf(ApiError);
    expect((err as ApiError).kind).toBe('http');
    expect(spy).toHaveBeenCalledTimes(33);

    spy.mockImplementation((req) => Promise.resolve(answerFor(req)));
    const track = await loadTrack(LAUNCH, 30);
    expect(track.samples).toHaveLength(33);
    expect(spy).toHaveBeenCalledTimes(34);
  });

  it('does not join an answer with an unreadable landing time or a missing value into the track', async () => {
    const spy = vi.spyOn(api, 'evaluate').mockImplementation((req) => Promise.resolve({ ...answerFor(req), landing_utc: 'not a time' }));
    const noTime = await outcomeOf(geometryForLaunch(LAUNCH));
    expect(noTime).toBeInstanceOf(ApiError);
    expect((noTime as ApiError).kind).toBe('parse');

    spy.mockImplementation((req) => {
      const answer = answerFor(req);
      return Promise.resolve({ ...answer, geometry: { ...answer.geometry!, subearth_lat: undefined as unknown as number } });
    });
    const noValue = await outcomeOf(geometryForLaunch(LAUNCH));
    expect((noValue as ApiError).kind).toBe('parse');
    expect((await outcomeOf(loadTrack(LAUNCH, 30))) instanceof ApiError).toBe(true);

    // Neither stayed in the cache: a healthy backend is asked afresh.
    spy.mockImplementation((req) => Promise.resolve(answerFor(req)));
    expect((await geometryForLaunch(LAUNCH)).tMs).toBe(LANDING);
  });

  it('refuses answers that are not a day apart, rather than stretch the curve across them', async () => {
    // A backend whose landing moves two days for each day of launch: the answers are two days apart.
    vi.spyOn(api, 'evaluate').mockImplementation((req) => {
      const landingMs = LANDING + 2 * (Date.parse(req.launch_utc) - LAUNCH);
      return Promise.resolve({ ...answerFor(req), landing_utc: toIsoUtc(landingMs), geometry: geometryAt(landingMs) });
    });
    const err = await outcomeOf(loadTrack(LAUNCH, 30));
    expect(err).toBeInstanceOf(ApiError);
    expect((err as ApiError).kind).toBe('parse');
  });

  it('refuses a launch time that is not a real time, without throwing where it is called', async () => {
    const err = await outcomeOf(geometryForLaunch(Number.NaN));
    expect(err).toBeInstanceOf(Error);
    expect(isAbortError(err)).toBe(false);
  });
});
