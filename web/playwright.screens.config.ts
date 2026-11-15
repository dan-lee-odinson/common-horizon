import { defineConfig } from '@playwright/test';
import base from './playwright.config';

// `npm run screens`: takes the README pictures at 1440 x 900 and 390 x 844.
export default defineConfig({
  ...base,
  testMatch: 'screens.capture.ts',
  timeout: 180_000,
  projects: (base.projects ?? []).map((p) => ({ ...p, name: p.name === 'desktop' ? '1440x900' : '390x844' })),
});
