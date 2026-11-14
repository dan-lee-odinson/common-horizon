// Mission planner: hardware rows, the power balance number, the stay length and the Earth link.

import { useId, useState } from 'react';
import type { CatalogItem, CheckResponse, PowerCheck } from '../api/types';
import { actions, appStore, MAX_STAY_DAYS, MIN_STAY_DAYS, type HardwarePick } from '../state/app';
import { useData } from '../state/data';
import { useStore } from '../state/store';
import { formatKwh, formatPercent, powerColorVar, powerLevel, powerWord } from '../util/power';
import { AsyncView, SkeletonLines } from './AsyncView';
import { EARTH_LINK_COLOR, EARTH_LINK_WORD } from './HorizonPlot';
import { HardwareGlyph } from './HardwareGlyph';
import { Icon } from './Icon';

export function PlannerPanel() {
  const { catalog, check, hardwareChosen, highlighted, evaluation } = useData();
  const hardware = useStore(appStore, (s) => s.hardware);
  const stayDays = useStore(appStore, (s) => s.stayDays);
  const ids = { stay: useId(), stayNum: useId(), heading: useId() };

  const row = highlighted ? evaluation.data?.rows.find((r) => r.siteId === highlighted.id) : undefined;

  return (
    <section aria-labelledby={ids.heading} className="flex h-full min-h-0 flex-col" data-testid="planner">
      <div className="flex items-center justify-between border-b border-line px-4 py-3">
        <h2 id={ids.heading} className="m-0 text-[14px] font-semibold">
          Mission planner
        </h2>
        <button type="button" className="btn btn-icon md:hidden" aria-label="Close the planner" onClick={() => actions.setDrawer('none')}>
          <Icon name="close" />
        </button>
      </div>

      <div className="min-h-0 flex-1 overflow-y-auto overscroll-contain">
        <fieldset className="m-0 border-0 p-0">
          <legend className="label px-4 pt-3">Hardware</legend>
          <AsyncView result={catalog} what="the hardware catalog" waiting={<SkeletonLines lines={6} />} empty="The catalog came back empty.">
            {(data) => (
              <ul className="m-0 flex list-none flex-col gap-1 p-2">
                {data.items.map((item) => (
                  <HardwareRow key={item.id} item={item} pick={hardware[item.id]} />
                ))}
              </ul>
            )}
          </AsyncView>
        </fieldset>

        <div className="border-t border-line px-4 py-3">
          <PowerBalance check={check.refreshing && check.data?.balance_margin_percent === null ? null : check.data} status={check.status} hasHardware={hardwareChosen.length > 0} siteName={highlighted?.name ?? null} onRetry={check.retry} />
        </div>

        <div className="border-t border-line px-4 py-3">
          <div className="flex items-baseline justify-between">
            <label htmlFor={ids.stay} className="label">
              Stay length
            </label>
            <span className="flex items-baseline gap-1 text-[13px]">
              <input
                id={ids.stayNum}
                type="number"
                min={MIN_STAY_DAYS}
                max={MAX_STAY_DAYS}
                step={0.25}
                value={stayDays}
                onChange={(e) => {
                  const v = Number(e.target.value);
                  if (Number.isFinite(v) && e.target.value !== '') actions.setStay(v);
                }}
                className="field num w-20 text-right"
                aria-label="Stay length in days"
              />
              <span className="text-muted">days</span>
            </span>
          </div>
          <input
            id={ids.stay}
            type="range"
            min={MIN_STAY_DAYS}
            max={MAX_STAY_DAYS}
            step={0.25}
            value={stayDays}
            onChange={(e) => actions.setStay(Number(e.target.value))}
            className="mt-2 w-full"
            aria-valuetext={`${stayDays} days`}
          />
          <div className="flex justify-between text-[11px] text-muted num">
            <span>1 d</span>
            <span>365.25 d</span>
          </div>
        </div>
      </div>

      <div className="border-t border-line px-4 py-3" data-testid="earth-link">
        <p className="label m-0 mb-1">Earth link{highlighted ? ` · ${highlighted.name}` : ''}</p>
        {row ? (
          <p className="m-0 flex items-center gap-2 text-[14px] font-medium">
            <span className="inline-block size-3 rounded-full" style={{ background: EARTH_LINK_COLOR[row.evaluation.earth_link] }} aria-hidden />
            {EARTH_LINK_WORD[row.evaluation.earth_link]}
          </p>
        ) : (
          <p className="m-0 flex items-center gap-2 text-[13px] text-muted">
            <span className="inline-block size-3 rounded-full border border-line-strong" aria-hidden />
            no site picked yet
          </p>
        )}
      </div>
    </section>
  );
}

