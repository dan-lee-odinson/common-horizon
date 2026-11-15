// Everything the visitor has chosen lives here: the stage, the dates, the hardware, the sites.

import type { CatalogItem, HardwareChoice, Site, SiteRef } from '../api/types';
import { formatLatLon, normalizeLon360 } from '../util/geo';
import { MAX_STORAGE_KWH } from '../util/storage';
import { createStore } from './store';
import { prefersReducedMotion } from './useMedia';

/**
 * The three stages of one continuous space:
 *   orbit    the whole Moon with the Sun and Earth riding their rings
 *   mission  mission select: one site in the spotlight, the ranking, the delay
 *   site     the terrain at the selected site, with time playing
 */
export type Stage = 'orbit' | 'mission' | 'site';

/**
 * Camera flight between mission select and the site. "in": the camera dives from the Moon to the
 * selected site, then the terrain takes over. "out": back from the terrain, the camera starts low
 * over the site and climbs out. null: no flight.
 */
export type Flight = 'in' | 'out' | null;

export type DrawerMode = 'preset' | 'custom';

export interface HardwarePick {
  selected: boolean;
  count: number;
  /** True once the visitor has touched this row; site defaults no longer change it. */
  userSet: boolean;
}

export interface AppState {
  stage: Stage;
  /** The landing card over the Orbit stage. Open on first load; "About" reopens it. */
  cardOpen: boolean;
  launchUtcMs: number;
  slipDays: number;
  stayDays: number;
  hardware: Record<string, HardwarePick>;
  /** Battery storage typed in the planner, kWh. 0 = none. */
  storageKwh: number;
  /** The site the visitor picked. null = follow the best-ranked site. */
  highlightedId: string | null;
  /** The point typed into the coordinate entry or clicked on the Moon. */
  customSite: SiteRef | null;
  saved: SiteRef[];
  compareOpen: boolean;
  /** Mission select: the site drawer (presets, coordinates, saved sites). */
  drawerOpen: boolean;
  drawerMode: DrawerMode;
  /** Mission select: the mission planner sheet. */
  missionOpen: boolean;
  /** Site stage on phones: the horizon sheet. */
  horizonOpen: boolean;
  /** Orbit and site stages: the Mission Assistant, opened from the top bar. (In mission select it is always there.) */
  assistantOpen: boolean;
  /** Orbit: the time preview is running. */
  previewPlaying: boolean;
  /** Site stage: time is playing, and how fast (simulated days per second). */
  playing: boolean;
  speed: number;
  flight: Flight;
}

/** Example default launch: picked because the mock ranking changes clearly with the delay. */
export const DEFAULT_LAUNCH_UTC_MS = Date.UTC(2027, 1, 10, 15, 0, 0);
export const DEFAULT_STAY_DAYS = 14;
export const MAX_SLIP_DAYS = 30;
export const MIN_STAY_DAYS = 1;
export const MAX_STAY_DAYS = 365.25;
export { MAX_STORAGE_KWH };
/** Site stage speeds, in simulated days per second of play. */
export const SPEEDS = [0.5, 2, 6] as const;
export const DEFAULT_SPEED = 2;

/**
 * The example mission the app opens with, so the ranking is live on arrival: catalog ids and
 * counts, and battery storage. Only ids the catalog really has are ticked.
 */
export const EXAMPLE_MISSION: { hardware: Record<string, number>; storageKwh: number } = {
  hardware: { starship: 1, hab: 1, rover: 1, solar: 4 },
  storageKwh: 2000,
};

const SAVED_KEY = 'common-horizon.saved-sites';
const CARD_KEY = 'common-horizon.card-seen';

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

/** The landing card shows once per visit (one browser tab's session). */
function cardSeen(): boolean {
  try {
    return globalThis.sessionStorage?.getItem(CARD_KEY) === '1';
  } catch {
    return false;
  }
}

function markCardSeen(): void {
  try {
    globalThis.sessionStorage?.setItem(CARD_KEY, '1');
  } catch {
    // Without storage the card simply shows again on the next load.
  }
}

