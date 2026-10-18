// The checker and lists (SPEC D34) and event payloads (D35): paths inside rows, nested lists, a broken
// m-for, what counts as used, snapshot coverage of rows and list states, list snapshots and routes.

import { describe, expect, test } from 'bun:test'
import { validateRouteTable } from 'melzin/core'
import { type Diagnostic, type RouteContext, checkSource, loadViewSource } from '../src/check.ts'

function page(body: string, schema: unknown, snapshots: unknown): string {
  return [
    '<!doctype html>',
    '<html>',
    '<head>',
    '<title>T</title>',
    `<script type="melzin/schema">${JSON.stringify(schema, null, 2)}</script>`,
    `<script type="melzin/snapshots">${JSON.stringify(snapshots, null, 2)}</script>`,
    '</head>',
    '<body>',
    body,
    '</body>',
    '</html>',
  ].join('\n')
}

function messages(diagnostics: Diagnostic[]): string[] {
  return diagnostics.map((d) => `${d.severity}: ${d.message}`)
}

/** Position of the nth `needle` in `source` (1-based). */
function at(source: string, needle: string, nth = 0): { line: number; col: number } {
  let offset = -1
  for (let i = 0; i <= nth; i++) offset = source.indexOf(needle, offset + 1)
  if (offset < 0) throw new Error(`${needle} not found`)
  const before = source.slice(0, offset)
  return { line: before.split('\n').length, col: offset - before.lastIndexOf('\n') }
}

const MEMBER = {
  type: 'object',
  properties: {
    handle: { type: 'string' },
    name: { type: 'string' },
    verified: { type: 'boolean' },
    tags: { type: 'array', uniqueItems: true, items: { type: 'string' } },
  },
  required: ['handle', 'name'],
}
const SCHEMA = {
  data: {
    type: 'object',
    properties: { title: { type: 'string' }, members: { type: 'array', key: 'handle', items: MEMBER } },
    required: ['title', 'members'],
  },
}
const ANA = { handle: 'ana', name: 'Ana', verified: true, tags: ['design', 'code'] }
const BO = { handle: 'bo', name: 'Bo', tags: [] }
const SNAPSHOTS = { nobody: { data: { title: 'T', members: [] } }, two: { data: { title: 'T', members: [ANA, BO] } } }
// Uses every field, so only what a test adds can produce diagnostics.
const ROW = `<span m-text="member.name"></span><b m-show="member.verified">✓</b><i m-for="tag in member.tags" m-text="tag"></i>`
const LIST = `<h1 m-text="title"></h1><ul><li m-for="member in members">${ROW}</li></ul>`
const check = (body: string, schema: unknown = SCHEMA, snapshots: unknown = SNAPSHOTS): string[] => messages(checkSource(page(body, schema, snapshots)))

describe('paths inside rows', () => {
  test('a view that uses every field of its list is clean', () => {
    expect(check(LIST)).toEqual([])
  })

  test("the m-for element's own directives apply per row, whatever the attribute order", () => {
    const body = '<h1 m-text="title"></h1><ul><li m-text="member.name" m-show="member.verified" m-for="member in members"></li></ul>'
    const schema = { data: { ...SCHEMA.data, properties: { ...SCHEMA.data.properties, members: { type: 'array', key: 'handle', items: { ...MEMBER, properties: { handle: MEMBER.properties.handle, name: MEMBER.properties.name, verified: MEMBER.properties.verified } } } } } }
    const snapshots = { nobody: SNAPSHOTS.nobody, two: { data: { title: 'T', members: [{ handle: 'ana', name: 'Ana', verified: true }, { handle: 'bo', name: 'Bo' }] } } }
    expect(check(body, schema, snapshots)).toEqual([])
  })

  test('an alias is only known inside its rows, and an alias of strings is the string', () => {
    expect(check(`${LIST}<p m-text="member.name"></p>`)).toEqual(["error: m-text: unknown field 'member' (did you mean 'members'?)"])
    expect(check(LIST.replace('m-text="tag"', 'm-text="tag.label"'))).toEqual(["error: m-text: 'tag' is a string and has no fields"])
  })

  test('an inner alias must differ from the outer ones', () => {
    expect(check(LIST.replace('tag in member.tags" m-text="tag"', 'member in member.tags" m-text="member"'))).toEqual([
      "error: m-for: 'member' is already the item of the m-for over 'members' around this one; pick another name, such as tag",
    ])
  })

  test('route.* reads the URL anywhere, and is no list to repeat', () => {
    expect(check(LIST.replace('<ul>', '<ul><li m-for="param in route.params" m-text="param"></li>'))).toEqual([
      "error: m-for: 'route.params' is the URL input, which has no lists; m-for goes over a list field (\"type\": \"array\")",
    ])
  })

  test('the item of a list of objects always exists, so testing it always holds', () => {
    expect(check(LIST.replace('<span m-text="member.name"></span>', '<span m-if="member" m-text="member.name"></span>'))).toEqual([
      "warning: m-if: 'member' is a required object, so this condition is always true",
    ])
  })
})