function HardwareRow({ item, pick }: { item: CatalogItem; pick: HardwarePick | undefined }) {
  const id = useId();
  const selected = pick?.selected ?? false;
  const count = pick?.count ?? item.default_count;
  return (
    <li className={`flex items-center gap-3 rounded-lg px-2 py-1.5 transition-colors ${selected ? 'bg-accent-soft' : 'hover:bg-surface-2'}`}>
      <div className="grid h-11 w-14 shrink-0 place-items-center rounded-md border border-line bg-space text-ink-2" data-testid="picture-slot">
        {item.picture ? <img src={item.picture} alt="" className="max-h-full max-w-full object-contain" /> : <HardwareGlyph id={item.id} kind={item.kind} />}
      </div>
      <div className="flex min-w-0 flex-1 items-center gap-2">
        <input id={id} type="checkbox" checked={selected} onChange={(e) => actions.toggleHardware(item.id, e.target.checked)} className="size-4 shrink-0" />
        <label htmlFor={id} className="min-w-0 cursor-pointer">
          <span className="block truncate text-[13px] font-medium">{item.name}</span>
          {item.note ? <span className="block truncate text-[11px] text-muted">{item.note}</span> : null}
        </label>
      </div>
      {item.countable ? (
        <div className="flex shrink-0 items-center gap-1" role="group" aria-label={`${item.name} count`}>
          <button
            type="button"
            className="btn btn-icon size-7 min-h-7"
            aria-label={`Fewer ${item.name}`}
            disabled={!selected || count <= 1}
            onClick={() => actions.setHardwareCount(item.id, count - 1, item.max_count)}
          >
            <Icon name="minus" size={14} />
          </button>
          <span className="num w-5 text-center text-[13px]" aria-live="polite">
            {count}
          </span>
          <button
            type="button"
            className="btn btn-icon size-7 min-h-7"
            aria-label={`More ${item.name}`}
            disabled={!selected || count >= item.max_count}
            onClick={() => actions.setHardwareCount(item.id, count + 1, item.max_count)}
          >
            <Icon name="plus" size={14} />
          </button>
        </div>
      ) : null}
    </li>
  );
}

function PowerBalance({
  check,
  status,
  hasHardware,
  siteName,
  onRetry,
}: {
  check: CheckResponse | null;
  status: string;
  hasHardware: boolean;
  siteName: string | null;
  onRetry: () => void;
}) {
  const [open, setOpen] = useState(false);
  const detailsId = useId();
  if (!hasHardware) {
    return (
      <div>
        <p className="label m-0">Power balance</p>
        <p className="m-0 mt-1 text-[13px] text-muted" data-state="empty">
          Tick hardware above to see the power balance.
        </p>
      </div>
    );
  }
  if (status === 'error') {
    return (
      <div role="alert">
        <p className="label m-0">Power balance</p>
        <p className="m-0 mt-1 text-[13px] text-ink-2">
          <span className="text-bad">Could not run the power check.</span>{' '}
          <button type="button" className="btn ml-1" onClick={onRetry}>
            Try again
          </button>
        </p>
      </div>
    );
  }
  if (!check) {
    return (
      <div role="status">
        <p className="label m-0">Power balance</p>
        <div className="skeleton mt-2 h-8 w-28" />
        <span className="sr-only">Running the power check…</span>
      </div>
    );
  }
  const level = powerLevel(check.balance_margin_percent);
  return (
    <div>
      <p className="label m-0">Power balance{siteName ? ` · ${siteName}` : ' · no site picked'}</p>
      <button
        type="button"
        className="mt-1 flex w-full items-baseline gap-2 rounded-lg px-1 py-1 text-left hover:bg-surface-2"
        aria-expanded={open}
        aria-controls={detailsId}
        onClick={() => setOpen((o) => !o)}
        data-testid="power-number"
        data-level={level}
      >
        <span className="num text-[28px] font-semibold leading-none" style={{ color: powerColorVar(level) }}>
          {formatPercent(check.balance_margin_percent, true)}
        </span>
        <span className="text-[12px]" style={{ color: powerColorVar(level) }}>
          {powerWord(level)}
        </span>
        <span className="ml-auto text-[11px] text-muted">{open ? 'hide checks' : 'day / night checks'}</span>
      </button>
      {open ? (
        <dl id={detailsId} className="m-0 mt-2 grid gap-2 text-[12px]">
          <CheckLine label="Day check" c={check.day} notNeeded="no daylight during this stay" />
          <CheckLine label="Night check" c={check.night} notNeeded="no darkness during this stay" />
          <div className="flex justify-between border-t border-line pt-2">
            <dt className="text-muted">Energy over the stay</dt>
            <dd className="num m-0" style={{ color: powerColorVar(level) }}>
              {formatKwh(check.energy_added_kwh)}
            </dd>
          </div>
        </dl>
      ) : null}
      <p className={`m-0 mt-2 text-[12px] ${check.fits ? 'text-ink-2' : 'text-bad'}`} data-testid="fit-status">
        {check.fits ? 'Hardware fits.' : `Does not fit: ${check.fit_notes.join(' ')}`}
      </p>
    </div>
  );
}

function CheckLine({ label, c, notNeeded }: { label: string; c: PowerCheck; notNeeded: string }) {
  const level = powerLevel(c.margin_percent);
  return (
    <div className="flex items-baseline justify-between gap-2">
      <dt className="text-ink-2">{label}</dt>
      <dd className="num m-0 text-right">
        {c.needed ? (
          <>
            <span className="text-muted">
              {c.generation_kw} kW made / {c.load_kw} kW used ·{' '}
            </span>
            <span style={{ color: powerColorVar(level) }}>{formatPercent(c.margin_percent, true)}</span>
          </>
        ) : (
          <span className="text-muted">{notNeeded}</span>
        )}
      </dd>
    </div>
  );
}
