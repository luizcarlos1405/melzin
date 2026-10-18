import { describe, expect, test } from 'bun:test'
import {
  type MelzinSchema,
  defaultAt,
  hasField,
  joinPath,
  leafPaths,
  resolveField,
  resolvePath,
  suggest,
  validateData,
  validateSchema,
} from '../src/core/schema.ts'

const profile = {
  data: {
    type: 'object',
    properties: {
      user: {
        type: 'object',
        properties: {
          name: { type: 'string' },
          role: { type: 'string' },
          bio: { type: 'string', default: '' },
          followers: { type: 'number' },
        },
        required: ['name', 'role', 'followers'],
      },
      verified: { type: 'boolean', default: false, description: 'shows a badge' },
    },
    required: ['user'],
  },
  events: { follow: {}, share: { description: 'opens the share sheet' } },
}

function valid(value: unknown): MelzinSchema {
  const { schema, issues } = validateSchema(value)
  expect(issues).toEqual([])
  if (schema === null) throw new Error('expected a schema')
  return schema
}

function issuesOf(value: unknown) {
  const { schema, issues } = validateSchema(value)
  expect(schema).toBeNull()
  return issues
}

describe('validateSchema: accepted', () => {
  test('the profile card schema round-trips', () => {
    expect(valid(profile)).toEqual(profile as MelzinSchema)
  })

  test('an empty object, data only, events only', () => {
    expect(valid({})).toEqual({})
    expect(valid({ data: { type: 'object', properties: {} } })).toEqual({ data: { type: 'object', properties: {} } })
    expect(valid({ events: { save: {} } })).toEqual({ events: { save: {} } })
  })

  test('description is allowed everywhere', () => {
    valid({
      description: 'a view',
      data: { type: 'object', description: 'd', properties: { a: { type: 'number', description: 'n' } } },
      events: { go: { description: 'e' } },
    })
  })

  test('defaults of every leaf type', () => {
    valid({
      data: {
        type: 'object',
        properties: {
          s: { type: 'string', default: 'x' },
          n: { type: 'number', default: 0 },
          b: { type: 'boolean', default: true },
        },
      },
    })
  })

  test('drops nothing it understands and copies the input', () => {
    const input = structuredClone(profile)
    const schema = valid(input)
    expect(schema).not.toBe(input as unknown as MelzinSchema)
    expect(schema.data).not.toBe(input.data as unknown as MelzinSchema['data'])
  })
})

