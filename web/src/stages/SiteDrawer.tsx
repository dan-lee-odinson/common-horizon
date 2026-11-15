// The site drawer: a glass drawer that slides in and out at the right of mission select.
// A switch chooses between "Preset" (a searchable list of the preset sites; they are not all laid
// out on screen) and "Custom coordinates" (type a latitude and longitude, or press a spot on the
// Moon). Saved sites and "Compare" sit at the bottom.

import { useEffect, useId, useMemo, useState, type FormEvent, type KeyboardEvent } from 'react';
import { AsyncView, SkeletonLines } from '../components/AsyncView';
import { Icon } from '../components/Icon';
import { Drawer } from '../hud/Drawer';
import { actions, appStore, type DrawerMode } from '../state/app';
import { useData, type KnownSite } from '../state/data';
import { useStore } from '../state/store';
import { formatLatLon, isValidLatitude, toEastLongitude, type Hemisphere } from '../util/geo';

const MODES: { id: DrawerMode; label: string }[] = [
  { id: 'preset', label: 'Preset' },
  { id: 'custom', label: 'Custom coordinates' },
];

export function SiteDrawer({ phone }: { phone: boolean }) {
  const open = useStore(appStore, (s) => s.drawerOpen);
  const mode = useStore(appStore, (s) => s.drawerMode);
  const saved = useStore(appStore, (s) => s.saved);
  const { focus } = useData();

  function onModeKey(e: KeyboardEvent<HTMLDivElement>) {
    if (!['ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown'].includes(e.key)) return;
    e.preventDefault();
    const next = mode === 'preset' ? 'custom' : 'preset';
    actions.setDrawerMode(next);
    (e.currentTarget.querySelector(`[data-mode="${next}"]`) as HTMLButtonElement | null)?.focus();
  }

  return (
    <Drawer open={open} onClose={() => actions.setDrawerOpen(false)} title="Sites" side={phone ? 'bottom' : 'right'} modal={phone} testId="site-drawer">
      <div className="shrink-0 border-b border-line px-4 py-3">
        <div role="radiogroup" aria-label="Choose a site from the presets or by coordinates" className="seg w-full" onKeyDown={onModeKey}>
          {MODES.map((m) => (
            <button
              key={m.id}
              type="button"
              role="radio"
              data-mode={m.id}
              aria-checked={mode === m.id}
              tabIndex={mode === m.id ? 0 : -1}
              className="flex-1"
              onClick={() => actions.setDrawerMode(m.id)}
              data-testid={`mode-${m.id}`}
            >
              {m.label}
            </button>
          ))}
        </div>
      </div>

      <div className="flex min-h-0 flex-1 flex-col">{mode === 'preset' ? <PresetList focusId={focus?.id ?? null} /> : <CoordinateEntry />}</div>

      <SavedSites saved={saved} focusId={focus?.id ?? null} />
    </Drawer>
  );
}

function PresetList({ focusId }: { focusId: string | null }) {
  const { sites, rows } = useData();
  const [query, setQuery] = useState('');
  const searchId = useId();
  const rankOf = useMemo(() => new Map(rows.map((r) => [r.siteId, r])), [rows]);
  return (
    <>
      <div className="shrink-0 px-4 pb-2 pt-3">
        <label htmlFor={searchId} className="label mb-1.5 block">
          Search preset sites
        </label>
        <div className="relative">
          <span className="pointer-events-none absolute left-2.5 top-1/2 -translate-y-1/2 text-muted">
            <Icon name="search" size={15} />
          </span>
          <input
            id={searchId}
            type="search"
            className="field w-full pl-8 text-[14px]"
            placeholder="Name or note, for example Apollo"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            autoComplete="off"
            data-testid="preset-search"
          />
        </div>
      </div>
      <div className="min-h-0 flex-1 overflow-y-auto overscroll-contain px-2 pb-2">
        <AsyncView result={sites} what="the preset sites" waiting={<SkeletonLines lines={5} />} empty="No preset sites came back. Enter coordinates instead.">
          {(list) => {
            const q = query.trim().toLowerCase();
            const shown = q ? list.sites.filter((s) => `${s.name} ${s.note ?? ''}`.toLowerCase().includes(q)) : list.sites;
            if (shown.length === 0) {
              return (
                <p className="m-0 px-2 py-3 text-[14px] text-ink-2" role="status" data-testid="preset-none">
                  No preset matches “{query.trim()}”. Clear the search, or switch to Custom coordinates.
                </p>
              );
            }
            return (
              <ul className="m-0 flex list-none flex-col gap-0.5 p-0" data-testid="preset-list">
                {shown.map((site) => {
                  const row = rankOf.get(site.id);
                  const active = site.id === focusId;
                  return (
                    <li key={site.id}>
                      <button
                        type="button"
                        className={`flex min-h-11 w-full items-start gap-3 rounded-[3px] border px-2 py-1.5 text-left ${active ? 'border-line-strong bg-accent-soft' : 'border-transparent hover:bg-accent-soft'}`}
                        aria-pressed={active}
                        onClick={() => actions.highlight(site.id, site)}
                        data-testid="preset"
                        data-site-id={site.id}
                      >
                        <span className="min-w-0 flex-1">
                          <span className="block break-words text-[14px] leading-snug text-ink">{site.name}</span>
                          <span className="num block text-[12px] text-ink-2">{formatLatLon(site.lat, site.lon_east, 2)}</span>
                          {site.note ? <span className="block break-words text-[13px] leading-snug text-ink-2">{site.note}</span> : null}
                        </span>
                        {row ? (
                          <span className="num shrink-0 pt-0.5 text-right text-[12px] text-muted">
                            rank <span className="text-ink">{row.rank}</span>
                          </span>
                        ) : null}
                      </button>
                    </li>
                  );
                })}
              </ul>
            );
          }}
        </AsyncView>
      </div>
    </>
  );
}

