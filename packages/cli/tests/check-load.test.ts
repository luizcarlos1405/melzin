// loadViewFile / loadViewSource: what Bun-side code (contract tests, tools) reads from a view.

import { expect, test } from 'bun:test'
import { join } from 'node:path'
import { loadViewFile, loadViewSource } from '../src/check.ts'
import * as tools from '../src/tools.ts'

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
  expect(await loadViewFile(join(fixtures, 'good-static.mel.html'))).toEqual({ title: 'T', description: '', stage: 'exploration', schema: null, snapshots: [], issues: [] })
})

test('the description is the head\'s meta description, whitespace collapsed', () => {
  const head = '<meta name="Description" content="  Cards,\n  more air ">'
  expect(loadViewSource(`<html><head>${head}<meta name="description" content="second"></head><body></body></html>`).description).toBe('Cards, more air')
  expect(loadViewSource('<html><head><meta name="viewport" content="x"></head><body><meta name="description" content="body"></body></html>').description).toBe('')
})

test('the stage follows what the file has (SPEC D28, D33)', () => {
  const view = (head: string, body = '<p>x</p>') => loadViewSource(`<html><head><title>T</title>${head}</head><body>${body}</body></html>`).stage
  const schema = (value: unknown) => `<script type="melzin/schema">${JSON.stringify(value)}</script>`
  const data = { type: 'object', properties: { name: { type: 'string' } } }
  expect(view('')).toBe('exploration')
  expect(view(schema({ data }), '<p m-text="name"></p>')).toBe('states')
  expect(view('<script type="melzin/snapshots">{ "a": {} }</script>')).toBe('states')
  expect(view(schema({ data, events: {} }), '<p m-text="name"></p>')).toBe('states')
  expect(view(schema({ events: { save: {} } }), '<button m-on:click="emit(\'save\')">Save</button>')).toBe('contracts')
  expect(view(schema({ data: { type: 'object', properties: { url: { type: 'string', route: 'home' } } } }), '<a m-bind:href="url">x</a>')).toBe('contracts')
  expect(view('', '<p m-text="route.params.handle"></p>')).toBe('contracts')
  // A broken schema still counts as one: the author has started on states.
  expect(view('<script type="melzin/schema">{ nope</script>')).toBe('states')
})

test('issues: invalid JSON, schema issues and snapshot issues', async () => {
  const json = await loadViewFile(join(fixtures, 'invalid-json-schema.mel.html'))
  expect(json.schema).toBeNull()
  expect(json.issues).toEqual([{ message: "invalid JSON in the melzin/schema block: trailing commas aren't allowed in JSON" }])

  const schema = await loadViewFile(join(fixtures, 'schema-issue.mel.html'))
  expect(schema.schema).toBeNull()
  expect(schema.issues).toEqual([{ message: `a list needs 'items', the schema every item matches, such as "items": { "type": "string" }`, path: 'data.properties.tags' }])
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
  expect(view).toEqual({ title: '', description: '', stage: 'exploration', schema: null, snapshots: [], issues: [] })
})

test('a missing file rejects', async () => {
  await expect(loadViewFile(join(fixtures, 'nope.mel.html'))).rejects.toThrow()
})

test('@melzin/cli/tools exports the checker API', () => {
  for (const name of ['checkFiles', 'checkSource', 'loadViewFile', 'loadViewSource', 'formatDiagnostic', 'formatSummary', 'generateTypes', 'typesPathFor', 'buildCss', 'resolveProject', 'linkFields', 'viewStage']) {
    expect(typeof (tools as Record<string, unknown>)[name]).toBe('function')
  }
})
