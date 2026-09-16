import { sendEmailDigest } from './src/notifications.js';

console.log("Testing Email API...");
sendEmailDigest("OLX Tracker: API Test Successful!", "<p>Your Resend API key is working perfectly.</p>")
  .then(() => console.log("Test email sent!"))
  .catch(err => console.error("Error sending test email:", err));
