import { describe, expect, test } from 'bun:test'
import { validateSchema } from '../src/core/schema.ts'
import { mergePatch, parseSnapshots, snapshotOwnPaths } from '../src/core/snapshots.ts'

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
      { message: "unknown key 'notes'; a snapshot has 'data', 'route' for the URL and 'extends' for the snapshot it builds on", path: 'snapshots["s"].notes' },
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

describe('mergePatch (RFC 7396)', () => {
  test("the RFC's examples", () => {
    const cases: [unknown, unknown, unknown][] = [
      [{ a: 'b' }, { a: 'c' }, { a: 'c' }],
      [{ a: 'b' }, { b: 'c' }, { a: 'b', b: 'c' }],
      [{ a: 'b' }, { a: null }, {}],
      [{ a: 'b', b: 'c' }, { a: null }, { b: 'c' }],
      [{ a: ['b'] }, { a: 'c' }, { a: 'c' }],
      [{ a: 'c' }, { a: ['b'] }, { a: ['b'] }],
      [{ a: { b: 'c' } }, { a: { b: 'd', c: null } }, { a: { b: 'd' } }],
      [{ a: [{ b: 'c' }] }, { a: [1] }, { a: [1] }],
      [['a', 'b'], ['c', 'd'], ['c', 'd']],
      [{ a: 'b' }, ['c'], ['c']],
      [{ a: 'foo' }, null, null],
      [{ a: 'foo' }, 'bar', 'bar'],
      [{ e: null }, { a: 1 }, { e: null, a: 1 }],
      [[1, 2], { a: 'b', c: null }, { a: 'b' }],
      [{}, { a: { bb: { ccc: null } } }, { a: { bb: {} } }],
    ]
    for (const [target, patch, result] of cases) expect({ target, patch, merged: mergePatch(target, patch) }).toEqual({ target, patch, merged: result })
  })

  test('returns new objects and leaves its arguments alone', () => {
    const target = { user: { name: 'Ana', tags: ['a'] }, other: { x: 1 } }
    const patch = { user: { name: 'Bruno' } }
    const merged = mergePatch(target, patch) as typeof target
    expect(merged).toEqual({ user: { name: 'Bruno', tags: ['a'] }, other: { x: 1 } })
    merged.other.x = 2
    merged.user.tags.push('b')
    expect(target).toEqual({ user: { name: 'Ana', tags: ['a'] }, other: { x: 1 } })
    expect(patch).toEqual({ user: { name: 'Bruno' } })
  })

  test('a __proto__ key stays an ordinary key', () => {
    const merged = mergePatch({}, JSON.parse('{ "__proto__": { "polluted": true } }')) as Record<string, unknown>
    expect(Object.hasOwn(merged, '__proto__')).toBe(true)
    expect(Object.getPrototypeOf(merged)).toBe(Object.prototype)
    expect((merged as { polluted?: boolean }).polluted).toBeUndefined()
  })
})

describe('snapshotOwnPaths', () => {
  test('what a snapshot sets, replaces or removes itself', () => {
    const own = snapshotOwnPaths({ extends: 'base', data: { user: { name: 'Ana', bio: null }, viewer: null, 'first name': 'x' }, route: { query: null } })
    for (const path of ['data', 'data.user', 'data.user.name', 'data.user.bio', 'data.viewer', 'data.viewer.isSelf', 'data["first name"]', 'route.query', 'route.query.as']) {
      expect({ path, sets: own.sets(path) }).toEqual({ path, sets: true })
    }
    for (const path of ['extends', 'data.user.role', 'data.stats', 'data.username', 'route', 'route.params', 'route.params.handle']) {
      expect({ path, sets: own.sets(path) }).toEqual({ path, sets: path === 'route' })
    }
    expect(['data.user.bio', 'data.viewer', 'route.query', 'data.user.name'].map(own.removes)).toEqual([true, true, true, false])
  })
})