export const appStore = createStore<AppState>({
  stage: 'orbit',
  cardOpen: !cardSeen(),
  launchUtcMs: DEFAULT_LAUNCH_UTC_MS,
  slipDays: 0,
  stayDays: DEFAULT_STAY_DAYS,
  hardware: {},
  storageKwh: 0,
  highlightedId: null,
  customSite: null,
  saved: loadSaved(),
  compareOpen: false,
  drawerOpen: false,
  drawerMode: 'preset',
  missionOpen: false,
  horizonOpen: false,
  assistantOpen: false,
  previewPlaying: !prefersReducedMotion(),
  playing: false,
  speed: DEFAULT_SPEED,
  flight: null,
});

/** Simulated "now" in the site stage (moves when Play runs). null = at the landing time. */
export const simClock = createStore<{ nowMs: number | null }>({ nowMs: null });

/** The previewed instant in the Orbit stage. null = at the landing time. It never changes the launch date. */
export const orbitClock = createStore<{ nowMs: number | null }>({ nowMs: null });

// ---------- actions ----------

export function clamp(x: number, lo: number, hi: number): number {
  return Math.min(hi, Math.max(lo, x));
}

/** A flight that no scene finishes (for example while the 3D code is still loading) ends after this. */
export const FLIGHT_TIMEOUT_MS = 4500;
let flightSeq = 0;
let missionInitialised = false;

function startFlight(flight: 'in' | 'out', finish: () => void) {
  const seq = ++flightSeq;
  setTimeout(() => {
    if (seq === flightSeq && appStore.get().flight === flight) finish();
  }, FLIGHT_TIMEOUT_MS);
}

const CLOSED_PANELS = { drawerOpen: false, missionOpen: false, horizonOpen: false, compareOpen: false, assistantOpen: false } as const;

