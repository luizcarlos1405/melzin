// The checker and routes (SPEC D21–D27): routes.json itself, and each view against the route table.

import { afterAll, beforeAll, describe, expect, test } from 'bun:test'
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { validateRouteTable } from 'melzin/core'
import { type Diagnostic, type RouteContext, type Severity, checkFiles, checkRoutesSource, checkSource } from '../src/check.ts'

const TABLE = {
  routes: {
    home: { path: '/', view: 'home', query: { as: {} } },
    profile: { path: '/u/:handle', view: 'profile', query: { as: {} } },
    followers: { path: '/u/:handle/followers', view: 'profile', query: { as: {} } },
  },
}

const ROUTES: RouteContext = { present: true, table: validateRouteTable(TABLE).table }

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

const PROFILE_SCHEMA = {
  data: {
    type: 'object',
    properties: { name: { type: 'string' }, homeUrl: { type: 'string', route: 'home' } },
    required: ['name', 'homeUrl'],
  },
}

describe('routes.json', () => {
  test('a clean table', () => {
    expect(checkRoutesSource(JSON.stringify(TABLE), ['home', 'profile'])).toMatchObject({ diagnostics: [] })
  })

  test('problems point into the file', () => {
    const source = '{\n  "routes": {\n    "home": { "path": "/", "view": "hom" },\n    "about": { "path": "about", "view": "about.mel.html", "code": "soon" }\n  }\n}\n'
    const { diagnostics, table } = checkRoutesSource(source, ['home', 'about'])
    expect(table).toBeNull()
    expect(diagnostics).toEqual([
      { ...at(source, '"view": "hom"'), severity: 'error', message: "routes.home.view: there's no view named 'hom' (hom.mel.html in the views folder) (did you mean 'home'?)" },
      { ...at(source, '"path": "about"'), severity: 'error', message: "routes.about.path: a path starts with '/', such as '/about'" },
      { ...at(source, '"view": "about'), severity: 'error', message: 'routes.about.view: \'view\' is the view\'s name, such as "about", without folders or .mel.html' },
      { ...at(source, '"code"'), severity: 'error', message: "routes.about.code: 'code' must be one of 'eager', 'prefetch', 'lazy', got \"soon\"" },
    ])
  })

  test('invalid JSON', () => {
    expect(checkRoutesSource('{ "routes": { } ', null).diagnostics).toEqual([
      { line: 1, col: 17, severity: 'error', message: "invalid JSON: unexpected end of JSON; expected ',' or '}'" },
    ])
  })
})

