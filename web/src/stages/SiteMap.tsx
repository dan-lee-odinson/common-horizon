// The Site map: the ground around the chosen site, from NASA Moon Trek's public tile service.
//
// A "Site map · NASA Moon Trek" button at the top right of the scene opens a glass panel there
// (closed until asked for). The panel shows the stored picture (public/site-context/<site id>.jpg,
// 960 x 600, site at the centre) at once and draws the live tiles over it as they arrive. If any
// tile fails, or six seconds pass first, the tiles are dropped and the stored picture stays, and
// the panel says so. A custom point has no stored picture: a plain placeholder stands until the
// tiles are in.
//
// The tiles are plain <img> elements placed in a clipped box (no canvas, no map library). All the
// arithmetic is in util/moonTrek.ts, ported from tools/site-context/moon_trek_tiles.py. The view
// keeps the site at its centre: three zoom steps, no panning. A slope layer shows Moon Trek's own
// legend, whole and without scrolling: siteMapLayout.ts shares the panel's room between the two.

import { useCallback, useEffect, useId, useLayoutEffect, useMemo, useRef, useState, type KeyboardEvent, type RefObject } from 'react';
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
import { legendSize, mapHeight, PANEL, panelFit, type LegendFit } from './siteMapLayout';

/** Whether the panel is open. Kept from one site to the next. */
export const siteMapUi = createStore<{ open: boolean }>({ open: false });

export const TOGGLE_LABEL = 'Site map · NASA Moon Trek';
export const STORED_NOTE = 'Stored picture. NASA Moon Trek could not be reached.';
export const NO_PICTURE_NOTE = 'NASA Moon Trek could not be reached, and there is no stored picture for this point.';

/** Room the button and the panel keep from the wings, px. */
const GAP = 12;
/** Room the panel keeps from the top strip and the console, px. */
const EDGE = 6;

export function SiteMap({ site, phone }: { site: SiteRef | null; phone: boolean }) {
  const open = useStore(siteMapUi, (s) => s.open);
  const frame = useStore(siteFrame, (f) => f);
  // On a phone the Horizon sheet covers the scene: the map gives it the room.
  const sheetOpen = useStore(appStore, (s) => s.horizonOpen);
  const panelId = useId();
  const toggleRef = useRef<HTMLButtonElement>(null);
  const closeRef = useRef<HTMLButtonElement>(null);
  const panelRef = useRef<HTMLElement>(null);
  // Focus follows a press: into the panel when it opens, back to the button when it closes.
  const moveFocus = useRef(false);
  useEffect(() => {
    if (!moveFocus.current) return;
    moveFocus.current = false;
    (open ? closeRef.current : toggleRef.current)?.focus();
  }, [open]);
  useSceneTagsClear(panelRef, open);

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
  // strip and above the console (on a phone: below the top bar and above the dock).
  const right = Math.max(GAP, frame.width - frame.right + GAP);
  const toggleTop = frame.top + (phone ? 8 : GAP);
  const panelTop = phone ? 68 : frame.top + EDGE;
  const bottom = Math.max(EDGE, frame.height - frame.bottom + (phone ? 8 : EDGE));
  const room = Math.max(0, frame.height - panelTop - bottom);
  const freeW = phone ? frame.width - 2 * GAP : frame.right - frame.left - 2 * GAP;

  return (
    <div className={`hud-layer ${phone ? 'z-[46]' : ''}`} data-testid="site-map-layer">
      {open ? (
        <Glass as="section" ref={panelRef} id={panelId} className="absolute" style={{ top: panelTop, right, maxWidth: freeW }} aria-label="Site map" onKeyDown={onKeyDown} data-panel data-testid="site-map">
          {/* The glass itself does not scroll: its corner brackets stand just outside it. */}
          <div className="overflow-y-auto overscroll-contain p-3" style={{ maxHeight: room - 2 * PANEL.border }} data-testid="site-map-scroll">
            <MapPanel key={`${site.id}:${site.lat}:${site.lon_east}`} site={site} room={room} freeW={freeW} closeRef={closeRef} onClose={() => setOpen(false)} />
          </div>
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
          {TOGGLE_LABEL}
        </button>
      )}
    </div>
  );
}

