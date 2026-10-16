import puppeteer from 'puppeteer-core'

const browser = await puppeteer.launch({
  executablePath: '/usr/local/bin/google-chrome',
  headless: true,
  args: ['--no-sandbox', '--disable-dev-shm-usage'],
})
const page = await browser.newPage()
const errors = []
const audio = []
page.on('pageerror', (err) => errors.push(String(err)))
page.on('response', (res) => {
  const url = res.url()
  if (url.includes('/audio/') || url.endsWith('.mp3')) audio.push(`${res.status()} ${url}`)
})
await page.setViewport({ width: 1280, height: 800 })
await page.goto('http://188.127.251.247/', { waitUntil: 'domcontentloaded', timeout: 30000 })
await page.waitForSelector('button')

async function clickText(selector, text) {
  const handles = await page.$$(selector)
  for (const handle of handles) {
    const label = await handle.evaluate((el) => el.textContent || '')
    if (label.includes(text)) {
      await handle.click()
      return
    }
  }
  throw new Error(`no ${text}`)
}

await clickText('button', 'Открыть задания')
await page.waitForSelector('.task-card')
await clickText('.task-card', 'Кубики')
await page.waitForSelector('.bubble-text')
await new Promise((r) => setTimeout(r, 1500))
await page.screenshot({ path: '/tmp/misha-live.png' })
const title = await page.title()
console.log('title', title)
console.log('audio', audio.slice(0, 6))
console.log('errors', errors)
await browser.close()