describe('snapshots that extend another (D30)', () => {
  const { schema: profile } = validateSchema({
    data: {
      type: 'object',
      properties: {
        user: {
          type: 'object',
          properties: { name: { type: 'string' }, bio: { type: 'string' } },
          required: ['name'],
        },
        viewer: {
          type: 'object',
          properties: { following: { type: 'boolean' }, isSelf: { type: 'boolean' } },
          required: ['following', 'isSelf'],
        },
      },
      required: ['user'],
    },
  })

  const base = {
    data: { user: { name: 'Bruno', bio: 'Queues and caches.' }, viewer: { following: false, isSelf: false } },
    route: { params: { handle: 'bruno' }, query: { as: 'ana' } },
  }

  test('a snapshot merges what it sets into its base, which stays as it was', () => {
    const result = parseSnapshots(
      {
        'follows you': base,
        following: { extends: 'follows you', data: { viewer: { following: true } } },
        'signed out': { extends: 'follows you', data: { viewer: null }, route: { query: null } },
      },
      profile,
    )
    expect(result.issues).toEqual([])
    expect(result.snapshots).toEqual([
      { name: 'follows you', data: base.data, route: base.route },
      {
        name: 'following',
        extends: 'follows you',
        data: { user: { name: 'Bruno', bio: 'Queues and caches.' }, viewer: { following: true, isSelf: false } },
        route: base.route,
      },
      { name: 'signed out', extends: 'follows you', data: { user: { name: 'Bruno', bio: 'Queues and caches.' } }, route: { params: { handle: 'bruno' } } },
    ])
  })

  test('chains resolve, in any order in the block', () => {
    const result = parseSnapshots(
      {
        'no bio, following': { extends: 'following', data: { user: { bio: null } } },
        following: { extends: 'follows you', data: { viewer: { following: true } } },
        'follows you': base,
      },
      profile,
    )
    expect(result.issues).toEqual([])
    expect(result.snapshots.map((snapshot) => [snapshot.name, snapshot.extends, snapshot.data])).toEqual([
      ['no bio, following', 'following', { user: { name: 'Bruno' }, viewer: { following: true, isSelf: false } }],
      ['following', 'follows you', { user: { name: 'Bruno', bio: 'Queues and caches.' }, viewer: { following: true, isSelf: false } }],
      ['follows you', undefined, base.data],
    ])
  })

  test("a problem in a value the snapshot inherits is reported once, at the base", () => {
    const result = parseSnapshots(
      {
        typical: { data: { user: { name: 7 } } },
        derived: { extends: 'typical', data: { user: { bio: 'x' } } },
        again: { extends: 'derived', data: { user: { name: 8 } } },
      },
      profile,
    )
    expect(result.issues).toEqual([
      { message: 'expected string, got number', path: 'snapshots["typical"].data.user.name' },
      { message: 'expected string, got number', path: 'snapshots["again"].data.user.name' },
    ])
  })

  test('problems in what the snapshot sets are its own', () => {
    const result = parseSnapshots(
      {
        typical: { data: { user: { name: 'Bruno' } } },
        'removes a required field': { extends: 'typical', data: { user: { name: null } } },
        // Its base has no viewer, so the viewer it starts is missing fields.
        'half a viewer': { extends: 'typical', data: { viewer: { following: true } } },
        'a typo': { extends: 'typical', data: { usr: { name: 'x' } } },
      },
      profile,
    )
    expect(result.issues).toEqual([
      { message: "the schema requires this field, so null can't remove it", path: 'snapshots["removes a required field"].data.user.name' },
      { message: "missing required field 'isSelf'", path: 'snapshots["half a viewer"].data.viewer.isSelf' },
      { message: "unknown field 'usr' (did you mean 'user'?)", path: 'snapshots["a typo"].data.usr' },
    ])
  })

  test('null in a snapshot that extends nothing removes nothing', () => {
    const result = parseSnapshots({ alone: { data: { user: { name: 'Ana', bio: null } } } }, profile)
    expect(result).toEqual({ snapshots: [{ name: 'alone', data: { user: { name: 'Ana' } } }], issues: [] })
  })

  test('a broken chain is an error at the snapshot that breaks it; its data waits until it resolves', () => {
    const result = parseSnapshots(
      {
        typical: base,
        number: { extends: 7, data: { viewer: { following: true } } },
        empty: { extends: ' ' },
        itself: { extends: 'itself' },
        typo: { extends: 'tipical', data: { viewer: { following: true } } },
        'on a typo': { extends: 'typo', data: { user: { name: 'x' } } },
        a: { extends: 'b' },
        b: { extends: 'a' },
      },
      profile,
    )
    expect(result.issues).toEqual([
      { message: '\'extends\' names the snapshot this one builds on, such as "extends": "typical"', path: 'snapshots["number"].extends' },
      { message: '\'extends\' names the snapshot this one builds on, such as "extends": "typical"', path: 'snapshots["empty"].extends' },
      { message: "a snapshot can't extend itself", path: 'snapshots["itself"].extends' },
      { message: "there's no snapshot named 'tipical' to extend (did you mean 'typical'?)", path: 'snapshots["typo"].extends' },
      { message: "these snapshots extend each other in a cycle: 'a' → 'b' → 'a'", path: 'snapshots["b"].extends' },
    ])
    // Still returned, with what they set themselves, so a preview can show them.
    expect(result.snapshots.find((snapshot) => snapshot.name === 'typo')).toEqual({ name: 'typo', data: { viewer: { following: true } } })
    expect(result.snapshots.find((snapshot) => snapshot.name === 'on a typo')).toEqual({
      name: 'on a typo',
      extends: 'typo',
      data: { viewer: { following: true }, user: { name: 'x' } },
    })
  })

  test('route problems follow the same rule', () => {
    const result = parseSnapshots(
      {
        typical: { data: { user: { name: 'A' } }, route: { params: { handle: 1 } } },
        derived: { extends: 'typical', route: { query: { as: 2 } } },
      },
      profile,
    )
    expect(result.issues).toEqual([
      { message: 'expected a string, got number (URL values are always strings)', path: 'snapshots["typical"].route.params.handle' },
      { message: 'expected a string, got number (URL values are always strings)', path: 'snapshots["derived"].route.query.as' },
    ])
  })
})
