// Checker edge cases on inline sources: positions, schema-less views, invalid schemas, odd markup.

import { describe, expect, test } from 'bun:test'
import { type Diagnostic, checkSource } from '../src/check.ts'

const SCHEMA = '{ "data": { "type": "object", "properties": { "count": { "type": "number" } }, "required": ["count"] }, "events": { "increment": {} } }'
const SNAPSHOTS = '{ "zero": { "data": { "count": 0 } } }'

function page(body: string, { schema = SCHEMA as string | null, snapshots = SNAPSHOTS as string | null, head = '' } = {}): string {
  return [
    '<!doctype html>',
    '<html>',
    '<head>',
    '<title>T</title>',
    schema === null ? '' : `<script type="melzin/schema">${schema}</script>`,
    snapshots === null ? '' : `<script type="melzin/snapshots">${snapshots}</script>`,
    head,
    '</head>',
    '<body>',
    body,
    '</body>',
    '</html>',
  ].join('\n')
}

const CLEAN_BODY = `<p m-text="count"></p><button m-on:click="emit('increment')">+</button>`

function messages(diagnostics: Diagnostic[]): string[] {
  return diagnostics.map((d) => `${d.severity}: ${d.message}`)
}

/** Position of `needle` in `source` (1-based). */
function at(source: string, needle: string, shift = 0): { line: number; col: number } {
  const offset = source.indexOf(needle) + shift
  const before = source.slice(0, offset)
  return { line: before.split('\n').length, col: offset - before.lastIndexOf('\n') }
}

describe('positions', () => {
  test('points inside unquoted and single-quoted values', () => {
    const source = page(`<p m-text=cuont></p><p m-text='count'></p><button m-on:click='emit("nope")'>x</button><button m-on:click="emit('increment')">+</button>`)
    const diagnostics = checkSource(source)
    expect(diagnostics).toEqual([
      { ...at(source, 'cuont'), severity: 'error', message: "m-text: unknown field 'cuont' (did you mean 'count'?)" },
      { ...at(source, 'nope'), severity: 'error', message: 'm-on:click: event \'nope\' isn\'t declared in the schema\'s events (add "nope": {} to the schema\'s events)' },
    ])
  })

  test('falls back to the start of the value when it uses character references', () => {
    const source = page(`<p m-text="count&#46;&#46;x"></p>${CLEAN_BODY}`)
    const [first] = checkSource(source)
    expect(first).toMatchObject({ ...at(source, 'count&#46;'), message: "m-text: expected a name after '.', found '.'" })
  })

  test('whitespace around a path is fine and the position skips it', () => {
    const source = page(`<p m-text="  cuont "></p>${CLEAN_BODY}`)
    expect(checkSource(source)[0]).toMatchObject(at(source, 'cuont'))
  })

  test('CRLF line endings', () => {
    const source = page(`<p m-text="count"></p>\n<p m-text="nope"></p>\n<button m-on:click="emit('increment')">+</button>`).replaceAll('\n', '\r\n')
    expect(checkSource(source)).toEqual([{ line: 11, col: 12, severity: 'error', message: "m-text: unknown field 'nope'" }])
  })

  test('exact JSON position for schema issues, missing fields point at their parent', () => {
    const snapshots = '{\n  "zero": { "data": {} }\n}'
    const source = page(CLEAN_BODY, { snapshots })
    expect(checkSource(source)).toEqual([
      { ...at(source, '"data": {}'), severity: 'error', message: `snapshots["zero"].data.count: missing required field 'count'` },
    ])
  })

  test('diagnostics are sorted by position', () => {
    const source = page(`<p v-text="count" m-text="count">x</p>\n<button m-on:click="emit('increment')" @click="x">+</button>`)
    const diagnostics = checkSource(source)
    const keys = diagnostics.map((d) => d.line * 1000 + d.col)
    expect(keys).toEqual([...keys].sort((a, b) => a - b))
    expect(diagnostics).toHaveLength(3)
  })
})

