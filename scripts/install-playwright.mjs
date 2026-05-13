import { execFileSync } from 'node:child_process';
import { createRequire } from 'node:module';

if (process.env.VERCEL) {
  console.log('Skipping Playwright browser download on Vercel; @sparticuz/chromium is bundled for serverless capture.');
  process.exit(0);
}

const require = createRequire(import.meta.url);
const playwrightCli = require.resolve('playwright/cli');

execFileSync(process.execPath, [playwrightCli, 'install', 'chromium'], {
  stdio: 'inherit',
  env: {
    ...process.env,
    PLAYWRIGHT_BROWSERS_PATH: '0',
  },
});
