// The mission planner: a second sheet of glass, opened from the one-line mission summary.
// Launch date and time, stay length, hardware rows with counts, typed battery storage, the power
// balance with the check that limits it, the fit check and the Earth link. The power balance
// follows the planner module's day and night checks.

import { useEffect, useId, useState, type ReactNode } from 'react';
import type { CatalogItem, CheckResponse, DayCheck, HardwareKind, NightCheck } from '../api/types';
import { AsyncView, SkeletonLines } from '../components/AsyncView';
import { HardwareGlyph } from '../components/HardwareGlyph';
import { Icon } from '../components/Icon';
import { Sheet } from '../hud/Sheet';
import { actions, appStore, MAX_SLIP_DAYS, MAX_STAY_DAYS, MIN_STAY_DAYS, type HardwarePick } from '../state/app';
import { useData } from '../state/data';
import { useStore } from '../state/store';
import { balanceWords, formatAmount, formatKwh, formatMargin, levelFromStatus, storageToCover, type PowerLevel } from '../util/power';
import { EARTH_LINK_TONE, EARTH_LINK_WORD } from '../util/quantities';
import { catalogFigureRows, chosenCapacity, figureValue, KIND_HEADING } from '../util/catalog';
import { readStorageEntry } from '../util/storage';
import { parseDatetimeLocalUtc, toDatetimeLocalUtc } from '../util/time';

const TONE: Record<PowerLevel, string> = { good: 'good', thin: 'warn', short: 'bad', unknown: 'muted' };

export function MissionSheet({ phone }: { phone: boolean }) {
  const open = useStore(appStore, (s) => s.missionOpen);
  return (
    <Sheet open={open} onClose={() => actions.setMissionOpen(false)} title="Mission planner" note="Change anything here and the ranking follows." testId="planner" phone={phone}>
      {open ? <PlannerBody /> : null}
    </Sheet>
  );
}