describe('validateSchema: rejected', () => {
  test('non-object schemas', () => {
    for (const value of [null, [], 'x', 3]) {
      expect(issuesOf(value)).toHaveLength(1)
    }
    expect(issuesOf([])[0]?.message).toContain('got array')
  })

  test('ui is internal state (D5)', () => {
    expect(issuesOf({ ui: {} })).toEqual([{ message: "internal state (ui) isn't supported yet; let the host send that state as data", path: 'ui' }])
  })

  test('unknown top-level keys, with a suggestion', () => {
    expect(issuesOf({ dta: {} })).toEqual([{ message: "unknown keyword 'dta' (did you mean 'data'?)", path: 'dta' }])
    expect(issuesOf({ $schema: 'x' })).toEqual([{ message: "unknown keyword '$schema'", path: '["$schema"]' }])
  })

  test('data is an object, not a list', () => {
    expect(issuesOf({ data: { type: 'array', items: {} } })).toEqual([
      {
        message: `'data' must be an object schema; put the list in a field: { "type": "object", "properties": { "items": { "type": "array", ... } } }`,
        path: 'data',
      },
    ])
  })

  test('data must be an object schema', () => {
    expect(issuesOf({ data: { type: 'string' } })[0]?.path).toBe('data')
    expect(issuesOf({ data: 3 })[0]?.path).toBe('data')
  })

  test('object schemas need properties', () => {
    expect(issuesOf({ data: { type: 'object' } })).toEqual([
      { message: "an object schema needs 'properties' (use {} for none)", path: 'data' },
    ])
    expect(issuesOf({ data: { type: 'object', properties: [] } })).toEqual([
      { message: "'properties' must be an object, got array", path: 'data.properties' },
    ])
  })

  test('unknown keywords on leaves and objects', () => {
    expect(issuesOf({ data: { type: 'object', properties: { a: { type: 'string', minLength: 1 } } } })).toEqual([
      { message: "unknown keyword 'minLength'", path: 'data.properties.a.minLength' },
    ])
    expect(issuesOf({ data: { type: 'object', properties: {}, additionalProperties: false } })).toEqual([
      { message: "unknown keyword 'additionalProperties'", path: 'data.additionalProperties' },
    ])
    expect(issuesOf({ data: { type: 'object', properties: { a: { type: 'string', defualt: 'x' } } } })).toEqual([
      { message: "unknown keyword 'defualt' (did you mean 'default'?)", path: 'data.properties.a.defualt' },
    ])
  })

  test('default is only for leaves', () => {
    expect(issuesOf({ data: { type: 'object', properties: { u: { type: 'object', properties: {}, default: {} } } } })).toEqual([
      { message: "'default' is only allowed on string, number and boolean fields", path: 'data.properties.u.default' },
    ])
  })

  test('missing and unsupported types', () => {
    expect(issuesOf({ data: { type: 'object', properties: { a: {} } } })).toEqual([
      { message: "missing 'type' (string, number, boolean, object or array)", path: 'data.properties.a' },
    ])
    expect(issuesOf({ data: { type: 'object', properties: { a: { type: 'integer' } } } })).toEqual([
      { message: `unsupported type "integer" (use 'number'); use string, number, boolean, object or array`, path: 'data.properties.a.type' },
    ])
    expect(issuesOf({ data: { type: 'object', properties: { a: { type: ['string', 'null'] } } } })[0]?.path).toBe(
      'data.properties.a.type',
    )
    expect(issuesOf({ data: { type: 'object', properties: { a: 'string' } } })).toEqual([
      { message: 'a field schema must be an object, got string', path: 'data.properties.a' },
    ])
  })

  test('property names must be identifiers', () => {
    expect(issuesOf({ data: { type: 'object', properties: { 'first-name': { type: 'string' } } } })).toEqual([
      {
        message: "'first-name' isn't a valid field name (use letters, digits and _, not starting with a digit)",
        path: 'data.properties["first-name"]',
      },
    ])
    expect(issuesOf({ data: { type: 'object', properties: { '1st': { type: 'string' } } } })[0]?.path).toBe(
      'data.properties["1st"]',
    )
  })

  test('required entries must exist, be strings and be unique', () => {
    expect(issuesOf({ data: { type: 'object', properties: { count: { type: 'number' } }, required: ['cuont'] } })).toEqual([
      { message: "required field 'cuont' isn't in properties (did you mean 'count'?)", path: 'data.required[0]' },
    ])
    expect(issuesOf({ data: { type: 'object', properties: {}, required: 'a' } })).toEqual([
      { message: "'required' must be an array of field names", path: 'data.required' },
    ])
    expect(issuesOf({ data: { type: 'object', properties: { a: { type: 'number' } }, required: ['a', 'a'] } })).toEqual([
      { message: "'a' is listed twice in required", path: 'data.required[1]' },
    ])
  })

  test('defaults must match their type', () => {
    expect(issuesOf({ data: { type: 'object', properties: { n: { type: 'number', default: '0' } } } })).toEqual([
      { message: 'default must be a number, got string', path: 'data.properties.n.default' },
    ])
    expect(issuesOf({ data: { type: 'object', properties: { b: { type: 'boolean', default: null } } } })).toEqual([
      { message: 'default must be a boolean, got null', path: 'data.properties.b.default' },
    ])
  })

  test('description must be a string', () => {
    expect(issuesOf({ events: { go: { description: 1 } } })).toEqual([
      { message: "'description' must be a string", path: 'events.go.description' },
    ])
  })

  test('events: names, shapes, payloads (D14), unknown keys', () => {
    expect(issuesOf({ events: [] })[0]?.path).toBe('events')
    expect(issuesOf({ events: { 'on-save': {} } })).toEqual([
      { message: "'on-save' isn't a valid event name (use letters, digits and _, not starting with a digit)", path: 'events["on-save"]' },
    ])
    expect(issuesOf({ events: { save: true } })).toEqual([
      { message: 'an event must be an object such as {}, got boolean', path: 'events.save' },
    ])
    expect(issuesOf({ events: { save: { payload: { type: 'string' } } } })).toEqual([
      {
        message: 'a payload is an object schema of named fields: { "type": "object", "properties": { "optionId": { "type": "string" } } }',
        path: 'events.save.payload.type',
      },
    ])
    expect(issuesOf({ events: { save: { foo: 1 } } })).toEqual([{ message: "unknown keyword 'foo'", path: 'events.save.foo' }])
  })

  test('collects several issues at once', () => {
    const issues = issuesOf({ ui: {}, data: { type: 'object', properties: { 'a-b': { type: 'string' }, c: { type: 'array' } } } })
    expect(issues.map((issue) => issue.path)).toEqual(['ui', 'data.properties["a-b"]', 'data.properties.c'])
  })
})

