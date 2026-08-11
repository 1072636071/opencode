import { createRequire } from 'node:module'
import path from 'node:path'

const req = createRequire(import.meta.url)
const asar = req('D:\\work\\space\\open-code-mm\\opencode\\node_modules\\.bun\\@electron+asar@3.4.1\\node_modules\\@electron\\asar\\lib\\asar.js')
const asarPath = 'D:\\app\\opemCodeMM\\resources\\app.asar'

try {
  const list = asar.listPackage(asarPath)
  console.log('Total files:', list.length)
  
  const keyFiles = ['\\package.json', '\\out\\main\\index.js', '\\out\\preload\\index.js', '\\out\\renderer\\index.html']
  for (const f of keyFiles) {
    console.log(f, list.includes(f) ? 'EXISTS' : 'MISSING')
  }
  
  const buf = asar.extractFile(asarPath, 'out/main/index.js')
  console.log('=== main/index.js first 5 lines ===')
  console.log(buf.toString().split('\n').slice(0, 5).join('\n'))
  
  const pkg = JSON.parse(asar.extractFile(asarPath, 'package.json').toString())
  console.log('=== package.json main:', pkg.main)
} catch (e) {
  console.error('ERROR:', e.message)
}