// Lists (SPEC D34): list schemas, list data, paths that start with an m-for alias, and the walkers that
// go into a list's items.

import { describe, expect, test } from 'bun:test'
import {
  LIST_ITEMS,
  type ListSchema,
  type MelzinSchema,
  type Scope,
  defaultAt,
  fieldPathOf,
  formatFieldPath,
  indexPath,
  itemKey,
  itemName,
  joinPath,
  leafPaths,
  linkFields,
  resolveField,
  resolveList,
  resolvePath,
  schemaFields,
  schemaPathOf,
  validateData,
  validateSchema,
  withAlias,
} from '../src/core/schema.ts'
import { parseSnapshots } from '../src/core/snapshots.ts'

const members = {
  type: 'array',
  key: 'handle',
  description: 'everyone in the club',
  minItems: 0,
  maxItems: 4,
  items: {
    type: 'object',
    properties: {
      handle: { type: 'string' },
      name: { type: 'string' },
      bio: { type: 'string', default: 'No bio yet' },
      url: { type: 'string', route: 'profile' },
    },
    required: ['handle', 'name'],
  },
}

const club = {
  data: {
    type: 'object',
    properties: {
      members,
      features: { type: 'array', uniqueItems: true, items: { type: 'string' } },
      scores: { type: 'array', uniqueItems: true, items: { type: 'number' } },
      polls: {
        type: 'array',
        key: 'id',
        items: {
          type: 'object',
          properties: {
            id: { type: 'number' },
            options: {
              type: 'array',
              key: 'id',
              minItems: 2,
              items: { type: 'object', properties: { id: { type: 'string' }, length: { type: 'number' } }, required: ['id'] },
            },
          },
          required: ['id', 'options'],
        },
      },
      title: { type: 'string' },
    },
    required: ['members', 'polls'],
  },
}

function valid(value: unknown): MelzinSchema {
  const { schema, issues } = validateSchema(value)
  expect(issues).toEqual([])
  if (schema === null) throw new Error('expected a schema')
  return schema
}

/** The issues of a schema whose data has one field, `list`. */
function listIssues(list: unknown) {
  const { schema, issues } = validateSchema({ data: { type: 'object', properties: { list } } })
  expect(schema).toBeNull()
  return issues
}

const objectItems = { type: 'object', properties: { id: { type: 'string' }, done: { type: 'boolean' } }, required: ['id'] }