describe('validateData', () => {
  const schema = valid(profile)

  test('valid data, with optional fields missing', () => {
    expect(validateData(schema, { user: { name: 'Ada', role: 'Engineer', followers: 3 } })).toEqual([])
    expect(validateData(schema, { user: { name: 'Ada', role: 'Engineer', followers: 3, bio: 'x' }, verified: true })).toEqual([])
  })

  test('undefined values count as missing', () => {
    expect(validateData(schema, { user: { name: 'Ada', role: 'R', followers: 1, bio: undefined } })).toEqual([])
    expect(validateData(schema, { user: { name: undefined, role: 'R', followers: 1 } })).toEqual([
      { message: "missing required field 'name'", path: 'user.name' },
    ])
  })

  test('data must be an object', () => {
    expect(validateData(schema, null)).toEqual([{ message: 'data must be an object, got null' }])
    expect(validateData(schema, [])).toEqual([{ message: 'data must be an object, got array' }])
  })

  test('unknown fields with suggestions, missing required fields, type mismatches, recursively', () => {
    expect(
      validateData(schema, { user: { nme: 'Ada', role: 1, followers: '3', bio: null }, extra: 1 }),
    ).toEqual([
      { message: "unknown field 'nme' (did you mean 'name'?)", path: 'user.nme' },
      { message: 'expected string, got number', path: 'user.role' },
      { message: 'expected number, got string', path: 'user.followers' },
      { message: 'expected string, got null', path: 'user.bio' },
      { message: "missing required field 'name'", path: 'user.name' },
      { message: "unknown field 'extra'", path: 'extra' },
    ])
  })

  test('an object field given a leaf', () => {
    expect(validateData(schema, { user: 'Ada' })).toEqual([{ message: 'expected an object, got string', path: 'user' }])
    expect(validateData(schema, {})).toEqual([{ message: "missing required field 'user'", path: 'user' }])
  })

  test('without a data schema only {} is valid', () => {
    expect(validateData({}, {})).toEqual([])
    expect(validateData(null, {})).toEqual([])
    expect(validateData({ events: { a: {} } }, { a: 1 })).toEqual([{ message: "unknown field 'a'", path: 'a' }])
  })

  test('non-identifier keys use bracket paths', () => {
    expect(validateData({}, { 'a b': 1 })).toEqual([{ message: "unknown field 'a b'", path: '["a b"]' }])
  })

  test('inherited keys are not fields', () => {
    expect(validateData(schema, { user: { name: 'a', role: 'b', followers: 1, toString: 'x' } })).toEqual([
      { message: "unknown field 'toString'", path: 'user.toString' },
    ])
  })
})

