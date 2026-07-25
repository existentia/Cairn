// Capture the README screenshots from a Cairn instance seeded with the
// fictional demo data in seed_demo_data.py.
//
//   npm i playwright && npx playwright install chromium
//   node docs/demo/capture_screenshots.js docs/screenshots
//
// Point it somewhere else with CAIRN_URL / CAIRN_USER / CAIRN_PASS. Only ever
// run this against a throwaway instance — the output is published.
const { chromium } = require('playwright');
const path = require('path');

const OUT = process.argv[2] || '.';
const URL = process.env.CAIRN_URL || 'http://localhost:3000';
const USER = process.env.CAIRN_USER || 'demo';
const PASS = process.env.CAIRN_PASS || 'demo';

const SETTLE = 2200; // let recharts finish animating

async function shot(page, name, scrollY = 0) {
  await page.evaluate((y) => window.scrollTo(0, y), scrollY);
  // Park the cursor off the charts so recharts doesn't render a hover tooltip.
  await page.mouse.move(4, 4);
  await page.waitForTimeout(700);
  await page.screenshot({ path: path.join(OUT, name) });
  console.log('  ✓', name);
}

async function tab(page, label) {
  await page.getByRole('button', { name: label, exact: true }).first().click();
  await page.waitForTimeout(SETTLE);
}

(async () => {
  const browser = await chromium.launch();
  const ctx = await browser.newContext({
    viewport: { width: 1280, height: 820 },
    deviceScaleFactor: 2,
    colorScheme: 'dark',
  });
  const page = await ctx.newPage();

  await page.goto(URL, { waitUntil: 'networkidle' });
  await page.locator('input[type=text]').fill(USER);
  await page.locator('input[type=password]').fill(PASS);
  await page.getByRole('button', { name: 'Sign In' }).click();
  await page.waitForTimeout(4500); // dashboard load + toast auto-dismiss

  console.log('dark theme:');
  await shot(page, '01-overview.png');

  await tab(page, 'Accounts');
  await shot(page, '02-accounts.png');

  await tab(page, 'Advisor');
  await shot(page, '03-advisor.png');

  await tab(page, 'Projections');
  await shot(page, '04-projections.png', 355);

  await tab(page, 'Goals');
  await shot(page, '05-goals.png');

  await tab(page, 'Tools');
  await tab(page, 'Tax Year');
  await shot(page, '06-tax-year.png');

  await tab(page, 'Marginal Rate');
  await shot(page, '07-marginal-rate.png', 400);

  await tab(page, 'FIRE Calculator');
  await shot(page, '08-fire-calculator.png', 355);

  await tab(page, 'Salary Sacrifice');
  await shot(page, '09-salary-sacrifice.png', 355);

  // Light theme — persisted in localStorage, so set it and reload.
  console.log('light theme:');
  await page.evaluate(() => localStorage.setItem('cairn_theme', 'light'));
  await page.reload({ waitUntil: 'networkidle' });
  await page.waitForTimeout(SETTLE + 1200);
  await shot(page, '10-overview-light.png');

  await browser.close();
  console.log('done');
})();
