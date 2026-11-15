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
