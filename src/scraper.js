import { chromium } from 'playwright-extra';
import stealth from 'puppeteer-extra-plugin-stealth';
chromium.use(stealth());

export async function scrapeSearch(config, searchDef) {
  const browser = await chromium.launch({ 
    headless: true,
    args: ['--no-sandbox']
  });
  const context = await browser.newContext({
    userAgent: 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36'
  });
  const page = await context.newPage();

  let url = `https://www.olx.in/${searchDef.location_slug}/q-${searchDef.search_term}?isSearchCall=true`;
  if (searchDef.price_min != null) {
    url += `&search[filter_float_price:from]=${searchDef.price_min}`;
  }
  if (searchDef.price_max != null) {
    url += `&search[filter_float_price:to]=${searchDef.price_max}`;
  }

  console.log(`[Scraper] Navigating to: ${url}`);
  
  try {
    await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 30000 });
    
    // Attempt to click "Load more"
    let clicks = 0;
    while (clicks < (config.max_load_more_clicks || 10)) {
      try {
        const loadMoreBtn = page.locator('button:has-text("load more") i, button[data-aut-id="btnLoadMore"]');
        if (await loadMoreBtn.count() > 0 && await loadMoreBtn.first().isVisible()) {
          console.log(`[Scraper] Clicking Load More (${clicks + 1})`);
          await loadMoreBtn.first().click();
          await page.waitForTimeout(2000); // Wait for items to append
          clicks++;
        } else {
          break;
        }
      } catch (e) {
        break; // Button might be gone or unclickable
      }
    }

    // Extract listings. OLX listings are usually within li[data-aut-id="itemBox"]
    // We'll use a robust approach looking for links containing '-iid-'
    const itemLinks = await page.locator('a[href*="-iid-"]').elementHandles();
    const results = [];

    for (const link of itemLinks) {
      try {
        const href = await link.getAttribute('href');
        if (!href) continue;

        const ad_id_match = href.match(/-iid-(\d+)/);
        if (!ad_id_match) continue;

        const ad_id = ad_id_match[1];
        const fullUrl = `https://www.olx.in${href.split('?')[0]}`; // clean URL

        // Try to get title, price, location from within this element or its parent
        const textContent = await link.textContent();
        // Fallback title is usually in the URL
        const titleFallback = href.split('/').pop().replace(/-iid-\d+/, '').replace(/-/g, ' ');
        
        let priceStr = null;
        const priceEl = await link.$('span[data-aut-id="itemPrice"]');
        if (priceEl) {
          priceStr = await priceEl.textContent();
        } else {
          // generic fallback: find ₹ symbol
          const matches = textContent.match(/₹[\s\d,]+/);
          if (matches) priceStr = matches[0];
        }

        let price = null;
        if (priceStr) {
          price = parseInt(priceStr.replace(/[^\d]/g, ''), 10);
        }

        // Hard-enforce the config price constraints (sometimes OLX injects promoted ads that bypass the URL filters)
        if (price !== null) {
          if (searchDef.price_min != null && price < searchDef.price_min) continue;
          if (searchDef.price_max != null && price > searchDef.price_max) continue;
        } else if (searchDef.price_min != null || searchDef.price_max != null) {
          continue; // Skip items with completely missing prices if a strict constraint is set
        }

        const titleEl = await link.$('span[data-aut-id="itemTitle"]');
        const title = titleEl ? await titleEl.textContent() : titleFallback;

        const locationEl = await link.$('span[data-aut-id="itemDetails"]'); // just a guess
        const location = locationEl ? await locationEl.textContent() : searchDef.location_slug;

        results.push({
          ad_id,
          url: fullUrl,
          title: title.trim(),
          price: price,
          location: location ? location.trim() : null
        });
      } catch (e) {
        console.warn(`[Scraper] Failed to extract an item: ${e.message}`);
      }
    }

    // Deduplicate by ad_id
    const uniqueResults = [];
    const seenIds = new Set();
    for (const r of results) {
      if (!seenIds.has(r.ad_id)) {
        seenIds.add(r.ad_id);
        uniqueResults.push(r);
      }
    }

    console.log(`[Scraper] Found ${uniqueResults.length} unique listings for ${searchDef.name}`);
    return uniqueResults;
  } catch (err) {
    console.error(`[Scraper] Error scraping ${searchDef.name}:`, err);
    return [];
  } finally {
    await browser.close();
  }
}

export async function fetchFullDescription(url) {
  const browser = await chromium.launch({ 
    headless: true,
    args: ['--no-sandbox']
  });
  const context = await browser.newContext({
    userAgent: 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36'
  });
  const page = await context.newPage();

  console.log(`[Scraper] Fetching full ad page: ${url}`);
  try {
    await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 30000 });
    
    // Typically the description is in a div with data-aut-id="itemDescriptionContent"
    const descLocator = page.locator('[data-aut-id="itemDescriptionContent"]');
    if (await descLocator.count() > 0) {
      return await descLocator.first().textContent();
    }

    // Fallback: look for generic description containers
    const fallbackDesc = page.locator('.description, .item-description');
    if (await fallbackDesc.count() > 0) {
      return await fallbackDesc.first().textContent();
    }
    
    console.warn(`[Scraper] Could not find description specific selector for ${url}`);
    return "";
  } catch (err) {
    console.error(`[Scraper] Error fetching description for ${url}:`, err);
    return null;
  } finally {
    await browser.close();
  }
}