function PlannerBody() {
  const { catalog, check, hardwareChosen, focus, focusRow } = useData();
  const hardware = useStore(appStore, (s) => s.hardware);
  const capacityPick = useStore(appStore, (s) => s.capacityPick);
  const stayDays = useStore(appStore, (s) => s.stayDays);
  const launchUtcMs = useStore(appStore, (s) => s.launchUtcMs);
  const slipDays = useStore(appStore, (s) => s.slipDays);
  const ids = { launch: useId(), stay: useId(), stayNum: useId(), slip: useId() };
  const [launchDraft, setLaunchDraft] = useState<string | null>(null);

  return (
    <div className="min-h-0 flex-1 overflow-y-auto overscroll-contain">
      <section className="grid grid-cols-2 gap-x-5 gap-y-3 px-5 py-4 max-md:grid-cols-1" aria-label="Launch and stay">
        <div className="flex min-w-0 flex-col gap-1.5">
          <label htmlFor={ids.launch} className="label">
            Planned launch, UTC
          </label>
          <input
            id={ids.launch}
            type="datetime-local"
            className="field num w-full text-[14px]"
            value={launchDraft ?? toDatetimeLocalUtc(launchUtcMs)}
            onChange={(e) => {
              const ms = parseDatetimeLocalUtc(e.target.value);
              if (Number.isFinite(ms)) {
                setLaunchDraft(null);
                actions.setLaunch(ms);
              } else setLaunchDraft(e.target.value);
            }}
            onBlur={() => setLaunchDraft(null)}
            data-testid="launch-input"
          />
        </div>
        <div className="flex min-w-0 flex-col gap-1.5">
          <label htmlFor={ids.slip} className="label">
            Launch delay, days (0 to {MAX_SLIP_DAYS})
          </label>
          <input
            id={ids.slip}
            type="number"
            inputMode="numeric"
            className="field num w-full text-[14px]"
            min={0}
            max={MAX_SLIP_DAYS}
            step={1}
            value={slipDays}
            onChange={(e) => {
              if (e.target.value !== '' && Number.isFinite(Number(e.target.value))) actions.setSlip(Number(e.target.value));
            }}
          />
        </div>
        <div className="col-span-2 flex min-w-0 flex-col gap-1 max-md:col-span-1">
          <div className="flex items-end justify-between gap-3">
            <label htmlFor={ids.stay} className="label">
              Stay length
            </label>
            <span className="flex items-baseline gap-1.5">
              <input
                id={ids.stayNum}
                type="number"
                inputMode="decimal"
                min={MIN_STAY_DAYS}
                max={MAX_STAY_DAYS}
                step={0.25}
                value={stayDays}
                onChange={(e) => {
                  const v = Number(e.target.value);
                  if (Number.isFinite(v) && e.target.value !== '') actions.setStay(v);
                }}
                className="field num w-24 text-right text-[14px]"
                aria-label="Stay length in days"
                data-testid="stay-input"
              />
              <span className="text-[13px] text-ink-2">days</span>
            </span>
          </div>
          <input
            id={ids.stay}
            type="range"
            className="scrub"
            min={MIN_STAY_DAYS}
            max={MAX_STAY_DAYS}
            step={0.25}
            value={stayDays}
            onChange={(e) => actions.setStay(Number(e.target.value))}
            aria-valuetext={`${stayDays} days`}
          />
          <div className="num -mt-2 flex justify-between text-[12px] text-muted">
            <span>1 d</span>
            <span>365.25 d</span>
          </div>
        </div>
      </section>

      <fieldset className="m-0 min-w-0 border-0 border-t border-line p-0">
        <legend className="label px-5 pt-4">Hardware</legend>
        <AsyncView result={catalog} what="the hardware catalog" waiting={<SkeletonLines lines={6} />} empty="The catalog came back empty.">
          {(data) => {
            // Battery storage sits with the power sources: after the last power row.
            const lastPower = data.items.map((i) => i.kind).lastIndexOf('power');
            const at = lastPower === -1 ? data.items.length : lastPower + 1;
            // A heading wherever the kind changes: landers, payload, power sources, power loads.
            const rows = (items: CatalogItem[], from: number) =>
              items.map((item, i) => {
                const before = data.items[from + i - 1];
                return (
                  <HardwareRow
                    key={item.id}
                    item={item}
                    pick={hardware[item.id]}
                    capacityOption={chosenCapacity(item, capacityPick)?.option ?? null}
                    heading={before?.kind === item.kind ? null : item.kind}
                  />
                );
              });
            return (
              <ul className="m-0 flex list-none flex-col gap-1 px-3 pb-3 pt-2">
                {rows(data.items.slice(0, at), 0)}
                <StorageRow />
                {rows(data.items.slice(at), at)}
              </ul>
            );
          }}
        </AsyncView>
      </fieldset>

      <section className="border-t border-line px-5 py-4" aria-label="Power balance">
        <PowerBalance
          check={check.refreshing && check.data?.balance.status === 'none' ? null : check.data}
          status={check.status}
          error={check.error}
          hasHardware={hardwareChosen.length > 0}
          siteName={focus?.name ?? null}
          onRetry={check.retry}
          pickedLabels={pickedCapacityLabels(catalog.data?.items ?? [], hardwareChosen.map((h) => h.id), capacityPick)}
        />
      </section>

      <section className="border-t border-line px-5 py-4" data-testid="earth-link" aria-label="Earth link">
        <p className="label m-0 mb-1 break-words">Earth link{focus ? `, ${focus.name}` : ''}</p>
        {focusRow ? (
          <p className="readout-value m-0" data-size="md" data-tone={EARTH_LINK_TONE[focusRow.evaluation.earth_link]}>
            {EARTH_LINK_WORD[focusRow.evaluation.earth_link]}
          </p>
        ) : (
          <p className="m-0 text-[14px] text-ink-2">No site in the spotlight yet.</p>
        )}
      </section>
    </div>
  );
}

