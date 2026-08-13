import { EventEmitter } from 'node:events'
import { PassThrough } from 'node:stream'
import { describe, expect, it, vi } from 'vitest'
import {
  harnessUrlFromLine,
  LineBuffer,
  startHarness,
  type HarnessChild,
  type HarnessSpawn,
} from '../src/harness-runtime.js'

class FakeChild extends EventEmitter implements HarnessChild {
  readonly stdout = new PassThrough()
  readonly stderr = new PassThrough()
  readonly kill = vi.fn((_signal?: NodeJS.Signals) => {
    this.emit('exit', 0)
    return true
  })
}

class StubbornChild extends EventEmitter implements HarnessChild {
  readonly stdout = new PassThrough()
  readonly stderr = new PassThrough()
  readonly kill = vi.fn((signal?: NodeJS.Signals) => {
    if (signal === 'SIGKILL') this.emit('exit', 137)
    return true
  })
}

describe('harnessUrlFromLine', () => {
  it('accepts only the announced loopback URL', () => {
    expect(harnessUrlFromLine('dsh web: http://127.0.0.1:43123')).toBe('http://127.0.0.1:43123/')
    expect(harnessUrlFromLine('dsh web: http://localhost:43123')).toBeUndefined()
    expect(harnessUrlFromLine('dsh web: https://127.0.0.1:43123')).toBeUndefined()
    expect(harnessUrlFromLine('dsh web: http://127.0.0.1:43123/other')).toBeUndefined()
    expect(harnessUrlFromLine('noise http://127.0.0.1:43123')).toBeUndefined()
  })
})

describe('LineBuffer', () => {
  it('reassembles lines split across chunks', () => {
    const buffer = new LineBuffer()
    expect(buffer.push('first\nsec')).toEqual(['first'])
    expect(buffer.push('ond\r\nthird')).toEqual(['second'])
    expect(buffer.flush()).toBe('third')
  })
})

describe('startHarness', () => {
  it('waits for the dynamic port and shuts the child down once', async () => {
    const child = new FakeChild()
    const spawn: HarnessSpawn = vi.fn(() => child)
    const started = startHarness(spawn, {
      executable: '/electron',
      cwd: '/workspace',
      dshHome: '/data',
      environment: { PATH: '/bin' },
      startTimeoutMs: 500,
      stopTimeoutMs: 500,
    })
    child.stdout.write('booting\ndsh web: http://127.0.0.1:4')
    child.stdout.write('321\n')

    const handle = await started
    expect(handle.url).toBe('http://127.0.0.1:4321/')
    expect(spawn).toHaveBeenCalledWith(
      '/electron',
      [
        '--expose-internals',
        expect.stringMatching(/@deepseek-ai[\\/]dsh[\\/]lib[\\/]bin\.js$/u),
        'web',
        '--port',
        '0',
      ],
      expect.objectContaining({
        cwd: '/workspace',
        env: { PATH: '/bin', DSH_HOME: '/data', ELECTRON_RUN_AS_NODE: '1' },
      }),
    )
    await expect(handle.stop()).resolves.toBe(true)
    await expect(handle.stop()).resolves.toBe(true)
    expect(child.kill).toHaveBeenCalledOnce()
  })

  it('reports stderr when the child exits before announcing a URL', async () => {
    const child = new FakeChild()
    const spawn: HarnessSpawn = () => child
    const started = startHarness(spawn, {
      executable: '/electron',
      cwd: '/workspace',
      dshHome: '/data',
      environment: {},
      startTimeoutMs: 500,
    })
    child.stderr.write('missing credential\n')
    child.emit('exit', 2)

    await expect(started).rejects.toThrow(/状态码 2[\s\S]*missing credential/u)
  })

  it('force-stops a child that ignores graceful termination', async () => {
    const child = new StubbornChild()
    const started = startHarness(() => child, {
      executable: '/electron',
      cwd: '/workspace',
      dshHome: '/data',
      environment: {},
      startTimeoutMs: 500,
      stopTimeoutMs: 1,
    })
    child.stdout.write('dsh web: http://127.0.0.1:4321\n')

    const handle = await started
    await expect(handle.stop()).resolves.toBe(false)
    expect(child.kill).toHaveBeenNthCalledWith(1, 'SIGTERM')
    expect(child.kill).toHaveBeenNthCalledWith(2, 'SIGKILL')
  })
})
