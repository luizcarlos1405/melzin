// Event payloads (SPEC D35): the payload schema, emit's payload objects checked against it (D15), and
// the object the runtime sends.

import { describe, expect, test } from 'bun:test'
import { type EmitPayload, parseClickDirective } from '../src/core/expr.ts'
import { buildPayload, payloadFixMessage, payloadIssues, resolvePayloadValue } from '../src/core/payload.ts'
import { type MelzinSchema, type Scope, resolveList, validateSchema } from '../src/core/schema.ts'

const poll = {
  data: {
    type: 'object',
    properties: {
      pollId: { type: 'string' },
      closed: { type: 'boolean', default: false },
      options: {
        type: 'array',
        key: 'id',
        items: {
          type: 'object',
          properties: {
            id: { type: 'string' },
            label: { type: 'string' },
            votes: { type: 'number' },
            note: { type: 'string' },
            url: { type: 'string', route: 'option' },
            tags: { type: 'array', uniqueItems: true, items: { type: 'string' } },
          },
          required: ['id', 'label', 'votes'],
        },
      },
      viewer: { type: 'object', properties: { id: { type: 'string' } }, required: ['id'] },
    },
    required: ['pollId', 'options'],
  },
  events: {
    vote: {
      description: 'casts a vote',
      payload: {
        type: 'object',
        description: 'which option',
        properties: { optionId: { type: 'string', description: 'the option key' }, note: { type: 'string' }, count: { type: 'number' } },
        required: ['optionId'],
      },
    },
    refresh: {},
  },
}

function valid(value: unknown): MelzinSchema {
  const { schema, issues } = validateSchema(value)
  expect(issues).toEqual([])
  if (schema === null) throw new Error('expected a schema')
  return schema
}

/** The issues of a schema with one event `go` whose payload is `payload`. */
function payloadSchemaIssues(payload: unknown) {
  const { schema, issues } = validateSchema({ events: { go: { payload } } })
  expect(schema).toBeNull()
  return issues
}