describe('validateSchema: lists', () => {
  test('lists of objects with a key, lists of strings and numbers, nested lists, round-trip', () => {
    expect(valid(club)).toEqual(club as MelzinSchema)
  })

  test('a list field may be optional, and leaf items may be links', () => {
    valid({
      data: {
        type: 'object',
        properties: { links: { type: 'array', uniqueItems: true, items: { type: 'string', route: 'profile', description: 'a URL' } } },
      },
    })
  })

  test('a missing items, a tuple, items that are lists or booleans', () => {
    expect(listIssues({ type: 'array' })).toEqual([
      { message: `a list needs 'items', the schema every item matches, such as "items": { "type": "string" }`, path: 'data.properties.list' },
    ])
    expect(listIssues({ type: 'array', items: [{ type: 'string' }] })).toEqual([
      { message: "'items' is one schema that every item matches; lists of mixed items (tuples) aren't supported", path: 'data.properties.list.items' },
    ])
    expect(listIssues({ type: 'array', items: 'string' })).toEqual([
      { message: `'items' must be a schema such as { "type": "string" }, got string`, path: 'data.properties.list.items' },
    ])
    expect(listIssues({ type: 'array', items: { type: 'array', items: { type: 'string' } } })).toEqual([
      { message: `a list's items can't be lists; a list of lists needs object items with a key, such as { "id", "rows" }`, path: 'data.properties.list.items' },
    ])
    expect(listIssues({ type: 'array', uniqueItems: true, items: { type: 'boolean' } })).toEqual([
      {
        message: `a list of booleans can't be keyed, since its values repeat; use object items with a key, such as { "id", "done" }`,
        path: 'data.properties.list.items.type',
      },
    ])
    expect(listIssues({ type: 'array', items: {} })).toEqual([
      { message: "missing 'type': list items are objects, strings or numbers", path: 'data.properties.list.items' },
    ])
  })

  test('no default on a list or its leaf items', () => {
    expect(listIssues({ type: 'array', uniqueItems: true, items: { type: 'string' }, default: [] })).toEqual([
      { message: "a list has no default: a missing optional list shows like an empty one, so leave 'default' out", path: 'data.properties.list.default' },
    ])
    expect(listIssues({ type: 'array', uniqueItems: true, items: { type: 'string', default: '' } })).toEqual([
      { message: "a list item is never missing, so it takes no 'default'", path: 'data.properties.list.items.default' },
    ])
  })

  test('unknown keywords, and object keywords on the list itself', () => {
    expect(listIssues({ type: 'array', uniqueItems: true, items: { type: 'string' }, maxitems: 3 })).toEqual([
      { message: "unknown keyword 'maxitems' (did you mean 'maxItems'?)", path: 'data.properties.list.maxitems' },
    ])
    expect(listIssues({ type: 'array', key: 'id', items: objectItems, properties: {} })).toEqual([
      {
        message: `'properties' belongs in the items' schema: "items": { "type": "object", "properties": { ... }, "required": [ ... ] }`,
        path: 'data.properties.list.properties',
      },
    ])
  })

  test('list keywords on fields that are not lists', () => {
    expect(listIssues({ type: 'string', items: { type: 'string' } })).toEqual([
      { message: `'items' is for lists, which have "type": "array"`, path: 'data.properties.list.items' },
    ])
    expect(listIssues({ items: { type: 'string' } })).toEqual([
      { message: `missing 'type': a list needs "type": "array"`, path: 'data.properties.list' },
    ])
    expect(listIssues({ type: 'list' })).toEqual([
      { message: `unsupported type "list" (use 'array'); use string, number, boolean, object or array`, path: 'data.properties.list.type' },
    ])
  })

  test('a list of objects needs a key: a required string or number field of its items', () => {
    expect(listIssues({ type: 'array', items: objectItems })).toEqual([
      { message: `a list of objects needs a "key": the field of its items that identifies each one, such as "key": "id"`, path: 'data.properties.list' },
    ])
    // The example is the first required string or number field.
    const people = { type: 'object', properties: { bio: { type: 'string' }, handle: { type: 'string' } }, required: ['handle'] }
    expect(listIssues({ type: 'array', items: people })[0]?.message).toContain('such as "key": "handle"')
    expect(listIssues({ type: 'array', key: 3, items: objectItems })).toEqual([
      { message: `'key' must be the name of a field of the items, such as "id"`, path: 'data.properties.list.key' },
    ])
    expect(listIssues({ type: 'array', key: 'ids', items: objectItems })).toEqual([
      { message: "key 'ids' isn't a field of the items (did you mean 'id'?)", path: 'data.properties.list.key' },
    ])
    expect(listIssues({ type: 'array', key: 'user.id', items: objectItems })).toEqual([
      { message: `the key is a field of the items, not a path: give the items a field such as "userId"`, path: 'data.properties.list.key' },
    ])
    expect(listIssues({ type: 'array', key: 'done', items: objectItems })).toEqual([
      { message: "key 'done' must be a string or number field; it's a boolean", path: 'data.properties.list.key' },
    ])
    expect(listIssues({ type: 'array', key: 'id', items: { ...objectItems, required: [] } })).toEqual([
      { message: `key 'id' must be required: add it to the items' "required", since every item needs its key`, path: 'data.properties.list.key' },
    ])
    expect(listIssues({ type: 'array', key: 'id', uniqueItems: true, items: objectItems })).toEqual([
      { message: `"uniqueItems" is for lists of strings or numbers; the key already makes items unique`, path: 'data.properties.list.uniqueItems' },
    ])
  })

  test("a list of strings or numbers is keyed by its values, with uniqueItems", () => {
    expect(listIssues({ type: 'array', items: { type: 'string' } })).toEqual([
      { message: 'a list of strings is keyed by its values: add "uniqueItems": true', path: 'data.properties.list' },
    ])
    expect(listIssues({ type: 'array', uniqueItems: false, items: { type: 'number' } })).toEqual([
      { message: 'a list of numbers is keyed by its values: add "uniqueItems": true', path: 'data.properties.list.uniqueItems' },
    ])
    expect(listIssues({ type: 'array', key: 'id', items: { type: 'string' } })).toEqual([
      { message: 'a list of strings is keyed by its values: use "uniqueItems": true instead of "key"', path: 'data.properties.list.key' },
    ])
  })

  test('minItems and maxItems are whole numbers, the minimum no more than the maximum', () => {
    const strings = { type: 'array', uniqueItems: true, items: { type: 'string' } }
    expect(listIssues({ ...strings, minItems: -1, maxItems: 1.5 })).toEqual([
      { message: "'minItems' must be a whole number, 0 or more", path: 'data.properties.list.minItems' },
      { message: "'maxItems' must be a whole number, 0 or more", path: 'data.properties.list.maxItems' },
    ])
    expect(listIssues({ ...strings, minItems: 3, maxItems: 2 })).toEqual([
      { message: "'minItems' (3) is more than 'maxItems' (2)", path: 'data.properties.list.minItems' },
    ])
    valid({ data: { type: 'object', properties: { list: { ...strings, minItems: 2, maxItems: 2 } } } })
  })

  test('problems inside the items are reported at their paths, and still the key rules apply', () => {
    expect(listIssues({ type: 'array', items: { type: 'object', properties: { 'a-b': { type: 'string' } } } })).toEqual([
      { message: "'a-b' isn't a valid field name (use letters, digits and _, not starting with a digit)", path: 'data.properties.list.items.properties["a-b"]' },
      { message: `a list of objects needs a "key": the field of its items that identifies each one, such as "key": "id"`, path: 'data.properties.list' },
    ])
  })
})

