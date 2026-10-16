import puppeteer from 'puppeteer-core'

const browser = await puppeteer.launch({
  executablePath: '/usr/local/bin/google-chrome',
  headless: true,
  args: ['--no-sandbox', '--disable-dev-shm-usage'],
})
const page = await browser.newPage()
const errors = []
page.on('pageerror', (err) => errors.push(String(err)))
page.on('console', (msg) => {
  if (msg.type() === 'error') errors.push(msg.text())
})

async function shot(name) {
  await page.screenshot({ path: `/tmp/${name}.png`, fullPage: true })
}

await page.setViewport({ width: 1280, height: 800 })
await page.goto('http://127.0.0.1:5173/', { waitUntil: 'networkidle0' })
await shot('misha-home')

const clicked = await page.evaluate(() => {
  const btn = [...document.querySelectorAll('button')].find((el) => el.textContent.includes('Открыть задания'))
  if (!btn) return 'missing'
  btn.click()
  return 'clicked'
})
console.log(clicked)
await new Promise((r) => setTimeout(r, 500))
console.log('url', page.url())
const body = await page.evaluate(() => document.body.innerText.slice(0, 400))
console.log(body)
await page.waitForSelector('.task-card', { timeout: 8000 })
await shot('misha-map')

const titles = await page.$$eval('.task-card strong', (nodes) => nodes.map((n) => n.textContent))
console.log('cards', titles.join(' | '))

await page.evaluate(() => {
  const card = [...document.querySelectorAll('.task-card')].find((el) => el.textContent.includes('Кубики'))
  card.click()
})
await page.waitForSelector('.cube, .bubble-text')
await shot('misha-cubes-1')

for (let i = 0; i < 3; i++) {
  const next = await page.$('button.btn:not(.ghost)')
  if (next) await next.click()
  await new Promise((r) => setTimeout(r, 200))
}
await shot('misha-cubes-end')

const inputs = await page.$$('.answer input')
console.log('answer fields', inputs.length)
if (inputs[0]) {
  await inputs[0].click()
  for (const d of ['3', '2']) {
    const btn = await page.evaluateHandle((digit) => {
      return [...document.querySelectorAll('.pad button')].find((b) => b.textContent.trim() === digit)
    }, d)
    await btn.asElement().click()
  }
  const check = await page.evaluateHandle(() =>
    [...document.querySelectorAll('.pad button')].find((b) => b.textContent.includes('Проверить')),
  )
  await check.asElement().click()
  await new Promise((r) => setTimeout(r, 300))
}
await shot('misha-cubes-ok')
const ok = await page.$eval('.answer', (el) => el.className)
console.log('answer class', ok)

await page.setViewport({ width: 390, height: 844 })
await page.goto('http://127.0.0.1:5173/', { waitUntil: 'networkidle0' })
await shot('misha-mobile')

console.log('errors', errors.length)
for (const e of errors) console.log('ERR', e.slice(0, 300))
await browser.close()