describe('schema-less views', () => {
  test('a static view is clean', () => {
    expect(checkSource(page('<h1 class="text-xl">Hi</h1>', { schema: null, snapshots: null }), 'a.mel.html')).toEqual([])
  })

  test('m-text and m-on:click need a schema', () => {
    const source = page(`<p m-text="count"></p><button m-on:click="emit('go')">x</button>`, { schema: null, snapshots: null })
    expect(messages(checkSource(source))).toEqual([
      "error: m-text: unknown field 'count' (the view has no melzin/schema block)",
      "error: m-on:click: event 'go' isn't declared in the schema's events (the view has no melzin/schema block)",
    ])
  })

  test('snapshots without a schema may only hold empty data', () => {
    const source = page('<p>x</p>', { schema: null, snapshots: '{ "a": { "data": { "count": 1 } }, "b": {} }' })
    expect(messages(checkSource(source))).toEqual(["error: snapshots[\"a\"].data.count: unknown field 'count'"])
  })
})

describe('invalid schema', () => {
  test('only the schema issue is reported, not path or event checks that depend on it', () => {
    const source = page(`<p m-text="anything"></p><button m-on:click="emit('whatever')">x</button>`, {
      schema: '{ "data": { "type": "object", "properties": {} }, "ui": {} }',
      snapshots: '{ "a": { "data": { "zzz": 1 } } }',
    })
    expect(messages(checkSource(source))).toEqual(["error: schema ui: internal state (ui) isn't supported yet; let the host send that state as data"])
  })

  test('schema issue without a path points at the block start', () => {
    const source = page(CLEAN_BODY, { schema: '  []', snapshots: null })
    expect(checkSource(source)).toEqual([
      {
        ...at(source, '[]'),
        severity: 'error',
        message: "schema: the schema must be a JSON object with 'data' and/or 'events', got array",
      },
    ])
  })

  test('an empty data block', () => {
    const source = page(CLEAN_BODY, { schema: '' })
    expect(messages(checkSource(source))).toEqual(['error: invalid JSON in the melzin/schema block: the block is empty; it needs a JSON object'])
  })

  test('an event payload is an object schema', () => {
    const source = page(CLEAN_BODY, {
      schema: '{ "data": { "type": "object", "properties": { "count": { "type": "number" } } }, "events": { "increment": { "payload": {} } } }',
    })
    expect(messages(checkSource(source))).toEqual([
      'error: schema events.increment.payload: a payload is an object schema of named fields: { "type": "object", "properties": { "optionId": { "type": "string" } } }',
    ])
  })
})

