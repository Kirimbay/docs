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

  const cityLabels = await page.locator('#russia-map-widget .rmw-city-name').count();
  assert(cityLabels === 8, `Desktop ${i}: expected 8 city labels, got ${cityLabels}`);

  const pulseRings = await page.locator('#russia-map-widget .rmw-city-pulse').count();
  assert(pulseRings === 0, `Desktop ${i}: pulse rings should be removed`);

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

async function openMoscowMobile(page) {
  const moscow = page.locator('#russia-map-widget .rmw-city[data-city-id="moscow"]');
  const box = await moscow.boundingBox();
  assert(box, 'Moscow marker not found');
  await page.touchscreen.tap(box.x + box.width / 2, box.y + box.height / 2);
  await page.waitForTimeout(450);
}

async function assertMobileModalFit(page, label) {
  const modalOpen = await page.locator('#russia-map-widget .rmw-modal.is-open').isVisible();
  assert(modalOpen, `${label}: Moscow modal should open on tap`);

  const metrics = await page.evaluate(() => {
    const frame = document.querySelector('#russia-map-widget .rmw-modal-frame');
    const wrap = document.querySelector('#russia-map-widget .rmw-video-wrap');
    const head = document.querySelector('#russia-map-widget .rmw-modal-head');
    if (!frame || !wrap || !head) return null;
    const frameRect = frame.getBoundingClientRect();
    const wrapRect = wrap.getBoundingClientRect();
    const wrapStyle = getComputedStyle(wrap);
    return {
      vw: window.innerWidth,
      vh: window.innerHeight,
      frameW: frameRect.width,
      wrapW: wrapRect.width,
      wrapH: wrapRect.height,
      wrapPad: parseFloat(wrapStyle.paddingLeft) || 0,
      wrapBottom: wrapRect.bottom,
      headH: head.getBoundingClientRect().height
    };
  });

  assert(metrics, `${label}: modal elements missing`);
  assert(metrics.frameW >= metrics.vw * 0.98, `${label}: frame should be full width, got ${metrics.frameW}/${metrics.vw}`);
  assert(metrics.wrapBottom <= metrics.vh + 2, `${label}: video overflows viewport, bottom=${metrics.wrapBottom}, vh=${metrics.vh}`);
  assert(metrics.wrapPad >= 3, `${label}: video border missing, padding=${metrics.wrapPad}`);

  const ar = metrics.wrapW / metrics.wrapH;
  assert(ar > 1.5 && ar < 1.9, `${label}: bad aspect ratio ${ar.toFixed(2)}`);

  const usesMaxWidth = metrics.wrapW >= metrics.vw * 0.88;
  const usesMaxHeight = metrics.wrapH >= (metrics.vh - metrics.headH - 24) * 0.88;
  assert(usesMaxWidth || usesMaxHeight, `${label}: video should use max available space ${metrics.wrapW}x${metrics.wrapH} in ${metrics.vw}x${metrics.vh}`);

  await page.locator('#rmw-close-btn').tap();
  await page.waitForTimeout(150);
  assert(await page.locator('#russia-map-widget .rmw-modal.is-open').count() === 0, `${label}: modal should close`);
}

async function testMobilePortrait(page, i) {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto(BASE, { waitUntil: 'domcontentloaded' });
  await page.waitForTimeout(500);
  await openMoscowMobile(page);
  await assertMobileModalFit(page, `Mobile portrait ${i}`);
}

async function testMobileLandscape(page, i) {
  await page.setViewportSize({ width: 844, height: 390 });
  await page.goto(BASE, { waitUntil: 'domcontentloaded' });
  await page.waitForTimeout(500);
  await openMoscowMobile(page);
  await assertMobileModalFit(page, `Mobile landscape ${i}`);
}

const browser = await chromium.launch({ headless: true });
const desktopPage = await browser.newPage({ viewport: { width: 1280, height: 900 } });
const mobilePage = await browser.newPage({ ...devices['iPhone 13'] });

for (let i = 1; i <= runs; i++) {
  try {
    await testDesktop(desktopPage, i);
    await testMobilePortrait(mobilePage, i);
    await testMobileLandscape(mobilePage, i);
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
