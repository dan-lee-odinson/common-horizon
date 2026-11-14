// Shown instead of the 3D Moon when the browser has no WebGL (or the address has ?webgl=off).
// A flat orthographic drawing of the Moon that still lets the visitor pick sites and points.

import { useEffect, useMemo, useState, type MouseEvent } from 'react';
import type { Geometry } from '../api/types';
import type { KnownSite } from '../state/data';
import type { View } from '../state/app';
import { clamp } from '../state/app';
import { DEG, RAD, normalizeLon360 } from '../util/geo';

interface Props {
  view: Exclude<View, 'scene'>;
  sites: KnownSite[];
  highlightedId: string | null;
  savedIds: Set<string>;
  geometry: Geometry | null;
  onMoonClick: () => void;
  onPickPoint: (lat: number, lonEast: number) => void;
  onSiteClick: (site: KnownSite) => void;
}

const R = 160;
const C = 200;

/** Orthographic projection centred on (lat0, lon0). East is to the right. */
export function project(lat: number, lon: number, lat0: number, lon0: number): { x: number; y: number; visible: boolean } {
  const p = lat * DEG;
  const p0 = lat0 * DEG;
  const dl = (lon - lon0) * DEG;
  const cosc = Math.sin(p0) * Math.sin(p) + Math.cos(p0) * Math.cos(p) * Math.cos(dl);
  const x = Math.cos(p) * Math.sin(dl);
  const y = Math.cos(p0) * Math.sin(p) - Math.sin(p0) * Math.cos(p) * Math.cos(dl);
  return { x: C + R * x, y: C - R * y, visible: cosc >= 0 };
}

export function unproject(px: number, py: number, lat0: number, lon0: number): { lat: number; lonEast: number } | null {
  const x = (px - C) / R;
  const y = (C - py) / R;
  const rho = Math.hypot(x, y);
  if (rho > 1) return null;
  if (rho === 0) return { lat: lat0, lonEast: normalizeLon360(lon0) };
  const c = Math.asin(rho);
  const p0 = lat0 * DEG;
  const lat = Math.asin(Math.cos(c) * Math.sin(p0) + (y * Math.sin(c) * Math.cos(p0)) / rho) * RAD;
  const lon = lon0 + Math.atan2(x * Math.sin(c), rho * Math.cos(c) * Math.cos(p0) - y * Math.sin(c) * Math.sin(p0)) * RAD;
  return { lat, lonEast: normalizeLon360(lon) };
}

function graticule(lat0: number, lon0: number): string[] {
  const lines: string[] = [];
  const draw = (pts: { x: number; y: number; visible: boolean }[]) => {
    let d = '';
    let pen = false;
    for (const p of pts) {
      if (!p.visible) {
        pen = false;
        continue;
      }
      d += `${pen ? 'L' : 'M'}${p.x.toFixed(1)},${p.y.toFixed(1)} `;
      pen = true;
    }
    if (d) lines.push(d);
  };
  for (let lat = -60; lat <= 60; lat += 30) draw(Array.from({ length: 121 }, (_, i) => project(lat, i * 3, lat0, lon0)));
  for (let lon = 0; lon < 360; lon += 30) draw(Array.from({ length: 61 }, (_, i) => project(-90 + i * 3, lon, lat0, lon0)));
  return lines;
}

