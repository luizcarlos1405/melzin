// Small checker behaviours: the stale-types check ignores line endings, and hint wording.

import { afterAll, describe, expect, test } from 'bun:test'
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { checkFiles, checkSource, loadViewSource } from '../src/cli/check.ts'
import { generateTypes } from '../src/cli/typegen.ts'

const VIEW = `<!doctype html>
<html>
<head>
<title>Counter</title>
<script type="melzin/schema">{ "data": { "type": "object", "properties": { "count": { "type": "number" } }, "required": ["count"] }, "events": { "increment": {} } }</script>
<script type="melzin/snapshots">{ "zero": { "data": { "count": 0 } } }</script>
</head>
<body>
<p m-text="count"></p><button m-on:click="emit('increment')">+</button>
</body>
</html>
`

const dir = mkdtempSync(join(tmpdir(), 'melzin-polish-'))
afterAll(() => rmSync(dir, { recursive: true, force: true }))

describe('stale types', () => {
  test('a types file with CRLF line endings is still up to date', async () => {
    const view = join(dir, 'counter.mel.html')
    writeFileSync(view, VIEW)
    const types = generateTypes(loadViewSource(VIEW).schema, 'counter.mel.html')
    writeFileSync(join(dir, 'counter.types.ts'), types.replace(/\n/g, '\r\n'))
    const result = await checkFiles([view], { cwd: dir })
    expect(result.files[0]!.diagnostics).toEqual([])
  })
})

describe('hint wording', () => {
  test('a whole-number snapshot named 1 suggests "one item"', () => {
    const source = VIEW.replace('{ "zero": { "data": { "count": 0 } } }', '{ "1": { "data": { "count": 1 } } }')
    const messages = checkSource(source, 'counter.mel.html').map((d) => d.message)
    expect(messages.some((m) => m.endsWith('use words, such as "one item"'))).toBe(true)
  })
})