describe('validateData: lists', () => {
  const schema = valid(club)
  const base = { members: [], polls: [] }

  test('valid lists, empty ones included; an optional list may be missing', () => {
    expect(validateData(schema, base)).toEqual([])
    expect(
      validateData(schema, {
        members: [{ handle: 'ana', name: 'Ana', url: '/u/ana' }, { handle: 'bruno', name: 'Bruno', bio: 'Hi' }],
        features: ['fast', 'safe'],
        scores: [1, 2],
        polls: [{ id: 1, options: [{ id: 'a' }, { id: 'b' }] }],
      }),
    ).toEqual([])
  })

  test('a list value must be an array; items are checked with indexed paths', () => {
    expect(validateData(schema, { ...base, members: { handle: 'ana' } })).toEqual([{ message: 'expected a list, got object', path: 'members' }])
    expect(validateData(schema, { ...base, members: [{ handle: 'ana', name: 1, extra: true }, 'ana'] })).toEqual([
      { message: 'expected string, got number', path: 'members[0].name' },
      { message: "unknown field 'extra'", path: 'members[0].extra' },
      { message: 'expected an object, got string', path: 'members[1]' },
    ])
    expect(validateData(schema, { ...base, features: ['a', 2] })).toEqual([{ message: 'expected string, got number', path: 'features[1]' }])
  })

  test('missing keys are missing required fields', () => {
    expect(validateData(schema, { ...base, members: [{ name: 'Ana' }] })).toEqual([
      { message: "missing required field 'handle'", path: 'members[0].handle' },
    ])
  })

  test('duplicate keys are reported at the later item, in one list instance', () => {
    expect(validateData(schema, { ...base, members: [{ handle: 'ana', name: 'Ana' }, { handle: 'bo', name: 'Bo' }, { handle: 'ana', name: 'Ana 2' }] })).toEqual([
      { message: 'duplicate key "ana": members[0] has it too; keys must be unique in a list', path: 'members[2].handle' },
    ])
    expect(validateData(schema, { ...base, features: ['a', 'b', 'a'], scores: [1, 1] })).toEqual([
      { message: 'duplicate value "a": features[0] has it too; values must be unique in a list', path: 'features[2]' },
      { message: 'duplicate value 1: scores[0] has it too; values must be unique in a list', path: 'scores[1]' },
    ])
    // Options of different polls may reuse ids.
    const polls = [
      { id: 1, options: [{ id: 'x' }, { id: 'x' }] },
      { id: 2, options: [{ id: 'x' }, { id: 'y' }] },
    ]
    expect(validateData(schema, { ...base, polls })).toEqual([
      { message: 'duplicate key "x": polls[0].options[0] has it too; keys must be unique in a list', path: 'polls[0].options[1].id' },
    ])
  })

  test('keys compare by value and type; prototype names are ordinary keys', () => {
    const { schema: mixed } = validateSchema({
      data: { type: 'object', properties: { tags: { type: 'array', uniqueItems: true, items: { type: 'string' } } } },
    })
    expect(validateData(mixed, { tags: ['__proto__', 'constructor', 'toString', 'hasOwnProperty'] })).toEqual([])
    expect(validateData(mixed, { tags: ['__proto__', '__proto__'] })).toEqual([
      { message: 'duplicate value "__proto__": tags[0] has it too; values must be unique in a list', path: 'tags[1]' },
    ])
    // A key of the wrong type is a type error, and doesn't count as a duplicate of 1.
    expect(validateData(schema, { ...base, polls: [{ id: 1, options: [] }, { id: '1', options: [] }] })).toEqual([
      { message: 'has 0 items; the schema allows at least 2', path: 'polls[0].options' },
      { message: 'expected number, got string', path: 'polls[1].id' },
      { message: 'has 0 items; the schema allows at least 2', path: 'polls[1].options' },
    ])
  })

  test('minItems and maxItems are issues at the list', () => {
    const options = [{ id: 'a' }]
    expect(validateData(schema, { ...base, polls: [{ id: 1, options }] })).toEqual([
      { message: 'has 1 item; the schema allows at least 2', path: 'polls[0].options' },
    ])
    const five = ['a', 'b', 'c', 'd', 'e'].map((handle) => ({ handle, name: handle }))
    expect(validateData(schema, { ...base, members: five })).toEqual([{ message: 'has 5 items; the schema allows at most 4', path: 'members' }])
  })

  test('null items, and null fields inside items', () => {
    expect(validateData(schema, { ...base, members: [null, undefined], features: [null] })).toEqual([
      { message: "a list item can't be null; leave it out of the list", path: 'members[0]' },
      { message: "a list item can't be undefined; leave it out of the list", path: 'members[1]' },
      { message: "a list item can't be null; leave it out of the list", path: 'features[0]' },
    ])
    expect(validateData(schema, { ...base, members: [{ handle: 'ana', name: null, bio: null }] })).toEqual([
      { message: 'expected string, got null', path: 'members[0].name' },
      { message: 'expected string, got null; leave the field out to make it missing', path: 'members[0].bio' },
    ])
  })

  test('odd keys inside items keep bracket paths', () => {
    expect(validateData(schema, { ...base, members: [{ handle: 'a', name: 'A', 'b c': 1 }] })).toEqual([
      { message: "unknown field 'b c'", path: 'members[0]["b c"]' },
    ])
  })
})