describe('a broken m-for', () => {
  test("paths that may read its item aren't checked, so it's the only error, and \"never used\" waits", () => {
    expect(check(LIST.replace('member in members', 'member of members'))).toEqual([`error: m-for: use 'in': m-for="member in members"`])
    expect(check(LIST.replace('member in members', 'member in membrs'))).toEqual(["error: m-for: unknown field 'membrs' (did you mean 'members'?)"])
  })

  test('data fields inside it are still checked', () => {
    expect(check(LIST.replace('member in members', 'member in membrs').replace('<span m-text="member.name">', '<span m-text="titel">'))).toEqual([
      "error: m-for: unknown field 'membrs' (did you mean 'members'?)",
      "error: m-text: unknown field 'titel' (did you mean 'title'?)",
    ])
  })

  test('m-if, m-else-if or m-else on it: one error each, and the chain before it ends', () => {
    expect(check(LIST.replace('<li m-for="member in members">', '<li m-for="member in members" m-else>'))).toEqual([
      "error: m-else can't go on an element with m-for: wrap the list in an element with m-else, or put the condition inside the row; to show only some items, have the host filter the list",
    ])
    expect(check(`${LIST}<p m-if="title">x</p><p m-for="tag in members" m-text="tag.name"></p><p m-else>y</p>`)).toEqual([
      'error: m-else must come right after an element with m-if or m-else-if; an m-for element ends a chain: for when the list is empty, wrap the list in an element with m-if="members.length" and put m-else after the wrapper',
    ])
    // Text between them ends the chain anyway, so the hint is only for the element right after the list.
    expect(check(`${LIST}<p m-for="tag in members" m-text="tag.name"></p> or <p m-else>y</p>`)).toEqual([
      'error: m-else must come right after an element with m-if or m-else-if',
    ])
  })
})