/** The scene's labelled markers (scene/SiteMarkers.tsx). They are drawn above the HUD, so they would show through the panel. */
const SCENE_TAGS = '[data-testid="site-marker"]';

/**
 * While the panel is open, a scene tag that it covers is hidden, and shown again once it is clear:
 * the stage's rule that a tag never touches a glass panel. Checked once per frame, as the scene
 * moves its tags once per frame. `visibility` only, so the scene's own showing and hiding (by
 * `display`) is left alone.
 */
function useSceneTagsClear(panelRef: RefObject<HTMLElement | null>, open: boolean): void {
  useEffect(() => {
    if (!open) return;
    const hidden = new Set<HTMLElement>();
    let raf = 0;
    const tick = () => {
      const p = panelRef.current?.getBoundingClientRect();
      for (const el of document.querySelectorAll<HTMLElement>(SCENE_TAGS)) {
        const r = el.getBoundingClientRect();
        const under = p !== undefined && r.width > 0 && r.left < p.right && p.left < r.right && r.top < p.bottom && p.top < r.bottom;
        if (under === hidden.has(el)) continue;
        el.style.visibility = under ? 'hidden' : '';
        if (under) hidden.add(el);
        else hidden.delete(el);
      }
      raf = requestAnimationFrame(tick);
    };
    tick();
    return () => {
      cancelAnimationFrame(raf);
      for (const el of hidden) el.style.visibility = '';
    };
  }, [panelRef, open]);
}

interface TileLoad {
  loaded: ReadonlySet<string>;
  failed: boolean;
  timedOut: boolean;
  markLoaded: (tileKey: string) => void;
  markFailed: () => void;
}

/** Which tiles of the view are in, whether one failed, and whether its six seconds are up. A new view starts afresh. */
function useTileLoad(viewKey: string): TileLoad {
  const fresh = (key: string) => ({ key, loaded: new Set<string>() as ReadonlySet<string>, failed: false, timedOut: false });
  const [s, setS] = useState(() => fresh(viewKey));
  let current = s;
  if (s.key !== viewKey) {
    current = fresh(viewKey);
    setS(current);
  }
  useEffect(() => {
    const t = window.setTimeout(() => setS((p) => (p.key === viewKey ? { ...p, timedOut: true } : p)), TILE_TIMEOUT_MS);
    return () => window.clearTimeout(t);
  }, [viewKey]);
  const markLoaded = useCallback((tileKey: string) => setS((p) => (p.key !== viewKey || p.loaded.has(tileKey) ? p : { ...p, loaded: new Set(p.loaded).add(tileKey) })), [viewKey]);
  const markFailed = useCallback(() => setS((p) => (p.key === viewKey ? { ...p, failed: true } : p)), [viewKey]);
  return { loaded: current.loaded, failed: current.failed, timedOut: current.timedOut, markLoaded, markFailed };
}