describe('views against the route table', () => {
  test('a clean routed view', () => {
    const source = page(
      '<h1 m-text="name"></h1><p m-text="route.params.handle"></p><p m-if="route.query.as">as</p><a m-bind:href="homeUrl">Home</a><a href="/u/ana/followers">Followers</a>',
      PROFILE_SCHEMA,
      {
        'as nobody': { data: { name: 'Ana', homeUrl: '/' }, route: { params: { handle: 'ana' } } },
        'as bruno': { data: { name: 'Ana', homeUrl: '/?as=bruno' }, route: { params: { handle: 'ana' }, query: { as: 'bruno' } } },
      },
    )
    expect(messages(checkSource(source, 'profile.mel.html', ROUTES))).toEqual([])
  })

  test('URL input the routes don\'t have', () => {
    const source = page(
      '<h1 m-text="name"></h1><p m-text="route.params.handel"></p><p m-show="route.query.tab">x</p><a m-bind:href="homeUrl">Home</a>',
      PROFILE_SCHEMA,
      { s: { data: { name: 'Ana', homeUrl: '/' }, route: { params: { handle: 'ana' } } } },
    )
    const expected: Diagnostic[] = [
      { ...at(source, 'route.params.handel'), severity: 'error', message: "route.params.handel: route 'profile' (/u/:handle) has no :handel parameter (did you mean 'route.params.handle'?)" },
      { ...at(source, 'route.params.handel'), severity: 'error', message: "route.params.handel: route 'followers' (/u/:handle/followers) has no :handel parameter (did you mean 'route.params.handle'?)" },
      { ...at(source, 'route.query.tab'), severity: 'error', message: "route.query.tab: route 'profile' doesn't declare the query parameter 'tab'; add \"tab\": {} to its query in routes.json" },
      { ...at(source, 'route.query.tab'), severity: 'error', message: "route.query.tab: route 'followers' doesn't declare the query parameter 'tab'; add \"tab\": {} to its query in routes.json" },
      { ...at(source, '"s"'), severity: 'warning', message: 'snapshots["s"] has no route.params.handel, which the view shows; add "route": { "params": { "handel": "..." } }' },
      { ...at(source, 'm-show'), severity: 'warning', message: 'no snapshot shows this element; add one where m-show="route.query.tab" holds' },
    ]
    expect(checkSource(source, 'profile.mel.html', ROUTES)).toEqual(expected.sort((a, b) => a.line - b.line || a.col - b.col))
  })

  test('a view no route shows, and a project without routes', () => {
    const source = page('<p m-text="route.params.handle"></p><p m-text="route.name"></p>', { data: { type: 'object', properties: {} } }, { s: {} })
    expect(messages(checkSource(source, 'card.mel.html', ROUTES))).toEqual([
      "warning: route.params.handle is always empty: no route in routes.json shows the view 'card'",
    ])
    expect(messages(checkSource(source, 'card.mel.html', { present: false, table: null }))).toEqual([
      'warning: route.params.handle is always empty: the project has no routes.json, so no route shows this view',
      'warning: route.name is always empty: the project has no routes.json, so no route shows this view',
    ])
    // Without a route context, only the view's own rules apply.
    expect(messages(checkSource(source, 'card.mel.html'))).toEqual([])
  })

  test('malformed route paths', () => {
    const source = page('<p m-text="route.params"></p><p m-if="route.page">x</p>', { data: { type: 'object', properties: {} } }, { s: {} })
    expect(messages(checkSource(source))).toEqual([
      "error: m-text: 'route.params' is an object; name one, such as route.params.handle",
      "error: m-if: unknown field 'route.page'; use route.name, route.params.<name> or route.query.<name>",
    ])
  })

  test('link fields name routes that exist, and snapshots hold their URLs', () => {
    const schema = {
      data: {
        type: 'object',
        properties: { a: { type: 'string', route: 'profle' }, b: { type: 'string', route: 'profile' }, c: { type: 'string', route: 'home' } },
        required: ['a', 'b', 'c'],
      },
    }
    const source = page(
      '<a m-bind:href="a">a</a><a m-bind:href="b">b</a><a m-bind:href="c">c</a>',
      schema,
      { s: { data: { a: '/u/ana', b: '/', c: 'https://example.com/' } } },
    )
    expect(checkSource(source, 'card.mel.html', ROUTES)).toEqual([
      { ...at(source, '"route": "profle"'), severity: 'error', message: "link field 'a' names route 'profle', which isn't in routes.json (did you mean 'profile'?)" },
      { ...at(source, '"b": "/"'), severity: 'error', message: 'snapshots["s"].data.b: \'/\' isn\'t a URL of route \'profile\' (/u/:handle); it\'s a URL of route \'home\'' },
      { ...at(source, '"c": "https'), severity: 'error', message: 'snapshots["s"].data.c: \'https://example.com/\' isn\'t a URL of route \'home\' (/)' },
    ])
    expect(messages(checkSource(source, 'card.mel.html', { present: false, table: null }))).toEqual([
      "warning: link field 'a' names route 'profle', but the project has no routes.json",
      "warning: link field 'b' names route 'profile', but the project has no routes.json",
      "warning: link field 'c' names route 'home', but the project has no routes.json",
    ])
  })

  test('snapshot routes the view\'s routes don\'t have, and static links to no route', () => {
    const source = page('<a href="/u/ana">Ana</a><a href="/nowhere">x</a><a href="//cdn.example.com/x">cdn</a><a href="about">rel</a>', { data: { type: 'object', properties: {} } }, {
      s: { route: { params: { id: '1' }, query: { tab: 'x' } } },
    })
    expect(checkSource(source, 'profile.mel.html', ROUTES)).toEqual([
      { ...at(source, '"id"'), severity: 'warning', message: 'snapshots["s"].route.params.id: no route that shows this view has a :id parameter' },
      { ...at(source, '"tab"'), severity: 'warning', message: "snapshots[\"s\"].route.query.tab: no route that shows this view declares the query parameter 'tab'" },
      { ...at(source, 'href="/nowhere"'), severity: 'warning', message: "no route in routes.json matches '/nowhere', so following it loads another page instead of switching screens" },
    ])
  })
})