describe('loops and bindings the runtime would not run', () => {
  const PICK = { ...SCHEMA, events: { pick: { payload: { type: 'object', properties: { handle: { type: 'string' } }, required: ['handle'] } } } }
  const PICK_ROW = `${ROW}<button m-on:click="emit('pick', { handle: member.handle })">Pick</button>`

  test("a Vue or Alpine loop is its only error, with the m-for to write; paths through its alias wait", () => {
    for (const loop of ['v-for="member in members"', 'v-for="(member, i) in members"', 'v-for="member of members"']) {
      expect(check(`<h1 m-text="title"></h1><ul><li ${loop}>${PICK_ROW}</li></ul>`, PICK)).toEqual([
        `error: 'v-for' is Vue/Alpine syntax; use m-for="member in members"`,
      ])
    }
    expect(check(`<h1 m-text="title"></h1><ul><li x-for="member in members">${PICK_ROW}</li></ul>`, PICK)).toEqual([
      `error: 'x-for' is Vue/Alpine syntax; use m-for="member in members" on the element to repeat (<template> isn't supported)`,
    ])
    // Like a broken m-for: other paths are still checked when the loop reads as one...
    expect(check(`<h1 m-text="title"></h1><ul><li v-for="member in members"><span m-text="titel"></span>${PICK_ROW}</li></ul>`, PICK)).toEqual([
      `error: 'v-for' is Vue/Alpine syntax; use m-for="member in members"`,
      "error: m-text: unknown field 'titel' (did you mean 'title'?)",
    ])
    // ...and without the item's name, the m-for names one after the list, and any path that doesn't start
    // with a data field waits (here 'name' and 'titel').
    expect(check(`<h1 m-text="title"></h1><ul><li v-for="{ name } in members"><span m-text="name"></span><i m-text="titel"></i></li></ul>`)).toEqual([
      `error: 'v-for' is Vue/Alpine syntax; use m-for="member in members"`,
    ])
  })

  test('m-if on the m-for element is still resolved in the row: a typo is reported, and what it reads is used', () => {
    const body = LIST.replace('<li m-for="member in members">', '<li m-for="member in members" m-if="member.verified">').replace('<b m-show="member.verified">✓</b>', '')
    const chain = "error: m-if can't go on an element with m-for: wrap the list in an element with m-if, or put the condition inside the row; to show only some items, have the host filter the list"
    expect(check(body)).toEqual([chain])
    expect(check(body.replace('m-if="member.verified"', 'm-if="member.verifed"'))).toEqual([chain, "error: m-if: unknown field 'member.verifed' (did you mean 'member.verified'?)"])
  })

  test('a <template> loop is its only error: what its content reads and emits waits for the fix', () => {
    for (const loop of ['m-for', 'v-for', 'x-for']) {
      expect(check(`<h1 m-text="title"></h1><ul><template ${loop}="member in members"><li>${PICK_ROW}</li></template></ul>`, PICK)).toEqual([
        "error: put m-for on the element to repeat; <template> isn't supported",
      ])
    }
  })

  test("an emit of an undeclared event is its only error: its payload's paths count as used, and the declared event waits", () => {
    const body = `<h1 m-text="title"></h1><ul><li m-for="member in members">${PICK_ROW.replace("'pick'", "'pik'").replace('<span m-text="member.name"></span>', '')}</li></ul>`
    const named = body.replace('{ handle: member.handle }', '{ handle: member.handle, name: member.name }')
    expect(check(named, PICK)).toEqual([`error: m-on:click: event 'pik' isn't declared in the schema's events (did you mean 'pick'?)`])
  })
})

describe('messages that name the fix', () => {
  test("a mustache's example binds its own path", () => {
    expect(check(LIST.replace('<span m-text="member.name"></span>', '<span m-text="member.name"></span>{{ member.handle }}'))).toEqual([
      `warning: '{{ member.handle }}' isn't Melzin syntax and would show as is; bind an empty element instead: <span m-text="member.handle"></span>`,
    ])
    expect(check(`${LIST}<p>{{ members.length + 1 }}</p>`)).toEqual([
      `warning: '{{ members.length + 1 }}' isn't Melzin syntax and would show as is; bind an empty element instead: <span m-text="<path>"></span>`,
    ])
  })

  test("a string's length in a condition: the string alone says whether it's empty", () => {
    expect(check(LIST.replace('<h1 m-text="title"></h1>', '<h1 m-if="title.length" m-text="title"></h1>'))).toEqual([
      "error: m-if: 'title' is a string and has no length; a condition on 'title' itself holds when it isn't empty",
    ])
  })

  test('a URL built in m-bind:href', () => {
    const builds = 'views never build URLs: bind a link field (a string field with "route": "<route name>" in the schema), which the source fills with href() (docs/authoring.md §3)'
    const row = (href: string): string => LIST.replace('<span m-text="member.name"></span>', `<a m-bind:href="${href}" m-text="member.name"></a>`)
    expect(check(row("&#39;/u/&#39; + member.handle"))).toEqual([`error: m-bind:href: unexpected character '+'; ${builds}`])
    expect(check(row('`/u/${member.handle}`'))).toEqual([`error: m-bind:href: unexpected character '\`'; ${builds}`])
    expect(check(row('href(&#39;profile&#39;, member.handle)'))).toEqual([`error: m-bind:href: m-bind:href needs a path such as author.profileUrl, not a call; ${builds}`])
  })

  test('a payload without fields is sent as {}', () => {
    const schema = { ...SCHEMA, events: { ping: { payload: { type: 'object', properties: {} } } } }
    expect(check(`${LIST}<button m-on:click="emit('ping')">Ping</button>`, schema)).toEqual([
      "error: m-on:click: event 'ping' has a payload; send it: emit('ping', {})",
    ])
    expect(check(`${LIST}<button m-on:click="emit('ping', {})">Ping</button>`, schema)).toEqual([])
  })
})

