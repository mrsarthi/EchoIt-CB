const { chromium } = require('playwright');
(async () => {
  const browser = await chromium.launch({ channel: 'msedge', headless: true });
  const context = await browser.newContext({ viewport: { width: 1280, height: 800 } });
  const page = await context.newPage();
  
  await page.goto('http://localhost:5173');
  await page.waitForTimeout(2000);
  
  await page.screenshot({ path: 'screenshot1.png' });
  console.log('Screenshot saved to screenshot1.png');
  await browser.close();
})();