export const actions = {
  /** "Begin", Escape or a click outside: the landing card closes and does not return this visit. */
  closeCard() {
    if (!appStore.get().cardOpen) return;
    appStore.set({ cardOpen: false });
    markCardSeen();
  },
  /** "About" in the HUD. */
  openCard() {
    appStore.set({ cardOpen: true, ...CLOSED_PANELS });
  },
  /** Orbit -> mission select. */
  enterMission() {
    flightSeq++;
    appStore.set({ stage: 'mission', flight: null, playing: false, ...CLOSED_PANELS });
    simClock.set({ nowMs: null });
    orbitClock.set({ nowMs: null });
  },
  /** Mission select -> orbit. */
  backToOrbit() {
    flightSeq++;
    appStore.set({ stage: 'orbit', flight: null, playing: false, ...CLOSED_PANELS });
    simClock.set({ nowMs: null });
    orbitClock.set({ nowMs: null });
  },
  /**
   * "Zoom in to this site": the camera dives to the given site, then the terrain takes over.
   * Visitors who prefer reduced motion switch at once.
   */
  zoomToSite(site: Pick<Site, 'id' | 'default_hardware'> | null) {
    const s = appStore.get();
    if (!site || s.flight === 'in') return;
    if (s.highlightedId !== site.id) actions.highlight(site.id, site);
    if (s.stage !== 'mission' || prefersReducedMotion()) {
      actions.showSite();
      return;
    }
    appStore.set({ flight: 'in', ...CLOSED_PANELS });
    startFlight('in', actions.finishFlightIn);
  },
  showSite() {
    flightSeq++;
    appStore.set({ stage: 'site', flight: null, ...CLOSED_PANELS });
  },
  /** Called by the scene when the camera reaches the site. */
  finishFlightIn() {
    if (appStore.get().flight === 'in') actions.showSite();
  },
  /** "Back to mission select" from the site: the reverse of "Zoom in to this site". */
  backToMission() {
    const out = !prefersReducedMotion() && appStore.get().highlightedId !== null && appStore.get().stage === 'site';
    appStore.set({ stage: 'mission', playing: false, flight: out ? 'out' : null, ...CLOSED_PANELS });
    simClock.set({ nowMs: null });
    if (out) startFlight('out', actions.finishFlightOut);
  },
  /** Called by the scene when the camera is back at its mission-select distance. */
  finishFlightOut() {
    if (appStore.get().flight === 'out') appStore.set({ flight: null });
  },
  setLaunch(ms: number) {
    if (Number.isFinite(ms)) appStore.set({ launchUtcMs: ms });
    simClock.set({ nowMs: null });
    orbitClock.set({ nowMs: null });
  },
  setSlip(days: number) {
    appStore.set({ slipDays: clamp(Math.round(days), 0, MAX_SLIP_DAYS) });
    simClock.set({ nowMs: null });
    orbitClock.set({ nowMs: null });
  },
  setStay(days: number) {
    appStore.set({ stayDays: clamp(Math.round(days * 4) / 4, MIN_STAY_DAYS, MAX_STAY_DAYS) });
  },
  /**
   * Called once the catalog arrives. The first time, the example mission is ticked (ids the catalog
   * has) as if the visitor had chosen it; every other item starts unticked with its default count.
   */
  initHardware(items: CatalogItem[]) {
    const current = appStore.get().hardware;
    const first = !missionInitialised;
    const next: Record<string, HardwarePick> = {};
    let ticked = false;
    for (const item of items) {
      const example = first ? EXAMPLE_MISSION.hardware[item.id] : undefined;
      if (current[item.id]) next[item.id] = current[item.id];
      else if (example !== undefined) {
        next[item.id] = { selected: true, count: clamp(example, 1, Math.max(1, item.max_count)), userSet: true };
        ticked = true;
      } else next[item.id] = { selected: false, count: item.default_count, userSet: false };
    }
    if (items.length > 0) missionInitialised = true;
    appStore.set({ hardware: next, storageKwh: ticked && appStore.get().storageKwh === 0 ? EXAMPLE_MISSION.storageKwh : appStore.get().storageKwh });
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
  /** Battery storage in kWh. Anything not a positive number means none; the cap is MAX_STORAGE_KWH. */
  setStorage(kwh: number) {
    appStore.set({ storageKwh: Number.isFinite(kwh) && kwh > 0 ? clamp(kwh, 0, MAX_STORAGE_KWH) : 0 });
  },
  /** Pick a site. Items the visitor has not touched follow the site's default hardware. null = follow the best. */
  highlight(id: string | null, site?: Pick<Site, 'default_hardware'> | null) {
    const { hardware } = appStore.get();
    const defaults = new Set(site?.default_hardware ?? []);
    const next: Record<string, HardwarePick> = {};
    for (const [key, pick] of Object.entries(hardware)) {
      next[key] = pick.userSet ? pick : { ...pick, selected: defaults.has(key) };
    }
    appStore.set({ highlightedId: id, hardware: next });
    simClock.set({ nowMs: null });
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
    appStore.set(open ? { compareOpen: true, drawerOpen: false, missionOpen: false } : { compareOpen: false });
  },
  setDrawerOpen(open: boolean) {
    appStore.set(open ? { drawerOpen: true, missionOpen: false } : { drawerOpen: false });
  },
  setDrawerMode(drawerMode: DrawerMode) {
    appStore.set({ drawerMode });
  },
  setMissionOpen(open: boolean) {
    appStore.set(open ? { missionOpen: true, drawerOpen: false } : { missionOpen: false });
  },
  setHorizonOpen(open: boolean) {
    appStore.set({ horizonOpen: open });
  },
  setAssistantOpen(open: boolean) {
    appStore.set({ assistantOpen: open });
  },
  setPreviewPlaying(previewPlaying: boolean) {
    appStore.set({ previewPlaying });
  },
  setPlaying(playing: boolean) {
    appStore.set({ playing });
  },
  setSpeed(speed: number) {
    appStore.set({ speed });
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