describe('nested lists', () => {
  const POLLS = {
    data: {
      type: 'object',
      properties: {
        polls: {
          type: 'array',
          key: 'id',
          items: {
            type: 'object',
            properties: {
              id: { type: 'string' },
              options: { type: 'array', key: 'id', items: { type: 'object', properties: { id: { type: 'string' }, label: { type: 'string' } }, required: ['id', 'label'] } },
            },
            required: ['id', 'options'],
          },
        },
      },
      required: ['polls'],
    },
    events: { vote: { payload: { type: 'object', properties: { pollId: { type: 'string' }, optionId: { type: 'string' } }, required: ['pollId', 'optionId'] } } },
  }
  const BODY = `<section m-for="poll in polls"><button m-for="option in poll.options" m-text="option.label" m-on:click="emit('vote', { pollId: poll.id, optionId: option.id })"></button></section>`
  const option = (id: string): unknown => ({ id, label: id.toUpperCase() })

  test('keys are unique per list instance: two polls may reuse option ids', () => {
    const snapshots = {
      none: { data: { polls: [] } },
      two: { data: { polls: [{ id: 'p', options: [option('a'), option('b')] }, { id: 'q', options: [option('a')] }, { id: 'r', options: [] }] } },
    }
    expect(check(BODY, POLLS, snapshots)).toEqual([])
    const duplicate = { ...snapshots, two: { data: { polls: [{ id: 'p', options: [option('a'), option('a')] }, { id: 'q', options: [] }] } } }
    const source = page(BODY, POLLS, duplicate)
    expect(checkSource(source)).toEqual([
      {
        ...at(source, '"id": "a"', 1),
        severity: 'error',
        message: 'snapshots["two"].data.polls[0].options[1].id: duplicate key "a": polls[0].options[0] has it too; keys must be unique in a list',
      },
    ])
  })

  test('list states count every instance, and are reported at the first m-for over the field', () => {
    const snapshots = { none: { data: { polls: [] } }, two: { data: { polls: [{ id: 'p', options: [option('a')] }, { id: 'q', options: [option('b')] }] } } }
    const source = page(BODY, POLLS, snapshots)
    expect(checkSource(source)).toEqual([
      { ...at(source, 'm-for="option'), severity: 'warning', message: `no snapshot shows 'poll.options' empty; add one to design the empty state, or set "minItems": 1 if it's never empty` },
      { ...at(source, 'm-for="option'), severity: 'warning', message: "no snapshot shows 'poll.options' with more than one item; add one, or set \"maxItems\": 1 if it never has more" },
    ])
  })
})

describe('what counts as used', () => {
  test("an m-for uses its list and the list's key; a list nothing uses is reported alone", () => {
    expect(check('<h1 m-text="title"></h1>')).toEqual(["warning: data field 'members' is never used"])
    expect(check('<h1 m-text="title"></h1><ul><li m-for="member in members">x</li></ul>')).toEqual([
      "warning: data field 'members[].name' is never used",
      "warning: data field 'members[].verified' is never used",
      "warning: data field 'members[].tags' is never used",
    ])
  })

  test("a list of strings is used when its alias is read", () => {
    expect(check(LIST.replace('m-text="tag"', ''))).toEqual(["warning: data field 'members[].tags[]' is never used"])
  })

  test("a .length condition uses the list but not its items' fields", () => {
    const body = '<h1 m-text="title"></h1><p m-if="members.length">Has members</p>'
    expect(check(body)).toEqual([
      "warning: data field 'members[].handle' is never used",
      "warning: data field 'members[].name' is never used",
      "warning: data field 'members[].verified' is never used",
      "warning: data field 'members[].tags' is never used",
    ])
  })

  test('payload values use what they read', () => {
    const schema = { ...SCHEMA, events: { pick: { payload: { type: 'object', properties: { verified: { type: 'boolean' } } } } } }
    const body = LIST.replace('<b m-show="member.verified">✓</b>', `<button m-on:click="emit('pick', { verified: member.verified })">✓</button>`)
    expect(check(body, schema)).toEqual([])
  })
})

