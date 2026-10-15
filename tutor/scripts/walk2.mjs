import puppeteer from 'puppeteer-core'

const browser = await puppeteer.launch({
  executablePath: '/usr/local/bin/google-chrome',
  headless: true,
  args: ['--no-sandbox', '--disable-dev-shm-usage'],
})
const page = await browser.newPage()
const errors = []
page.on('pageerror', (err) => errors.push(String(err)))
await page.setViewport({ width: 1280, height: 900 })
await page.goto('http://127.0.0.1:5173/', { waitUntil: 'networkidle0' })
await page.evaluate(() => {
  ;[...document.querySelectorAll('button')].find((el) => el.textContent.includes('Открыть задания')).click()
})
await page.waitForSelector('.task-card')
await page.evaluate(() => {
  ;[...document.querySelectorAll('.task-card')].find((el) => el.textContent.includes('Вычисли')).click()
})
await page.waitForSelector('.chip')
await page.evaluate(() => {
  ;[...document.querySelectorAll('.chip')].find((el) => el.textContent.includes('30 + 15')).click()
})
await page.waitForSelector('.expr')
await page.screenshot({ path: '/tmp/misha-expr.png' })
for (let i = 0; i < 6; i++) {
  const has = await page.evaluate(() => {
    const btn = [...document.querySelectorAll('button.btn:not(.ghost)')].find((el) =>
      /Дальше|Показать шаг/.test(el.textContent),
    )
    if (!btn) return false
    btn.click()
    return true
  })
  if (!has) break
  await new Promise((r) => setTimeout(r, 150))
}
await page.screenshot({ path: '/tmp/misha-expr-done.png' })
const text = await page.evaluate(() => document.body.innerText)
console.log(text.includes('39') ? 'saw 39' : 'NO 39')
console.log(text.includes('Проверить') ? 'has check' : 'no check')

await page.evaluate(() => {
  ;[...document.querySelectorAll('button')].find((el) => el.textContent.trim() === 'Назад').click()
})
await page.waitForSelector('.task-card')
await page.evaluate(() => {
  ;[...document.querySelectorAll('.task-card')].find((el) => el.textContent.includes('Лишняя фигура')).click()
})
await page.waitForSelector('.shape')
await page.screenshot({ path: '/tmp/misha-shapes.png' })
for (const n of ['2', '5', '6']) {
  await page.evaluate((label) => {
    ;[...document.querySelectorAll('.shape')].find((el) => el.textContent.trim() === label).click()
  }, n)
  await new Promise((r) => setTimeout(r, 100))
}
const after = await page.evaluate(() => document.body.innerText)
console.log(after.includes('Способы найдены') ? 'shapes complete' : 'shapes not complete')
console.log('found line', after.split('\n').find((l) => l.includes('Найдено')))
console.log('errors', errors)
await browser.close()