/** The heading, the controls, the map, what it says and the legend. A new site starts afresh at the stored picture's view. */
function MapPanel({ site, room, freeW, closeRef, onClose }: { site: SiteRef; room: number; freeW: number; closeRef: RefObject<HTMLButtonElement | null>; onClose: () => void }) {
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
  const tiles = view?.tiles ?? [];
  const load = useTileLoad(viewKey);
  const state: MapState = mapState(tiles.length, load.loaded.size, load.failed, load.timedOut);
  const [storedMissing, setStoredMissing] = useState(false);

  const storedPath = storedPictureUrl(site.id);
  const stored = storedPath && !storedMissing ? `${import.meta.env.BASE_URL}${storedPath}` : null;
  const storedLayer = layerByLabel(home.label) as TrekLayer;
  const grid = gridFor(site.lat);
  // What is on screen: the live layer, the stored picture, or nothing at all.
  const showing: 'live' | 'stored' | 'none' = state === 'stored' ? (stored ? 'stored' : 'none') : 'live';
  const shownLayer = showing === 'stored' ? storedLayer : (view?.layer ?? storedLayer);
  const scaleText = showing === 'stored' ? perPixelText(metersPerPixelAt(grid, site.lat, home.zooms[1])) : (shownLayer.scaleNote ?? perPixelText(view?.metersPerDataPx ?? metersPerPixelAt(grid, site.lat, zoom)));
  const note = state === 'loading' ? 'Loading from NASA Moon Trek…' : state === 'live' ? '' : stored ? STORED_NOTE : NO_PICTURE_NOTE;

  // The room: the chosen slope layer's legend keeps its place even while the tiles load or fail,
  // so the panel does not jump about.
  const legendLayer = view && isSlope(view.layer.kind) && view.layer.legend ? view.layer : null;
  const fit = panelFit(room, freeW, legendLayer?.legend ?? null);
  const bodyRef = useRef<HTMLDivElement>(null);
  const mapRef = useRef<HTMLDivElement>(null);
  const chrome = useChrome(bodyRef, mapRef);
  const mapH = mapHeight(fit, chrome);

  const header = (
    <div className="flex min-h-9 items-center gap-2">
      <h3 className="panel-title m-0 shrink-0">Site map</h3>
      <span className="min-w-0 truncate text-[12px] text-ink-2">{site.name}</span>
      <button ref={closeRef} type="button" className="btn btn-quiet btn-icon -my-1 -mr-1.5 ml-auto shrink-0" onClick={onClose} aria-label="Close the site map" data-testid="site-map-close">
        <Icon name="close" size={16} />
      </button>
    </div>
  );

  return (
    <div className="flex items-start gap-3">
      {legendLayer && fit.legend?.placement === 'side' ? <Legend layer={legendLayer} fit={fit.legend} size={legendSize(fit.legend, mapH)} live={showing === 'live'} /> : null}
      <div ref={bodyRef} className="flex flex-col gap-2" style={{ width: fit.bodyW }} data-testid="site-map-body">
        {header}
        {kinds.length > 1 ? (
          <div className="seg flex-wrap self-start" role="group" aria-label="Map layer" data-testid="site-map-layers">
            {kinds.map((k) => (
              <button key={k} type="button" aria-pressed={k === kind} onClick={() => setKind(k)} data-kind={k}>
                {LAYER_NAMES[k]}
              </button>
            ))}
          </div>
        ) : null}
        <div ref={mapRef} className="relative" style={{ width: (mapH * VIEW_W) / VIEW_H, height: mapH }}>
          <MapFrame
            site={site}
            view={view}
            viewKey={viewKey}
            zoom={zoom}
            homeZoom={home.zooms[1]}
            state={state}
            showing={showing}
            shownLayer={shownLayer}
            stored={stored}
            onStoredMissing={() => setStoredMissing(true)}
            load={load}
          />
          {/* Over the map, but not part of its picture. */}
          <div className="absolute right-2 top-2 flex flex-col gap-1.5">
            <button type="button" className="btn btn-glass btn-icon" onClick={() => setStep(step + 1)} disabled={step >= 2} aria-label="Zoom in on the site" data-testid="site-map-zoom-in">
              <Icon name="plus" size={16} />
            </button>
            <button type="button" className="btn btn-glass btn-icon" onClick={() => setStep(step - 1)} disabled={step <= 0} aria-label="Zoom out from the site" data-testid="site-map-zoom-out">
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
        {legendLayer && fit.legend?.placement === 'below' ? <Legend layer={legendLayer} fit={fit.legend} size={legendSize(fit.legend, mapH)} live={showing === 'live'} /> : null}
        <p className="m-0 flex flex-wrap gap-x-4 gap-y-1 text-[13px]">
          <a className="text-accent underline decoration-[rgb(95_230_245/0.5)] underline-offset-2" href={moonTrekLink(site.lat, site.lon_east)} target="_blank" rel="noopener noreferrer" data-testid="site-map-trek">
            Open in Moon Trek
          </a>
          <QuickMapLink site={site} />
        </p>
      </div>
    </div>
  );
}

/**
 * The height of the map's column besides the map and a wide legend, measured once drawn (a caption
 * can wrap to three lines, the status line comes and goes). Until then, the layout's own guess.
 */
