import { chromium } from 'playwright-extra';
import stealth from 'puppeteer-extra-plugin-stealth';
chromium.use(stealth());

(async () => {
  const browser = await chromium.launch({ headless: true, args: ['--no-sandbox'] });
  const context = await browser.newContext();
  const page = await context.newPage();
  
  const url = 'https://www.olx.in/bengaluru_g4058803/computers-laptops_c1505/q-gaming-pc?isSearchCall=true&search[filter_float_price:from]=45000&search[filter_float_price:to]=120000';
  await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 30000 });
  
  let clicks = 0;
  while (clicks < 10) {
    try {
      const loadMoreBtn = page.locator('button:has-text("load more") i, button[data-aut-id="btnLoadMore"]');
      if (await loadMoreBtn.count() > 0 && await loadMoreBtn.first().isVisible()) {
        await loadMoreBtn.first().click();
        await page.waitForTimeout(2000);
        clicks++;
      } else {
        break;
      }
    } catch(e) { break; }
  }
  
  const links = await page.$$eval('a[href*="-iid-"]', (els) => els.map(a => a.href));
  const text = links.join('\n');
  if (text.includes('1852474690')) {
    console.log("Found 1852474690 in search results!");
  } else {
    console.log("NOT found in search results.");
  }
  
  // also try hitting the ad directly
  const adUrl = 'https://www.olx.in/item/-iid-1852474690';
  const resp = await page.goto(adUrl);
  console.log("Direct ad status:", resp.status());
  
  await browser.close();
})();
