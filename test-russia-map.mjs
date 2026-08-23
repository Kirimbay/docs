import { chromium, devices } from 'playwright';

const BASE = 'http://127.0.0.1:8765/russia-map-embed.html';
const runs = 5;
let passed = 0;
const errors = [];

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

async function testDesktop(page, i) {
  await page.goto(BASE, { waitUntil: 'domcontentloaded' });
  await page.waitForTimeout(500);

  const moscow = page.locator('#russia-map-widget .rmw-city[data-city-id="moscow"]');
  await moscow.hover({ force: true });
  await page.waitForTimeout(250);

  const hoverModal = await page.locator('#russia-map-widget .rmw-modal.is-open').count();
  assert(hoverModal === 0, `Desktop ${i}: Moscow modal must not open on hover`);

  await moscow.click({ force: true });
  await page.waitForTimeout(300);

  const modalOpen = await page.locator('#russia-map-widget .rmw-modal.is-open').isVisible();
  assert(modalOpen, `Desktop ${i}: Moscow modal should open on click`);

  const panelWidth = await page.locator('#russia-map-widget .rmw-modal-panel').evaluate((el) => el.getBoundingClientRect().width);
  assert(panelWidth >= 900, `Desktop ${i}: modal should be large, got ${panelWidth}px`);

  const videoSrc = await page.locator('#russia-map-widget #rmw-video-container video').getAttribute('src');
  assert(videoSrc && videoSrc.includes('.mp4'), `Desktop ${i}: expected MP4 video`);

  await page.locator('#rmw-close-btn').click();
  await page.waitForTimeout(150);
  assert(await page.locator('#russia-map-widget .rmw-modal.is-open').count() === 0, `Desktop ${i}: modal should close`);
}

async function testMobile(page, i) {
  await page.goto(BASE, { waitUntil: 'domcontentloaded' });
  await page.waitForTimeout(500);

  const moscow = page.locator('#russia-map-widget .rmw-city[data-city-id="moscow"]');
  const box = await moscow.boundingBox();
  assert(box, `Mobile ${i}: Moscow marker not found`);

  await page.touchscreen.tap(box.x + box.width / 2, box.y + box.height / 2);
  await page.waitForTimeout(400);

  const modalOpen = await page.locator('#russia-map-widget .rmw-modal.is-open').isVisible();
  assert(modalOpen, `Mobile ${i}: Moscow modal should open on tap`);

  const panelWidth = await page.locator('#russia-map-widget .rmw-modal-panel').evaluate((el) => el.getBoundingClientRect().width);
  const viewport = page.viewportSize();
  assert(panelWidth >= viewport.width * 0.98, `Mobile ${i}: modal should be full width, got ${panelWidth}/${viewport.width}`);

  const closeBox = await page.locator('#rmw-close-btn').boundingBox();
  assert(Math.round(closeBox.width) >= 44 && Math.round(closeBox.height) >= 44, `Mobile ${i}: close button too small`);

  await page.locator('#rmw-close-btn').tap();
  await page.waitForTimeout(150);
  assert(await page.locator('#russia-map-widget .rmw-modal.is-open').count() === 0, `Mobile ${i}: modal should close on tap`);
}

const browser = await chromium.launch({ headless: true });
const desktopPage = await browser.newPage({ viewport: { width: 1280, height: 900 } });
const iphone = devices['iPhone 13'];
const mobilePage = await browser.newPage({ ...iphone });

for (let i = 1; i <= runs; i++) {
  try {
    await testDesktop(desktopPage, i);
    await testMobile(mobilePage, i);
    passed++;
    console.log(`PASS run ${i}/${runs}`);
  } catch (err) {
    errors.push(String(err.message || err));
    console.error(`FAIL run ${i}/${runs}:`, err.message || err);
  }
}

await browser.close();

console.log('\nSummary:', passed, '/', runs, 'passed');
if (errors.length) {
  console.error('Errors:\n- ' + errors.join('\n- '));
  process.exit(1);
}
