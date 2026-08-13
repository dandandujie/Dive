/**
 * Dive 桌面主进程：启动官方 DeepSeek Harness Web profile，将其绑定到随机
 * loopback 端口，并在隔离的 BrowserWindow 中加载原有前端。
 */

import { spawn } from 'node:child_process'
import { join } from 'node:path'
import {
  app,
  BrowserWindow,
  dialog,
  session,
  shell,
  type WebContents,
} from 'electron'
import { startHarness, type HarnessHandle, type HarnessSpawn } from './harness-runtime.js'
import { classifyNavigation } from './navigation.js'

const WINDOW_BACKGROUND = '#0b0f14'
const WINDOW_MIN_WIDTH = 880
const WINDOW_MIN_HEIGHT = 640

let harness: HarnessHandle | undefined
let harnessOrigin: string | undefined
let mainWindow: BrowserWindow | undefined
let quitting = false
let quitAfterShutdown = false

app.setName('Dive')

function openExternal(url: string): void {
  void shell.openExternal(url).catch((error: unknown) => {
    console.error('Dive 无法打开外部链接', error)
  })
}

function secure(contents: WebContents): void {
  contents.setWindowOpenHandler(({ url }) => {
    if (harnessOrigin !== undefined && classifyNavigation(url, harnessOrigin) === 'external') {
      openExternal(url)
    }
    return { action: 'deny' }
  })
  contents.on('will-navigate', (event, url) => {
    if (harnessOrigin === undefined) {
      event.preventDefault()
      return
    }
    const decision = classifyNavigation(url, harnessOrigin)
    if (decision === 'allow') return
    event.preventDefault()
    if (decision === 'external') openExternal(url)
  })
}

async function createMainWindow(): Promise<void> {
  if (harness === undefined) throw new Error('DeepSeek Harness 尚未启动')
  const window = new BrowserWindow({
    width: 1440,
    height: 920,
    minWidth: WINDOW_MIN_WIDTH,
    minHeight: WINDOW_MIN_HEIGHT,
    show: false,
    backgroundColor: WINDOW_BACKGROUND,
    title: 'Dive',
    webPreferences: {
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
      webSecurity: true,
    },
  })
  mainWindow = window
  secure(window.webContents)
  window.once('ready-to-show', () => window.show())
  window.on('closed', () => {
    if (mainWindow === window) mainWindow = undefined
  })
  await window.loadURL(harness.url)
}

function focusMainWindow(): void {
  if (harness === undefined) return
  if (mainWindow === undefined) {
    void createMainWindow().catch(fatal)
    return
  }
  if (mainWindow.isMinimized()) mainWindow.restore()
  mainWindow.show()
  mainWindow.focus()
}

function fatal(error: unknown): void {
  const message = error instanceof Error ? error.message : String(error)
  console.error(error)
  dialog.showErrorBox('Dive 无法启动', message)
  app.quit()
}

async function boot(): Promise<void> {
  const spawnHarness: HarnessSpawn = (executable, args, options) =>
    spawn(executable, args, options)
  const dshHome = join(app.getPath('userData'), 'harness')
  harness = await startHarness(spawnHarness, {
    executable: process.execPath,
    cwd: app.getPath('home'),
    dshHome,
    environment: process.env,
    onLog(stream, line) {
      if (stream === 'stderr') console.error(`[harness] ${line}`)
      else console.log(`[harness] ${line}`)
    },
  })
  harnessOrigin = new URL(harness.url).origin

  session.defaultSession.setPermissionCheckHandler(() => false)
  session.defaultSession.setPermissionRequestHandler((_contents, _permission, callback) => callback(false))
  await createMainWindow()

  void harness.exited.then((code) => {
    if (quitting) return
    fatal(new Error(`DeepSeek Harness 意外退出（状态码 ${String(code)}）`))
  })
}

if (!app.requestSingleInstanceLock()) {
  app.quit()
} else {
  app.on('second-instance', focusMainWindow)
  app.on('activate', focusMainWindow)
  app.on('window-all-closed', () => {
    if (process.platform !== 'darwin') app.quit()
  })
  app.on('before-quit', (event) => {
    if (quitAfterShutdown || harness === undefined) return
    event.preventDefault()
    if (quitting) return
    quitting = true
    mainWindow?.hide()
    void harness.stop().then((stopped) => {
      if (!stopped) console.error('DeepSeek Harness 未在关闭时限内退出')
    }).finally(() => {
      quitAfterShutdown = true
      app.quit()
    })
  })
  void app.whenReady().then(boot).catch(fatal)
}