describe('snapshots with lists', () => {
  const schema = valid(club)

  test('issues inside lists have data paths that index the items', () => {
    const result = parseSnapshots({ two: { data: { members: [{ handle: 'ana', name: 'Ana' }, { handle: 'ana', name: 'Ana' }], polls: [] } } }, schema)
    expect(result.issues).toEqual([
      // The message names the other item by its path in the data.
      { message: 'duplicate key "ana": members[0] has it too; keys must be unique in a list', path: 'snapshots["two"].data.members[1].handle' },
    ])
  })

  test('a list replaces the base list whole (D36), and a null inside it is an error, not a removal', () => {
    const result = parseSnapshots(
      {
        base: { data: { members: [{ handle: 'ana', name: 'Ana', bio: 'Hi' }], polls: [] } },
        other: { extends: 'base', data: { members: [{ handle: 'bo', name: 'Bo', bio: null }] } },
      },
      schema,
    )
    expect(result.snapshots[1]?.data).toEqual({ members: [{ handle: 'bo', name: 'Bo', bio: null }], polls: [] })
    expect(result.issues).toEqual([
      { message: 'expected string, got null; leave the field out to make it missing', path: 'snapshots["other"].data.members[0].bio' },
    ])
  })

  test('a problem in an inherited list is reported at the base only', () => {
    const result = parseSnapshots(
      {
        base: { data: { members: [{ handle: 'ana' }], polls: [] } },
        other: { extends: 'base', data: { title: 'x' } },
      },
      schema,
    )
    expect(result.issues).toEqual([{ message: "missing required field 'name'", path: 'snapshots["base"].data.members[0].name' }])
  })
})

