import { chromium } from 'playwright-extra';
import stealth from 'puppeteer-extra-plugin-stealth';
chromium.use(stealth());

(async () => {
  const browser = await chromium.launch({ headless: true, args: ['--no-sandbox'] });
  const context = await browser.newContext();
  const page = await context.newPage();
  
  const adUrl = 'https://www.olx.in/item/-iid-1852474690';
  await page.goto(adUrl, { waitUntil: 'domcontentloaded' });
  
  const title = await page.title();
  
  const price = await page.locator('[data-aut-id="itemPrice"]').textContent().catch(() => 'unknown');
  
  // try to get breadcrumbs
  const breadcrumbs = await page.$$eval('[data-aut-id="breadcrumb"] a', (els) => els.map(a => a.textContent));
  
  console.log("Title:", title);
  console.log("Price:", price);
  console.log("Breadcrumbs:", breadcrumbs.join(' > '));
  
  await browser.close();
})();
