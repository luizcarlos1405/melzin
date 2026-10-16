// The runtime must never turn strings into markup or code (#24).
import { expect, test } from 'bun:test'
import { readdirSync, readFileSync } from 'node:fs'
import { join } from 'node:path'

const dir = join(import.meta.dir, '../src/runtime')

test('runtime sources use no innerHTML/outerHTML/insertAdjacentHTML/eval/new Function', () => {
  const files = readdirSync(dir).filter((f) => f.endsWith('.ts'))
  expect(files).toContain('mount.ts')
  for (const file of files) {
    const source = readFileSync(join(dir, file), 'utf8')
    expect({ file, hits: source.match(/innerHTML|outerHTML|insertAdjacentHTML|\beval\b|new\s+Function|document\.write/g) }).toEqual({
      file,
      hits: null,
    })
  }
})
