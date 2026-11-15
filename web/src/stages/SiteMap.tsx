// The Site map: the ground around the chosen site, from NASA Moon Trek's public tile service.
//
// A "Site map" button at the top right of the scene opens a glass panel there. The panel shows the
// stored picture (public/site-context/<site id>.jpg, 960 x 600, site at the centre) at once and
// draws the live tiles over it as they arrive. If any tile fails, or six seconds pass first, the
// tiles are dropped and the stored picture stays, and the panel says so. A custom point has no
// stored picture: a plain placeholder stands until the tiles are in.
//
// The tiles are plain <img> elements placed in a clipped box (no canvas, no map library). All the
// arithmetic is in util/moonTrek.ts, ported from tools/site-context/moon_trek_tiles.py. The view
// keeps the site at its centre: three zoom steps, no panning.

import { useEffect, useId, useMemo, useRef, useState, type KeyboardEvent } from 'react';
import type { SiteRef } from '../api/types';
import { Icon } from '../components/Icon';
import { Glass } from '../hud/Glass';
import { siteFrame } from '../scene/siteView';
import { appStore } from '../state/app';
import { createStore, useStore } from '../state/store';
import {
  chooseLayer,
  gridFor,
  homeView,
  isSlope,
  LAYER_NAMES,
  layerByLabel,
  legendUrl,
  mapState,
  mapView,
  metersPerPixelAt,
  moonTrekLink,
  perPixelText,
  quickMapLink,
  scaleBar,
  siteKinds,
  storedPictureUrl,
  TILE_TIMEOUT_MS,
  VIEW_H,
  VIEW_W,
  type LayerKind,
  type MapState,
  type MapView,
  type TrekLayer,
} from '../util/moonTrek';

/** Whether the panel is open. Kept from one site to the next. */
export const siteMapUi = createStore<{ open: boolean }>({ open: false });

export const STORED_NOTE = 'Stored picture. NASA Moon Trek could not be reached.';
export const NO_PICTURE_NOTE = 'NASA Moon Trek could not be reached, and there is no stored picture for this point.';

/** Room the panel keeps around it inside the free part of the window, px. */
const GAP = 12;
/** The panel's height besides the map (heading, layer buttons, caption, links, padding), px. */
const CHROME_PX = 236;

export function SiteMap({ site, phone }: { site: SiteRef | null; phone: boolean }) {
  const open = useStore(siteMapUi, (s) => s.open);
  const frame = useStore(siteFrame, (f) => f);
  // On a phone the Horizon sheet covers the scene: the map gives it the room.
  const sheetOpen = useStore(appStore, (s) => s.horizonOpen);
  const panelId = useId();
  const toggleRef = useRef<HTMLButtonElement>(null);
  const closeRef = useRef<HTMLButtonElement>(null);
  // Focus follows a press: into the panel when it opens, back to the button when it closes.
  const moveFocus = useRef(false);
  useEffect(() => {
    if (!moveFocus.current) return;
    moveFocus.current = false;
    (open ? closeRef.current : toggleRef.current)?.focus();
  }, [open]);

  if (!site || !frame.measured || (phone && sheetOpen)) return null;

  const setOpen = (v: boolean) => {
    moveFocus.current = true;
    siteMapUi.set({ open: v });
  };
  const onKeyDown = (e: KeyboardEvent) => {
    if (e.key === 'Escape') {
      e.stopPropagation();
      setOpen(false);
    }
  };

  // In the free part of the window: right of the left wing, left of the right wing, below the top
  // strip and above the console (on a phone: below the status card and above the dock).
  const right = Math.max(GAP, frame.width - frame.right + GAP);
  const toggleTop = frame.top + (phone ? 8 : GAP);
  const panelTop = phone ? 68 : frame.top + GAP;
  const bottom = Math.max(GAP, frame.height - frame.bottom + (phone ? 8 : GAP));
  const room = frame.height - panelTop - bottom;
  const freeWidth = phone ? frame.width - 2 * GAP : frame.right - frame.left - 2 * GAP;
  // As wide as the height allows the map at 16:10, within 30rem and the free width.
  const width = Math.round(Math.max(Math.min(272, freeWidth), Math.min(480, freeWidth, (room - CHROME_PX) * (VIEW_W / VIEW_H) + 24)));

  return (
    <div className={`hud-layer ${phone ? 'z-[46]' : ''}`} data-testid="site-map-layer">
      {open ? (
        <Glass
          as="section"
          id={panelId}
          className="absolute flex flex-col gap-2 overflow-y-auto overscroll-contain p-3"
          style={phone ? { top: panelTop, left: GAP, right: GAP, maxHeight: room } : { top: panelTop, right, width, maxHeight: room }}
          aria-label="Site map"
          onKeyDown={onKeyDown}
          data-panel
          data-testid="site-map"
        >
          <div className="flex min-h-9 items-center gap-2">
            <h3 className="panel-title m-0 shrink-0">Site map</h3>
            <span className="min-w-0 truncate text-[12px] text-ink-2">{site.name}</span>
            <button ref={closeRef} type="button" className="btn btn-quiet btn-icon -my-1 -mr-1.5 ml-auto shrink-0" onClick={() => setOpen(false)} aria-label="Close the site map" data-testid="site-map-close">
              <Icon name="close" size={16} />
            </button>
          </div>
          <MapPanel key={`${site.id}:${site.lat}:${site.lon_east}`} site={site} />
        </Glass>
      ) : (
        <button
          ref={toggleRef}
          type="button"
          className="btn btn-glass absolute"
          style={{ top: toggleTop, right }}
          onClick={() => setOpen(true)}
          aria-expanded={false}
          aria-controls={panelId}
          data-testid="site-map-toggle"
        >
          <MapIcon />
          Site map
        </button>
      )}
    </div>
  );
}

