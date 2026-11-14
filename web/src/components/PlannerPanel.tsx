// Mission planner: hardware rows (with typed battery storage), the power balance number, the stay
// length and the Earth link. The power balance follows the planner module's day and night checks.

import { useId, useState, type ReactNode } from 'react';
import type { CatalogItem, CheckResponse, DayCheck, NightCheck } from '../api/types';
import { actions, appStore, MAX_STAY_DAYS, MIN_STAY_DAYS, type HardwarePick } from '../state/app';
import { useData } from '../state/data';
import { useStore } from '../state/store';
import { balanceWords, formatAmount, formatKwh, formatMargin, levelFromStatus, powerColorVar, storageToCover } from '../util/power';
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
        <h2 id={ids.heading} className="m-0 text-[15px] font-semibold">
          Mission planner
        </h2>
        <button type="button" className="btn btn-icon md:hidden" aria-label="Close the planner" onClick={() => actions.setDrawer('none')}>
          <Icon name="close" />
        </button>
      </div>

      <div className="min-h-0 flex-1 overflow-y-auto overscroll-contain">
        <fieldset className="m-0 min-w-0 border-0 p-0">
          <legend className="label px-4 pt-3">Hardware</legend>
          <AsyncView result={catalog} what="the hardware catalog" waiting={<SkeletonLines lines={6} />} empty="The catalog came back empty.">
            {(data) => {
              // Battery storage sits with the power sources: after the last power row.
              const lastPower = data.items.map((i) => i.kind).lastIndexOf('power');
              const at = lastPower === -1 ? data.items.length : lastPower + 1;
              return (
                <ul className="m-0 flex list-none flex-col gap-1 p-2">
                  {data.items.slice(0, at).map((item) => (
                    <HardwareRow key={item.id} item={item} pick={hardware[item.id]} />
                  ))}
                  <StorageRow />
                  {data.items.slice(at).map((item) => (
                    <HardwareRow key={item.id} item={item} pick={hardware[item.id]} />
                  ))}
                </ul>
              );
            }}
          </AsyncView>
        </fieldset>

        <div className="border-t border-line px-4 py-3">
          <PowerBalance
            check={check.refreshing && check.data?.balance.status === 'none' ? null : check.data}
            status={check.status}
            hasHardware={hardwareChosen.length > 0}
            siteName={highlighted?.name ?? null}
            onRetry={check.retry}
          />
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
          {item.note ? <span className={`block truncate text-[12px] ${selected ? 'text-ink-2' : 'text-muted'}`}>{item.note}</span> : null}
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

/**
 * Battery storage: a typed figure in kWh, not a catalog row (the planner module takes storage as its
 * own figure). Empty or 0 means none. It only counts once a site is picked, because the site's
 * longest darkness sets how much storage the night needs.
 */
