import { describe, expect, test } from 'bun:test'
import { parseViewHtml } from '../src/runtime/index.ts'
import { useDom } from './helpers/dom.ts'
import { COUNTER, COUNTER_SCHEMA, view } from './runtime-fixtures.ts'

useDom()

describe('parseViewHtml', () => {
  test('returns title, schema, snapshots in order and the body', () => {
    const parsed = parseViewHtml(COUNTER)
    expect(parsed.title).toBe('Counter')
    expect(parsed.schema).toEqual(COUNTER_SCHEMA as never)
    expect(parsed.snapshots).toEqual([
      { name: 'zero', data: { count: 0 } },
      { name: 'a few clicks', data: { count: 3 } },
    ])
    expect(parsed.issues).toEqual([])
    expect(parsed.body.tagName).toBe('BODY')
    expect(parsed.body.querySelector('p')?.getAttribute('m-text')).toBe('count')
  })

  test('the body is not the live document', () => {
    const parsed = parseViewHtml(COUNTER)
    expect(parsed.body.ownerDocument).not.toBe(document)
    expect(document.querySelector('main')).toBeNull()
  })

  test('missing title, schema and snapshots', () => {
    const parsed = parseViewHtml(view({ body: '<h1>Hi</h1>' }))
    expect(parsed).toMatchObject({ title: '', schema: null, snapshots: [], issues: [] })
  })

  test('title whitespace is collapsed', () => {
    expect(parseViewHtml(view({ title: '\n  Profile\n   card  ', body: '' })).title).toBe('Profile card')
  })

  test('snapshot issues are reported with paths and the snapshots are still returned', () => {
    const parsed = parseViewHtml(
      view({
        schema: COUNTER_SCHEMA,
        snapshots: { ok: { data: { count: 1 } }, 'a few clicks': { data: { count: 'three' } }, extra: { data: { count: 1 }, ui: {} } },
        body: '',
      }),
    )
    expect(parsed.schema).not.toBeNull()
    expect(parsed.snapshots.map((s) => s.name)).toEqual(['ok', 'a few clicks', 'extra'])
    expect(parsed.issues).toEqual([
      { message: 'expected number, got string', path: 'snapshots["a few clicks"].data.count' },
      { message: "internal state (ui) isn't supported yet; put the whole state in 'data'", path: 'snapshots["extra"].ui' },
    ])
  })

  test('invalid schema JSON is an issue, not an exception', () => {
    const parsed = parseViewHtml(view({ schema: '{ nope', snapshots: { a: { data: { x: 1 } } }, body: '' }))
    expect(parsed.schema).toBeNull()
    expect(parsed.issues).toHaveLength(1)
    expect(parsed.issues[0]!.path).toBe('schema')
    expect(parsed.issues[0]!.message).toStartWith("the melzin/schema block isn't valid JSON")
    // Snapshot data isn't checked against a broken schema.
    expect(parsed.snapshots).toEqual([{ name: 'a', data: { x: 1 } }])
  })

  test('invalid schema is reported with core paths', () => {
    const parsed = parseViewHtml(view({ schema: { data: { type: 'object', properties: { a: { type: 'array' } } } }, body: '' }))
    expect(parsed.schema).toBeNull()
    expect(parsed.issues).toEqual([{ message: `a list needs 'items', the schema every item matches, such as "items": { "type": "string" }`, path: 'data.properties.a' }])
  })

  test('invalid snapshots JSON is an issue', () => {
    const parsed = parseViewHtml(view({ schema: COUNTER_SCHEMA, snapshots: '{"zero": ', body: '' }))
    expect(parsed.schema).toEqual(COUNTER_SCHEMA as never)
    expect(parsed.snapshots).toEqual([])
    expect(parsed.issues).toHaveLength(1)
    expect(parsed.issues[0]!.path).toBe('snapshots')
    expect(parsed.issues[0]!.message).toStartWith("the melzin/snapshots block isn't valid JSON")
  })

  test('without a schema only empty snapshot data is valid', () => {
    const parsed = parseViewHtml(view({ snapshots: { empty: {}, bad: { data: { a: 1 } } }, body: '' }))
    expect(parsed.snapshots).toEqual([
      { name: 'empty', data: {} },
      { name: 'bad', data: { a: 1 } },
    ])
    expect(parsed.issues).toEqual([{ message: "unknown field 'a'", path: 'snapshots["bad"].data.a' }])
  })

  test('duplicate data blocks are issues; the first block wins', () => {
    const parsed = parseViewHtml(
      view({ schema: COUNTER_SCHEMA, head: '<script type="melzin/snapshots">{}</script><script type="melzin/snapshots">{}</script>', body: '' }),
    )
    expect(parsed.issues).toEqual([{ message: 'only one <script type="melzin/snapshots"> block is allowed, found 2', path: 'snapshots' }])
  })

  test('data blocks in <body> are not read, and are reported (stray head content moves them there)', () => {
    const parsed = parseViewHtml(
      '<!doctype html><html><head><title>T</title></head><body><script type="melzin/schema">{"ui":{}}</script>' +
        '<script type="melzin/snapshots">{}</script></body></html>',
    )
    expect(parsed.schema).toBeNull()
    expect(parsed.snapshots).toEqual([])
    expect(parsed.issues.map((issue) => issue.path)).toEqual(['schema', 'snapshots'])
    expect(parsed.issues[0]?.message).toStartWith('the melzin/schema block ended up in <body>: something before it in <head>')
    expect(parsed.issues[1]?.message).toStartWith('the melzin/snapshots block ended up in <body>')
  })

  test('the title is the head <title>, not an inline SVG title in the body', () => {
    const svg = '<button><svg viewBox="0 0 1 1"><title>Close icon</title></svg></button>'
    expect(parseViewHtml(`<!doctype html><html><head><meta charset="utf-8"></head><body>${svg}</body></html>`).title).toBe('')
    expect(parseViewHtml(`<!doctype html><html><head><title>Dialog</title></head><body>${svg}</body></html>`).title).toBe('Dialog')
  })

  test('data block types ignore case and surrounding spaces, like the checker', () => {
    const parsed = parseViewHtml('<!doctype html><html><head><script type=" Melzin/Schema ">{"events":{"go":{}}}</script></head><body></body></html>')
    expect(parsed.schema).toEqual({ events: { go: {} } })
  })
})