describe('validateSchema: payloads', () => {
  test('a payload is an object of string, number and boolean fields, round-trip', () => {
    expect(valid(poll)).toEqual(poll as MelzinSchema)
    valid({ events: { toggle: { payload: { type: 'object', properties: { on: { type: 'boolean' } } } } } })
  })

  test('the payload itself must be an object schema with properties', () => {
    const shape = 'a payload is an object schema of named fields: { "type": "object", "properties": { "optionId": { "type": "string" } } }'
    expect(payloadSchemaIssues('x')).toEqual([{ message: shape, path: 'events.go.payload' }])
    expect(payloadSchemaIssues({})).toEqual([{ message: shape, path: 'events.go.payload' }])
    expect(payloadSchemaIssues({ type: 'string' })).toEqual([{ message: shape, path: 'events.go.payload.type' }])
    expect(payloadSchemaIssues({ type: 'object' })).toEqual([
      { message: `a payload needs 'properties', its fields: { "type": "object", "properties": { "optionId": { "type": "string" } } }`, path: 'events.go.payload' },
    ])
    expect(payloadSchemaIssues({ type: 'object', properties: {}, extra: 1 })).toEqual([
      { message: "unknown keyword 'extra'", path: 'events.go.payload.extra' },
    ])
  })

  test('fields are leaves without default or route', () => {
    const leaves = 'payload fields are strings, numbers or booleans for now; send a key, such as optionId, and let the host look up the rest'
    expect(payloadSchemaIssues({ type: 'object', properties: { option: { type: 'object', properties: {} } } })).toEqual([
      { message: leaves, path: 'events.go.payload.properties.option' },
    ])
    expect(payloadSchemaIssues({ type: 'object', properties: { ids: { type: 'array', uniqueItems: true, items: { type: 'string' } } } })).toEqual([
      { message: leaves, path: 'events.go.payload.properties.ids' },
    ])
    expect(payloadSchemaIssues({ type: 'object', properties: { id: { type: 'string', default: 'x' } } })).toEqual([
      { message: 'a payload field has no default: the view sends the value it has, or leaves an optional field out', path: 'events.go.payload.properties.id.default' },
    ])
    expect(payloadSchemaIssues({ type: 'object', properties: { url: { type: 'string', route: 'home' } } })).toEqual([
      { message: "a payload field isn't a link: send a key, such as the item's id, and let the host find the URL", path: 'events.go.payload.properties.url.route' },
    ])
  })

  // Messages about a payload field's type list only what a payload field can be (D35).
  test("a field's type gets the hints that fit a payload", () => {
    expect(payloadSchemaIssues({ type: 'object', properties: { n: { type: 'integer' } } })).toEqual([
      { message: `unsupported type "integer" (use 'number'); use string, number or boolean`, path: 'events.go.payload.properties.n.type' },
    ])
    expect(payloadSchemaIssues({ type: 'object', properties: { n: { type: 'list' } } })).toEqual([
      { message: 'unsupported type "list"; use string, number or boolean', path: 'events.go.payload.properties.n.type' },
    ])
    expect(payloadSchemaIssues({ type: 'object', properties: { n: {} } })).toEqual([
      { message: "missing 'type' (string, number or boolean)", path: 'events.go.payload.properties.n' },
    ])
    expect(payloadSchemaIssues({ type: 'object', properties: { n: { type: 'string', key: 'id' } } })).toEqual([
      { message: "unknown keyword 'key'", path: 'events.go.payload.properties.n.key' },
    ])
  })

  // JSON.parse keeps `__proto__` an own key; it must stay one, and be reported, not become the prototype.
  test('a __proto__ keyword in a payload field is reported, and what it holds is ignored', () => {
    const field = (json: string) => JSON.parse(`{ "events": { "vote": { "payload": { "type": "object", "properties": { "optionId": ${json} } } } } }`)
    for (const json of ['{ "type": "string", "__proto__": { "default": "x" } }', '{ "type": "string", "__proto__": { "bogus": 1 } }']) {
      const { schema, issues } = validateSchema(field(json))
      expect(schema).toBeNull()
      expect(issues).toEqual([{ message: "unknown keyword '__proto__'", path: 'events.vote.payload.properties.optionId.__proto__' }])
    }
    expect(validateSchema(field('{ "type": "string", "default": "x", "__proto__": {} }')).issues).toEqual([
      { message: 'a payload field has no default: the view sends the value it has, or leaves an optional field out', path: 'events.vote.payload.properties.optionId.default' },
      { message: "unknown keyword '__proto__'", path: 'events.vote.payload.properties.optionId.__proto__' },
    ])
  })

  test('field names and required follow the object rules', () => {
    expect(payloadSchemaIssues({ type: 'object', properties: { 'a-b': { type: 'string' } } })).toEqual([
      { message: "'a-b' isn't a valid field name (use letters, digits and _, not starting with a digit)", path: 'events.go.payload.properties["a-b"]' },
    ])
    expect(payloadSchemaIssues({ type: 'object', properties: { id: { type: 'string' } }, required: ['ids'] })).toEqual([
      { message: "required field 'ids' isn't in properties (did you mean 'id'?)", path: 'events.go.payload.required[0]' },
    ])
  })
})

describe('payload values', () => {
  const schema = valid(poll)
  const rows = resolveList(schema, 'option', ['options'])
  if (!rows.ok) throw new Error(rows.message)
  const scope: Scope = rows.scope

  test('paths into the row, the data and the URL', () => {
    expect(resolvePayloadValue(schema, ['option', 'id'], scope)).toEqual({ ok: true, type: 'string', required: true })
    expect(resolvePayloadValue(schema, ['option', 'note'], scope)).toEqual({ ok: true, type: 'string', required: false })
    expect(resolvePayloadValue(schema, ['option', 'votes'], scope)).toEqual({ ok: true, type: 'number', required: true })
    // A link field is a string; a field with a default is always there.
    expect(resolvePayloadValue(schema, ['option', 'url'], scope)).toEqual({ ok: true, type: 'string', required: false })
    expect(resolvePayloadValue(schema, ['closed'], scope)).toEqual({ ok: true, type: 'boolean', required: true })
    expect(resolvePayloadValue(schema, ['viewer', 'id'], scope)).toEqual({ ok: true, type: 'string', required: false })
    expect(resolvePayloadValue(schema, ['route', 'params', 'pollId'])).toEqual({ ok: true, type: 'string', required: true })
    expect(resolvePayloadValue(schema, ['route', 'query', 'tab'])).toEqual({ ok: true, type: 'string', required: false })
  })

  test('objects, lists, counts and unknown fields are not values', () => {
    expect(resolvePayloadValue(schema, ['option'], scope)).toEqual({ ok: false, message: "'option' is an object; a payload field takes a string, number or boolean, such as its id" })
    expect(resolvePayloadValue(schema, ['option', 'tags'], scope)).toEqual({ ok: false, message: "'option.tags' is a list; a payload field takes a string, number or boolean, such as its id" })
    expect(resolvePayloadValue(schema, ['options', 'length'])).toMatchObject({ ok: false, message: expect.stringContaining("'options.length' counts the items, which only conditions can use") })
    expect(resolvePayloadValue(schema, ['option', 'idd'], scope)).toEqual({ ok: false, message: "unknown field 'option.idd' (did you mean 'option.id'?)" })
    expect(resolvePayloadValue(schema, ['route', 'nope'])).toMatchObject({ ok: false })
  })
})

