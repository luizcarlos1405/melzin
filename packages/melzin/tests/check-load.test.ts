// loadViewFile / loadViewSource: what Bun-side code (contract tests, tools) reads from a view.

import { expect, test } from 'bun:test'
import { join } from 'node:path'
import { loadViewFile, loadViewSource } from '../src/cli/check.ts'
import * as tools from '../src/cli/tools.ts'

const fixtures = join(import.meta.dir, 'fixtures/check')

test('reads title, schema and snapshots', async () => {
  const view = await loadViewFile(join(fixtures, 'good-nested.mel.html'))
  expect(view.title).toBe('T')
  expect(view.issues).toEqual([])
  expect(view.schema?.data?.properties.user).toMatchObject({ type: 'object', required: ['name'] })
  expect(view.schema?.events).toEqual({})
  expect(view.snapshots).toEqual([
    { name: 'typical', data: { user: { name: 'Ada', bio: 'Math' } } },
    { name: 'empty bio', data: { user: { name: 'Ada' } } },
  ])
})

test('the title has its whitespace collapsed, like parseViewHtml', () => {
  const view = loadViewSource('<!doctype html><html><head><title>\n  Order\n   status  </title></head><body><p>x</p></body></html>')
  expect(view.title).toBe('Order status')
})

test('a static view has no schema and no snapshots', async () => {
  expect(await loadViewFile(join(fixtures, 'good-static.mel.html'))).toEqual({ title: 'T', schema: null, snapshots: [], issues: [] })
})

test('issues: invalid JSON, schema issues and snapshot issues', async () => {
  const json = await loadViewFile(join(fixtures, 'invalid-json-schema.mel.html'))
  expect(json.schema).toBeNull()
  expect(json.issues).toEqual([{ message: "invalid JSON in the melzin/schema block: trailing commas aren't allowed in JSON" }])

  const schema = await loadViewFile(join(fixtures, 'schema-issue.mel.html'))
  expect(schema.schema).toBeNull()
  expect(schema.issues).toEqual([{ message: "lists aren't supported yet; use a fixed number of fields such as first, second, third", path: 'data.properties.tags' }])
  // snapshot data isn't validated against an invalid schema
  expect(schema.snapshots).toEqual([{ name: 'zero', data: { count: 0 } }])

  const snapshot = await loadViewFile(join(fixtures, 'snapshot-issue.mel.html'))
  expect(snapshot.schema).not.toBeNull()
  expect(snapshot.snapshots.map((s) => s.name)).toEqual(['zero', 'a few clicks'])
  expect(snapshot.issues).toEqual([{ message: 'expected number, got string', path: 'snapshots["a few clicks"].data.count' }])

  const duplicate = await loadViewFile(join(fixtures, 'duplicate-schema.mel.html'))
  expect(duplicate.issues).toEqual([{ message: 'duplicate melzin/schema block; a view has at most one' }])
  expect(duplicate.schema?.events).toEqual({ increment: {} })
})

test('markup problems are not data issues', () => {
  const view = loadViewSource('<html><head></head><body class="x"><p v-text="a"></p><script></script></body></html>')
  expect(view).toEqual({ title: '', schema: null, snapshots: [], issues: [] })
})

test('a missing file rejects', async () => {
  await expect(loadViewFile(join(fixtures, 'nope.mel.html'))).rejects.toThrow()
})

test('melzin/tools exports the checker API', () => {
  for (const name of ['checkFiles', 'checkSource', 'loadViewFile', 'loadViewSource', 'formatDiagnostic', 'formatSummary', 'generateTypes', 'typesPathFor', 'buildCss', 'resolveProject']) {
    expect(typeof (tools as Record<string, unknown>)[name]).toBe('function')
  }
})
