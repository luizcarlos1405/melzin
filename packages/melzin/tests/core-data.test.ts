import { describe, expect, test } from 'bun:test'
import { conditionHolds, readPath, valueAt, valueOrDefault, valuesAt } from '../src/core/data.ts'
import { type MelzinSchema, type Scope, resolveList, validateSchema, withAlias } from '../src/core/schema.ts'

const { schema } = validateSchema({
  data: {
    type: 'object',
    properties: {
      verified: { type: 'boolean' },
      member: { type: 'boolean', default: true },
      bio: { type: 'string' },
      greeting: { type: 'string', default: 'Hi' },
      unread: { type: 'number' },
      viewer: { type: 'object', properties: { following: { type: 'boolean' } } },
      constructor: { type: 'string' },
    },
  },
})
if (schema === null) throw new Error('expected a valid schema')
const valid: MelzinSchema = schema

const holds = (data: unknown, path: string, negated = false): boolean =>
  conditionHolds(valid, data, { path: path.split('.'), negated })

describe('valueAt', () => {
  test('reads nested values with hasField', () => {
    expect(valueAt({ a: { b: 1 } }, ['a', 'b'])).toBe(1)
    expect(valueAt({ a: { b: 1 } }, ['a', 'c'])).toBeUndefined()
    expect(valueAt({ a: 'text' }, ['a', 'length'])).toBeUndefined()
    expect(valueAt({}, ['constructor'])).toBeUndefined()
    expect(valueAt(null, ['a'])).toBeUndefined()
    class Model {
      get a(): number {
        return 2
      }
    }
    expect(valueAt(new Model(), ['a'])).toBe(2)
  })
})

describe('valueOrDefault', () => {
  test('missing and null values fall back to the default', () => {
    expect(valueOrDefault(valid, {}, ['greeting'])).toBe('Hi')
    expect(valueOrDefault(valid, { greeting: null }, ['greeting'])).toBe('Hi')
    expect(valueOrDefault(valid, { greeting: '' }, ['greeting'])).toBe('')
    expect(valueOrDefault(valid, {}, ['bio'])).toBeUndefined()
  })
})

describe('conditionHolds', () => {
  test('booleans', () => {
    expect(holds({ verified: true }, 'verified')).toBe(true)
    expect(holds({ verified: false }, 'verified')).toBe(false)
    expect(holds({}, 'verified')).toBe(false)
  })

  test('strings hold unless empty', () => {
    expect(holds({ bio: 'Hello' }, 'bio')).toBe(true)
    expect(holds({ bio: ' ' }, 'bio')).toBe(true)
    expect(holds({ bio: '' }, 'bio')).toBe(false)
    expect(holds({}, 'bio')).toBe(false)
  })

  test('numbers hold unless zero', () => {
    expect(holds({ unread: 3 }, 'unread')).toBe(true)
    expect(holds({ unread: -1 }, 'unread')).toBe(true)
    expect(holds({ unread: 0 }, 'unread')).toBe(false)
  })

  test('objects hold when present, and their fields can be tested through them', () => {
    expect(holds({ viewer: {} }, 'viewer')).toBe(true)
    expect(holds({}, 'viewer')).toBe(false)
    expect(holds({ viewer: { following: true } }, 'viewer.following')).toBe(true)
    expect(holds({}, 'viewer.following')).toBe(false)
  })

  test('missing values use the default', () => {
    expect(holds({}, 'member')).toBe(true)
    expect(holds({ member: false }, 'member')).toBe(false)
    expect(holds({}, 'greeting')).toBe(true)
  })

  test('! flips the result', () => {
    expect(holds({}, 'viewer', true)).toBe(true)
    expect(holds({ viewer: {} }, 'viewer', true)).toBe(false)
    expect(holds({ bio: '' }, 'bio', true)).toBe(true)
  })

  test('Object.prototype members are never read', () => {
    expect(holds({}, 'constructor')).toBe(false)
  })
})

