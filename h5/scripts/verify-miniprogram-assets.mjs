import { createHash } from 'node:crypto'
import { readdir, readFile } from 'node:fs/promises'
import path from 'node:path'

const root = path.resolve(import.meta.dirname, '..')
const sourceRoot = path.resolve(root, '../miniprogram/miniprogram/assets')
const targetRoot = path.resolve(root, 'public/assets')

async function files(rootDirectory, current = '') {
  const entries = await readdir(path.join(rootDirectory, current), { withFileTypes: true })
  const output = []
  for (const entry of entries) {
    const relative = path.join(current, entry.name)
    if (entry.isDirectory()) output.push(...await files(rootDirectory, relative))
    else if (!['.DS_Store', 'README.md'].includes(entry.name)) output.push(relative)
  }
  return output.toSorted()
}

async function hash(file) {
  return createHash('sha256').update(await readFile(file)).digest('hex')
}

const sourceFiles = await files(sourceRoot)
const targetFiles = await files(targetRoot)
if (sourceFiles.join('\n') !== targetFiles.join('\n')) {
  throw new Error('H5 静态资产文件列表与小程序不一致，请重新同步 assets 目录')
}
for (const relative of sourceFiles) {
  const [sourceHash, targetHash] = await Promise.all([
    hash(path.join(sourceRoot, relative)),
    hash(path.join(targetRoot, relative)),
  ])
  if (sourceHash !== targetHash) throw new Error(`H5 静态资产被修改：${relative}`)
}
console.log(`Verified ${sourceFiles.length} miniprogram assets with matching SHA-256 hashes.`)
