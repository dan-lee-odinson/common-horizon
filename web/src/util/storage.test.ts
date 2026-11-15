import { describe, expect, it } from 'vitest';
import { MAX_STORAGE_KWH, readStorageEntry } from './storage';

describe('battery storage entry', () => {
  it('reads a plain figure', () => {
    expect(readStorageEntry('600')).toMatchObject({ kwh: 600, status: 'ok', display: '600' });
    expect(readStorageEntry(' 1,500.5 ')).toMatchObject({ kwh: 1500.5, status: 'ok' });
  });

  it('treats an empty box and zero as none', () => {
    expect(readStorageEntry('')).toMatchObject({ kwh: 0, status: 'empty' });
    expect(readStorageEntry('   ')).toMatchObject({ kwh: 0, status: 'empty' });
    expect(readStorageEntry('0')).toMatchObject({ kwh: 0, status: 'empty' });
  });

  it('counts a bad entry as none and says so, so the box and the checks agree', () => {
    for (const bad of ['-5', 'abc', '12abc', '--', '1e', '.']) {
      const e = readStorageEntry(bad);
      expect(e.kwh).toBe(0);
      expect(e.status).toBe('invalid');
      expect(e.note).toContain('counts as 0 kWh');
    }
  });

  it('reads thousands commas, a leading plus and the exponent form as the plain figure', () => {
    expect(readStorageEntry('1,500')).toMatchObject({ kwh: 1500, status: 'ok', display: '1500' });
    expect(readStorageEntry('12,345.5')).toMatchObject({ kwh: 12345.5, status: 'ok', display: '12345.5' });
    expect(readStorageEntry('1,000,000')).toMatchObject({ kwh: 1_000_000, status: 'ok' });
    expect(readStorageEntry('+600')).toMatchObject({ kwh: 600, status: 'ok' });
    expect(readStorageEntry('+1,500')).toMatchObject({ kwh: 1500, status: 'ok' });
    expect(readStorageEntry('1e3')).toMatchObject({ kwh: 1000, status: 'ok' });
    expect(readStorageEntry('2.5E2')).toMatchObject({ kwh: 250, status: 'ok' });
    expect(readStorageEntry('.5')).toMatchObject({ kwh: 0.5, status: 'ok' });
    expect(readStorageEntry('5.')).toMatchObject({ kwh: 5, status: 'ok' });
  });

  it('does not read a misplaced comma as a bigger number', () => {
    // "5,5" used to lose its comma and count as 55 kWh.
    for (const bad of ['5,5', '1,5', ',', ',5', '5,', '1,50', '1,5000', '12,34.5', '1,,500', '1,500e3', '1234,567', '1.5,000']) {
      const e = readStorageEntry(bad);
      expect(e.kwh, bad).toBe(0);
      expect(e.status, bad).toBe('invalid');
      expect(e.note, bad).toContain('counts as 0 kWh');
      expect(e.display, bad).toBe(bad);
    }
  });

  it('reads only plain decimal figures, not the other ways JavaScript spells a number', () => {
    for (const bad of ['0x10', '0X1F', '0b11', '0b101', '0o17', 'Infinity', '+Infinity', 'NaN', '1_000', '1 500', '１２', '−5', '+', '-', '+-5', '1e5.5', 'e3']) {
      const e = readStorageEntry(bad);
      expect(e.kwh, bad).toBe(0);
      expect(e.status, bad).toBe('invalid');
      expect(e.note, bad).toContain('counts as 0 kWh');
    }
  });

  it('settles zero as a plain zero however it is typed, never a negative zero', () => {
    for (const zero of ['0', '+0', '-0', '0.00', '-0.0', '-.0', '-00', '-0e5', '1e-400', '-1e-400']) {
      const e = readStorageEntry(zero);
      expect(Object.is(e.kwh, 0), zero).toBe(true);
      expect(e.status, zero).toBe('empty');
      expect(e.note, zero).toBe('Empty or 0 means none.');
    }
    // The minus sign does not stay in the box's settled text.
    expect(readStorageEntry('-0').display).toBe('0');
    // No entry at all, good or bad, gives a negative zero or a negative amount.
    for (const any of ['', ' ', '-0', '-5', '-1e-400', 'abc', '0x0', '5,5', '-0,000', '7', '1e400']) {
      const e = readStorageEntry(any);
      expect(Object.is(e.kwh, -0), any).toBe(false);
      expect(e.kwh, any).toBeGreaterThanOrEqual(0);
    }
  });

  it('caps a figure above the limit, shows the cap in the box and says so', () => {
    const e = readStorageEntry('5000000');
    expect(e.kwh).toBe(MAX_STORAGE_KWH);
    expect(e.status).toBe('capped');
    expect(e.display).toBe('1000000');
    expect(e.note).toBe('Capped at 1,000,000 kWh, the most this planner accepts.');
    expect(readStorageEntry('1e400').status).toBe('capped');
    expect(readStorageEntry(String(MAX_STORAGE_KWH)).status).toBe('ok');
  });
});