describe('paths with an m-for alias', () => {
  const schema = valid(club)
  const rows = resolveList(schema, 'member', ['members'])
  if (!rows.ok) throw new Error(rows.message)
  const scope = rows.scope

  test('the alias reads the list items; a row always has its item', () => {
    expect(resolveField(schema, ['member'], scope)).toMatchObject({ ok: true, field: { type: 'object' }, required: true })
    expect(resolveField(schema, ['member', 'name'], scope)).toEqual({ ok: true, field: { type: 'string' }, required: true })
    expect(resolveField(schema, ['member', 'bio'], scope)).toEqual({ ok: true, field: { type: 'string', default: 'No bio yet' }, required: false })
    expect(resolvePath(schema, ['member', 'bio'], scope)).toEqual({ ok: true, type: 'string', default: 'No bio yet' })
    expect(defaultAt(schema, ['member', 'bio'], scope)).toBe('No bio yet')
    // Without the scope, the alias is just an unknown field.
    expect(resolveField(schema, ['member', 'name'])).toEqual({ ok: false, message: "unknown field 'member' (did you mean 'members'?)" })
  })

  test('unknown fields suggest from the items, and from the aliases at the start of a path', () => {
    expect(resolvePath(schema, ['member', 'nme'], scope)).toEqual({ ok: false, message: "unknown field 'member.nme' (did you mean 'member.name'?)" })
    expect(resolvePath(schema, ['memer', 'name'], scope)).toEqual({ ok: false, message: "unknown field 'memer' (did you mean 'member'?)" })
    expect(resolvePath(schema, ['member', 'name', 'first'], scope)).toEqual({ ok: false, message: "'member.name' is a string and has no fields" })
  })

  test("an item's field written without the alias gets it, innermost row first", () => {
    expect(resolvePath(schema, ['name'], scope)).toEqual({ ok: false, message: "unknown field 'name' (did you mean 'member.name'?)" })
    expect(resolvePath(schema, ['handel'], scope)).toEqual({ ok: false, message: "unknown field 'handel' (did you mean 'member.handle'?)" })
    // A close data field still wins over a close item field, but not over an exact one.
    expect(resolvePath(schema, ['titel'], scope)).toEqual({ ok: false, message: "unknown field 'titel' (did you mean 'title'?)" })
    const polls = resolveList(schema, 'poll', ['polls'])
    const options = polls.ok ? resolveList(schema, 'option', ['poll', 'options'], polls.scope) : polls
    if (!options.ok) throw new Error(options.message)
    expect(resolvePath(schema, ['id'], options.scope)).toEqual({ ok: false, message: "unknown field 'id' (did you mean 'option.id'?)" })
    expect(resolvePath(schema, ['nope'], scope)).toEqual({ ok: false, message: "unknown field 'nope'" })
  })

  test('a list read through its name inside its own row points at the alias', () => {
    expect(resolveField(schema, ['members', 'name'], scope)).toEqual({
      ok: false,
      message: "'members' is a list, and this row reads one of its items as 'member': member.name",
    })
    expect(resolveField(schema, ['members', 'xyz'], scope)).toEqual({
      ok: false,
      message: "'members' is a list, and its items have no field 'xyz'; this row reads one of them as 'member'",
    })
    const tags = resolveList(schema, 'feature', ['features'])
    if (!tags.ok) throw new Error(tags.message)
    expect(resolveField(schema, ['features', 'name'], tags.scope)).toEqual({
      ok: false,
      message: "'features' is a list of strings, and this row reads one of them as 'feature'",
    })
  })

  test('the alias of a list of strings is the leaf itself', () => {
    const tags = resolveList(schema, 'feature', ['features'])
    if (!tags.ok) throw new Error(tags.message)
    expect(resolvePath(schema, ['feature'], tags.scope)).toEqual({ ok: true, type: 'string' })
    expect(resolvePath(schema, ['feature', 'x'], tags.scope)).toEqual({ ok: false, message: "'feature' is a string and has no fields" })
  })

  test('nested lists: an outer alias leads to the inner list', () => {
    const polls = resolveList(schema, 'poll', ['polls'])
    if (!polls.ok) throw new Error(polls.message)
    const options = resolveList(schema, 'option', ['poll', 'options'], polls.scope)
    if (!options.ok) throw new Error(options.message)
    expect(options.path).toEqual(['polls', LIST_ITEMS, 'options'])
    expect(options.required).toBe(true)
    expect(resolveField(schema, ['poll', 'id'], options.scope)).toMatchObject({ ok: true, required: true })
    expect(resolveField(schema, ['option', 'id'], options.scope)).toMatchObject({ ok: true, required: true })
    expect(fieldPathOf(['option', 'id'], options.scope)).toEqual(['polls', '[]', 'options', '[]', 'id'])
    expect(fieldPathOf(['title'], options.scope)).toEqual(['title'])
  })

  test('.length counts a list for conditions; a real field named length is still that field', () => {
    const count = resolveField(schema, ['members', 'length'])
    expect(count).toEqual({ ok: true, field: { type: 'number' }, required: true, length: (schema.data!.properties.members as ListSchema) })
    expect(resolveField(schema, ['features', 'length'])).toMatchObject({ ok: true, required: false })
    expect(resolveField(schema, ['members', 'length', 'x'])).toEqual({ ok: false, message: "'members.length' is a number and has no fields" })
    const polls = resolveList(schema, 'poll', ['polls'])
    const options = polls.ok ? resolveList(schema, 'option', ['poll', 'options'], polls.scope) : polls
    if (!options.ok) throw new Error(options.message)
    expect(resolveField(schema, ['poll', 'options', 'length'], options.scope)).toMatchObject({ ok: true, required: true, length: { type: 'array' } })
    expect(resolveField(schema, ['option', 'length'], options.scope)).toEqual({ ok: true, field: { type: 'number' }, required: false })
  })

  test('m-text shows leaves only: lists and counts get the fix', () => {
    expect(resolvePath(schema, ['members'])).toEqual({ ok: false, message: "'members' is a list; show its items with m-for" })
    expect(resolvePath(schema, ['members', 'length'])).toEqual({
      ok: false,
      message: "'members.length' counts the items, which only conditions can use (m-if, m-else-if, m-show); to show a count, have the host send it as its own field, such as memberCount",
    })
    expect(defaultAt(schema, ['members', 'length'])).toBeUndefined()
  })

  test("a path can't go past a list without a row", () => {
    expect(resolveField(schema, ['members', 'name'])).toEqual({
      ok: false,
      message: `'members' is a list; read its items' fields in a row: m-for="member in members", then member.name`,
    })
    expect(resolveField(schema, ['features', 'name'])).toEqual({
      ok: false,
      message: `'features' is a list of strings; show each one in a row: m-for="feature in features", then m-text="feature"`,
    })
    expect(resolveField(schema, ['members', '0'])).toEqual({
      ok: false,
      message: "'members.0' picks an item by position: a list's items are shown with m-for; for one particular item, have the host send it as its own field, such as featured",
    })
    // A misspelled item field gets the right one; a field the items don't have gets no made-up one.
    expect(resolveField(schema, ['members', 'nmae'])).toEqual({
      ok: false,
      message: `'members' is a list; read its items' fields in a row: m-for="member in members", then member.name`,
    })
    expect(resolveField(schema, ['members', 'xyz'])).toEqual({
      ok: false,
      message: `'members' is a list, and its items have no field 'xyz'; read their fields in a row: m-for="member in members"`,
    })
  })

  test('a misspelled length, or another word for a count, gets .length', () => {
    for (const segment of ['lenght', 'Length', 'legnth', 'size', 'count']) {
      expect(resolveField(schema, ['members', segment])).toEqual({ ok: false, message: `unknown field 'members.${segment}' (did you mean 'members.length'?)` })
    }
    expect(resolveField(schema, ['features', 'lenght'])).toEqual({ ok: false, message: "unknown field 'features.lenght' (did you mean 'features.length'?)" })
  })

  test('scopes are maps: an alias named like an Object.prototype member is a plain key', () => {
    const odd: Scope = withAlias(undefined, 'constructor', { list: schema.data!.properties.features as ListSchema, path: ['features'] })
    expect(resolvePath(schema, ['constructor'], odd)).toEqual({ ok: true, type: 'string' })
    expect(resolvePath(schema, ['toString'], odd)).toEqual({ ok: false, message: "unknown field 'toString'" })
    expect(scope.size).toBe(1)
    expect(withAlias(scope, 'x', { list: schema.data!.properties.features as ListSchema, path: ['features'] }).size).toBe(2)
    expect(scope.size).toBe(1)
  })
})

