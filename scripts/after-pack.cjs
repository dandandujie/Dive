const { existsSync, readFileSync, realpathSync } = require('node:fs')
const { dirname, join, relative, sep } = require('node:path')

function readPackage(packageDirectory) {
  return JSON.parse(readFileSync(join(packageDirectory, 'package.json'), 'utf8'))
}

function isInside(parent, child) {
  const path = relative(parent, child)
  return path === '' || (!path.startsWith(`..${sep}`) && path !== '..')
}

function findDependency(appDirectory, packageDirectory, name) {
  const starts = [packageDirectory, realpathSync(packageDirectory)]

  for (const start of starts) {
    let cursor = start
    while (isInside(appDirectory, cursor)) {
      const candidate = join(cursor, 'node_modules', name)
      if (existsSync(join(candidate, 'package.json'))) return candidate

      const parent = dirname(cursor)
      if (parent === cursor) break
      cursor = parent
    }
  }

  return undefined
}

/**
 * 校验成品中的 Harness 运行时依赖，防止 pnpm peer 依赖在打包时被遗漏。
 *
 * @param {import('electron-builder').AfterPackContext} context 打包上下文。
 * @returns {Promise<void>} 校验完成。
 */
module.exports = async function afterPack(context) {
  const resourcesDirectory = context.electronPlatformName === 'darwin'
    ? join(context.appOutDir, `${context.packager.appInfo.productFilename}.app`, 'Contents', 'Resources')
    : join(context.appOutDir, 'resources')
  const appDirectory = join(resourcesDirectory, 'app')
  const harnessDirectory = join(appDirectory, 'node_modules', '@deepseek-ai', 'dsh')

  if (!existsSync(join(harnessDirectory, 'lib', 'bin.js'))) {
    throw new Error('打包结果缺少 @deepseek-ai/dsh/lib/bin.js')
  }

  const queue = [harnessDirectory]
  const visited = new Set()

  while (queue.length > 0) {
    const packageDirectory = queue.pop()
    const realDirectory = realpathSync(packageDirectory)
    if (visited.has(realDirectory)) continue
    visited.add(realDirectory)

    const manifest = readPackage(packageDirectory)
    const requiredPeers = Object.keys(manifest.peerDependencies ?? {}).filter(
      name => manifest.peerDependenciesMeta?.[name]?.optional !== true,
    )
    const dependencies = Object.keys(manifest.dependencies ?? {})

    for (const name of [...dependencies, ...requiredPeers]) {
      const dependencyDirectory = findDependency(appDirectory, packageDirectory, name)
      if (!dependencyDirectory) {
        throw new Error(`${manifest.name} 缺少运行时依赖 ${name}`)
      }
      queue.push(dependencyDirectory)
    }

    for (const name of Object.keys(manifest.optionalDependencies ?? {})) {
      const dependencyDirectory = findDependency(appDirectory, packageDirectory, name)
      if (dependencyDirectory) queue.push(dependencyDirectory)
    }
  }

  console.log(`  • Harness 运行时依赖完整（${visited.size} 个包）`)
}
