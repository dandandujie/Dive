/** BrowserWindow 只能留在 Harness 同源页面，外部打开仅允许 HTTPS。 */

export type NavigationDecision = 'allow' | 'external' | 'deny'

/** 对一次导航或新窗口请求作无副作用分类。 */
export function classifyNavigation(target: string, harnessOrigin: string): NavigationDecision {
  let url: URL
  try {
    url = new URL(target)
  } catch {
    return 'deny'
  }
  if (url.origin === harnessOrigin) return 'allow'
  return url.protocol === 'https:' ? 'external' : 'deny'
}