describe('m-bind:href', () => {
  const schema = {
    data: {
      type: 'object',
      properties: { url: { type: 'string', route: 'home' }, name: { type: 'string' }, user: { type: 'object', properties: {} } },
      required: ['url', 'name', 'user'],
    },
  }
  const snapshots = { s: { data: { url: '/', name: 'x', user: {} } } }

  test('a link field on a link', () => {
    expect(messages(checkSource(page('<p m-text="name"></p><a m-bind:href="url">x</a>', schema, snapshots)))).toEqual([])
  })

  test('problems', () => {
    const source = page(
      '<p m-text="name"></p><span m-bind:href="url">a</span><a href="/" m-bind:href="url">b</a><a m-bind:href="name">c</a><a m-bind:href="user">d</a><a m-bind:href="route.name">e</a><a m-bind:href="nope">f</a><a m-bind:href="!url">g</a>',
      schema,
      snapshots,
    )
    const expected: { line: number; col: number; severity: Severity; message: string }[] = [
      { ...at(source, '<span'), severity: 'error', message: 'm-bind:href only works on links (<a> and <area>)' },
      { ...at(source, 'href="/"'), severity: 'error', message: "a link with m-bind:href can't also have a static href; keep m-bind:href" },
      { ...at(source, '"name">c'), severity: 'error', message: 'm-bind:href: \'name\' isn\'t a link field; give it "route": "<route name>" in the schema and have the source fill it with href() (views never build URLs)' },
      { ...at(source, '"user">d'), severity: 'error', message: "m-bind:href: 'user' is an object; it needs a link field" },
      { ...at(source, '"route.name">e'), severity: 'error', message: "m-bind:href needs a link field; 'route.name' isn't a URL (views never build URLs)" },
      { ...at(source, '"nope">f'), severity: 'error', message: "m-bind:href: unknown field 'nope'" },
      { ...at(source, '"!url">g'), severity: 'error', message: "m-bind:href: m-bind:href needs a path such as author.profileUrl; '!' only works in conditions (m-if, m-show)" },
    ]
    // Value positions point inside the quotes.
    expect(checkSource(source)).toEqual(expected.map((d) => ({ ...d, col: d.message.startsWith('m-bind:href only') || d.message.startsWith('a link') ? d.col : d.col + 1 })))
  })

  test('Vue and Alpine spellings', () => {
    expect(messages(checkSource(page('<p m-text="name"></p><a :href="url">x</a><a m-bind:href="url">y</a>', schema, snapshots)))).toEqual([
      "error: ':href' is Vue/Alpine syntax; use m-bind:href",
    ])
  })
})

describe('melzin check on a project', () => {
  let dir = ''

  beforeAll(() => {
    dir = mkdtempSync(join(tmpdir(), 'melzin-check-routes-'))
    mkdirSync(join(dir, 'views'))
    writeFileSync(join(dir, 'routes.json'), JSON.stringify({ routes: { home: { path: '/', view: 'home' }, missing: { path: '/m', view: 'missing' } } }))
    writeFileSync(join(dir, 'views/home.mel.html'), page('<p m-text="route.params.x"></p>', { data: { type: 'object', properties: {} } }, { s: {} }))
  })

  afterAll(() => {
    rmSync(dir, { recursive: true, force: true })
  })

  test('routes.json is checked with the views, and views against it', async () => {
    const result = await checkFiles(['views/home.mel.html', 'routes.json'], { cwd: dir })
    expect(result.files.map(({ file, diagnostics }) => [file, messages(diagnostics)])).toEqual([
      ['views/home.mel.html', ['warning: snapshots["s"] has no route.params.x, which the view shows; add "route": { "params": { "x": "..." } }', "error: route.params.x: route 'home' (/) has no :x parameter"]],
      ['routes.json', ["error: routes.missing.view: there's no view named 'missing' (missing.mel.html in the views folder)"]],
    ])
  })

  test('the CLI checks routes.json by default', async () => {
    const proc = Bun.spawn(['bun', join(import.meta.dir, '../src/index.ts'), 'check'], { cwd: dir, stdout: 'pipe', stderr: 'pipe' })
    const [stdout, code] = await Promise.all([new Response(proc.stdout).text(), proc.exited])
    expect(code).toBe(1)
    expect(stdout).toContain("routes.json:1:")
    expect(stdout.trim().split('\n').at(-1)).toBe('2 errors, 1 warning in 2 files')
  })
})