function useChrome(bodyRef: RefObject<HTMLDivElement | null>, mapRef: RefObject<HTMLDivElement | null>): number {
  const [measured, setMeasured] = useState<number | null>(null);
  useLayoutEffect(() => {
    const body = bodyRef.current;
    const map = mapRef.current;
    if (!body || !map) return;
    const measure = () => {
      const below = body.querySelector<HTMLElement>('[data-testid="site-map-legend"][data-placement="below"]');
      const c = body.scrollHeight - map.offsetHeight - (below ? below.offsetHeight + PANEL.rowGap : 0);
      setMeasured((p) => (p !== null && Math.abs(p - c) < 0.5 ? p : c));
    };
    measure();
    // The column's size changes when its text wraps differently, a line comes or goes, or a legend is added.
    const observer = new ResizeObserver(measure);
    observer.observe(body);
    return () => observer.disconnect();
  }, [bodyRef, mapRef]);
  return measured ?? PANEL.chrome;
}

function MapFrame({
  site,
  view,
  viewKey,
  zoom,
  homeZoom,
  state,
  showing,
  shownLayer,
  stored,
  onStoredMissing,
  load,
}: {
  site: SiteRef;
  view: MapView | null;
  viewKey: string;
  zoom: number;
  homeZoom: number;
  state: MapState;
  showing: 'live' | 'stored' | 'none';
  shownLayer: TrekLayer;
  stored: string | null;
  onStoredMissing: () => void;
  load: TileLoad;
}) {
  const tiles = view?.tiles ?? [];
  const bar = scaleBar(metersPerPixelAt(gridFor(site.lat), site.lat, zoom));
  const squeeze = view?.squeeze ?? 1;
  return (
    <div
      className="relative h-full w-full overflow-hidden rounded-[3px] border border-line bg-[#0b1118]"
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
          onError={onStoredMissing}
          data-testid="site-map-stored"
        />
      ) : showing === 'none' || state === 'loading' ? (
        <p className="absolute inset-0 m-0 flex items-center justify-center p-4 text-center text-[12px] text-ink-2" data-testid="site-map-placeholder">
          {state === 'loading' ? 'No stored picture for this point. Loading the map…' : 'No map for this point.'}
        </p>
      ) : null}
      {state !== 'stored' && tiles.length > 0 ? (
        // East-west squeeze by cos(latitude) on the global grid, about the site. Made anew for each view.
        <div key={viewKey} className="absolute inset-0" style={squeeze === 1 ? undefined : { transform: `scaleX(${squeeze})` }} data-testid="site-map-tiles">
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
                visibility: load.loaded.has(t.key) ? 'visible' : 'hidden',
              }}
              onLoad={() => load.markLoaded(t.key)}
              onError={load.markFailed}
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

/**
 * Moon Trek's own legend for a slope layer, at the size the layout gives it. A tall one stands in a
 * column the panel's full height, on white like the picture itself, enlarged by a whole number
 * with square pixels so its pixel lettering stays sharp. A wide one sits below the map.
 */
function Legend({ layer, fit, size, live }: { layer: TrekLayer; fit: LegendFit; size: { width: number; height: number; scale: number }; live: boolean }) {
  const [failed, setFailed] = useState(false);
  const side = fit.placement === 'side';
  const box = side ? '-my-3 -ml-3 flex shrink-0 items-center justify-center self-stretch rounded-l-[5px] bg-[#fff]' : 'm-0 flex items-center justify-center';
  const text = (words: string) => <p className={`m-0 p-2 text-[12px] leading-snug ${side ? 'text-[#25313b]' : 'text-ink-2'}`}>{words}</p>;
  return (
    <figure className={box} style={side ? { width: size.width } : { width: size.width, minHeight: size.height }} data-testid="site-map-legend" data-placement={fit.placement} data-scale={Number(size.scale.toFixed(3))}>
      {!live ? (
        text('The legend shows with the live slope layer.')
      ) : failed ? (
        text('Moon Trek’s legend could not be loaded.')
      ) : (
        <img
          src={legendUrl(layer)}
          alt={`Legend for ${layer.title}, from NASA Moon Trek`}
          width={Math.round(size.width)}
          height={Math.round(size.height)}
          className="block max-w-none rounded-[2px]"
          style={{ width: size.width, height: size.height, imageRendering: side && size.scale > 1 ? 'pixelated' : 'auto' }}
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