describe('conditions on lists', () => {
  const OPTIONAL = { data: { ...SCHEMA.data, required: ['title'] } }

  test('an optional list holds even when empty; its length tells', () => {
    expect(check(LIST.replace('<ul>', '<ul m-if="members">'), OPTIONAL)).toEqual([
      "warning: m-if: 'members' is a list, so the condition holds even when it's empty; test members.length",
    ])
    // Every snapshot has the list, empty or not, so the warning shows its point.
    expect(check(`${LIST}<p m-if="!members">None</p>`, OPTIONAL)).toEqual([
      'warning: no snapshot shows this element; add one where m-if="!members" holds',
      "warning: m-if: 'members' is a list, so the condition doesn't hold when it's empty, only when it's missing; test !members.length",
    ])
    expect(check(`${LIST}<p m-if="!members">None</p>`)).toEqual([
      "warning: m-if: 'members' is a required list, so the condition never holds, even when it's empty; test !members.length",
    ])
  })

  test('the empty state of a list: .length conditions, with a missing optional list as empty', () => {
    const body = `<h1 m-text="title"></h1><ul m-if="members.length"><li m-for="member in members">${ROW}</li></ul><p m-else>No members yet</p>`
    expect(check(body)).toEqual([])
    const missing = { nobody: { data: { title: 'T' } }, two: SNAPSHOTS.two }
    expect(check(body, OPTIONAL, missing)).toEqual([])
    expect(check(body, OPTIONAL, { two: SNAPSHOTS.two })).toEqual([
      `warning: no snapshot shows 'members' empty; add one to design the empty state, or set "minItems": 1 if it's never empty`,
      'warning: no snapshot shows this element; add one where the conditions before its m-else are all false',
    ])
  })
})

