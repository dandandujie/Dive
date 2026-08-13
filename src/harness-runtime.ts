/**
 * DeepSeek Harness 子进程的启动协议。桌面主进程只接受 Harness 明确打印的
 * loopback URL，并在退出前给同一进程一次有界的优雅关闭机会。
 */

import { createRequire } from 'node:module'
import { dirname, join } from 'node:path'

const require = createRequire(import.meta.url)
const WEB_URL_PREFIX = 'dsh web: '
const MAX_PENDING_LINE_LENGTH = 64 * 1024
const MAX_STDERR_TAIL_LENGTH = 16 * 1024
const DEFAULT_START_TIMEOUT_MS = 60_000
const DEFAULT_STOP_TIMEOUT_MS = 8_000
const FORCE_STOP_TIMEOUT_MS = 1_000

/** child_process.spawn 所需的最小选项，保持运行模块可在普通 Node 测试中加载。 */
export interface HarnessSpawnOptions {
  cwd: string
  env: Record<string, string>
  stdio: 'pipe'
  windowsHide: true
}

/** Node 子进程在本模块中使用的最小接口。 */
export interface HarnessChild {
  readonly stdout: NodeJS.ReadableStream | null
  readonly stderr: NodeJS.ReadableStream | null
  kill(signal?: NodeJS.Signals): boolean
  once(event: 'exit', listener: (code: number | null) => void): this
}

/** 可替换的 child_process.spawn 调用，测试通过它驱动真实流与退出时序。 */
export type HarnessSpawn = (
  executable: string,
  args: string[],
  options: HarnessSpawnOptions,
) => HarnessChild

/** 一次 Harness 启动所需的路径、环境和诊断接收器。 */
export interface StartHarnessOptions {
  executable: string
  cwd: string
  dshHome: string
  environment: NodeJS.ProcessEnv
  onLog?: (stream: 'stdout' | 'stderr', line: string) => void
  startTimeoutMs?: number
  stopTimeoutMs?: number
}

/** 已启动的 Harness 及其完整生命周期。 */
export interface HarnessHandle {
  url: string
  exited: Promise<number>
  /** 请求优雅关闭；返回 false 表示超时后已强制终止。 */
  stop(): Promise<boolean>
}

/** 返回已安装 `@deepseek-ai/dsh` 的可执行入口。 */
export function resolveHarnessEntrypoint(): string {
  const manifest = require.resolve('@deepseek-ai/dsh/package.json')
  return join(dirname(manifest), 'lib', 'bin.js')
}

/**
 * 从 Harness 的完整输出行读取可信启动地址。
 *
 * 只接受由 CLI 固定前缀宣布的 `127.0.0.1` HTTP 地址；任意主机名、路径、
 * 用户信息或无效端口都不会进入 BrowserWindow。
 */
export function harnessUrlFromLine(line: string): string | undefined {
  if (!line.startsWith(WEB_URL_PREFIX)) return undefined
  const candidate = line.slice(WEB_URL_PREFIX.length).split(/\s/u, 1)[0]
  if (candidate === undefined) return undefined

  let parsed: URL
  try {
    parsed = new URL(candidate)
  } catch {
    return undefined
  }
  const port = Number(parsed.port)
  if (parsed.protocol !== 'http:' || parsed.hostname !== '127.0.0.1'
    || parsed.username !== '' || parsed.password !== ''
    || parsed.pathname !== '/' || parsed.search !== '' || parsed.hash !== ''
    || !Number.isInteger(port) || port < 1 || port > 65_535) {
    return undefined
  }
  return parsed.href
}

/** 按行拆分任意分块的 UTF-8 输出，同时约束未换行数据的内存占用。 */
export class LineBuffer {
  private pending = ''

  /** 追加一块文本并返回其中完成的行。 */
  push(chunk: string): string[] {
    const parts = (this.pending + chunk).split(/\r?\n/u)
    this.pending = parts.pop() ?? ''
    if (this.pending.length > MAX_PENDING_LINE_LENGTH) {
      this.pending = this.pending.slice(-MAX_PENDING_LINE_LENGTH)
    }
    return parts
  }

  /** 返回流结束时剩余的最后一行。 */
  flush(): string | undefined {
    if (this.pending === '') return undefined
    const line = this.pending
    this.pending = ''
    return line
  }
}