describe('markup', () => {
  test('directive names are case-insensitive (HTML lowercases them)', () => {
    expect(checkSource(page(`<p M-TEXT="count"></p><button M-ON:CLICK="emit('increment')">+</button>`))).toEqual([])
  })

  test('a data block in the body belongs in the head', () => {
    const source = page(`${CLEAN_BODY}<script type="melzin/snapshots">{}</script>`)
    expect(messages(checkSource(source))).toEqual(['error: the melzin/snapshots block belongs in <head>'])
  })

  test('only one title; an empty title warns', () => {
    expect(messages(checkSource(page(CLEAN_BODY, { head: '<title>Again</title>' })))).toEqual(['error: a view has only one <title>'])
    const empty = page(CLEAN_BODY).replace('<title>T</title>', '<title> </title>')
    expect(messages(checkSource(empty))).toEqual(['warning: <title> is empty; the title names the view in the shell'])
  })

  test('<style> in head', () => {
    expect(messages(checkSource(page(CLEAN_BODY, { head: '<style>p{}</style>' })))).toEqual([
      "error: <style> isn't allowed in <head>; it may only hold <title>, <meta> and the melzin/schema and melzin/snapshots blocks (styling is Tailwind classes only)",
    ])
  })

  test('other callees and extra arguments in m-on:click', () => {
    const source = page(`<p m-text="count"></p><button m-on:click="save()">x</button><button m-on:click="emit('increment', 'x')">+</button>`)
    expect(messages(checkSource(source))).toEqual([
      "error: m-on:click: only emit('name') is supported for now; did you mean emit('save')?",
      "error: m-on:click: event 'increment' has no payload; send emit('increment'), or declare its payload in the schema's events",
    ])
  })

  test('<template> is an error, and its content (never bound by the runtime) is not counted as used', () => {
    expect(messages(checkSource(page(`<button m-on:click="emit('increment')">+</button><template><p m-text="count"></p></template>`)))).toEqual([
      "warning: data field 'count' is never used",
      'error: <template> isn\'t supported; to group elements, wrap them in one element, such as <div class="contents">',
    ])
  })

  test('nested leaves and partial display', () => {
    const schema =
      '{ "data": { "type": "object", "properties": { "user": { "type": "object", "properties": { "name": { "type": "string" }, "bio": { "type": "string" } } } } } }'
    expect(messages(checkSource(page('<p m-text="user.name"></p>', { schema, snapshots: '{ "a": {} }' })))).toEqual([
      "warning: data field 'user.bio' is never used",
    ])
    // A broken binding may be the missing use, so "never used" waits until it's fixed.
    expect(messages(checkSource(page('<p m-text="user.name"></p><p m-text="user.name.first"></p>', { schema, snapshots: '{ "a": {} }' })))).toEqual([
      "error: m-text: 'user.name' is a string and has no fields",
    ])
  })

  test('a literal <body inside a data block does not confuse head detection', () => {
    const schema = '{ "data": { "type": "object", "properties": { "count": { "type": "number", "description": "<body> count" } } }, "events": { "increment": {} } }'
    expect(checkSource(page(CLEAN_BODY, { schema }))).toEqual([])
  })
})

describe('review fixes', () => {
  test('a byte order mark does not shift columns', () => {
    const source = page('<p m-text="zz"></p>')
    expect(checkSource(`﻿${source}`)).toEqual(checkSource(source))
  })

  test('<noscript> content is checked, as the runtime parses it as elements', () => {
    expect(messages(checkSource(page(`${CLEAN_BODY}<noscript><p m-text="zz"></p><script>x()</script></noscript>`)))).toEqual([
      "error: m-text: unknown field 'zz'",
      "error: <script> isn't allowed in the body; views have no scripts",
    ])
  })

  test('stray text in <head> without a <body> tag is reported where it is', () => {
    const source = '<html><head><title>x</title>hello<script type="melzin/schema">{}</script></head><p></p></html>'
    expect(checkSource(source)).toEqual([{ ...at(source, 'hello'), severity: 'error', message: "text isn't allowed in <head>; it may only hold <title>, <meta> and the melzin/schema and melzin/snapshots blocks" }])
  })

  test('data block types ignore case and surrounding spaces, like the runtime', () => {
    const source = page(CLEAN_BODY).replace('type="melzin/schema"', 'type=" Melzin/Schema "')
    expect(checkSource(source)).toEqual([])
  })

  test('SVG <script> and <style> in the body are errors; SVG <title> is fine', () => {
    expect(messages(checkSource(page(`${CLEAN_BODY}<svg><title>Icon</title><script>x()</script><style>*{}</style></svg>`)))).toEqual([
      "error: <script> isn't allowed in the body; views have no scripts",
      "error: <style> isn't allowed; styling is Tailwind classes only, with design tokens in theme.css",
    ])
  })

  test("a path starting with 'data.' gets a hint", () => {
    expect(messages(checkSource(page(`<p m-text="data.count"></p><button m-on:click="emit('increment')">+</button>`)))).toEqual([
      "error: m-text: unknown field 'data' (paths start inside data: use 'count')",
    ])
  })

  test('a broken m-on:click silences "nothing emits it" until it is fixed', () => {
    expect(messages(checkSource(page(`<p m-text="count"></p><button m-on:click="emit(increment)">+</button>`)))).toEqual([
      "error: m-on:click: expected a string, found 'increment' (quote it: 'increment')",
    ])
  })

  test('a file with the wrong name gets only that error', () => {
    expect(messages(checkSource('just some notes', '/x/readme.txt'))).toEqual(["error: view files must be named *.mel.html (got 'readme.txt')"])
  })
})