/** The labels of the payload figures picked for the chosen landers: their lines in the fit check are marked. */
function pickedCapacityLabels(items: readonly CatalogItem[], chosen: readonly string[], picks: Readonly<Record<string, string>>): string[] {
  return items.filter((i) => i.kind === 'lander' && chosen.includes(i.id) && i.capacity_options.length > 1).flatMap((i) => {
    const o = chosenCapacity(i, picks);
    return o ? [o.label] : [];
  });
}

function HardwareRow({ item, pick, capacityOption, heading }: { item: CatalogItem; pick: HardwarePick | undefined; capacityOption: string | null; heading: HardwareKind | null }) {
  const id = useId();
  const selected = pick?.selected ?? false;
  const count = pick?.count ?? item.default_count;
  const figures = catalogFigureRows(item);
  const options = item.capacity_options ?? [];
  return (
    <>
      {heading ? (
        <li className="label px-2 pt-2" aria-hidden data-testid="kind-heading" data-kind={heading}>
          {KIND_HEADING[heading]}
        </li>
      ) : null}
      <li className={`flex flex-col gap-1 rounded-[3px] border px-2 py-1.5 ${selected ? 'border-line bg-accent-soft' : 'border-transparent'}`} data-testid="hardware-row" data-id={item.id} data-kind={item.kind}>
        <div className="flex items-center gap-3">
          <div className="grid h-11 w-12 shrink-0 place-items-center rounded-[3px] border border-line text-ink-2" data-testid="picture-slot">
            {item.picture ? <img src={item.picture} alt="" className="max-h-full max-w-full object-contain" /> : <HardwareGlyph id={item.id} kind={item.kind} />}
          </div>
          <label htmlFor={id} className="flex min-h-11 min-w-0 flex-1 cursor-pointer items-center gap-3">
            <input id={id} type="checkbox" className="check" checked={selected} onChange={(e) => actions.toggleHardware(item.id, e.target.checked)} />
            <span className="min-w-0">
              <span className="block break-words text-[14px] leading-snug text-ink">{item.name}</span>
              {item.note ? <span className="block break-words text-[13px] leading-snug text-ink-2">{item.note}</span> : null}
            </span>
          </label>
          {item.countable ? (
            <div className="flex shrink-0 items-center gap-1" role="group" aria-label={`${item.name} count`}>
              <button
                type="button"
                className="btn btn-icon"
                aria-label={`Fewer ${item.name}`}
                disabled={!selected || count <= 1}
                onClick={() => actions.setHardwareCount(item.id, count - 1, item.max_count)}
              >
                <Icon name="minus" size={14} />
              </button>
              <span className="num w-7 text-center text-[15px]" aria-live="polite" data-testid="hardware-count">
                {count}
              </span>
              <button
                type="button"
                className="btn btn-icon"
                aria-label={`More ${item.name}`}
                disabled={!selected || count >= item.max_count}
                onClick={() => actions.setHardwareCount(item.id, count + 1, item.max_count)}
              >
                <Icon name="plus" size={14} />
              </button>
            </div>
          ) : null}
        </div>
        {figures.length > 0 ? (
          <ul className="m-0 ml-[3.75rem] flex list-none flex-col gap-0.5 p-0 text-[12px] leading-snug" aria-label={`${item.name}: published figures`} data-testid="figures">
            {figures.map((f) => (
              <li key={f.key} className="flex flex-wrap items-baseline gap-x-1.5" data-testid="figure" data-published={f.published}>
                <span className="text-ink-2">{f.label}:</span>
                <span className={`num ${f.published ? 'text-ink' : 'text-muted'}`}>{f.value}</span>
                {f.status.map((s) => (
                  <span key={s} className="rounded-[2px] border border-line px-1 text-[12px] text-ink-2" data-testid="figure-status">
                    {s}
                  </span>
                ))}
                {f.source ? (
                  <span className="text-muted" data-testid="figure-source">
                    {f.source}
                  </span>
                ) : null}
              </li>
            ))}
          </ul>
        ) : null}
        {options.length > 1 ? (
          <fieldset className="m-0 ml-[3.75rem] min-w-0 border-0 p-0 text-[12px] leading-snug" data-testid="capacity-options">
            <legend className="p-0 text-ink-2">Payload figure for the fit check (pick one):</legend>
            {options.map((o) => (
              <label key={o.option} className="flex min-h-8 cursor-pointer items-start gap-2 py-0.5">
                <input
                  type="radio"
                  className="mt-0.5"
                  name={`capacity-${item.id}`}
                  value={o.option}
                  checked={capacityOption === o.option}
                  onChange={() => actions.pickCapacity(item.id, o.option)}
                  data-testid="capacity-option"
                />
                <span className="min-w-0">
                  <span className="text-ink">{o.label}</span> <span className="num text-ink">{figureValue(o.figure).text}</span>{' '}
                  {o.figure.status.map((s) => (
                    <span key={s} className="rounded-[2px] border border-line px-1 text-[12px] text-ink-2">
                      {s}
                    </span>
                  ))}{' '}
                  <span className="text-muted">{o.figure.source}</span>
                </span>
              </label>
            ))}
          </fieldset>
        ) : null}
      </li>
    </>
  );
}

