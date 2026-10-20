// Visual QA helper: drive the app headlessly and capture screenshots.
// Usage: node scripts/capture.mjs <url> <width> <height> "click=<sel>;wait=<ms>;shot=<file>;text=<sel>;fill=<sel>|<value>;press=<key>;eval=<js>;mouse=<x>,<y>"
import { chromium } from '@playwright/test'
const [,, url, w, h, script] = process.argv
// GPU=1 renders on the real GPU (smoother, and what a viewer's browser does)
const browser = await chromium.launch(process.env.GPU ? { args: ['--use-angle=d3d11', '--enable-gpu', '--ignore-gpu-blocklist'] } : {})
const page = await browser.newPage({ viewport: { width: +w, height: +h }, deviceScaleFactor: 1 })
const errors = []
page.on('console', (m) => { if (m.type() === 'error') errors.push(m.text()) })
page.on('pageerror', (e) => errors.push(String(e)))
// BLOCK=<substring> aborts matching requests (for example, offline basemap checks)
if (process.env.BLOCK) await page.route((u) => u.href.includes(process.env.BLOCK), (r) => r.abort())
await page.goto(url)
await page.waitForTimeout(2500)
for (const a of script.split(';').filter(Boolean)) {
  const i = a.indexOf('=')
  const kind = a.slice(0, i), arg = a.slice(i + 1)
  if (kind === 'click') await page.locator(arg).first().click()
  if (kind === 'fill') { const [sel, val] = arg.split('|'); await page.locator(sel).fill(val) }
  if (kind === 'press') await page.keyboard.press(arg)
  if (kind === 'wait') await page.waitForTimeout(+arg)
  if (kind === 'scroll') await page.locator(arg).first().scrollIntoViewIfNeeded()
  if (kind === 'shot') await page.screenshot({ path: arg })
  if (kind === 'eval') console.log('eval =>', JSON.stringify(await page.evaluate(`(() => { const v = ${arg}; return v === window.__sm?.map ? null : v })()`))?.slice(0, 600))
  if (kind === 'mouse') { const [x, y] = arg.split(',').map(Number); await page.mouse.click(x, y) }
  if (kind === 'text') console.log(arg, '=>', (await page.locator(arg).first().innerText()).replace(/\n/g, ' | ').slice(0, 300))
}
console.log(JSON.stringify({ errors: errors.slice(0, 8) }))
await browser.close()
