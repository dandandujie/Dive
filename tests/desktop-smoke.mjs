import { writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { app, BrowserWindow } from 'electron'

const output = process.env.DIVE_SMOKE_SCREENSHOT
if (output === undefined || output === '') {
  throw new Error('DIVE_SMOKE_SCREENSHOT must name the output PNG')
}

const originalLoadUrl = BrowserWindow.prototype.loadURL
BrowserWindow.prototype.loadURL = async function loadAndVerify(url, options) {
  await originalLoadUrl.call(this, url, options)
  await new Promise(resolve => setTimeout(resolve, 1_500))
  const title = await this.webContents.executeJavaScript('document.title')
  const body = await this.webContents.executeJavaScript('document.body.innerText')
  if (title !== 'DeepSeek Harness' || typeof body !== 'string' || body.trim() === '') {
    throw new Error(`unexpected Harness page: title=${JSON.stringify(title)}, body=${JSON.stringify(body)}`)
  }
  await writeFile(output, await this.webContents.capturePage().then(image => image.toPNG()))
  console.log(`DIVE_DESKTOP_READY ${new URL(url).origin} ${title}`)
  setImmediate(() => app.quit())
}

await import(join(import.meta.dirname, '../dist/main.js'))