describe('payloadIssues (D15)', () => {
  const schema = valid(poll)
  const rows = resolveList(schema, 'option', ['options'])
  if (!rows.ok) throw new Error(rows.message)
  const scope = rows.scope

  /** The issues of one m-on:click value, with the offset of the event name as the emit's position; null: outside the rows. */
  const issues = (value: string, withScope: Scope | null = scope) => {
    const parsed = parseClickDirective(value)
    if (!parsed.ok) throw new Error(parsed.message)
    return payloadIssues(schema, parsed.event, parsed.payload, value.indexOf("'") + 1, withScope ?? undefined)
  }

  test('a matching payload has no issues; optional fields may be left out', () => {
    expect(issues("emit('vote', { optionId: option.id })")).toEqual([])
    expect(issues("emit('vote', { optionId: option.id, note: option.note, count: option.votes })")).toEqual([])
    expect(issues("emit('vote', { optionId: route.params.pollId })", null)).toEqual([])
    expect(issues("emit('refresh')")).toEqual([])
  })

  test('a payload exactly when the event declares one', () => {
    expect(issues("emit('vote')")).toEqual([{ message: "event 'vote' has a payload; send it: emit('vote', { optionId: ... })", offset: 6 }])
    expect(issues("emit('refresh', { id: option.id })")).toEqual([
      { message: "event 'refresh' has no payload; send emit('refresh'), or declare its payload in the schema's events", offset: 16 },
    ])
    // Undeclared events are reported on their own.
    expect(issues("emit('nope', { id: option.id })")).toEqual([])
    // A payload without fields is written as such.
    const empty = { events: { ping: { payload: { type: 'object', properties: {} } } } }
    expect(payloadIssues(valid(empty), 'ping', undefined, 6)).toEqual([{ message: "event 'ping' has a payload; send it: emit('ping', {})", offset: 6 }])
  })

  test('unknown fields, missing required fields and wrong types', () => {
    const value = "emit('vote', { optonId: option.id, count: option.label })"
    expect(issues(value)).toEqual([
      { message: "'optonId' isn't a field of the payload of 'vote' (did you mean 'optionId'?)", offset: value.indexOf('optonId') },
      { message: "'option.label' is a string, but the payload's 'count' is a number", offset: value.indexOf('option.label') },
      { message: "the payload of 'vote' needs 'optionId'", offset: value.indexOf('{') },
    ])
  })

  test("a value that may be missing can't fill a required field", () => {
    const value = "emit('vote', { optionId: option.note })"
    expect(issues(value)).toEqual([
      { message: "'option.note' may be missing, but the payload requires 'optionId'", offset: value.indexOf('option.note') },
    ])
    expect(issues("emit('vote', { optionId: route.query.tab })")).toMatchObject([{ message: "'route.query.tab' may be missing, but the payload requires 'optionId'" }])
  })

  test('paths that resolve to nothing are reported at the path', () => {
    const value = "emit('vote', { optionId: option.idd })"
    expect(issues(value)).toEqual([{ message: "unknown field 'option.idd' (did you mean 'option.id'?)", offset: value.indexOf('option.idd') }])
    // Outside the row, the alias isn't in scope.
    expect(issues("emit('vote', { optionId: option.id })", null)).toMatchObject([{ message: "unknown field 'option' (did you mean 'options'?)" }])
  })
})

