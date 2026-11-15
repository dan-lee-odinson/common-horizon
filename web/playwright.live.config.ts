import { defineConfig, devices } from '@playwright/test';
import base from './playwright.config';

// `npm run test:e2e:live`: the main path against a LIVE backend. It builds the website with
// VITE_API_BASE set (into dist-live/), serves it at port 4174 and runs e2e/main-path.spec.ts.
// Start the backend first, allowing this origin, for example from backend/:
//   CH_CORS_EXTRA_ORIGINS=http://localhost:4174 uvicorn app.main:app --port 8000
// Another backend address: CH_E2E_API_BASE=https://... npm run test:e2e:live
const PORT = 4174;
const API_BASE = process.env.CH_E2E_API_BASE ?? 'http://localhost:8000';

export default defineConfig({
  ...base,
  testMatch: 'main-path.spec.ts',
  use: { ...base.use, baseURL: `http://localhost:${PORT}` },
  webServer: {
    command: `npx vite build --outDir dist-live --emptyOutDir && npx vite preview --outDir dist-live --port ${PORT} --strictPort`,
    env: { VITE_API_BASE: API_BASE },
    url: `http://localhost:${PORT}`,
    reuseExistingServer: false,
    timeout: 180_000,
  },
  projects: [
    {
      name: 'live-desktop',
      use: { ...devices['Desktop Chrome'], viewport: { width: 1440, height: 900 } },
      metadata: { mode: 'live', apiBase: API_BASE },
    },
  ],
});
