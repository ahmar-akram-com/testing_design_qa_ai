import { execFileSync } from 'node:child_process';

if (process.env.VERCEL) {
  console.log('Skipping Playwright browser download on Vercel; @sparticuz/chromium is bundled for serverless capture.');
  process.exit(0);
}

const npx = process.platform === 'win32' ? 'npx.cmd' : 'npx';

execFileSync(npx, ['playwright', 'install', 'chromium'], {
  stdio: 'inherit',
  env: {
    ...process.env,
    PLAYWRIGHT_BROWSERS_PATH: '0',
  },
});
