import { chromium } from 'playwright';

const BASE = 'http://127.0.0.1:8765/russia-map-test.html';
const runs = 10;
let passed = 0;
const errors = [];

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

async function runOnce(page, i) {
  await page.goto(BASE, { waitUntil: 'networkidle' });

  const widget = page.locator('#russia-map-widget');
  await widget.waitFor({ state: 'visible' });

  const paths = await page.locator('#russia-map-widget .rmw-land').count();
  assert(paths >= 10, `Run ${i}: expected Russia paths, got ${paths}`);

  const cities = ['moscow', 'spb'];
  for (const cityId of cities) {
    const city = page.locator(`#russia-map-widget .rmw-city[data-city-id="${cityId}"]`);
    await city.hover({ force: true });
    await page.waitForTimeout(150);

    const labelVisible = await page.locator('#russia-map-widget .rmw-label.is-visible').isVisible();
    assert(labelVisible, `Run ${i}: label not visible for ${cityId}`);

    const labelText = await page.locator('#russia-map-widget .rmw-label').textContent();
    assert(labelText && labelText.includes('нажмите'), `Run ${i}: bad label for ${cityId}: ${labelText}`);

    await city.click({ force: true });
    await page.waitForTimeout(250);

    const modalOpen = await page.locator('#russia-map-widget .rmw-modal.is-open').isVisible();
    assert(modalOpen, `Run ${i}: modal not open for ${cityId}`);

    const iframeCount = await page.locator('#russia-map-widget #rmw-video-container iframe').count();
    assert(iframeCount === 1, `Run ${i}: iframe missing for ${cityId}`);

    const title = await page.locator('#rmw-modal-title').textContent();
    assert(title && title.length > 1, `Run ${i}: empty modal title for ${cityId}`);

    await page.locator('#rmw-close-btn').click();
    await page.waitForTimeout(150);

    const modalClosed = await page.locator('#russia-map-widget .rmw-modal.is-open').count();
    assert(modalClosed === 0, `Run ${i}: modal did not close for ${cityId}`);

    const videoCleared = await page.locator('#russia-map-widget #rmw-video-container iframe').count();
    assert(videoCleared === 0, `Run ${i}: video not cleared for ${cityId}`);
  }
}

const browser = await chromium.launch({ headless: true });
const page = await browser.newPage({ viewport: { width: 1280, height: 900 } });

for (let i = 1; i <= runs; i++) {
  try {
    await runOnce(page, i);
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