// A payload that doesn't parse gets its fix in the event's terms: its declared fields, filled from the
// rows in scope (the innermost alias and its key), never a fixed example.
describe('payloadFixMessage', () => {
  const inbox = valid({
    data: {
      type: 'object',
      properties: {
        filters: { type: 'array', uniqueItems: true, items: { type: 'string' } },
        notifications: {
          type: 'array',
          key: 'id',
          items: { type: 'object', properties: { id: { type: 'string' }, title: { type: 'string' }, rank: { type: 'number' } }, required: ['id', 'title'] },
        },
        members: {
          type: 'array',
          key: 'handle',
          items: { type: 'object', properties: { handle: { type: 'string' }, name: { type: 'string' } }, required: ['handle'] },
        },
        owner: { type: 'string' },
      },
      required: ['filters', 'notifications', 'members', 'owner'],
    },
    events: {
      selectFilter: { payload: { type: 'object', properties: { filter: { type: 'string' } }, required: ['filter'] } },
      markRead: { payload: { type: 'object', properties: { notificationId: { type: 'string' }, note: { type: 'string' } }, required: ['notificationId'] } },
      pick: { payload: { type: 'object', properties: { handle: { type: 'string' } }, required: ['handle'] } },
      move: { payload: { type: 'object', properties: { id: { type: 'string' }, rank: { type: 'number' } }, required: ['id', 'rank'] } },
      clear: {},
    },
  })
  const rowsOf = (alias: string, list: string): Scope => {
    const rows = resolveList(inbox, alias, [list])
    if (!rows.ok) throw new Error(rows.message)
    return rows.scope
  }
  const filters = rowsOf('filter', 'filters')
  const notifications = rowsOf('notification', 'notifications')
  const members = rowsOf('member', 'members')
  /** The message for one m-on:click value that doesn't parse, as the checker and the runtime write it. */
  const fixOf = (value: string, scope?: Scope): string => {
    const parsed = parseClickDirective(value)
    if (parsed.ok || parsed.fix === undefined) throw new Error(`expected a payload fix for ${value}`)
    return payloadFixMessage(inbox, parsed.fix, scope)
  }

  test("a positional value goes in the event's field", () => {
    expect(fixOf("emit('pick', member.handle)", members)).toBe("a payload is an object of named fields: emit('pick', { handle: member.handle })")
    expect(fixOf("emit('markRead', $event)", notifications)).toBe("a payload is an object of named fields: emit('markRead', { notificationId: notification.id })")
    expect(fixOf("emit('markRead', 'n1')", notifications)).toBe("a payload is an object of named fields: emit('markRead', { notificationId: notification.id })")
    expect(fixOf("emit('move', true)", notifications)).toBe("a payload is an object of named fields: emit('move', { id: notification.id, rank: notification.rank })")
    // Outside any row there is nothing to fill a field from but data.
    expect(fixOf("emit('markRead', 'n1')")).toBe("a payload is an object of named fields: emit('markRead', { notificationId: <path> })")
    expect(fixOf("emit('pick', [1])", members)).toBe("a payload is an object of named fields: emit('pick', { handle: member.handle })")
  })

  test('a shorthand field means the path of the same name when there is one', () => {
    expect(fixOf("emit('selectFilter', { filter })", filters)).toBe("write the value's path too: { filter: filter }")
    expect(fixOf("emit('markRead', { notificationId })", notifications)).toBe("write the value's path too: { notificationId: notification.id }")
    expect(fixOf("emit('selectFilter', { owner })")).toBe("write the value's path too: { owner: owner }")
    expect(fixOf("emit('markRead', { notificationId })")).toBe("write the value's path too: { notificationId: <path> }")
  })

  test('a quoted field name keeps its value, or gets one from the row', () => {
    expect(fixOf("emit('markRead', { 'notificationId': notification.id })", notifications)).toBe("write field names without quotes: { notificationId: notification.id }")
    expect(fixOf("emit('markRead', { 'notificationId' })", notifications)).toBe("write field names without quotes: { notificationId: notification.id }")
    expect(fixOf("emit('markRead', { 'notification id': x })", notifications)).toBe("write field names without quotes: { notificationId: x }")
    expect(fixOf("emit('pick', { '1': member.handle })", members)).toBe("write field names without quotes: { handle: member.handle }")
  })

  test('in nested rows, a field named after a row gets that row\'s key, and no other guess', () => {
    const board = valid({
      data: {
        type: 'object',
        properties: {
          groups: {
            type: 'array',
            key: 'gid',
            items: {
              type: 'object',
              properties: {
                gid: { type: 'string' },
                members: {
                  type: 'array',
                  key: 'handle',
                  items: { type: 'object', properties: { handle: { type: 'string' } }, required: ['handle'] },
                },
              },
              required: ['gid', 'members'],
            },
          },
        },
        required: ['groups'],
      },
      events: {
        two: { payload: { type: 'object', properties: { groupId: { type: 'string' }, memberHandle: { type: 'string' }, other: { type: 'string' } }, required: ['groupId', 'memberHandle'] } },
        three: { payload: { type: 'object', properties: { groupId: { type: 'string' }, other: { type: 'string' } }, required: ['other'] } },
      },
    })
    const outer = resolveList(board, 'group', ['groups'])
    if (!outer.ok) throw new Error(outer.message)
    const inner = resolveList(board, 'member', ['group', 'members'], outer.scope)
    if (!inner.ok) throw new Error(inner.message)
    const fix = (value: string): string => {
      const parsed = parseClickDirective(value)
      if (parsed.ok || parsed.fix === undefined) throw new Error(`expected a payload fix for ${value}`)
      return payloadFixMessage(board, parsed.fix, inner.scope)
    }
    expect(fix("emit('two', { groupId })")).toBe("write the value's path too: { groupId: group.gid }")
    expect(fix("emit('two', $event)")).toBe("a payload is an object of named fields: emit('two', { groupId: group.gid, memberHandle: member.handle })")
    // Named after no row: with two rows in scope, any key would be a guess that passes the checker.
    expect(fix("emit('three', $event)")).toBe("a payload is an object of named fields: emit('three', { other: <path> })")
    // A short alias isn't the start of a longer word: 'm' doesn't name 'memberHandle'.
    expect(payloadFixMessage(board, { kind: 'shorthand', callee: 'emit', event: 'two', name: 'memberHandle' }, inner.scope)).toBe("write the value's path too: { memberHandle: member.handle }")
  })

  test("an event without a payload sends none; an undeclared one gets the parse error's own message", () => {
    expect(fixOf("emit('clear', member.handle)", members)).toBe("event 'clear' has no payload; send emit('clear'), or declare its payload in the schema's events")
    expect(fixOf("emit('clear', { x })", members)).toBe("event 'clear' has no payload; send emit('clear'), or declare its payload in the schema's events")
    expect(fixOf("emit('nope', member.handle)", members)).toBe("a payload is an object of named fields: emit('nope', { memberHandle: member.handle })")
    expect(fixOf("emit('nope', { x })", members)).toBe("write the value's path too: { x: x }")
    expect(payloadFixMessage(null, { kind: 'positional', callee: 'emit', event: 'pick' })).toBe("a payload is an object of named fields: emit('pick', { <field>: <path> })")
  })
})