describe('snapshot coverage in rows', () => {
  test('an element in a row shows when it shows in any row of any snapshot', () => {
    const body = LIST.replace('<b m-show="member.verified">✓</b>', '<b m-if="member.verified">✓</b><b m-else>?</b>')
    expect(check(body)).toEqual([])
    expect(check(body, SCHEMA, { ...SNAPSHOTS, two: { data: { title: 'T', members: [BO, { ...BO, handle: 'cy', tags: ['x', 'y'] }] } } })).toEqual([
      'warning: no snapshot shows this element; add one where m-if="member.verified" holds',
    ])
  })

  test('a list whose items only show where an element around it is hidden', () => {
    const schema = { data: { ...SCHEMA.data, properties: { ...SCHEMA.data.properties, open: { type: 'boolean' } } } }
    const snapshots = { closed: SNAPSHOTS.two, open: { data: { title: 'T', open: true, members: [] } } }
    expect(check(LIST.replace('<ul>', '<ul m-show="open">'), schema, snapshots)).toEqual([
      "warning: no snapshot shows a row of 'members'; it only has items where an element around it is hidden",
    ])
  })

  test('conditions in a row that only hold in rows an element around it hides', () => {
    // Verified members always have tags; only the others have none.
    const snapshots = { nobody: SNAPSHOTS.nobody, two: { data: { title: 'T', members: [ANA, BO, { ...ANA, handle: 'cy', tags: [], verified: false }] } } }
    const body = LIST.replace('<b m-show="member.verified">✓</b>', '<div m-if="member.verified"><b m-if="!member.tags.length">No tags</b></div>')
    const source = page(body, SCHEMA, snapshots)
    expect(checkSource(source)).toEqual([
      { ...at(source, 'm-if="!member'), severity: 'warning', message: 'no snapshot shows this element; its conditions only hold where an element around it is hidden' },
    ])
  })

  test('a list missing everywhere; elements inside rows that never show are not reported again', () => {
    const optional = { data: { ...SCHEMA.data, required: ['title'] } }
    const body = LIST.replace('<span m-text="member.name"></span>', '<span m-if="member.verified" m-text="member.name"></span>')
    expect(check(body, optional, { nobody: { data: { title: 'T' } } })).toEqual([
      "warning: no snapshot shows a row of 'members' (it's missing in every snapshot); add a snapshot where it has items",
    ])
    expect(check(LIST, SCHEMA, { nobody: SNAPSHOTS.nobody, alone: { data: { title: 'T', members: [{ ...BO, verified: true }] } } })).toEqual([
      "warning: no snapshot shows 'members' with more than one item; add one, or set \"maxItems\": 1 if it never has more",
      "warning: no snapshot shows a row of 'member.tags' (it's empty in every snapshot that shows it); add a snapshot where it has items",
    ])
  })

  test('minItems of 1 or more skips the empty state, maxItems of 1 the several items', () => {
    const limited = (list: object): unknown => ({ data: { ...SCHEMA.data, properties: { ...SCHEMA.data.properties, members: { ...SCHEMA.data.properties.members, ...list } } } })
    expect(check(LIST, limited({ minItems: 1 }), { two: SNAPSHOTS.two })).toEqual([])
    expect(check(LIST, limited({ maxItems: 1 }), { nobody: SNAPSHOTS.nobody, ana: { data: { title: 'T', members: [ANA] } }, bo: { data: { title: 'T', members: [BO] } } })).toEqual([])
    expect(check(LIST, limited({ maxItems: 0 }), { nobody: SNAPSHOTS.nobody })).toEqual([
      `warning: no snapshot shows a row of 'members' (it's empty in every snapshot); "maxItems": 0 keeps it empty: raise it, or remove the m-for`,
    ])
  })

  test('several items count only where the list shows; the empty state counts everywhere', () => {
    const schema = { data: { ...SCHEMA.data, properties: { ...SCHEMA.data.properties, open: { type: 'boolean' } } } }
    const body = LIST.replace('<ul>', '<ul m-if="open">')
    const one = { data: { title: 'T', open: true, members: [ANA] } }
    const closed = { data: { title: 'T', members: [ANA, BO] } }
    expect(check(body, schema, { empty: { data: { title: 'T', open: true, members: [] } }, one, closed })).toEqual([
      "warning: no snapshot shows 'members' with more than one item; it only has several where an element around it is hidden",
    ])
    // The empty list may be hidden on purpose (m-if on its length, with an m-else).
    expect(check(body, schema, { empty: { data: { title: 'T', members: [] } }, one, open: { data: { ...closed.data, open: true } } })).toEqual([])
  })

  test("a constant condition is warned about once, and doesn't hide what's inside it from the other checks", () => {
    const alone = { alone: { data: { title: 'T', members: [ANA] } } }
    expect(check(LIST.replace('<ul>', '<ul m-if="members">'), SCHEMA, alone)).toEqual([
      "warning: m-if: 'members' is a required list, so the condition always holds, even when it's empty; test members.length",
      `warning: no snapshot shows 'members' empty; add one to design the empty state, or set "minItems": 1 if it's never empty`,
      'warning: no snapshot shows \'members\' with more than one item; add one, or set "maxItems": 1 if it never has more',
      `warning: no snapshot shows 'member.tags' empty; add one to design the empty state, or set "minItems": 1 if it's never empty`,
    ])
    const user = { data: { ...SCHEMA.data, properties: { ...SCHEMA.data.properties, user: { type: 'object', properties: { name: { type: 'string' } } } }, required: ['title', 'members', 'user'] } }
    const withUser = { nobody: { data: { ...SNAPSHOTS.nobody.data, user: {} } }, two: { data: { ...SNAPSHOTS.two.data, user: { name: 'Ana' } } } }
    expect(check(`${LIST}<div m-if="user"><p m-show="user.name" m-text="user.name"></p></div>`, user, withUser)).toEqual([
      "warning: m-if: 'user' is a required object, so this condition is always true",
    ])
    const named = { nobody: { data: { ...SNAPSHOTS.nobody.data, user: { name: 'Bo' } } }, two: withUser.two }
    expect(check(`${LIST}<div m-if="user"><p m-show="!user.name" m-text="user.name"></p></div>`, user, named)).toEqual([
      "warning: m-if: 'user' is a required object, so this condition is always true",
      'warning: no snapshot shows this element; add one where m-show="!user.name" holds',
    ])
    // One that never holds hides its element: only its own warning, not "no snapshot shows this element".
    expect(check(`${LIST}<div m-if="!user"><p m-show="title">None</p></div><p m-else m-text="user.name"></p>`, user, withUser)).toEqual([
      "warning: m-if: 'user' is a required object, so this condition is always false",
    ])
  })

  test('a static id inside a row', () => {
    const source = page(LIST.replace('<span m-text', '<span id="name" m-text'), SCHEMA, SNAPSHOTS)
    expect(checkSource(source)).toEqual([{ ...at(source, 'id="name"'), severity: 'warning', message: 'every row gets the same id, but ids must be unique in a page; remove the id' }])
  })
})

