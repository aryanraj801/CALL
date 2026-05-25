const { chromium } = require('playwright');

(async () => {
  const browser = await chromium.launch();

  // Create multiple contexts (simulating different users/devices)
  const context1 = await browser.newContext();
  const context2 = await browser.newContext();

  const page1 = await context1.newPage();
  const page2 = await context2.newPage();

  console.log("Navigating User 1 to app...");
  await page1.goto('http://localhost:3000');
  console.log("User 1 title:", await page1.title());

  console.log("Navigating User 2 to app...");
  await page2.goto('http://localhost:3000');
  console.log("User 2 title:", await page2.title());

  console.log("Both users successfully accessed the app simultaneously without port conflicts.");

  await browser.close();
})();
