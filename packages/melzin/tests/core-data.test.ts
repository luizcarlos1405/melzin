import { describe, expect, test } from 'bun:test'
import { conditionHolds, valueAt, valueOrDefault } from '../src/core/data.ts'
import { type MelzinSchema, validateSchema } from '../src/core/schema.ts'

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
