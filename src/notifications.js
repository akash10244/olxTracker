import { Resend } from 'resend';
import dotenv from 'dotenv';
dotenv.config();

const resend = new Resend(process.env.EMAIL_API_KEY);

export async function sendTelegramAlert(message, silent = false) {
  const token = process.env.TELEGRAM_BOT_TOKEN;
  const chatId = process.env.TELEGRAM_CHAT_ID;

  if (!token || !chatId) {
    console.warn("[Notifications] Telegram config missing, skipping alert.");
    return;
  }

  try {
    const response = await fetch(`https://api.telegram.org/bot${token}/sendMessage`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        chat_id: chatId,
        text: message,
        parse_mode: 'HTML',
        disable_notification: silent
      })
    });

    if (!response.ok) {
      console.error("[Notifications] Telegram API error:", await response.text());
    }
  } catch (err) {
    console.error("[Notifications] Failed to send Telegram alert:", err);
  }
}

export async function sendEmailDigest(subject, htmlBody) {
  if (!process.env.EMAIL_API_KEY || !process.env.TO_EMAIL) {
    console.warn("[Notifications] Email config missing (EMAIL_API_KEY or TO_EMAIL), skipping email.");
    return;
  }

  try {
    const { data, error } = await resend.emails.send({
      from: 'OLX Tracker <onboarding@resend.dev>',
      to: [process.env.TO_EMAIL],
      subject: subject,
      html: htmlBody,
    });

    if (error) {
      console.error("[Notifications] Resend API error:", error);
    }
  } catch (err) {
    console.error("[Notifications] Failed to send Email:", err);
  }
}

export function formatDealMessage(listing, aiResult) {
  let msg = `<b>${listing.title}</b>\n`;
  msg += `Price: ₹${listing.price}\n`;
  msg += `Tier: <b>${aiResult.deal_tier.toUpperCase()}</b>\n`;
  msg += `Reason: ${aiResult.deal_reason}\n\n`;
  
  if (aiResult.scam_risk !== 'low') {
    msg += `⚠️ Scam Risk: ${aiResult.scam_risk.toUpperCase()} (${(aiResult.scam_reasons || []).join(', ')})\n`;
  }
  if (aiResult.description_quality === 'lazy') {
    msg += `<i>Note: Description is lazy/thin. Specs might be inaccurate.</i>\n`;
  }

  msg += `<a href="${listing.url}">View Listing</a>`;
  return msg;
}

export function formatEmailItem(listing, aiResult) {
  return `
    <div style="margin-bottom: 20px; border-bottom: 1px solid #eee; padding-bottom: 10px;">
      <h3><a href="${listing.url}">${listing.title}</a></h3>
      <p><strong>Price:</strong> ₹${listing.price}</p>
      <p><strong>Tier:</strong> ${aiResult.deal_tier.toUpperCase()}</p>
      <p><strong>Reason:</strong> ${aiResult.deal_reason}</p>
      ${aiResult.scam_risk !== 'low' ? `<p style="color: red;"><strong>⚠️ Scam Risk:</strong> ${aiResult.scam_risk} - ${(aiResult.scam_reasons || []).join(', ')}</p>` : ''}
      ${aiResult.description_quality === 'lazy' ? `<p><i>Note: Description is lazy/thin. Specs might be inaccurate.</i></p>` : ''}
    </div>
  `;
}