describe('list snapshots', () => {
  test('null inside a list is never a removal: it gets its own error, not the "removes nothing" warning', () => {
    const snapshots = { nobody: SNAPSHOTS.nobody, two: { data: { title: 'T', members: [{ ...ANA, verified: null }, BO] } }, more: { extends: 'two', data: { members: [ANA, null] } } }
    const source = page(LIST, SCHEMA, snapshots)
    expect(checkSource(source)).toEqual([
      { ...at(source, '"verified": null'), severity: 'error', message: 'snapshots["two"].data.members[0].verified: expected boolean, got null; leave the field out to make it missing' },
      { ...at(source, 'null', 1), severity: 'error', message: `snapshots["more"].data.members[1]: a list item can't be null; leave it out of the list` },
    ])
  })

  test('a problem in an inherited list is reported at the base; a snapshot that restates the list owns its problems', () => {
    const duplicate = [ANA, { ...BO, handle: 'ana' }]
    const snapshots = {
      nobody: SNAPSHOTS.nobody,
      two: { data: { title: 'T', members: duplicate } },
      renamed: { extends: 'two', data: { title: 'Team' } },
      restated: { extends: 'two', data: { members: duplicate } },
    }
    const source = page(LIST, SCHEMA, snapshots)
    const message = (name: string): string => `snapshots["${name}"].data.members[1].handle: duplicate key "ana": members[0] has it too; keys must be unique in a list`
    expect(checkSource(source)).toEqual([
      { ...at(source, '"handle": "ana"', 1), severity: 'error', message: message('two') },
      { ...at(source, '"handle": "ana"', 3), severity: 'error', message: message('restated') },
    ])
  })
})

describe('lists and routes', () => {
  const ROUTES: RouteContext = {
    present: true,
    table: validateRouteTable({ routes: { members: { path: '/', view: 'members' }, profile: { path: '/u/:handle', view: 'profile' } } }).table,
  }
  const LINKED = {
    data: {
      type: 'object',
      properties: {
        members: {
          type: 'array',
          key: 'handle',
          items: { type: 'object', properties: { handle: { type: 'string' }, url: { type: 'string', route: 'profile' } }, required: ['handle', 'url'] },
        },
      },
      required: ['members'],
    },
  }
  const BODY = '<ul><li m-for="member in members"><a m-bind:href="member.url" m-text="member.handle"></a></li></ul>'
  const linked = (members: unknown[]): unknown => ({ data: { members } })

  test("each item's link is a URL of its route, at the item's position; inherited ones at the base", () => {
    const snapshots = {
      nobody: linked([]),
      two: linked([{ handle: 'ana', url: '/u/ana' }, { handle: 'bo', url: '/' }]),
      again: { extends: 'two', route: { query: {} } },
    }
    const source = page(BODY, LINKED, snapshots)
    expect(checkSource(source, 'members.mel.html', ROUTES)).toEqual([
      { ...at(source, '"url": "/"'), severity: 'error', message: `snapshots["two"].data.members[1].url: '/' isn't a URL of route 'profile' (/u/:handle); it's a URL of route 'members'` },
    ])
  })

  test('a link field inside items names a route of routes.json, and makes the view a contract', () => {
    const typo = { data: { ...LINKED.data, properties: { members: { ...LINKED.data.properties.members, items: { ...LINKED.data.properties.members.items, properties: { handle: { type: 'string' }, url: { type: 'string', route: 'profle' } } } } } } }
    expect(messages(checkSource(page(BODY, typo, { nobody: linked([]), two: linked([{ handle: 'a', url: '/u/a' }, { handle: 'b', url: '/u/b' }]) }), 'members.mel.html', ROUTES))).toEqual([
      "error: link field 'members[].url' names route 'profle', which isn't in routes.json (did you mean 'profile'?)",
    ])
    expect(loadViewSource(page(BODY, LINKED, { nobody: linked([]) })).stage).toBe('contracts')
    expect(loadViewSource(page(LIST, SCHEMA, SNAPSHOTS)).stage).toBe('states')
  })

  test('payload values from the URL: parameters are checked against the routes, and a query may be missing', () => {
    const schema = {
      data: { type: 'object', properties: { name: { type: 'string' } }, required: ['name'] },
      events: { follow: { payload: { type: 'object', properties: { handle: { type: 'string' }, as: { type: 'string' } }, required: ['handle', 'as'] } } },
    }
    const snapshots = { ana: { data: { name: 'Ana' }, route: { params: { handle: 'ana' } } } }
    const body = `<h1 m-text="name"></h1><button m-on:click="emit('follow', { handle: route.params.hande, as: route.query.as })">Follow</button>`
    expect(messages(checkSource(page(body, schema, snapshots), 'profile.mel.html', ROUTES))).toEqual([
      'warning: snapshots["ana"] has no route.params.hande, which the view shows; add "route": { "params": { "hande": "..." } }',
      "error: route.params.hande: route 'profile' (/u/:handle) has no :hande parameter (did you mean 'route.params.handle'?)",
      "error: m-on:click: 'route.query.as' may be missing, but the payload requires 'as'",
      "error: route.query.as: route 'profile' doesn't declare the query parameter 'as'; add \"as\": {} to its query in routes.json",
    ])
  })
})