function cleanEnvironment(environment: NodeJS.ProcessEnv): Record<string, string> {
  return Object.fromEntries(
    Object.entries(environment).filter((entry): entry is [string, string] => entry[1] !== undefined),
  )
}

async function waitForExit(exited: Promise<number>, ms: number): Promise<boolean> {
  let timer: NodeJS.Timeout | undefined
  try {
    return await Promise.race([
      exited.then(() => true),
      new Promise<false>(resolve => {
        timer = setTimeout(() => resolve(false), ms)
      }),
    ])
  } finally {
    if (timer !== undefined) clearTimeout(timer)
  }
}

/** 启动官方 Web profile，等待其声明实际端口，并返回可控生命周期。 */
export async function startHarness(spawn: HarnessSpawn, options: StartHarnessOptions): Promise<HarnessHandle> {
  const child = spawn(options.executable, [
    '--expose-internals',
    resolveHarnessEntrypoint(),
    'web',
    '--port',
    '0',
  ], {
    cwd: options.cwd,
    env: {
      ...cleanEnvironment(options.environment),
      DSH_HOME: options.dshHome,
      ELECTRON_RUN_AS_NODE: '1',
    },
    stdio: 'pipe',
    windowsHide: true,
  })
  if (child.stdout === null || child.stderr === null) {
    child.kill()
    throw new Error('Dive 无法读取 DeepSeek Harness 的启动输出')
  }

  let exitCode: number | undefined
  let resolveExit!: (code: number) => void
  const exited = new Promise<number>(resolve => { resolveExit = resolve })
  child.once('exit', (code) => {
    const normalized = code ?? 1
    exitCode = normalized
    resolveExit(normalized)
  })

  let stderrTail = ''
  const stdoutLines = new LineBuffer()
  const stderrLines = new LineBuffer()
  const emitLines = (stream: 'stdout' | 'stderr', lines: string[]): void => {
    for (const line of lines) options.onLog?.(stream, line)
  }

  const ready = new Promise<string>((resolve, reject) => {
    let settled = false
    const finish = (action: () => void): void => {
      if (settled) return
      settled = true
      clearTimeout(timer)
      action()
    }
    const inspect = (line: string): void => {
      const url = harnessUrlFromLine(line)
      if (url !== undefined) finish(() => resolve(url))
    }
    const timer = setTimeout(() => {
      finish(() => reject(new Error(`DeepSeek Harness 在 ${String(options.startTimeoutMs ?? DEFAULT_START_TIMEOUT_MS)} ms 内未完成启动${stderrTail === '' ? '' : `\n${stderrTail}`}`)))
    }, options.startTimeoutMs ?? DEFAULT_START_TIMEOUT_MS)

    child.stdout?.on('data', (chunk: unknown) => {
      const lines = stdoutLines.push(String(chunk))
      emitLines('stdout', lines)
      for (const line of lines) inspect(line)
    })
    child.stdout?.once('end', () => {
      const line = stdoutLines.flush()
      if (line !== undefined) {
        options.onLog?.('stdout', line)
        inspect(line)
      }
    })
    child.stderr?.on('data', (chunk: unknown) => {
      const text = String(chunk)
      stderrTail = (stderrTail + text).slice(-MAX_STDERR_TAIL_LENGTH)
      emitLines('stderr', stderrLines.push(text))
    })
    child.stderr?.once('end', () => {
      const line = stderrLines.flush()
      if (line !== undefined) options.onLog?.('stderr', line)
    })
    void exited.then((code) => {
      finish(() => reject(new Error(`DeepSeek Harness 在启动完成前退出（状态码 ${String(code)}）${stderrTail === '' ? '' : `\n${stderrTail}`}`)))
    })
  })

  let url: string
  try {
    url = await ready
  } catch (error) {
    if (exitCode === undefined) child.kill()
    throw error
  }

  let stopping: Promise<boolean> | undefined
  return {
    url,
    exited,
    stop() {
      stopping ??= (async () => {
        if (exitCode !== undefined) return true
        child.kill('SIGTERM')
        const stopped = await waitForExit(exited, options.stopTimeoutMs ?? DEFAULT_STOP_TIMEOUT_MS)
        if (stopped) return true
        child.kill('SIGKILL')
        await waitForExit(exited, FORCE_STOP_TIMEOUT_MS)
        return false
      })()
      return stopping
    },
  }
}