describe('resolvePath', () => {
  const schema = valid(profile)

  test('leaves resolve with their type and default', () => {
    expect(resolvePath(schema, ['user', 'name'])).toEqual({ ok: true, type: 'string' })
    expect(resolvePath(schema, ['user', 'bio'])).toEqual({ ok: true, type: 'string', default: '' })
    expect(resolvePath(schema, ['verified'])).toEqual({ ok: true, type: 'boolean', default: false })
    expect(resolvePath(schema, ['user', 'followers'])).toEqual({ ok: true, type: 'number' })
  })

  test('unknown fields', () => {
    expect(resolvePath(schema, ['x'])).toEqual({ ok: false, message: "unknown field 'x'" })
    expect(resolvePath(schema, ['user', 'nam'])).toEqual({ ok: false, message: "unknown field 'user.nam' (did you mean 'user.name'?)" })
    expect(resolvePath({}, ['count'])).toEqual({ ok: false, message: "unknown field 'count'" })
    expect(resolvePath(null, ['count'])).toEqual({ ok: false, message: "unknown field 'count'" })
    expect(resolvePath(schema, ['constructor'])).toEqual({ ok: false, message: "unknown field 'constructor'" })
  })

  test('a field written one level too high suggests the nested path', () => {
    expect(resolvePath(schema, ['name'])).toEqual({ ok: false, message: "unknown field 'name' (did you mean 'user.name'?)" })
  })

  test('objects are not displayable', () => {
    expect(resolvePath(schema, ['user'])).toEqual({
      ok: false,
      message: "'user' is an object; m-text needs a string, number or boolean",
    })
  })

  test('leaves have no fields', () => {
    expect(resolvePath(schema, ['user', 'name', 'first'])).toEqual({ ok: false, message: "'user.name' is a string and has no fields" })
  })
})

describe('resolveField', () => {
  const schema = valid(profile)

  test('leaves and objects resolve, with their schema', () => {
    expect(resolveField(schema, ['user', 'bio'])).toEqual({ ok: true, field: { type: 'string', default: '' }, required: false })
    const user = resolveField(schema, ['user'])
    expect(user.ok && user.field.type).toBe('object')
  })

  test('required means every step of the path is required', () => {
    expect(resolveField(schema, ['user'])).toMatchObject({ ok: true, required: true })
    expect(resolveField(schema, ['user', 'name'])).toMatchObject({ ok: true, required: true })
    expect(resolveField(schema, ['user', 'bio'])).toMatchObject({ ok: true, required: false })
    expect(resolveField(schema, ['verified'])).toMatchObject({ ok: true, required: false })
    const nested = valid({
      data: {
        type: 'object',
        properties: { viewer: { type: 'object', properties: { following: { type: 'boolean' } }, required: ['following'] } },
      },
    })
    expect(resolveField(nested, ['viewer', 'following'])).toMatchObject({ ok: true, required: false })
  })

  test('the same messages as resolvePath for paths that go nowhere', () => {
    for (const path of [['x'], ['user', 'nam'], ['name'], ['user', 'name', 'first'], ['data', 'user', 'name']]) {
      expect(resolveField(schema, path)).toEqual(resolvePath(schema, path) as never)
    }
  })

  test("the 'data.' hint also points at objects", () => {
    expect(resolveField(schema, ['data', 'user'])).toEqual({ ok: false, message: "unknown field 'data' (paths start inside data: use 'user')" })
  })
})

describe('leafPaths and defaultAt', () => {
  const schema = valid(profile)

  test('leaf paths in declaration order', () => {
    expect(leafPaths(schema)).toEqual(['user.name', 'user.role', 'user.bio', 'user.followers', 'verified'])
    expect(leafPaths({})).toEqual([])
    expect(leafPaths(null)).toEqual([])
  })

  test('defaults', () => {
    expect(defaultAt(schema, ['user', 'bio'])).toBe('')
    expect(defaultAt(schema, ['verified'])).toBe(false)
    expect(defaultAt(schema, ['user', 'name'])).toBeUndefined()
    expect(defaultAt(schema, ['nope'])).toBeUndefined()
  })
})

describe('helpers', () => {
  test('joinPath', () => {
    expect(joinPath('', 'a')).toBe('a')
    expect(joinPath('a', 'b')).toBe('a.b')
    expect(joinPath('a', 'b c')).toBe('a["b c"]')
  })

  test('suggest only offers close names', () => {
    expect(suggest('cuont', ['count', 'total'])).toBe(" (did you mean 'count'?)")
    expect(suggest('xyz', ['count'])).toBe('')
    expect(suggest('a', [])).toBe('')
  })
})

