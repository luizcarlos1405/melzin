// Link fields (SPEC D23), the reserved `route` name and reading the URL input (D27) in core.

import { describe, expect, test } from 'bun:test'
import { conditionHolds, parseHrefDirective, readPath, validateSchema } from '../src/core/index.ts'

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
    expect(parseHrefDirective("emit('x')")).toEqual({ ok: false, message: 'm-bind:href needs a path such as author.profileUrl, not a call', offset: 0 })
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
