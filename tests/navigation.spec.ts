import { describe, expect, it } from 'vitest'
import { classifyNavigation } from '../src/navigation.js'

describe('classifyNavigation', () => {
  const origin = 'http://127.0.0.1:43123'

  it('keeps only exact Harness-origin navigation in the app', () => {
    expect(classifyNavigation(`${origin}/session/one`, origin)).toBe('allow')
    expect(classifyNavigation('http://127.0.0.1:9999/', origin)).toBe('deny')
    expect(classifyNavigation('http://example.com/', origin)).toBe('deny')
  })

  it('routes HTTPS externally and rejects dangerous schemes', () => {
    expect(classifyNavigation('https://github.com/deepseek-ai/deepseek-harness', origin)).toBe('external')
    expect(classifyNavigation('file:///etc/passwd', origin)).toBe('deny')
    expect(classifyNavigation('javascript:alert(1)', origin)).toBe('deny')
    expect(classifyNavigation('not a URL', origin)).toBe('deny')
  })
})