describe('review fixes', () => {
  test("'__proto__' is rejected as a field or event name instead of silently disappearing", () => {
    const value = JSON.parse(
      '{"data":{"type":"object","properties":{"__proto__":{"type":"string"},"name":{"type":"string"}},"required":["__proto__"]},"events":{"__proto__":{}}}',
    )
    const { schema, issues } = validateSchema(value)
    expect(schema).toBeNull()
    expect(issues).toEqual([
      { message: "'__proto__' isn't a valid field name (it's reserved)", path: 'data.properties.__proto__' },
      { message: "'__proto__' isn't a valid event name (it's reserved)", path: 'events.__proto__' },
    ])
  })

  test('required fields named like Object.prototype members are reported when missing', () => {
    const schema = valid({
      data: { type: 'object', properties: { toString: { type: 'string' }, constructor: { type: 'string' } }, required: ['toString', 'constructor'] },
    })
    expect(validateData(schema, {})).toEqual([
      { message: "missing required field 'toString'", path: 'toString' },
      { message: "missing required field 'constructor'", path: 'constructor' },
    ])
  })

  test('values from getters and prototypes count, and are type-checked', () => {
    const schema = valid({ data: { type: 'object', properties: { count: { type: 'number' } }, required: ['count'] } })
    class Model {
      get count(): number {
        return 5
      }
    }
    expect(validateData(schema, new Model())).toEqual([])
    expect(validateData(schema, Object.create({ count: 'x' }))).toEqual([{ message: 'expected number, got string', path: 'count' }])
  })

  test('numbers must be finite', () => {
    const schema = valid({ data: { type: 'object', properties: { n: { type: 'number' } } } })
    expect(validateData(schema, { n: Number.NaN })).toEqual([{ message: 'expected a finite number, got NaN', path: 'n' }])
    expect(validateData(schema, { n: -Infinity })).toEqual([{ message: 'expected a finite number, got -Infinity', path: 'n' }])
  })

  test('a field written one level too high suggests its nested path', () => {
    const schema = valid({
      data: { type: 'object', properties: { post: { type: 'object', properties: { title: { type: 'string' } } } } },
    })
    expect(validateData(schema, { title: 'x' })).toEqual([{ message: "unknown field 'title' (did you mean 'post.title'?)", path: 'title' }])
  })

  test("a path that starts with 'data.' gets a hint", () => {
    const schema = valid({
      data: { type: 'object', properties: { post: { type: 'object', properties: { title: { type: 'string' } } } } },
    })
    expect(resolvePath(schema, ['data', 'post', 'title'])).toEqual({
      ok: false,
      message: "unknown field 'data' (paths start inside data: use 'post.title')",
    })
  })

  test('hasField stops before Object.prototype', () => {
    expect(hasField({}, 'toString')).toBe(false)
    expect(hasField({ toString: 1 }, 'toString')).toBe(true)
    expect(hasField(Object.create({ a: 1 }), 'a')).toBe(true)
    expect(hasField(Object.create(null), 'a')).toBe(false)
  })

  test("a class prototype's constructor isn't a field; an own one is", () => {
    class Item {
      readonly id: string
      constructor(id: string) {
        this.id = id
      }
    }
    class Special extends Item {}
    expect(hasField(new Item('a'), 'constructor')).toBe(false)
    expect(hasField(new Special('a'), 'constructor')).toBe(false)
    expect(hasField(Object.create(Item.prototype), 'constructor')).toBe(false)
    expect(hasField({ constructor: 'x' }, 'constructor')).toBe(true)
    expect(hasField(Object.assign(new Item('a'), { constructor: 'x' }), 'constructor')).toBe(true)
    expect(hasField(new Item('a'), 'id')).toBe(true)
    const schema = valid({ data: { type: 'object', properties: { items: { type: 'array', key: 'id', items: { type: 'object', properties: { id: { type: 'string' }, constructor: { type: 'string' } }, required: ['id'] } } } } })
    expect(validateData(schema, { items: [new Item('a')] })).toEqual([])
  })
})