describe('resolveList', () => {
  const schema = valid(club)

  test('a list from data: its schema, field path, whether it is required, and the rows scope', () => {
    const result = resolveList(schema, 'member', ['members'])
    expect(result).toMatchObject({ ok: true, path: ['members'], required: true })
    expect(result.ok && result.list).toBe(schema.data!.properties.members as ListSchema)
    expect(result.ok && result.scope.get('member')).toEqual({ list: schema.data!.properties.members as ListSchema, path: ['members'] })
    expect(resolveList(schema, 'tag', ['features'])).toMatchObject({ ok: true, required: false })
  })

  test('the alias is a new name', () => {
    expect(resolveList(schema, 'route', ['members'])).toEqual({ ok: false, at: 'alias', message: "'route' is already the URL input; pick another name, such as member" })
    expect(resolveList(schema, 'title', ['members'])).toEqual({ ok: false, at: 'alias', message: "'title' is already a data field; pick another name, such as member" })
    expect(resolveList(schema, 'members', ['members'])).toEqual({ ok: false, at: 'alias', message: "'members' is already a data field; pick another name, such as member" })
    const polls = resolveList(schema, 'poll', ['polls'])
    if (!polls.ok) throw new Error(polls.message)
    expect(resolveList(schema, 'poll', ['poll', 'options'], polls.scope)).toEqual({
      ok: false,
      at: 'alias',
      message: "'poll' is already the item of the m-for over 'polls' around this one; pick another name, such as option",
    })
  })

  test('the suggested name is free: not the alias, route, a data field or an alias in scope', () => {
    const taken = valid({
      data: {
        type: 'object',
        properties: {
          member: { type: 'string' },
          item: { type: 'string' },
          stuff: { type: 'array', uniqueItems: true, items: { type: 'string' } },
          members: club.data.properties.members,
        },
      },
    })
    expect(resolveList(taken, 'item', ['stuff'])).toMatchObject({ message: "'item' is already a data field; pick another name, such as entry" })
    expect(resolveList(taken, 'item', ['members'])).toMatchObject({ message: "'item' is already a data field; pick another name, such as entry" })
    expect(resolveList(taken, 'member', ['members'])).toMatchObject({ message: "'member' is already a data field; pick another name, such as entry" })
    const crowded = valid({
      data: {
        type: 'object',
        properties: { item: { type: 'string' }, entry: { type: 'string' }, itemItem: { type: 'string' }, items: { type: 'array', uniqueItems: true, items: { type: 'string' } } },
      },
    })
    expect(resolveList(crowded, 'item', ['items'])).toMatchObject({ message: "'item' is already a data field; pick another name" })
  })

  test('the path leads to a list', () => {
    expect(resolveList(schema, 'x', ['route', 'query', 'tab'])).toEqual({
      ok: false,
      at: 'path',
      message: `'route.query.tab' is the URL input, which has no lists; m-for goes over a list field ("type": "array")`,
    })
    expect(resolveList(schema, 'x', ['title'])).toEqual({
      ok: false,
      at: 'path',
      message: `'title' is a string, not a list; m-for goes over a list field ("type": "array")`,
    })
    expect(resolveList(schema, 'x', ['members', 'length'])).toEqual({
      ok: false,
      at: 'path',
      message: "'members.length' is a count; m-for goes over the list itself: x in members",
    })
    expect(resolveList(schema, 'x', ['membres'])).toEqual({ ok: false, at: 'path', message: "unknown field 'membres' (did you mean 'members'?)" })
  })
})

