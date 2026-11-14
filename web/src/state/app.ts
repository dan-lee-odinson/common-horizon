// Everything the visitor has chosen lives here: the view, the dates, the hardware, the sites.

import type { CatalogItem, HardwareChoice, Site, SiteRef } from '../api/types';
import type { TimeScale } from '../util/time';
import { formatLatLon, normalizeLon360 } from '../util/geo';
import { createStore } from './store';
import { prefersReducedMotion } from './useMedia';

export type View = 'globe' | 'sites' | 'scene';
export type Drawer = 'none' | 'planner' | 'sites' | 'horizon';
/**
 * Camera flight between the Moon and a site scene. "in": the Moon camera flies down to the
 * highlighted site, then the site scene opens. "out": back from the site scene, the Moon camera
 * starts over the site and flies out. null: no flight.
 */
export type Flight = 'in' | 'out' | null;

export interface HardwarePick {
  selected: boolean;
  count: number;
  /** True once the visitor has touched this row; site defaults no longer change it. */
  userSet: boolean;
}

export interface AppState {
  view: View;
  launchUtcMs: number;
  slipDays: number;
  timeScale: TimeScale;
  stayDays: number;
  hardware: Record<string, HardwarePick>;
  /** Battery storage typed in the planner, kWh. 0 = none. */
  storageKwh: number;
  highlightedId: string | null;
  /** The point typed into the coordinate entry or clicked on the Moon. */
  customSite: SiteRef | null;
  saved: SiteRef[];
  compareOpen: boolean;
  horizonOpen: boolean;
  /** Phone widths: which drawer is open. */
  drawer: Drawer;
  playing: boolean;
  flight: Flight;
}

/** Example default launch: picked because the mock ranking changes clearly with the slip. */
export const DEFAULT_LAUNCH_UTC_MS = Date.UTC(2027, 1, 10, 15, 0, 0);
export const DEFAULT_STAY_DAYS = 14;
export const MAX_SLIP_DAYS = 30;
export const MIN_STAY_DAYS = 1;
export const MAX_STAY_DAYS = 365.25;
/** Upper limit for typed battery storage, kWh (far above anything a lander carries). */
export const MAX_STORAGE_KWH = 1_000_000;
const SAVED_KEY = 'common-horizon.saved-sites';

function loadSaved(): SiteRef[] {
  try {
    const raw = globalThis.localStorage?.getItem(SAVED_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw) as unknown;
    if (!Array.isArray(parsed)) return [];
    return parsed.filter(
      (s): s is SiteRef =>
        typeof s === 'object' && s !== null && typeof s.id === 'string' && typeof s.name === 'string' && Number.isFinite(s.lat) && Number.isFinite(s.lon_east),
    );
  } catch {
    return [];
  }
}

function storeSaved(saved: SiteRef[]): void {
  try {
    globalThis.localStorage?.setItem(SAVED_KEY, JSON.stringify(saved));
  } catch {
    // Private windows can refuse storage; saving then lasts for this visit only.
  }
}

export const appStore = createStore<AppState>({
  view: 'globe',
  launchUtcMs: DEFAULT_LAUNCH_UTC_MS,
  slipDays: 0,
  timeScale: 'UTC',
  stayDays: DEFAULT_STAY_DAYS,
  hardware: {},
  storageKwh: 0,
  highlightedId: null,
  customSite: null,
  saved: loadSaved(),
  compareOpen: false,
  horizonOpen: true,
  drawer: 'none',
  playing: false,
  flight: null,
});

/** Simulated "now" in the site scene (moves when Play runs). null = at the landing time. */
export const simClock = createStore<{ nowMs: number | null }>({ nowMs: null });

// ---------- actions ----------

export function clamp(x: number, lo: number, hi: number): number {
  return Math.min(hi, Math.max(lo, x));
}

/** A flight that no view finishes (for example while the 3D code is still loading) ends after this. */
export const FLIGHT_TIMEOUT_MS = 3000;
let flightSeq = 0;

function startFlight(flight: 'in' | 'out', finish: () => void) {
  const seq = ++flightSeq;
  setTimeout(() => {
    if (seq === flightSeq && appStore.get().flight === flight) finish();
  }, FLIGHT_TIMEOUT_MS);
}