/** The controls, the map and what it says. A new site starts afresh at the stored picture's view. */
function MapPanel({ site }: { site: SiteRef }) {
  const home = useMemo(() => homeView(site.lat), [site.lat]);
  const kinds = useMemo(() => siteKinds(site.lat, site.lon_east), [site.lat, site.lon_east]);
  const [kind, setKind] = useState<LayerKind>(home.kind);
  const [step, setStep] = useState(1);
  const zoom = home.zooms[step];
  const view = useMemo(() => {
    const layer = chooseLayer(kind, site.lat, site.lon_east, zoom);
    return layer ? mapView(layer, site.lat, site.lon_east, zoom) : null;
  }, [kind, site.lat, site.lon_east, zoom]);
  const viewKey = view ? `${view.layer.label}/${zoom}` : 'none';

  return (
    <>
      {kinds.length > 1 ? (
        <div className="seg flex-wrap self-start" role="group" aria-label="Map layer" data-testid="site-map-layers">
          {kinds.map((k) => (
            <button key={k} type="button" aria-pressed={k === kind} onClick={() => setKind(k)} data-kind={k}>
              {LAYER_NAMES[k]}
            </button>
          ))}
        </div>
      ) : null}
      {/* Remade for each layer and zoom: each view waits for its own tiles. */}
      <LiveMap key={viewKey} site={site} view={view} homeZoom={home.zooms[1]} homeLabel={home.label} step={step} onStep={setStep} />
      <p className="m-0 flex flex-wrap gap-x-4 gap-y-1 text-[13px]">
        <a className="text-accent underline decoration-[rgb(95_230_245/0.5)] underline-offset-2" href={moonTrekLink(site.lat, site.lon_east)} target="_blank" rel="noopener noreferrer" data-testid="site-map-trek">
          Open in Moon Trek
        </a>
        <QuickMapLink site={site} />
      </p>
    </>
  );
}

function QuickMapLink({ site }: { site: SiteRef }) {
  const href = quickMapLink(site.lat, site.lon_east);
  if (!href) return null;
  return (
    <a className="text-accent underline decoration-[rgb(95_230_245/0.5)] underline-offset-2" href={href} target="_blank" rel="noopener noreferrer" data-testid="site-map-quickmap">
      Open in QuickMap
    </a>
  );
}