describe('walking into lists', () => {
  const schema = valid(club)

  test('schemaFields lists each list, its items and their fields', () => {
    expect(schemaFields(schema).map(({ path }) => formatFieldPath(path))).toEqual([
      'members', 'members[]', 'members[].handle', 'members[].name', 'members[].bio', 'members[].url',
      'features', 'features[]', 'scores', 'scores[]',
      'polls', 'polls[]', 'polls[].id', 'polls[].options', 'polls[].options[]', 'polls[].options[].id', 'polls[].options[].length',
      'title',
    ])
  })

  test('leafPaths and linkFields go into the items', () => {
    expect(leafPaths(schema)).toEqual([
      'members[].handle', 'members[].name', 'members[].bio', 'members[].url', 'features[]', 'scores[]', 'polls[].id',
      'polls[].options[].id', 'polls[].options[].length', 'title',
    ])
    expect(linkFields(schema)).toEqual([{ path: ['members', '[]', 'url'], route: 'profile' }])
  })

  test('path helpers', () => {
    expect(formatFieldPath(['members', LIST_ITEMS, 'name'])).toBe('members[].name')
    expect(formatFieldPath(['tags', LIST_ITEMS])).toBe('tags[]')
    expect(schemaPathOf(['members', LIST_ITEMS, 'url'])).toBe('data.properties.members.items.properties.url')
    expect(schemaPathOf(['user', 'name'])).toBe('data.properties.user.properties.name')
    expect(indexPath('members', 2)).toBe('members[2]')
    expect(joinPath(indexPath('members', 2), 'name')).toBe('members[2].name')
    expect(joinPath(indexPath('members', 2), 'b c')).toBe('members[2]["b c"]')
  })

  test('itemName makes examples read naturally', () => {
    expect(['members', 'options', 'categories', 'boxes', 'matches', 'classes', 'status', 'data', 'x'].map(itemName)).toEqual([
      'member', 'option', 'category', 'box', 'match', 'class', 'item', 'item', 'item',
    ])
  })

  test('itemKey: the key field of an object, a string or number itself', () => {
    const list = schema.data!.properties.members as ListSchema
    expect(itemKey(list, { handle: 'ana' })).toBe('ana')
    expect(itemKey(list, { handle: 1 })).toBeUndefined()
    expect(itemKey(list, {})).toBeUndefined()
    expect(itemKey(list, 'ana')).toBeUndefined()
    const scores = schema.data!.properties.scores as ListSchema
    expect(itemKey(scores, 3)).toBe(3)
    expect(itemKey(scores, '3')).toBeUndefined()
    expect(itemKey(scores, Number.NaN)).toBeUndefined()
    expect(itemKey(schema.data!.properties.features as ListSchema, '__proto__')).toBe('__proto__')
  })
})