describe('conditions', () => {
  const FLAGS = JSON.stringify({
    data: {
      type: 'object',
      properties: {
        count: { type: 'number' },
        verified: { type: 'boolean' },
        member: { type: 'boolean', default: true },
        viewer: { type: 'object', properties: { following: { type: 'boolean' } }, required: ['following'] },
        user: { type: 'object', properties: { name: { type: 'string' } }, required: ['name'] },
      },
      required: ['count', 'user'],
    },
    events: { increment: {} },
  })
  const SNAPSHOTS = {
    'signed out': { data: { count: 0, user: { name: 'A' } } },
    following: { data: { count: 1, verified: true, member: false, user: { name: 'B' }, viewer: { following: true } } },
    'not following': { data: { count: 2, user: { name: 'C' }, viewer: { following: false } } },
  }
  // Uses every leaf, so only what a test adds can produce diagnostics.
  const USES = `<p m-text="count"></p><p m-text="user.name"></p><button m-on:click="emit('increment')">+</button>
<i m-text="verified"></i><i m-text="viewer.following"></i><i m-text="member"></i>`
  const flags = (body: string, snapshots: unknown = SNAPSHOTS): string =>
    page(`${USES}\n${body}`, { schema: FLAGS, snapshots: JSON.stringify(snapshots) })

  test('booleans, defaults, optional objects and negation, all covered by the snapshots', () => {
    const body = `<b m-if="!viewer">Sign in</b>
<b m-else-if="viewer.following">Following</b>
<b m-else>Follow</b>
<b m-if="member">Member</b><b m-else>Guest</b>`
    expect(checkSource(flags(body))).toEqual([])
  })

  test('a condition counts as a use of its field; a broken one silences "never used"', () => {
    const schema = '{ "data": { "type": "object", "properties": { "verified": { "type": "boolean" } } } }'
    const snapshots = '{ "yes": { "data": { "verified": true } } }'
    expect(checkSource(page('<b m-if="verified">✓</b>', { schema, snapshots }))).toEqual([])
    expect(messages(checkSource(page('<b m-if="verifed">✓</b>', { schema, snapshots })))).toEqual([
      "error: m-if: unknown field 'verifed' (did you mean 'verified'?)",
    ])
  })

  test('comments and whitespace may sit between the branches; text or another element ends the chain', () => {
    expect(checkSource(flags('<b m-if="verified">a</b>\n  <!-- or -->\n  <b m-else>b</b>'))).toEqual([])
    expect(messages(checkSource(flags('<b m-if="verified">a</b><hr><b m-else>b</b>')))).toEqual([
      'error: m-else must come right after an element with m-if or m-else-if',
    ])
    expect(messages(checkSource(flags('<b m-if="verified">a</b>&nbsp;<b m-else>b</b>')))).toEqual([
      'error: m-else must come right after an element with m-if or m-else-if',
    ])
  })

  test('an element the runtime drops does not end a chain', () => {
    expect(messages(checkSource(flags('<b m-if="verified">a</b><script>x()</script><b m-else>b</b>')))).toEqual([
      "error: <script> isn't allowed in the body; views have no scripts",
    ])
  })

  test('an m-else-if with no chain starts one, so only it is reported', () => {
    expect(messages(checkSource(flags('<b m-else-if="verified">a</b><b m-else>b</b>')))).toEqual([
      'error: m-else-if must come right after an element with m-if or m-else-if',
    ])
  })

  test('positions point at the path after the !, and m-text takes no !', () => {
    const source = flags('<b m-if="! verifed">a</b>')
    expect(checkSource(source)).toEqual([
      { ...at(source, 'verifed"'), severity: 'error', message: "m-if: unknown field 'verifed' (did you mean 'verified'?)" },
    ])
    expect(messages(checkSource(flags('<p m-text="!count"></p>')))).toEqual([
      "error: m-text: m-text needs a path such as user.name; '!' only works in conditions (m-if, m-show)",
    ])
  })

  test('a required object is always present', () => {
    expect(messages(checkSource(flags('<b m-if="!user">Nobody</b>')))).toEqual([
      "warning: m-if: 'user' is a required object, so this condition is always false",
    ])
  })

  describe('snapshot coverage', () => {
    test('an m-else that no snapshot reaches', () => {
      const source = flags('<b m-if="count">Some</b><b m-else>None</b>', { ...SNAPSHOTS, 'signed out': { data: { count: 5, user: { name: 'A' } } } })
      expect(checkSource(source)).toEqual([
        {
          ...at(source, 'm-else>None'),
          severity: 'warning',
          message: 'no snapshot shows this element; add one where the conditions before its m-else are all false',
        },
      ])
    })

    test('defaults decide when the snapshots leave a field out', () => {
      const snapshots = { a: { data: { count: 0, user: { name: 'A' }, verified: true, viewer: { following: true } } } }
      expect(messages(checkSource(flags('<b m-if="!member">Guest</b>', snapshots)))).toEqual([
        'warning: no snapshot shows this element; add one where m-if="!member" holds',
      ])
    })

    test('m-if and m-show on one element must hold together', () => {
      expect(messages(checkSource(flags('<b m-if="viewer" m-show="count">x</b>', { following: SNAPSHOTS.following, 'signed out': SNAPSHOTS['signed out'] })))).toEqual([])
      expect(messages(checkSource(flags('<b m-if="viewer" m-show="!count">x</b>')))).toEqual([
        'warning: no snapshot shows this element; add one where m-if="viewer" holds and m-show="!count" holds',
      ])
    })

    test('inside another condition: reported when its own conditions only hold where the outer element is hidden', () => {
      const snapshots = { 'signed out': SNAPSHOTS['signed out'], following: SNAPSHOTS.following }
      expect(messages(checkSource(flags('<div m-if="viewer"><b m-if="!viewer.following">Follow</b></div>', snapshots)))).toEqual([
        'warning: no snapshot shows this element; its conditions only hold where an element around it is hidden',
      ])
    })

    test('an element inside one that never shows is not reported again', () => {
      const snapshots = { 'signed out': SNAPSHOTS['signed out'], 'not following': SNAPSHOTS['not following'] }
      expect(messages(checkSource(flags('<div m-if="verified"><b m-show="viewer.following">x</b></div>', snapshots)))).toEqual([
        'warning: no snapshot shows this element; add one where m-if="verified" holds',
      ])
    })

    test('waits until the snapshots are valid, and needs snapshots', () => {
      const typo = { ...SNAPSHOTS, following: { data: { count: 1, user: { name: 'B' }, viewr: { following: true } } } }
      expect(messages(checkSource(flags('<b m-if="viewer.following">x</b>', typo)))).toEqual([
        "error: snapshots[\"following\"].data.viewr: unknown field 'viewr' (did you mean 'viewer'?)",
      ])
      expect(messages(checkSource(page(`${USES}<b m-if="verified">x</b>`, { schema: FLAGS, snapshots: null })))).toEqual([
        'warning: the view has data fields but no snapshots; add a melzin/snapshots block with sample states, awkward ones included (very long text, zero, huge numbers)',
      ])
    })
  })
})