function LiveMap({ site, view, homeZoom, homeLabel, step, onStep }: { site: SiteRef; view: MapView | null; homeZoom: number; homeLabel: string; step: number; onStep: (step: number) => void }) {
  const tiles = view?.tiles ?? [];
  const [loaded, setLoaded] = useState<ReadonlySet<string>>(() => new Set());
  const [failed, setFailed] = useState(false);
  const [timedOut, setTimedOut] = useState(false);
  const [storedMissing, setStoredMissing] = useState(false);
  useEffect(() => {
    const t = window.setTimeout(() => setTimedOut(true), TILE_TIMEOUT_MS);
    return () => window.clearTimeout(t);
  }, []);
  const state: MapState = mapState(tiles.length, loaded.size, failed, timedOut);

  const storedPath = storedPictureUrl(site.id);
  const stored = storedPath && !storedMissing ? `${import.meta.env.BASE_URL}${storedPath}` : null;
  const storedLayer = layerByLabel(homeLabel) as TrekLayer;
  const grid = gridFor(site.lat);
  const zoom = view?.zoom ?? homeZoom;
  // What is on screen: the live layer, the stored picture, or nothing at all.
  const showing: 'live' | 'stored' | 'none' = state === 'stored' ? (stored ? 'stored' : 'none') : 'live';
  const shownLayer = showing === 'stored' ? storedLayer : (view?.layer ?? storedLayer);
  const scaleText = showing === 'stored' ? perPixelText(metersPerPixelAt(grid, site.lat, homeZoom)) : (shownLayer.scaleNote ?? perPixelText(view?.metersPerDataPx ?? metersPerPixelAt(grid, site.lat, zoom)));
  const bar = scaleBar(metersPerPixelAt(grid, site.lat, zoom));
  const squeeze = view?.squeeze ?? 1;

  const note = state === 'loading' ? 'Loading from NASA Moon Trek…' : state === 'live' ? '' : stored ? STORED_NOTE : NO_PICTURE_NOTE;

  return (
    <>
      <div className="relative w-full">
        <div
          className="relative w-full overflow-hidden rounded-[3px] border border-line bg-[#0b1118]"
          style={{ aspectRatio: `${VIEW_W} / ${VIEW_H}` }}
          role="img"
          aria-label={`Map of the ground around ${site.name}, ${shownLayer.title}, ${bar.text} scale bar, site at the centre`}
          data-testid="site-map-frame"
          data-state={state}
          data-showing={showing}
          data-layer={view?.layer.label ?? ''}
          data-zoom={zoom}
        >
          {stored ? (
            <img
              src={stored}
              alt=""
              draggable={false}
              className="absolute inset-0 h-full w-full max-w-none select-none"
              style={{ transform: zoom === homeZoom ? undefined : `scale(${2 ** (zoom - homeZoom)})` }}
              onError={() => setStoredMissing(true)}
              data-testid="site-map-stored"
            />
          ) : showing === 'none' || state === 'loading' ? (
            <p className="absolute inset-0 m-0 flex items-center justify-center p-4 text-center text-[12px] text-ink-2" data-testid="site-map-placeholder">
              {state === 'loading' ? 'No stored picture for this point. Loading the map…' : 'No map for this point.'}
            </p>
          ) : null}
          {state !== 'stored' && tiles.length > 0 ? (
            // East-west squeeze by cos(latitude) on the global grid, about the site.
            <div className="absolute inset-0" style={squeeze === 1 ? undefined : { transform: `scaleX(${squeeze})` }} data-testid="site-map-tiles">
              {tiles.map((t) => (
                <img
                  key={t.key}
                  src={t.url}
                  alt=""
                  draggable={false}
                  decoding="async"
                  className="absolute max-w-none select-none"
                  style={{
                    left: `${50 + (t.x / VIEW_W) * 100}%`,
                    top: `${50 + (t.y / VIEW_H) * 100}%`,
                    // Half a pixel more each way: no hairline seams between tiles.
                    width: `calc(${(t.size / VIEW_W) * 100}% + 0.5px)`,
                    height: `calc(${(t.size / VIEW_H) * 100}% + 0.5px)`,
                    visibility: loaded.has(t.key) ? 'visible' : 'hidden',
                  }}
                  onLoad={() => setLoaded((s) => (s.has(t.key) ? s : new Set(s).add(t.key)))}
                  onError={() => setFailed(true)}
                  data-tile={`${t.zoom}/${t.row}/${t.col}`}
                />
              ))}
            </div>
          ) : null}
          {showing === 'none' ? null : (
            <>
              <SiteMarker />
              <div className="absolute bottom-2 left-2 flex flex-col gap-1 rounded-[3px] bg-[rgb(2_8_14/0.72)] px-2 py-1.5" style={{ width: `calc(${(bar.viewPx / VIEW_W) * 100}% + 1rem)` }} data-testid="site-map-scale">
                <span className="num whitespace-nowrap text-[12px] leading-none text-ink">{bar.text}</span>
                <span className="block h-1.5 border-x-2 border-b-2 border-ink" aria-hidden="true" />
              </div>
            </>
          )}
        </div>
        {/* Over the map, but not part of its picture. */}
        <div className="absolute right-2 top-2 flex flex-col gap-1.5">
          <button type="button" className="btn btn-glass btn-icon" onClick={() => onStep(step + 1)} disabled={step >= 2} aria-label="Zoom in on the site" data-testid="site-map-zoom-in">
            <Icon name="plus" size={16} />
          </button>
          <button type="button" className="btn btn-glass btn-icon" onClick={() => onStep(step - 1)} disabled={step <= 0} aria-label="Zoom out from the site" data-testid="site-map-zoom-out">
            <Icon name="minus" size={16} />
          </button>
        </div>
      </div>
      <p className={`m-0 text-[12px] leading-snug ${state === 'stored' ? '' : 'sr-only'}`} data-tone={state === 'stored' ? 'warn' : undefined} role="status" aria-live="polite" data-testid="site-map-status">
        {note}
      </p>
      {showing === 'none' ? null : (
        <p className="m-0 text-[12px] leading-snug text-ink-2" data-testid="site-map-caption">
          <span className="text-ink">{shownLayer.title}</span> · NASA Moon Trek · {scaleText}
          {grid === 'SP' ? ' · 0° longitude is up' : ''}
        </p>
      )}
      {showing === 'live' && isSlope(shownLayer.kind) ? <Legend layer={shownLayer} /> : null}
    </>
  );
}