describe('lists and rows (D34)', () => {
  const { schema: parsed } = validateSchema({
    data: {
      type: 'object',
      properties: {
        members: {
          type: 'array',
          key: 'handle',
          items: {
            type: 'object',
            properties: { handle: { type: 'string' }, bio: { type: 'string', default: 'No bio' }, admin: { type: 'boolean', default: false } },
            required: ['handle'],
          },
        },
        tags: { type: 'array', uniqueItems: true, items: { type: 'string' } },
        stats: { type: 'object', properties: { length: { type: 'number' } } },
      },
    },
  })
  if (parsed === null) throw new Error('expected a valid schema')
  const lists: MelzinSchema = parsed
  const rows = resolveList(lists, 'member', ['members'])
  if (!rows.ok) throw new Error(rows.message)
  /** The rows' scope with `item` as the row's current item. */
  const row = (item: unknown): Scope => withAlias(undefined, 'member', { ...rows.scope.get('member')!, item })

  test("paths that start with the alias read the row's item, with defaults", () => {
    const scope = row({ handle: 'ana' })
    expect(valueAt({}, ['member', 'handle'], scope)).toBe('ana')
    expect(valueAt({}, ['member'], scope)).toEqual({ handle: 'ana' })
    expect(valueOrDefault(lists, {}, ['member', 'bio'], scope)).toBe('No bio')
    expect(readPath(lists, {}, null, ['member', 'bio'], row({ handle: 'a', bio: 'Hi' }))).toBe('Hi')
    expect(readPath(lists, {}, { params: { handle: 'x' } }, ['route', 'params', 'handle'], scope)).toBe('x')
    // Other paths still read the data.
    expect(valueAt({ tags: ['a'] }, ['tags'], scope)).toEqual(['a'])
    const tag = withAlias(scope, 'tag', { list: lists.data!.properties.tags as never, path: ['tags'], item: 'fast' })
    expect(valueAt({}, ['tag'], tag)).toBe('fast')
    expect(valueAt({}, ['member', 'handle'], tag)).toBe('ana')
  })

  test('.length counts a list; a field named length is read as a field', () => {
    expect(valueAt({ members: [{}, {}] }, ['members', 'length'])).toBe(2)
    expect(valueAt({ members: [] }, ['members', 'length'])).toBe(0)
    expect(valueAt({}, ['members', 'length'])).toBeUndefined()
    expect(valueAt({ members: 'ab' }, ['members', 'length'])).toBeUndefined()
    expect(valueAt({ stats: { length: 7 } }, ['stats', 'length'])).toBe(7)
  })

  test('conditions: a list holds when present, even empty; its length holds when it has items', () => {
    const test = (data: unknown, path: string, negated = false, scope?: Scope): boolean =>
      conditionHolds(lists, data, { path: path.split('.'), negated }, null, scope)
    expect(test({ members: [] }, 'members')).toBe(true)
    expect(test({ members: [] }, 'members.length')).toBe(false)
    expect(test({ members: [{ handle: 'a' }] }, 'members.length')).toBe(true)
    expect(test({}, 'members.length')).toBe(false)
    expect(test({}, 'members.length', true)).toBe(true)
    expect(test({}, 'member.admin', false, row({ handle: 'a' }))).toBe(false)
    expect(test({}, 'member.admin', false, row({ handle: 'a', admin: true }))).toBe(true)
  })

  test('valuesAt finds a field in every item, with data paths', () => {
    const data = { members: [{ handle: 'a', url: '/u/a' }, { handle: 'b' }, { handle: 'c', url: '/u/c' }], tags: ['x', 'y'] }
    expect(valuesAt(data, ['members', '[]', 'url'])).toEqual([
      { path: 'members[0].url', value: '/u/a' },
      { path: 'members[2].url', value: '/u/c' },
    ])
    expect(valuesAt(data, ['tags', '[]'])).toEqual([
      { path: 'tags[0]', value: 'x' },
      { path: 'tags[1]', value: 'y' },
    ])
    expect(valuesAt({ polls: [{ options: [{ id: 'a' }] }, { options: [{ id: 'b' }, { id: 'c' }] }] }, ['polls', '[]', 'options', '[]', 'id']).map((found) => found.path)).toEqual([
      'polls[0].options[0].id',
      'polls[1].options[0].id',
      'polls[1].options[1].id',
    ])
    expect(valuesAt({ members: 'nope' }, ['members', '[]', 'url'])).toEqual([])
    expect(valuesAt({ user: { name: 'Ana' } }, ['user', 'name'])).toEqual([{ path: 'user.name', value: 'Ana' }])
  })
})