export const actions = {
  setView(view: View) {
    appStore.set({ view, drawer: 'none', flight: null, playing: view === 'scene' ? appStore.get().playing : false });
    if (view !== 'scene') simClock.set({ nowMs: null });
  },
  /**
   * "Zoom in to this site": the Moon camera flies to the highlighted site, then the site scene
   * opens. Visitors who prefer reduced motion (and every view but the site markers) switch at once.
   */
  zoomToSite() {
    const s = appStore.get();
    if (!s.highlightedId || s.flight === 'in') return;
    if (s.view !== 'sites' || prefersReducedMotion()) {
      actions.setView('scene');
      return;
    }
    appStore.set({ flight: 'in', drawer: 'none' });
    startFlight('in', actions.finishFlightIn);
  },
  /** Called by the Moon view when the camera reaches the site. */
  finishFlightIn() {
    if (appStore.get().flight === 'in') actions.setView('scene');
  },
  /** "Back to Moon" from the site scene: the reverse of "Zoom in to this site". */
  backToMoon() {
    const out = !prefersReducedMotion() && appStore.get().highlightedId !== null;
    appStore.set({ view: 'sites', drawer: 'none', playing: false, flight: out ? 'out' : null });
    simClock.set({ nowMs: null });
    if (out) startFlight('out', actions.finishFlightOut);
  },
  /** Called by the Moon view when the camera is back at its usual distance. */
  finishFlightOut() {
    if (appStore.get().flight === 'out') appStore.set({ flight: null });
  },
  setLaunch(ms: number) {
    if (Number.isFinite(ms)) appStore.set({ launchUtcMs: ms });
    simClock.set({ nowMs: null });
  },
  setSlip(days: number) {
    appStore.set({ slipDays: clamp(Math.round(days), 0, MAX_SLIP_DAYS) });
    simClock.set({ nowMs: null });
  },
  setTimeScale(timeScale: TimeScale) {
    appStore.set({ timeScale });
  },
  setStay(days: number) {
    appStore.set({ stayDays: clamp(Math.round(days * 4) / 4, MIN_STAY_DAYS, MAX_STAY_DAYS) });
  },
  /** Called once the catalog arrives: every item starts unticked with its default count. */
  initHardware(items: CatalogItem[]) {
    const current = appStore.get().hardware;
    const next: Record<string, HardwarePick> = {};
    for (const item of items) {
      next[item.id] = current[item.id] ?? { selected: false, count: item.default_count, userSet: false };
    }
    appStore.set({ hardware: next });
  },
  toggleHardware(id: string, selected: boolean) {
    const hw = appStore.get().hardware;
    const pick = hw[id] ?? { selected: false, count: 1, userSet: false };
    appStore.set({ hardware: { ...hw, [id]: { ...pick, selected, userSet: true } } });
  },
  setHardwareCount(id: string, count: number, max: number) {
    const hw = appStore.get().hardware;
    const pick = hw[id] ?? { selected: true, count: 1, userSet: false };
    appStore.set({ hardware: { ...hw, [id]: { ...pick, count: clamp(Math.round(count), 1, max), userSet: true } } });
  },
  /** Battery storage in kWh. Anything not a positive number means none. */
  setStorage(kwh: number) {
    appStore.set({ storageKwh: Number.isFinite(kwh) && kwh > 0 ? clamp(kwh, 0, MAX_STORAGE_KWH) : 0 });
  },
  /** Highlight a site. Items the visitor has not touched follow the site's default hardware. */
  highlight(id: string | null, site?: Pick<Site, 'default_hardware'> | null) {
    const { hardware } = appStore.get();
    const defaults = new Set(site?.default_hardware ?? []);
    const next: Record<string, HardwarePick> = {};
    for (const [key, pick] of Object.entries(hardware)) {
      next[key] = pick.userSet ? pick : { ...pick, selected: defaults.has(key) };
    }
    appStore.set({ highlightedId: id, hardware: next });
  },
  setCustomSite(lat: number, lonEast: number) {
    const lon = normalizeLon360(lonEast);
    const site: SiteRef = {
      id: customId(lat, lon),
      name: `Custom point ${formatLatLon(lat, lon, 2)}`,
      lat: Math.round(lat * 1e5) / 1e5,
      lon_east: Math.round(lon * 1e5) / 1e5,
    };
    appStore.set({ customSite: site });
    actions.highlight(site.id, null);
    return site;
  },
  toggleSaved(site: SiteRef) {
    const { saved } = appStore.get();
    const next = saved.some((s) => s.id === site.id) ? saved.filter((s) => s.id !== site.id) : [...saved, site];
    appStore.set({ saved: next, compareOpen: next.length === 0 ? false : appStore.get().compareOpen });
    storeSaved(next);
  },
  setCompareOpen(open: boolean) {
    appStore.set({ compareOpen: open });
  },
  setHorizonOpen(open: boolean) {
    appStore.set({ horizonOpen: open });
  },
  setDrawer(drawer: Drawer) {
    appStore.set({ drawer });
  },
  setPlaying(playing: boolean) {
    appStore.set({ playing });
  },
};

export function customId(lat: number, lonEast: number): string {
  return `custom:${lat.toFixed(4)}:${normalizeLon360(lonEast).toFixed(4)}`;
}

export function hardwareChoices(hardware: Record<string, HardwarePick>): HardwareChoice[] {
  return Object.entries(hardware)
    .filter(([, p]) => p.selected)
    .map(([id, p]) => ({ id, count: p.count }))
    .sort((a, b) => a.id.localeCompare(b.id));
}