function StorageRow() {
  const storageKwh = useStore(appStore, (s) => s.storageKwh);
  const [draft, setDraft] = useState<string | null>(null);
  const ids = { input: useId(), note: useId() };
  const value = draft ?? (storageKwh > 0 ? String(storageKwh) : '');
  const invalid = draft !== null && draft.trim() !== '' && !(Number(draft) >= 0);
  const on = storageKwh > 0;
  return (
    <li className={`flex items-center gap-3 rounded-lg px-2 py-1.5 transition-colors ${on ? 'bg-accent-soft' : 'hover:bg-surface-2'}`} data-testid="storage-row">
      <div className="grid h-11 w-14 shrink-0 place-items-center rounded-md border border-line bg-space text-ink-2" data-testid="picture-slot">
        <HardwareGlyph id="battery" kind="power" />
      </div>
      <div className="min-w-0 flex-1">
        <label htmlFor={ids.input} className="block cursor-pointer truncate text-[13px] font-medium">
          Battery storage
        </label>
        <span id={ids.note} className={`block truncate text-[12px] ${invalid ? 'text-bad' : on ? 'text-ink-2' : 'text-muted'}`}>
          {invalid ? 'Type 0 or more' : 'empty or 0 = none'}
        </span>
      </div>
      <span className="flex shrink-0 items-baseline gap-1">
        <input
          id={ids.input}
          type="number"
          inputMode="decimal"
          min={0}
          step="any"
          placeholder="0"
          value={value}
          onChange={(e) => {
            const raw = e.target.value;
            setDraft(raw);
            if (raw.trim() === '') actions.setStorage(0);
            else {
              const kwh = Number(raw);
              if (Number.isFinite(kwh) && kwh >= 0) actions.setStorage(kwh);
            }
          }}
          onBlur={() => setDraft(null)}
          className="field num w-[5rem] text-right text-[13px]"
          aria-describedby={ids.note}
          aria-invalid={invalid || undefined}
          data-testid="storage-input"
        />
        <span className="text-[12px] text-muted">kWh</span>
      </span>
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
  if (status === 'error' || status === 'unavailable') {
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
  const { balance, day, night } = check;
  const level = levelFromStatus(balance.status);
  const words = balanceWords(level, balance.limiting);
  const marginText = formatMargin(balance.margin_percent, level);
  const nightFails = night.needed && !night.passes;
  const dayFails = day.needed && !day.passes;
  // Name the check that sets the headline number, so a red number always has a visible cause.
  const driverText = balance.limiting === null ? null : balance.limiting === 'day' ? dayDriver(day) : nightDriver(night);
  const needed = night.storage_needed_kwh;
  return (
    <div>
      <p className="label m-0">Power balance{siteName ? ` · ${siteName}` : ''}</p>
      <button
        type="button"
        className="mt-1 flex w-full items-baseline gap-2 rounded-lg px-1 py-1 text-left hover:bg-surface-2"
        aria-expanded={open}
        aria-controls={detailsId}
        onClick={() => setOpen((o) => !o)}
        data-testid="power-number"
        data-level={level}
        data-limiting={balance.limiting ?? ''}
      >
        <span className={`num font-semibold leading-none ${marginText === 'no supply' ? 'text-[22px]' : 'text-[28px]'}`} style={{ color: powerColorVar(level) }}>
          {marginText}
        </span>
        <span className="text-[12px] leading-tight" style={{ color: powerColorVar(level) }} data-testid="power-words">
          {words}
        </span>
        <span className="ml-auto shrink-0 text-[12px] text-muted">{open ? 'hide checks' : 'day / night checks'}</span>
      </button>
      {driverText ? (
        <p className="m-0 mt-1 text-[12px] text-ink-2" data-testid="power-driver">
          {driverText}
        </p>
      ) : null}
      {nightFails ? (
        <div className="mt-2 rounded-lg border border-line-strong bg-surface-2 px-2.5 py-2 text-[12px]" role="note" data-testid="night-advice">
          {needed !== null ? (
            <p className="m-0 text-ink" data-testid="storage-needed" data-kwh={storageToCover(needed)}>
              About <span className="num font-semibold">{storageToCover(needed).toLocaleString('en-US')} kWh</span> of storage would cover this site&rsquo;s darkness
              {night.storage_kwh > 0 ? <span className="text-ink-2"> ({formatAmount(night.storage_kwh, 'kWh')} typed)</span> : null}.
            </p>
          ) : (
            <p className="m-0 text-ink">Pick a site to see how much storage would cover its darkness.</p>
          )}
          <p className="m-0 mt-1 text-ink-2">Add battery storage or a nuclear generator to cover the dark hours.</p>
        </div>
      ) : null}
      {dayFails ? (
        <p className="m-0 mt-2 rounded-lg border border-line-strong bg-surface-2 px-2.5 py-2 text-[12px] text-ink-2" role="note" data-testid="day-advice">
          Add solar arrays or a nuclear generator to cover the daylight load{day.refill_kw > 0 ? ' and refill the storage' : ''}.
        </p>
      ) : null}
      {night.basis === 'power only' && !nightFails ? (
        <p className="m-0 mt-1 text-[12px] text-muted">No site picked yet, so the night check compares power only. Battery storage counts once a site is picked.</p>
      ) : null}
      {open ? (
        <dl id={detailsId} className="m-0 mt-2 grid gap-2 text-[12px]">
          <CheckLine label="Day check" needed={day.needed} notNeeded="nothing to check in daylight" margin={day.margin_percent} status={day.status}>
            {formatAmount(day.generation_kw, 'kW')} made / {formatAmount(day.load_kw, 'kW')} used
            {day.refill_kw > 0 ? ` + ${formatAmount(day.refill_kw, 'kW')} refill` : ''}
          </CheckLine>
          <CheckLine
            label="Night check"
            needed={night.needed}
            notNeeded={night.basis === 'no darkness' ? 'no darkness during this stay' : 'nothing draws power at night'}
            margin={night.margin_percent}
            status={night.status}
          >
            {night.basis === 'energy'
              ? `${formatAmount(night.available_kwh, 'kWh')} available / ${formatAmount(night.load_kwh, 'kWh')} needed`
              : `${formatAmount(night.generation_kw, 'kW')} made / ${formatAmount(night.load_kw, 'kW')} used`}
          </CheckLine>
          {night.longest_darkness_h !== null ? (
            <div className="flex justify-between gap-2">
              <dt className="text-muted">Longest darkness in this stay</dt>
              <dd className="num m-0 text-ink">{formatAmount(night.longest_darkness_h, 'h')}</dd>
            </div>
          ) : null}
          <div className="flex justify-between gap-2">
            <dt className="text-muted">Battery storage</dt>
            <dd className="num m-0 text-right text-ink">
              {night.storage_kwh > 0 ? `${formatAmount(night.storage_kwh, 'kWh')} typed` : 'none'}
              {needed !== null ? <span className="text-muted"> · {formatAmount(needed, 'kWh')} needed</span> : null}
            </dd>
          </div>
          <div className="flex justify-between gap-2 border-t border-line pt-2">
            <dt className="text-muted">Energy over the stay</dt>
            <dd className="num m-0 text-ink">{formatKwh(check.energy_added_kwh)}</dd>
          </div>
          {check.power_notes.map((note) => (
            <p key={note} className="m-0 text-muted">
              {note}
            </p>
          ))}
        </dl>
      ) : null}
      <p className={`m-0 mt-2 text-[12px] ${check.fits ? 'text-ink-2' : 'text-bad'}`} data-testid="fit-status">
        {check.fits ? 'Hardware fits.' : `Does not fit: ${check.fit_notes.join(' ')}`}
      </p>
    </div>
  );
}

function dayDriver(day: DayCheck): string {
  const refill = day.refill_kw > 0 ? ` + ${formatAmount(day.refill_kw, 'kW')} to refill storage` : '';
  return `Day check: ${formatAmount(day.generation_kw, 'kW')} made in sunlight, ${formatAmount(day.load_kw, 'kW')} used${refill}.`;
}

function nightDriver(night: NightCheck): string {
  if (night.basis === 'energy') {
    return `Night check: ${formatAmount(night.load_kwh, 'kWh')} needed over ${formatAmount(night.longest_darkness_h, 'h')} of darkness, ${formatAmount(night.available_kwh, 'kWh')} available.`;
  }
  return `Night check: ${formatAmount(night.generation_kw, 'kW')} made in darkness, ${formatAmount(night.load_kw, 'kW')} used.`;
}

function CheckLine({
  label,
  needed,
  notNeeded,
  margin,
  status,
  children,
}: {
  label: string;
  needed: boolean;
  notNeeded: string;
  margin: number | null;
  status: CheckResponse['balance']['status'];
  children: ReactNode;
}) {
  const level = levelFromStatus(status);
  return (
    <div className="flex items-baseline justify-between gap-2">
      <dt className="shrink-0 text-ink-2">{label}</dt>
      <dd className="num m-0 text-right">
        {needed ? (
          <>
            <span className="text-muted">{children} · </span>
            <span style={{ color: powerColorVar(level) }}>{formatMargin(margin, level)}</span>
          </>
        ) : (
          <span className="text-muted">{notNeeded}</span>
        )}
      </dd>
    </div>
  );
}
