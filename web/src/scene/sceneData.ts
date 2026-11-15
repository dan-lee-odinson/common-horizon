// What the 3D scenes are given from outside the canvas, and the instant they show.

import * as THREE from 'three';
import type { Geometry, HardwareChoice, HorizonResponse } from '../api/types';
import { appStore, orbitClock, simClock } from '../state/app';
import type { KnownSite } from '../state/data';
import { latLonToVec3 } from '../util/geo';
import type { GeometryTrack } from '../util/track';

export interface SceneData {
  /** Sun and Earth overhead points across the window; null until the answers arrive. */
  track: GeometryTrack | null;
  landingMs: number | null;
  /** End of the stay: the Earth bracket spans the stay. */
  stayEndMs: number | null;
  /** The evaluation's own geometry at the landing: used until the track arrives. */
  landingGeometry: Geometry | null;
  sites: KnownSite[];
  /** The site in the spotlight. */
  focus: KnownSite | null;
  savedIds: Set<string>;
  /** The focus site's horizon over the stay (site stage). */
  horizon: HorizonResponse | null;
  hardware: HardwareChoice[];
  /** The catalog's name for each item, by id: the site's markers carry it. */
  hardwareNames?: Readonly<Record<string, string>>;
  isPhone: boolean;
  reducedMotion: boolean;
  /** Mission select, "Custom coordinates" mode: a press on the Moon picks that point. */
  pickEnabled: boolean;
  onSiteClick: (site: KnownSite) => void;
  onPickPoint: (lat: number, lonEast: number) => void;
}

/** The instant the scene shows: the Orbit preview, the landing (mission select) or the site clock. */
export function sceneTimeMs(landingMs: number | null): number | null {
  if (landingMs === null) return null;
  const { stage } = appStore.get();
  if (stage === 'orbit') return orbitClock.get().nowMs ?? landingMs;
  if (stage === 'site') return simClock.get().nowMs ?? landingMs;
  return landingMs;
}

/** Sun and Earth overhead points at the instant the scene shows, or null before any data. */
export function geometryNow(data: Pick<SceneData, 'track' | 'landingMs' | 'landingGeometry'>): Geometry | null {
  const t = sceneTimeMs(data.landingMs);
  if (t !== null && data.track && t >= data.track.startMs && t <= data.track.endMs) return data.track.at(t);
  return data.landingGeometry;
}

export function toVector(lat: number, lonEast: number, r = 1, out = new THREE.Vector3()): THREE.Vector3 {
  const v = latLonToVec3(lat, lonEast, r);
  return out.set(v.x, v.y, v.z);
}
