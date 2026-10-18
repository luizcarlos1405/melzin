import { describe, expect, test } from 'bun:test'
import { validateSchema } from '../src/core/schema.ts'
import { parseSnapshots } from '../src/core/snapshots.ts'

const { schema } = validateSchema({
  data: { type: 'object', properties: { count: { type: 'number' } }, required: ['count'] },
  events: { increment: {} },
})

describe('parseSnapshots', () => {
  test('keeps order and data', () => {
    const result = parseSnapshots(
      { zero: { data: { count: 0 } }, 'a few clicks': { data: { count: 3 } }, huge: { data: { count: 1234567 } } },
      schema,
    )
    expect(result.issues).toEqual([])
    expect(result.snapshots).toEqual([
      { name: 'zero', data: { count: 0 } },
      { name: 'a few clicks', data: { count: 3 } },
      { name: 'huge', data: { count: 1234567 } },
    ])
  })

  test('data issues carry the snapshot name in their path; the snapshot is still returned', () => {
    const result = parseSnapshots({ 'a few clicks': { data: { count: '3', extra: true } } }, schema)
    expect(result.issues).toEqual([
      { message: 'expected number, got string', path: 'snapshots["a few clicks"].data.count' },
      { message: "unknown field 'extra'", path: 'snapshots["a few clicks"].data.extra' },
    ])
    expect(result.snapshots).toEqual([{ name: 'a few clicks', data: { count: '3', extra: true } }])
  })

  test('missing required fields', () => {
    expect(parseSnapshots({ empty: { data: {} } }, schema).issues).toEqual([
      { message: "missing required field 'count'", path: 'snapshots["empty"].data.count' },
    ])
  })

  test('a missing data key means {}', () => {
    const result = parseSnapshots({ plain: {} }, null)
    expect(result).toEqual({ snapshots: [{ name: 'plain', data: {} }], issues: [] })
    expect(parseSnapshots({ plain: {} }, schema).issues).toEqual([
      { message: "missing required field 'count'", path: 'snapshots["plain"].data.count' },
    ])
  })

  test('ui and other keys are issues', () => {
    const result = parseSnapshots({ s: { data: { count: 1 }, ui: {}, notes: 'x' } }, schema)
    expect(result.issues).toEqual([
      { message: "internal state (ui) isn't supported yet; put the whole state in 'data'", path: 'snapshots["s"].ui' },
      { message: "unknown key 'notes'; a snapshot has 'data' and, for the URL, 'route'", path: 'snapshots["s"].notes' },
    ])
    expect(result.snapshots).toHaveLength(1)
  })

  test('a route sets the URL input', () => {
    const result = parseSnapshots({ s: { data: { count: 1 }, route: { params: { handle: 'ana' }, query: { tab: 'posts' } } } }, schema)
    expect(result).toEqual({
      snapshots: [{ name: 's', data: { count: 1 }, route: { params: { handle: 'ana' }, query: { tab: 'posts' } } }],
      issues: [],
    })
  })

  test('route values are strings, and the name comes from the shell', () => {
    const result = parseSnapshots({ s: { data: { count: 1 }, route: { name: 'x', params: { id: 7 }, hash: '' } } }, schema)
    expect(result.issues).toEqual([
      { message: "a snapshot doesn't set the route's name; the shell takes it from the route it previews", path: 'snapshots["s"].route.name' },
      { message: 'expected a string, got number (URL values are always strings)', path: 'snapshots["s"].route.params.id' },
      { message: "unknown key 'hash'; a snapshot's route has 'params' and 'query'", path: 'snapshots["s"].route.hash' },
    ])
    expect(result.snapshots).toEqual([{ name: 's', data: { count: 1 } }])
    expect(parseSnapshots({ s: { route: [] } }, null).issues).toEqual([
      { message: '\'route\' must be an object such as { "params": { "handle": "ana" } }, got array', path: 'snapshots["s"].route' },
    ])
  })

  test('the block must be an object', () => {
    for (const value of [[], null, 'x']) {
      const result = parseSnapshots(value, schema)
      expect(result.snapshots).toEqual([])
      expect(result.issues).toEqual([
        { message: 'snapshots must be a JSON object mapping names to { "data": { ... } }', path: 'snapshots' },
      ])
    }
  })

  test('entries and data must be objects; bad entries are dropped', () => {
    const result = parseSnapshots({ a: 1, b: { data: [] }, c: { data: { count: 1 } } }, schema)
    expect(result.issues).toEqual([
      { message: 'a snapshot must be an object such as { "data": { ... } }', path: 'snapshots["a"]' },
      { message: "a snapshot's 'data' must be an object", path: 'snapshots["b"].data' },
    ])
    expect(result.snapshots.map((s) => s.name)).toEqual(['c'])
  })

  test('empty names are issues', () => {
    expect(parseSnapshots({ ' ': { data: { count: 1 } } }, schema).issues).toEqual([
      { message: "a snapshot name can't be empty", path: 'snapshots[" "]' },
    ])
  })

  test('static views (null schema) accept only empty data', () => {
    expect(parseSnapshots({ s: { data: { a: 1 } } }, null).issues).toEqual([
      { message: "unknown field 'a'", path: 'snapshots["s"].data.a' },
    ])
  })

  test('validateData: false skips data checks (for an invalid schema)', () => {
    expect(parseSnapshots({ s: { data: { anything: 1 } } }, null, { validateData: false })).toEqual({
      snapshots: [{ name: 's', data: { anything: 1 } }],
      issues: [],
    })
  })
})
