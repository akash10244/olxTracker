import fs from 'fs';
import path from 'path';
import crypto from 'crypto';
import { scrapeSearch, fetchFullDescription } from './scraper.js';
import { evaluateListing } from './ai.js';
import { sendTelegramAlert, sendEmailDigest, formatDealMessage, formatEmailItem } from './notifications.js';

const CONFIG_PATH = path.resolve('config.json');
const DATA_PATH = path.resolve('data.json');

const delay = ms => new Promise(resolve => setTimeout(resolve, ms));

function hashText(text) {
  if (!text) return null;
  return crypto.createHash('sha256').update(text).digest('hex');
}

const TIER_RANKS = { 'bad': 0, 'okay': 1, 'good': 2, 'steal': 3 };

async function main() {
  console.log(`[Main] Starting OLX Tracker Run at ${new Date().toISOString()}`);

  let config;
  try {
    config = JSON.parse(fs.readFileSync(CONFIG_PATH, 'utf-8'));
  } catch (err) {
    console.error(`[Main] ::error:: Failed to read config.json: ${err.message}`);
    await sendTelegramAlert("❌ <b>OLX Tracker Run Failed</b>\nFailed to read config.json.");
    process.exit(1);
  }

  let db = {};
  if (fs.existsSync(DATA_PATH)) {
    try {
      db = JSON.parse(fs.readFileSync(DATA_PATH, 'utf-8'));
    } catch (err) {
      console.warn(`[Main] ::warning:: Failed to read data.json, starting fresh: ${err.message}`);
    }
  }

  let runFailed = false;
  const currentRunTime = new Date().toISOString();

  for (const searchDef of config.searches || []) {
    console.log(`[Main] Processing search: ${searchDef.name}`);
    
    let activeListingsContext = [];
    for (const id in db) {
      if (db[id].active && db[id].deal_tier !== 'bad') {
        activeListingsContext.push(db[id]);
      }
    }
    
    // Scrape search page
    let scrapedItems = [];
    try {
      scrapedItems = await scrapeSearch(config, searchDef);
    } catch (err) {
      console.error(`[Main] ::error:: Scraper failed for ${searchDef.name}:`, err);
      runFailed = true;
      continue;
    }

    if (scrapedItems.length === 0) {
      console.warn(`[Main] ::warning:: No listings found for ${searchDef.name}. Check selectors or if blocked.`);
    }

    const seenThisRun = new Set();
    let currentItemIndex = 0;

    for (const item of scrapedItems) {
      currentItemIndex++;
      seenThisRun.add(item.ad_id);
      
      let existing = db[item.ad_id];
      let needsAi = false;
      let fullDesc = null;
      let newDescHash = null;
      let priceChanged = false;

      if (!existing) {
        console.log(`[Main] New listing found: ${item.ad_id} - ${item.title}`);
        needsAi = true;
        existing = {
          ad_id: item.ad_id,
          url: item.url,
          first_seen_at: currentRunTime,
          price_history: [],
          active: true,
          missed_runs: 0
        };
        db[item.ad_id] = existing;
      } else {
        existing.active = true;
        existing.missed_runs = 0;
        if (!existing.deal_tier) {
          needsAi = true; // Retry if AI failed previously
        }
      }

      existing.last_seen_at = currentRunTime;
      existing.title = item.title;

      // Price check
      const currentPrice = item.price;
      const lastPriceObj = existing.price_history.length > 0 ? existing.price_history[existing.price_history.length - 1] : null;
      
      if (!lastPriceObj || lastPriceObj.price !== currentPrice) {
        existing.price_history.push({ timestamp: currentRunTime, price: currentPrice });
        priceChanged = true;
        if (lastPriceObj) needsAi = true; // only trigger AI on price change if it's not a brand new listing (where it's already true)
      }

      // We only fetch description if it's new or if price changed, 
      // or we periodically want to check for desc changes (let's check always for now to see if hash changed, wait, fetching every time is slow)
      // PRD says: "In data.json, price unchanged AND description_hash unchanged → skip. No fetch of the full ad page"
      // Wait, how do we know if description_hash changed without fetching? We don't.
      // Correction: If the search card provides a snippet, we'd hash that. But OLX search cards barely have snippets.
      // So if price is unchanged, we just skip fetching. If they changed description without price, we might miss it, 
      // but that's a rare and acceptable tradeoff to avoid fetching 50 pages every 2 hours.
      // Let's stick to: if it's new or price changed -> fetch full ad page and run AI.
      
      if (needsAi) {
        fullDesc = await fetchFullDescription(item.url);
        newDescHash = hashText(fullDesc);
        
        // If it's an existing listing and price changed but description is exactly the same, we still run AI because price changed.
        existing.description_hash = newDescHash;
        
        console.log(`[Main] Running AI for ${item.ad_id} (${currentItemIndex}/${scrapedItems.length})`);
        const aiResult = await evaluateListing(item, fullDesc, activeListingsContext, searchDef.constraints);
        
        if (aiResult) {
          existing.extracted_specs = aiResult.extracted_specs;
          existing.deal_tier = aiResult.deal_tier;
          existing.scam_risk = aiResult.scam_risk;
          existing.description_quality = aiResult.description_quality;
          existing.short_summary = aiResult.short_summary;
          existing.detailed_summary = aiResult.detailed_summary;
          
          console.log(`[AI Thoughts] ${aiResult.short_summary}`);
          
          // Notification logic
          const newRank = TIER_RANKS[aiResult.deal_tier] || 0;
          const lastRank = existing.last_notified_tier ? TIER_RANKS[existing.last_notified_tier] : -1;
          const lastNotifiedPrice = existing.last_notified_price || Infinity;
          
          let shouldNotify = false;
          let isFollowUp = false;
          
          if (newRank > lastRank) {
            shouldNotify = true;
          } else if (newRank === lastRank && newRank > 0) { // Same tier (and not bad)
            const threshold = (config.discount_threshold_percent || 8) / 100;
            if (currentPrice <= lastNotifiedPrice * (1 - threshold)) {
              shouldNotify = true;
              isFollowUp = true;
            }
          }

          if (shouldNotify && (aiResult.deal_tier === 'steal' || aiResult.deal_tier === 'good' || aiResult.deal_tier === 'okay')) {
            console.log(`[Main] Notification triggered for ${item.ad_id} at tier ${aiResult.deal_tier}`);
            const msg = formatDealMessage(item, aiResult) + (isFollowUp ? "\n<i>(Price dropped further)</i>" : "");
            
            if (aiResult.deal_tier === 'steal') {
              // Immediate Telegram
              await sendTelegramAlert("🚨 <b>STEAL DEAL ALERT</b> 🚨\n\n" + msg);
            } else {
              // Immediate Email for good/okay deals
              const singleHtml = formatEmailItem(item, aiResult);
              await sendEmailDigest(`OLX Tracker: New ${aiResult.deal_tier} deal!`, singleHtml);
            }
            
            existing.last_notified_tier = aiResult.deal_tier;
            existing.last_notified_price = currentPrice;
          }
          
          // Save database immediately so we don't lose progress if script crashes or is killed
          fs.writeFileSync(DATA_PATH, JSON.stringify(db, null, 2), 'utf-8');
        }
        
        // Wait 4 seconds to respect Gemini Flash Lite's 15 RPM free tier limit
        console.log(`[Main] Sleeping 4 seconds to respect AI rate limits...`);
        await delay(4000);
      }
    }

    // Check for missed listings
    for (const id in db) {
      if (db[id].active && !seenThisRun.has(id)) {
        db[id].missed_runs = (db[id].missed_runs || 0) + 1;
        if (db[id].missed_runs >= 2) {
          console.log(`[Main] Marking ${id} as inactive (missed 2 runs).`);
          db[id].active = false;
        }
      }
    }
  }

  // Save data
  try {
    fs.writeFileSync(DATA_PATH, JSON.stringify(db, null, 2), 'utf-8');
    console.log(`[Main] Saved data.json`);
  } catch (err) {
    console.error(`[Main] ::error:: Failed to save data.json:`, err);
    runFailed = true;
  }

  if (runFailed) {
    await sendTelegramAlert("⚠️ <b>OLX Tracker Notice</b>\nRun completed with some errors. Check GitHub Actions logs.");
    process.exit(1);
  }
}

main().catch(err => {
  console.error("[Main] ::error:: Unhandled Exception:", err);
  sendTelegramAlert("❌ <b>OLX Tracker Fatal Error</b>\n" + err.message).then(() => process.exit(1));
});

process.on('unhandledRejection', (reason, promise) => {
  console.warn('[Main] Unhandled Rejection at:', promise, 'reason:', reason);
});
