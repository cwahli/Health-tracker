import { chromium } from 'playwright';

async function measure() {
  const browser = await chromium.launch({ headless: true });
  const context = await browser.newContext({ colorScheme: 'dark' }); // QA defaults to dark theme
  const page = await context.newPage();

  let requestCount = 0;
  const requests = [];

  page.on('request', (req) => {
    requestCount++;
    requests.push({ url: req.url(), method: req.method(), resourceType: req.resourceType() });
  });

  const startTime = Date.now();
  await page.goto('http://localhost:3000/', { waitUntil: 'domcontentloaded' });

  // Wait for login or main nav
  const demoBtn = page.locator('#demo-login-btn');
  const navTab = page.locator('#nav-tab-home');

  await Promise.race([
    demoBtn.waitFor({ state: 'visible', timeout: 15000 }).catch(() => {}),
    navTab.waitFor({ state: 'attached', timeout: 15000 }).catch(() => {})
  ]);

  if (await demoBtn.isVisible().catch(() => false)) {
    await demoBtn.click();
    await navTab.waitFor({ state: 'attached', timeout: 20000 });
  }

  // Home metrics
  await page.waitForLoadState('networkidle', { timeout: 10000 }).catch(() => {});
  const homeMetrics = await page.evaluate(() => {
    const nav = performance.getEntriesByType('navigation')[0];
    const paint = performance.getEntriesByType('paint');
    const fcp = paint.find((p) => p.name === 'first-contentful-paint');
    return {
      domContentLoaded: nav ? Math.round(nav.domContentLoadedEventEnd) : null,
      load: nav ? Math.round(nav.loadEventEnd) : null,
      fcp: fcp ? Math.round(fcp.startTime) : null,
      domInteractive: nav ? Math.round(nav.domInteractive) : null,
    };
  });

  const homeReqCount = requestCount;
  const homeDuration = Date.now() - startTime;

  console.log('HOME_METRICS:', JSON.stringify({ ...homeMetrics, homeReqCount, homeDuration }));

  // Switch to Health tab
  const healthStartReq = requestCount;
  const healthStartTime = Date.now();
  await page.locator('#nav-tab-health').click();
  await page.waitForTimeout(1000);
  await page.waitForLoadState('networkidle', { timeout: 10000 }).catch(() => {});
  const healthReqCount = requestCount - healthStartReq;
  const healthDuration = Date.now() - healthStartTime;

  console.log('HEALTH_METRICS:', JSON.stringify({ healthReqCount, healthDuration }));

  // Switch to Chat / quick action
  const chatStartReq = requestCount;
  const chatStartTime = Date.now();
  const quickActionBtn = page.locator('button[title="Open quick actions"], button.w-14.h-14').first();
  if (await quickActionBtn.isVisible({ timeout: 5000 }).catch(() => false)) {
    await quickActionBtn.click();
    const chatInput = page.getByPlaceholder(/message|eat|type|log/i).first();
    await chatInput.waitFor({ state: 'visible', timeout: 5000 }).catch(() => {});
  }
  const chatReqCount = requestCount - chatStartReq;
  const chatDuration = Date.now() - chatStartTime;

  console.log('CHAT_METRICS:', JSON.stringify({ chatReqCount, chatDuration }));

  await browser.close();
}

measure().catch(console.error);