/**
 * Battery storage: a typed figure in kWh, not a catalog row (the planner module takes storage as its
 * own figure). Empty or 0 means none. It only counts once a site is picked, because the site's
 * longest darkness sets how much storage the night needs.
 *
 * The box and the power checks always agree: every entry settles on one number at once. A bad entry
 * counts as none and says so; a figure above the cap becomes the cap, in the box too, and says so.
 */
function StorageRow() {
  const storageKwh = useStore(appStore, (s) => s.storageKwh);
  const stored = storageKwh > 0 ? String(storageKwh) : '';
  const [text, setText] = useState(stored);
  const [note, setNote] = useState(() => readStorageEntry(stored));
  const ids = { input: useId(), note: useId() };

  // When the storage changes from elsewhere, the box follows it.
  useEffect(() => {
    if (readStorageEntry(text).kwh !== storageKwh) {
      setText(stored);
      setNote(readStorageEntry(stored));
    }
    // Only the stored value drives this; the box's own typing is handled in onChange.
  }, [storageKwh]);

  function onType(raw: string) {
    const entry = readStorageEntry(raw);
    actions.setStorage(entry.kwh);
    setNote(entry);
    // A capped figure is replaced in the box straight away, so the box never shows more than the checks use.
    setText(entry.status === 'capped' ? entry.display : raw);
  }

  const bad = note.status === 'invalid';
  const on = storageKwh > 0;
  return (
    <li className={`flex items-center gap-3 rounded-[3px] border px-2 py-1.5 ${on ? 'border-line bg-accent-soft' : 'border-transparent'}`} data-testid="storage-row">
      <div className="grid h-11 w-12 shrink-0 place-items-center rounded-[3px] border border-line text-ink-2" data-testid="picture-slot">
        <HardwareGlyph id="battery" kind="power" />
      </div>
      <div className="min-w-0 flex-1">
        <label htmlFor={ids.input} className="block cursor-pointer text-[14px] leading-snug text-ink">
          Battery storage
        </label>
        <span id={ids.note} className="block text-[13px] leading-snug text-ink-2" data-tone={bad ? 'bad' : note.status === 'capped' ? 'warn' : undefined} role={bad || note.status === 'capped' ? 'status' : undefined} data-testid="storage-note" data-status={note.status}>
          {note.note}
        </span>
      </div>
      <span className="flex shrink-0 items-baseline gap-1.5">
        <input
          id={ids.input}
          type="text"
          inputMode="decimal"
          placeholder="0"
          value={text}
          onChange={(e) => onType(e.target.value)}
          onBlur={() => {
            // A bad entry leaves the box when the visitor does: it then shows what the checks use.
            const entry = readStorageEntry(text);
            if (entry.status === 'invalid') setText('');
            else if (entry.status !== 'capped') setNote(entry);
          }}
          className="field num w-[6.5rem] text-right text-[14px]"
          aria-describedby={ids.note}
          aria-invalid={bad || undefined}
          autoComplete="off"
          data-testid="storage-input"
        />
        <span className="text-[13px] text-ink-2">kWh</span>
      </span>
    </li>
  );
}