export function MoonFallback({ view, sites, highlightedId, savedIds, geometry, onMoonClick, onPickPoint, onSiteClick }: Props) {
  const highlighted = sites.find((s) => s.id === highlightedId) ?? null;
  const [center, setCenter] = useState({ lat: -35, lon: 20 });
  useEffect(() => {
    if (highlighted) setCenter({ lat: clamp(highlighted.lat, -75, 75), lon: highlighted.lon_east });
  }, [highlighted]);
  const lines = useMemo(() => graticule(center.lat, center.lon), [center]);

  function onDiscClick(e: MouseEvent<SVGCircleElement>) {
    if (view === 'globe') return onMoonClick();
    const svg = e.currentTarget.ownerSVGElement!;
    const rect = svg.getBoundingClientRect();
    const scale = 400 / rect.width;
    const hit = unproject((e.clientX - rect.left) * scale, (e.clientY - rect.top) * scale, center.lat, center.lon);
    if (hit) onPickPoint(hit.lat, hit.lonEast);
  }

  const bodies = geometry
    ? [
        { key: 'Sun', lat: geometry.subsolar_lat, lon: geometry.subsolar_lon_east, color: 'var(--ch-sun)' },
        { key: 'Earth', lat: geometry.subearth_lat, lon: geometry.subearth_lon_east, color: 'var(--ch-earth)' },
      ]
    : [];

  const nudge = (dLat: number, dLon: number) => setCenter((c) => ({ lat: clamp(c.lat + dLat, -80, 80), lon: normalizeLon360(c.lon + dLon) }));

  return (
    <div className="absolute inset-0 flex flex-col items-center justify-center gap-2 p-4" data-testid="moon-fallback">
      <p className="m-0 max-w-md text-center text-[12px] text-muted">3D is not available in this browser, so this is a flat view of the Moon.</p>
      <svg viewBox="0 0 400 400" className="h-auto max-h-[70%] w-full max-w-[min(70vh,520px)]" role="img" aria-label="Flat view of the Moon">
        <circle cx={C} cy={C} r={R} fill="var(--ch-moon-dark)" stroke="var(--ch-line-strong)" onClick={onDiscClick} className="cursor-pointer" />
        {lines.map((d, i) => (
          <path key={i} d={d} fill="none" stroke="var(--ch-line-strong)" strokeWidth={0.6} pointerEvents="none" />
        ))}
        {bodies.map((b) => {
          const p = project(b.lat, b.lon, center.lat, center.lon);
          const angle = Math.atan2(p.y - C, p.x - C);
          const r = p.visible ? Math.hypot(p.x - C, p.y - C) : R + 14;
          const x = C + Math.cos(angle) * Math.max(r, 0);
          const y = C + Math.sin(angle) * Math.max(r, 0);
          return (
            <g key={b.key} pointerEvents="none">
              <circle cx={x} cy={y} r={6} fill={b.color} />
              <text x={x + 9} y={y + 4} fontSize={11} fill={b.color}>
                {b.key} {p.visible ? 'overhead here' : 'this way'}
              </text>
            </g>
          );
        })}
        {view === 'sites'
          ? sites.map((s) => {
              const p = project(s.lat, s.lon_east, center.lat, center.lon);
              if (!p.visible) return null;
              const active = s.id === highlightedId;
              return (
                <g
                  key={s.id}
                  role="button"
                  tabIndex={0}
                  aria-label={`${s.name}${active ? ', highlighted: press again to open' : ''}`}
                  onClick={() => onSiteClick(s)}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter' || e.key === ' ') {
                      e.preventDefault();
                      onSiteClick(s);
                    }
                  }}
                  className="cursor-pointer"
                >
                  <circle cx={p.x} cy={p.y} r={10} fill="transparent" />
                  <circle cx={p.x} cy={p.y} r={active ? 5 : 3.5} fill={active ? 'var(--ch-marker-active)' : savedIds.has(s.id) ? 'var(--ch-marker-saved)' : 'var(--ch-marker)'} />
                  {active ? (
                    <text x={p.x + 8} y={p.y - 6} fontSize={11} fill="var(--ch-ink)">
                      {s.name}
                    </text>
                  ) : null}
                </g>
              );
            })
          : null}
      </svg>
      <div className="flex items-center gap-1" role="group" aria-label="Turn the Moon">
        <button type="button" className="btn btn-icon" aria-label="Turn west" onClick={() => nudge(0, -20)}>
          ←
        </button>
        <button type="button" className="btn btn-icon" aria-label="Turn north" onClick={() => nudge(20, 0)}>
          ↑
        </button>
        <button type="button" className="btn btn-icon" aria-label="Turn south" onClick={() => nudge(-20, 0)}>
          ↓
        </button>
        <button type="button" className="btn btn-icon" aria-label="Turn east" onClick={() => nudge(0, 20)}>
          →
        </button>
        <span className="ml-2 text-[11px] text-muted num">
          centre {Math.round(center.lat)}°, {Math.round(normalizeLon360(center.lon))}° E
        </span>
      </div>
    </div>
  );
}