function CoordinateEntry() {
  const [lat, setLat] = useState('');
  const [lon, setLon] = useState('');
  const [hemi, setHemi] = useState<Hemisphere>('E');
  const [error, setError] = useState<string | null>(null);
  const ids = { lat: useId(), lon: useId(), hemi: useId(), err: useId() };
  const customSite = useStore(appStore, (s) => s.customSite);

  useEffect(() => {
    // A press on the Moon fills the boxes, so the visitor can see and adjust the numbers.
    if (customSite) {
      setLat(customSite.lat.toFixed(3));
      setLon(customSite.lon_east.toFixed(3));
      setHemi('E');
      setError(null);
    }
  }, [customSite]);

  function submit(e: FormEvent) {
    e.preventDefault();
    const la = Number(lat);
    const lo = Number(lon);
    if (lat.trim() === '' || !isValidLatitude(la)) return setError('Latitude must be a number between −90 and 90.');
    if (lon.trim() === '' || !Number.isFinite(lo) || Math.abs(lo) > 360) return setError('Longitude must be a number of degrees, 0 to 360.');
    setError(null);
    actions.setCustomSite(la, toEastLongitude(lo, hemi));
  }

  return (
    <form onSubmit={submit} className="flex flex-col gap-3 overflow-y-auto px-4 py-3" aria-label="Go to a coordinate" noValidate data-testid="coordinate-form">
      <div className="grid grid-cols-[1fr_1fr_auto] items-end gap-2">
        <label htmlFor={ids.lat} className="flex min-w-0 flex-col gap-1.5">
          <span className="label">Latitude, ° (south is −)</span>
          <input
            id={ids.lat}
            inputMode="text"
            className="field num w-full text-[14px]"
            value={lat}
            onChange={(e) => setLat(e.target.value)}
            placeholder="−89.7"
            aria-describedby={ids.err}
            aria-invalid={error?.startsWith('Latitude') || undefined}
            data-testid="lat-input"
          />
        </label>
        <label htmlFor={ids.lon} className="flex min-w-0 flex-col gap-1.5">
          <span className="label">Longitude, °</span>
          <input
            id={ids.lon}
            inputMode="decimal"
            className="field num w-full text-[14px]"
            value={lon}
            onChange={(e) => setLon(e.target.value)}
            placeholder="196.7"
            aria-describedby={ids.err}
            aria-invalid={error?.startsWith('Longitude') || undefined}
            data-testid="lon-input"
          />
        </label>
        <div className="flex flex-col gap-1.5">
          <label htmlFor={ids.hemi} className="sr-only">
            East or west
          </label>
          <select id={ids.hemi} className="field text-[14px]" value={hemi} onChange={(e) => setHemi(e.target.value as Hemisphere)} data-testid="hemi-input">
            <option value="E">East</option>
            <option value="W">West</option>
          </select>
        </div>
      </div>
      <button type="submit" className="btn btn-primary self-start" data-testid="go-coordinate">
        <Icon name="target" size={15} />
        Spotlight this point
      </button>
      <p id={ids.err} className="m-0 min-h-[2.5em] text-[13px] leading-snug text-ink-2" role={error ? 'alert' : undefined} data-tone={error ? 'bad' : undefined} data-testid="coordinate-note">
        {error ?? 'West longitudes are turned into east longitudes (0 to 360). While this is open you can also press a spot on the Moon.'}
      </p>
      {customSite ? (
        <p className="num m-0 border-t border-line pt-3 text-[13px] text-ink-2" data-testid="custom-site">
          Custom point: <span className="text-ink">{formatLatLon(customSite.lat, customSite.lon_east, 3)}</span>
        </p>
      ) : null}
    </form>
  );
}

function SavedSites({ saved, focusId }: { saved: KnownSite[]; focusId: string | null }) {
  const compareOpen = useStore(appStore, (s) => s.compareOpen);
  return (
    <div className="shrink-0 border-t border-line px-4 py-3" data-testid="saved-sites">
      <div className="mb-2 flex items-center justify-between gap-3">
        <h3 className="panel-title m-0">Saved sites</h3>
        <button type="button" className="btn" disabled={saved.length === 0} aria-haspopup="dialog" aria-expanded={compareOpen} onClick={() => actions.setCompareOpen(true)} data-testid="compare-open">
          <Icon name="compare" size={14} />
          Compare{saved.length ? ` (${saved.length})` : ''}
        </button>
      </div>
      {saved.length === 0 ? (
        <p className="m-0 text-[13px] leading-snug text-ink-2">None yet. Press the star beside “Zoom in to this site” to save the spotlight site, then compare saved sites side by side.</p>
      ) : (
        <ul className="m-0 flex max-h-36 list-none flex-col gap-0.5 overflow-y-auto p-0">
          {saved.map((site) => (
            <li key={site.id} className="flex items-center gap-1">
              <button
                type="button"
                className={`min-h-11 min-w-0 flex-1 truncate rounded-[3px] px-2 text-left text-[14px] ${site.id === focusId ? 'bg-accent-soft text-ink' : 'text-ink-2 hover:bg-accent-soft'}`}
                aria-pressed={site.id === focusId}
                onClick={() => actions.highlight(site.id, site)}
                title={site.name}
              >
                {site.name}
              </button>
              <button type="button" className="btn btn-quiet btn-icon shrink-0 text-sun" aria-label={`Remove ${site.name} from saved sites`} onClick={() => actions.toggleSaved(site)}>
                <Icon name="star-filled" size={15} />
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