describe('payload fixes in the event\'s terms', () => {
  const INBOX = {
    data: {
      type: 'object',
      properties: {
        filters: { type: 'array', uniqueItems: true, items: { type: 'string' } },
        notifications: {
          type: 'array',
          key: 'id',
          items: { type: 'object', properties: { id: { type: 'string' }, title: { type: 'string' } }, required: ['id', 'title'] },
        },
      },
      required: ['filters', 'notifications'],
    },
    events: {
      selectFilter: { payload: { type: 'object', properties: { filter: { type: 'string' } }, required: ['filter'] } },
      markRead: { payload: { type: 'object', properties: { notificationId: { type: 'string' } }, required: ['notificationId'] } },
      refresh: {},
    },
  }
  const INBOX_SNAPSHOTS = {
    empty: { data: { filters: [], notifications: [] } },
    full: { data: { filters: ['all', 'unread'], notifications: [{ id: '1', title: 'A' }, { id: '2', title: 'B' }] } },
  }
  const inbox = (filterClick: string, notificationClick: string): string[] =>
    check(
      `<button m-on:click="emit('refresh')">Refresh</button>` +
        `<ul><li m-for="filter in filters"><button m-on:click="${filterClick}" m-text="filter"></button></li></ul>` +
        `<ul><li m-for="notification in notifications"><button m-on:click="${notificationClick}" m-text="notification.title"></button></li></ul>`,
      INBOX,
      INBOX_SNAPSHOTS,
    )
  const FILTER = "emit('selectFilter', { filter: filter })"
  const MARK = "emit('markRead', { notificationId: notification.id })"

  test('the fixes, written as suggested, pass', () => {
    expect(inbox(FILTER, MARK)).toEqual([])
  })

  test("a positional value goes in the event's only field", () => {
    expect(inbox("emit('selectFilter', filter)", MARK)).toEqual([`error: m-on:click: a payload is an object of named fields: ${FILTER}`])
    expect(inbox(FILTER, "emit('markRead', notification.id)")).toEqual([`error: m-on:click: a payload is an object of named fields: ${MARK}`])
  })

  test("a literal or $event gets the event's field, filled from the row's alias and key", () => {
    expect(inbox(FILTER, "emit('markRead', $event)")).toEqual([`error: m-on:click: a payload is an object of named fields: ${MARK}`])
    expect(inbox("emit('selectFilter', &#39;all&#39;)", MARK)).toEqual([`error: m-on:click: a payload is an object of named fields: ${FILTER}`])
  })

  test('shorthand and quoted names: the path from the row in scope', () => {
    expect(inbox("emit('selectFilter', { filter })", MARK)).toEqual(["error: m-on:click: write the value's path too: { filter: filter }"])
    expect(inbox(FILTER, "emit('markRead', { notificationId })")).toEqual(["error: m-on:click: write the value's path too: { notificationId: notification.id }"])
    expect(inbox(FILTER, "emit('markRead', { &#39;notificationId&#39;: notification.id })")).toEqual([
      'error: m-on:click: write field names without quotes: { notificationId: notification.id }',
    ])
  })

  test('a payload for an event declared without one', () => {
    expect(inbox(FILTER, "emit('refresh', notification.id)")).toEqual([
      "error: m-on:click: event 'refresh' has no payload; send emit('refresh'), or declare its payload in the schema's events",
    ])
  })
})