function PowerBalance({
  check,
  status,
  error,
  hasHardware,
  siteName,
  onRetry,
  pickedLabels,
}: {
  check: CheckResponse | null;
  status: string;
  error: string | null;
  hasHardware: boolean;
  siteName: string | null;
  onRetry: () => void;
  pickedLabels: string[];
}) {
  const [open, setOpen] = useState(false);
  const detailsId = useId();
  if (!hasHardware) {
    return (
      <div>
        <p className="label m-0">Power balance</p>
        <p className="m-0 mt-1 text-[14px] text-ink-2" data-state="empty">
          Tick hardware above to see the power balance.
        </p>
      </div>
    );
  }
  if (status === 'error' || status === 'unavailable') {
    return (
      <div role="alert">
        <p className="label m-0">Power balance</p>
        <p className="m-0 mt-1 flex flex-wrap items-center gap-3 text-[14px] text-ink-2">
          <span data-tone="bad">Could not run the power check.</span>
          {error ? <span data-testid="check-error">{error}</span> : null}
          <button type="button" className="btn" onClick={onRetry}>
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
        <div className="skeleton mt-2 h-9 w-32" />
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
      <p className="label m-0 break-words">Power balance{siteName ? `, ${siteName}` : ''}</p>
      <button
        type="button"
        className="mt-1 flex min-h-11 w-full flex-wrap items-baseline gap-x-3 gap-y-1 rounded-[3px] text-left"
        aria-expanded={open}
        aria-controls={detailsId}
        onClick={() => setOpen((o) => !o)}
        data-testid="power-number"
        data-level={level}
        data-limiting={balance.limiting ?? ''}
      >
        <span className="readout-value" data-size={marginText === 'no supply' ? 'lg' : 'xl'} data-tone={TONE[level]}>
          {marginText}
        </span>
        <span className="text-[14px] leading-tight" data-tone={TONE[level]} data-testid="power-words">
          {words}
        </span>
        <span className="ml-auto flex shrink-0 items-center gap-1 font-display text-[12px] font-semibold uppercase tracking-[0.1em] text-accent">
          {open ? 'Hide checks' : 'Day and night checks'}
          <Icon name={open ? 'chevron-up' : 'chevron-down'} size={14} />
        </span>
      </button>
      {driverText ? (
        <p className="m-0 mt-1 text-[13px] leading-snug text-ink-2" data-testid="power-driver">
          {driverText}
        </p>
      ) : null}
      {nightFails ? (
        <div className="mt-2 rounded-[3px] border border-line-strong px-3 py-2 text-[13px] leading-snug" role="note" data-testid="night-advice">
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
        <p className="m-0 mt-2 rounded-[3px] border border-line-strong px-3 py-2 text-[13px] leading-snug text-ink-2" role="note" data-testid="day-advice">
          Add solar arrays or a nuclear generator to cover the daylight load{day.refill_kw > 0 ? ' and refill the storage' : ''}.
        </p>
      ) : null}
      {night.basis === 'power only' && !nightFails ? (
        <p className="m-0 mt-1 text-[13px] leading-snug text-ink-2">No site in the spotlight yet, so the night check compares power only. Battery storage counts once a site is picked.</p>
      ) : null}
      {open ? (
        <dl id={detailsId} className="m-0 mt-3 grid gap-2 text-[13px]" data-testid="power-details">
          <CheckLine label="Day check" needed={day.needed} notNeeded="nothing to check in daylight" margin={day.margin_percent} status={day.status}>
            {formatAmount(day.generation_kw, 'kW')} made, {formatAmount(day.load_kw, 'kW')} used
            {day.refill_kw > 0 ? `, ${formatAmount(day.refill_kw, 'kW')} refill` : ''}
          </CheckLine>
          <CheckLine
            label="Night check"
            needed={night.needed}
            notNeeded={night.basis === 'no darkness' ? 'no darkness during this stay' : 'nothing draws power at night'}
            margin={night.margin_percent}
            status={night.status}
          >
            {night.basis === 'energy'
              ? `${formatAmount(night.available_kwh, 'kWh')} available, ${formatAmount(night.load_kwh, 'kWh')} needed`
              : `${formatAmount(night.generation_kw, 'kW')} made, ${formatAmount(night.load_kw, 'kW')} used`}
          </CheckLine>
          {night.longest_darkness_h !== null ? (
            <div className="flex justify-between gap-3">
              <dt className="text-ink-2">Longest darkness in this stay</dt>
              <dd className="num m-0 text-ink">{formatAmount(night.longest_darkness_h, 'h')}</dd>
            </div>
          ) : null}
          <div className="flex justify-between gap-3">
            <dt className="text-ink-2">Battery storage</dt>
            <dd className="num m-0 text-right text-ink" data-testid="storage-counted" data-kwh={night.storage_kwh}>
              {night.storage_kwh > 0 ? `${formatAmount(night.storage_kwh, 'kWh')} typed` : 'none'}
              {needed !== null ? <span className="text-ink-2">, {formatAmount(needed, 'kWh')} needed</span> : null}
            </dd>
          </div>
          {typeof check.energy_added_kwh === 'number' ? (
            <div className="flex justify-between gap-3 border-t border-line pt-2">
              <dt className="text-ink-2">Energy over the stay</dt>
              <dd className="num m-0 text-ink">{formatKwh(check.energy_added_kwh)}</dd>
            </div>
          ) : null}
          {check.site_energy ? (
            <div className="flex justify-between gap-3 border-t border-line pt-2" data-testid="site-energy">
              <dt className="text-ink-2">Energy the darkness adds</dt>
              <dd className="num m-0 text-right text-ink">
                {formatKwh(check.site_energy.total_kwh)}
                <span className="text-ink-2">
                  {' '}
                  ({formatAmount(check.site_energy.dark_hours, 'h')} dark, {check.site_energy.nights} {check.site_energy.nights === 1 ? 'night' : 'nights'})
                </span>
              </dd>
            </div>
          ) : null}
          {check.power_notes.map((n) => (
            <p key={n} className="m-0 text-ink-2">
              {n}
            </p>
          ))}
        </dl>
      ) : null}
      <div className="mt-3 text-[13px] leading-snug" data-testid="fit-status" data-fits={check.fits === null ? 'unknown' : String(check.fits)}>
        <p className="m-0 break-words" data-tone={check.fits === true ? undefined : check.fits === false ? 'bad' : 'warn'}>
          {check.fits === true ? 'Hardware fits' : check.fits === false ? 'Does not fit' : 'Fit not known'}: {check.fit_verdict}.
        </p>
        {check.fit_notes.length > 0 ? (
          <ul className="m-0 mt-1 flex list-none flex-col gap-0.5 p-0 text-ink-2" data-testid="fit-notes">
            {check.fit_notes.map((n) => {
              const mine = pickedLabels.some((label) => n.includes(label));
              return (
                <li key={n} className={`break-words ${mine ? 'text-ink' : ''}`} data-picked={mine || undefined}>
                  {n}
                  {mine ? <span className="text-accent"> (your pick)</span> : null}
                </li>
              );
            })}
          </ul>
        ) : null}
      </div>
    </div>
  );
}

function dayDriver(day: DayCheck): string {
  const refill = day.refill_kw > 0 ? `, plus ${formatAmount(day.refill_kw, 'kW')} to refill storage` : '';
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
    <div className="flex flex-wrap items-baseline justify-between gap-x-3">
      <dt className="shrink-0 text-ink">{label}</dt>
      <dd className="num m-0 text-right text-ink-2">
        {needed ? (
          <>
            {children}: <span data-tone={TONE[level]}>{formatMargin(margin, level)}</span>
          </>
        ) : (
          notNeeded
        )}
      </dd>
    </div>
  );
}