describe('buildPayload', () => {
  const schema = valid(poll)
  const rows = resolveList(schema, 'option', ['options'])
  if (!rows.ok) throw new Error(rows.message)

  const payloadOf = (value: string): EmitPayload => {
    const parsed = parseClickDirective(value)
    if (!parsed.ok || parsed.payload === undefined) throw new Error('expected a payload')
    return parsed.payload
  }

  test("reads the row's current item, data and route; leaves missing values out", () => {
    const payload = payloadOf("emit('vote', { optionId: option.id, note: option.note, closed: closed, poll: route.params.pollId })")
    const item = { id: 'pizza', label: 'Pizza', votes: 3 }
    const scope = new Map(rows.scope).set('option', { ...rows.scope.get('option')!, item })
    const data = { pollId: 'p1', options: [item] }
    expect(buildPayload(schema, data, { params: { pollId: 'p1' } }, payload, scope)).toEqual({ optionId: 'pizza', closed: false, poll: 'p1' })
    // The item changes: the next click sends its current values.
    scope.get('option')!.item = { id: 'tacos', label: 'Tacos', votes: 1, note: 'spicy' }
    expect(buildPayload(schema, data, null, payload, scope)).toEqual({ optionId: 'tacos', note: 'spicy', closed: false })
  })

  test('only strings, numbers and booleans are sent; names are own keys', () => {
    const payload = payloadOf("emit('vote', { __proto_: option, x: option.tags, n: option.votes })")
    const scope = new Map(rows.scope).set('option', { ...rows.scope.get('option')!, item: { id: 'a', tags: ['x'], votes: 0 } })
    const result = buildPayload(schema, {}, null, payload, scope)
    expect(result).toEqual({ n: 0 })
    expect(Object.getPrototypeOf(result)).toBe(Object.prototype)
  })
})
