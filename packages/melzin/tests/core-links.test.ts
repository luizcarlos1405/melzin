// Link fields (SPEC D23), the reserved `route` name and reading the URL input (D27) in core.

import { describe, expect, test } from 'bun:test'
import { blockedLinkScheme, conditionHolds, parseHrefDirective, parseSnapshots, readPath, validateData, validateSchema } from '../src/core/index.ts'

describe('link fields', () => {
  test('a string field names its route', () => {
    const { schema, issues } = validateSchema({
      data: { type: 'object', properties: { authorUrl: { type: 'string', route: 'profile', description: 'The author' } }, required: ['authorUrl'] },
    })
    expect(issues).toEqual([])
    expect(schema?.data?.properties.authorUrl).toEqual({ type: 'string', route: 'profile', description: 'The author' })
  })

  test('problems', () => {
    const { issues } = validateSchema({
      data: {
        type: 'object',
        properties: {
          count: { type: 'number', route: 'profile' },
          name: { type: 'string', route: 'not a route' },
          other: { type: 'string', route: 3 },
          home: { type: 'string', route: 'home', default: '/' },
        },
      },
    })
    expect(issues).toEqual([
      { message: "'route' is only allowed on string fields: a link field holds a URL", path: 'data.properties.count.route' },
      { message: '\'route\' must be the name of a route in routes.json, such as "profile"', path: 'data.properties.name.route' },
      { message: '\'route\' must be the name of a route in routes.json, such as "profile"', path: 'data.properties.other.route' },
      {
        message: "a link field can't have a default: views never build URLs, the source sends them (leave the field out to show no link)",
        path: 'data.properties.home.default',
      },
    ])
  })

  test("'route' is reserved at the top of data", () => {
    const { schema, issues } = validateSchema({ data: { type: 'object', properties: { route: { type: 'string' } } } })
    expect(schema).toBeNull()
    expect(issues).toEqual([
      { message: "'route' is reserved for the URL input (route.params, route.query); rename the field", path: 'data.properties.route' },
    ])
    expect(validateSchema({ data: { type: 'object', properties: { trip: { type: 'object', properties: { route: { type: 'string' } } } } } }).issues).toEqual([])
  })

  test('parseHrefDirective', () => {
    expect(parseHrefDirective('links.home')).toEqual({ ok: true, path: ['links', 'home'] })
    expect(parseHrefDirective('!x')).toEqual({ ok: false, message: "m-bind:href needs a path such as author.profileUrl; '!' only works in conditions (m-if, m-show)", offset: 0 })
    const builds = 'views never build URLs: bind a link field (a string field with "route": "<route name>" in the schema), which the source fills with href() (docs/authoring.md §3)'
    expect(parseHrefDirective("emit('x')")).toEqual({ ok: false, message: `m-bind:href needs a path such as author.profileUrl, not a call; ${builds}`, offset: 0 })
    // Building the URL in the view: a call, joined strings or a template literal.
    expect(parseHrefDirective(" href('profile', member.handle)")).toEqual({ ok: false, message: `m-bind:href needs a path such as author.profileUrl, not a call; ${builds}`, offset: 1 })
    expect(parseHrefDirective("'/u/' + member.handle")).toEqual({ ok: false, message: `unexpected character '+'; ${builds}`, offset: 6 })
    expect(parseHrefDirective('`/u/${member.handle}`')).toEqual({ ok: false, message: `unexpected character '\`'; ${builds}`, offset: 0 })
    expect(parseHrefDirective('member..url')).toEqual({ ok: false, message: "expected a name after '.', found '.'", offset: 7 })
  })
})

// A link field's URL that would run code is a data problem, with the path of the value that has it, so
// the runtime warns about it with the data and the checker reports it in snapshots (SPEC D23).
describe('script URLs in link fields', () => {
  const schema = validateSchema({
    data: {
      type: 'object',
      properties: {
        authorUrl: { type: 'string', route: 'profile' },
        note: { type: 'string' },
        members: {
          type: 'array',
          key: 'handle',
          items: { type: 'object', properties: { handle: { type: 'string' }, url: { type: 'string', route: 'profile' } }, required: ['handle'] },
        },
        related: { type: 'array', uniqueItems: true, items: { type: 'string', route: 'profile' } },
      },
    },
  }).schema!
  const message = (scheme: string): string => `${scheme}: URLs aren't allowed in links; the link has no href`

  test('blockedLinkScheme', () => {
    for (const url of ['javascript:alert(1)', ' JavaScript:x', 'java\tscript:x', 'vbscript:x', 'data:text/html,x', '\u0000javascript:x']) {
      expect(blockedLinkScheme(url)).toBeDefined()
    }
    for (const url of ['/u/ana', 'https://x.example/', 'mailto:a@b.c', '#top', '?as=ana', 'notes/javascript:x', '']) {
      expect(blockedLinkScheme(url)).toBeUndefined()
    }
  })

  test('validateData reports them at their paths, in lists too', () => {
    const data = {
      authorUrl: 'javascript:alert(1)',
      note: 'javascript:alert(1)',
      members: [{ handle: 'a', url: '/u/a' }, { handle: 'b', url: ' vbscript:x' }],
      related: ['/u/a', 'data:text/html,x'],
    }
    expect(validateData(schema, data)).toEqual([
      { message: message('javascript'), path: 'authorUrl' },
      { message: message('vbscript'), path: 'members[1].url' },
      { message: message('data'), path: 'related[1]' },
    ])
    expect(validateData(schema, { authorUrl: '/u/ana', members: [{ handle: 'a', url: 'https://x.example/a' }] })).toEqual([])
  })

  test('snapshots report them as data issues', () => {
    const { issues } = parseSnapshots({ typical: { data: { members: [{ handle: 'a', url: 'javascript:alert(1)' }] } } }, schema)
    expect(issues).toEqual([{ message: message('javascript'), path: 'snapshots["typical"].data.members[0].url' }])
  })
})

describe('reading the URL input', () => {
  const schema = { data: { type: 'object' as const, properties: { name: { type: 'string' as const, default: 'Anonymous' } } } }
  const route = { name: 'profile', params: { handle: 'ana' }, query: { tab: '' } }

  test('readPath', () => {
    expect(readPath(schema, {}, route, ['name'])).toBe('Anonymous')
    expect(readPath(schema, {}, route, ['route', 'params', 'handle'])).toBe('ana')
    expect(readPath(schema, {}, route, ['route', 'name'])).toBe('profile')
    expect(readPath(schema, {}, undefined, ['route', 'name'])).toBeUndefined()
    expect(readPath(schema, {}, route, ['route', 'nope'])).toBeUndefined()
  })

  test('conditions', () => {
    const path = (...segments: string[]) => ({ path: segments, negated: false })
    expect(conditionHolds(schema, {}, path('route', 'params', 'handle'), route)).toBe(true)
    expect(conditionHolds(schema, {}, path('route', 'query', 'tab'), route)).toBe(false)
    expect(conditionHolds(schema, {}, { path: ['route', 'query', 'as'], negated: true }, route)).toBe(true)
    expect(conditionHolds(schema, {}, path('route', 'params', 'handle'))).toBe(false)
  })
})