/** Moon Trek's own legend for a slope layer. */
function Legend({ layer }: { layer: TrekLayer }) {
  const [failed, setFailed] = useState(false);
  return (
    <figure className="m-0 flex flex-col gap-1" data-testid="site-map-legend">
      <figcaption className="label">Legend</figcaption>
      {failed ? (
        <p className="m-0 text-[12px] text-ink-2">Moon Trek’s legend could not be loaded.</p>
      ) : (
        <img
          src={legendUrl(layer)}
          alt={`Legend for ${layer.title}, from NASA Moon Trek`}
          className="h-auto max-h-20 w-auto max-w-full self-start rounded-[2px] bg-[rgb(255_255_255/0.92)]"
          onError={() => setFailed(true)}
        />
      )}
    </figure>
  );
}

/** A ring and four ticks at the centre: the site. */
function SiteMarker() {
  const ticks = 'M2 18h10M24 18h10M18 2v10M18 24v10';
  return (
    <svg className="pointer-events-none absolute left-1/2 top-1/2 -ml-[18px] -mt-[18px]" width="36" height="36" viewBox="0 0 36 36" aria-hidden="true" data-testid="site-map-marker">
      <g fill="none" strokeLinecap="round">
        <circle cx="18" cy="18" r="7" stroke="rgb(2 8 14 / 0.8)" strokeWidth="4" />
        <path d={ticks} stroke="rgb(2 8 14 / 0.8)" strokeWidth="4" />
        <circle cx="18" cy="18" r="7" stroke="var(--ch-sun)" strokeWidth="2" />
        <path d={ticks} stroke="var(--ch-sun)" strokeWidth="2" />
      </g>
    </svg>
  );
}

/** A folded map, drawn like the other line icons. */
function MapIcon() {
  return (
    <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="M3.5 6.5l5.5-2 6 2 5.5-2v13l-5.5 2-6-2-5.5 2zM9 4.5v13M15 6.5v13" />
    </svg>
  );
}
