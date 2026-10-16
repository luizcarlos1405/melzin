// Checker edge cases on inline sources: positions, schema-less views, invalid schemas, odd markup.

import { describe, expect, test } from 'bun:test'
import { type Diagnostic, checkSource } from '../src/cli/check.ts'

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
    expect(checkSource(page('<h1 class="text-xl">Hi</h1>', { schema: null, snapshots: null }), 'a.melzin.html')).toEqual([])
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

  test('event payloads are rejected', () => {
    const source = page(CLEAN_BODY, {
      schema: '{ "data": { "type": "object", "properties": { "count": { "type": "number" } } }, "events": { "increment": { "payload": {} } } }',
    })
    expect(messages(checkSource(source))).toEqual(["error: schema events.increment.payload: event payloads aren't supported yet; declare one event per action, such as votePizza and voteTacos"])
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
      "error: m-on:click: emit takes exactly one argument, the event name; event payloads aren't supported yet, so declare one event per action",
    ])
  })

  test('<template> is an error, and its content (never bound by the runtime) is not counted as displayed', () => {
    expect(messages(checkSource(page(`<button m-on:click="emit('increment')">+</button><template><p m-text="count"></p></template>`)))).toEqual([
      "warning: data field 'count' is never displayed",
      "error: <template> isn't supported; its content would never be bound. Write the markup directly",
    ])
  })

  test('nested leaves and partial display', () => {
    const schema =
      '{ "data": { "type": "object", "properties": { "user": { "type": "object", "properties": { "name": { "type": "string" }, "bio": { "type": "string" } } } } } }'
    expect(messages(checkSource(page('<p m-text="user.name"></p>', { schema, snapshots: '{ "a": {} }' })))).toEqual([
      "warning: data field 'user.bio' is never displayed",
    ])
    // A broken binding may be the missing display, so "never displayed" waits until it's fixed.
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
    expect(messages(checkSource('just some notes', '/x/readme.txt'))).toEqual(["error: view files must be named *.melzin.html (got 'readme.txt')"])
  })
})
