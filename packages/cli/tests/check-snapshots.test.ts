// The checker and snapshots that extend another (SPEC D30): problems in `extends`, nulls that remove
// nothing, and problems reported once, at the snapshot that sets the value. Like every snapshot
// problem, they point at the JSON key.

import { describe, expect, test } from 'bun:test'
import { validateRouteTable } from 'melzin/core'
import { type Diagnostic, type RouteContext, checkSource } from '../src/check.ts'

const SCHEMA = {
  data: {
    type: 'object',
    properties: {
      user: { type: 'object', properties: { name: { type: 'string' }, bio: { type: 'string' } }, required: ['name'] },
      viewer: { type: 'object', properties: { following: { type: 'boolean' } }, required: ['following'] },
      homeUrl: { type: 'string', route: 'home' },
    },
    required: ['user', 'homeUrl'],
  },
}

const BODY = [
  '<h1 m-text="user.name"></h1>',
  '<p m-if="user.bio" m-text="user.bio"></p>',
  '<p m-else>No bio yet</p>',
  '<p m-show="viewer.following">Following</p>',
  '<a m-bind:href="homeUrl">Home</a>',
  '<p>@<span m-text="route.params.handle"></span></p>',
].join('\n')

const ROUTES: RouteContext = {
  present: true,
  table: validateRouteTable({ routes: { home: { path: '/', view: 'home' }, profile: { path: '/u/:handle', view: 'profile' } } }).table,
}

const TYPICAL = { data: { user: { name: 'Ana', bio: 'Hi' }, homeUrl: '/' }, route: { params: { handle: 'ana' } } }

function page(snapshots: unknown): string {
  return [
    '<!doctype html>',
    '<html>',
    '<head>',
    '<title>Profile</title>',
    `<script type="melzin/schema">${JSON.stringify(SCHEMA)}</script>`,
    `<script type="melzin/snapshots">${JSON.stringify(snapshots, null, 2)}</script>`,
    '</head>',
    '<body>',
    BODY,
    '</body>',
    '</html>',
  ].join('\n')
}

const check = (source: string): Diagnostic[] => checkSource(source, 'profile.mel.html', ROUTES)

/** Position of the nth `needle` in `source` (1-based). */
function at(source: string, needle: string, nth = 0): { line: number; col: number } {
  let offset = -1
  for (let i = 0; i <= nth; i++) offset = source.indexOf(needle, offset + 1)
  if (offset < 0) throw new Error(`${needle} not found`)
  const before = source.slice(0, offset)
  return { line: before.split('\n').length, col: offset - before.lastIndexOf('\n') }
}

describe('snapshots that extend another (D30)', () => {
  test('a chain of snapshots that each set only what differs is clean', () => {
    const source = page({
      typical: TYPICAL,
      following: { extends: 'typical', data: { viewer: { following: true } } },
      'no bio': { extends: 'following', data: { user: { bio: null } } },
    })
    expect(check(source)).toEqual([])
  })

  test('a broken extends points at its value', () => {
    const source = page({
      typical: TYPICAL,
      typo: { extends: 'tipical', data: { viewer: { following: true } } },
      a: { extends: 'b' },
      b: { extends: 'a' },
    })
    expect(check(source)).toEqual([
      { ...at(source, '"extends": "tipical"'), severity: 'error', message: `snapshots["typo"].extends: there's no snapshot named 'tipical' to extend (did you mean 'typical'?)` },
      { ...at(source, '"extends": "a"'), severity: 'error', message: `snapshots["b"].extends: these snapshots extend each other in a cycle: 'a' → 'b' → 'a'` },
    ])
  })

  test('null removes an inherited field; one that removes nothing gets a warning', () => {
    const source = page({
      typical: { ...TYPICAL, data: { ...TYPICAL.data, viewer: null } },
      following: { extends: 'typical', data: { viewer: { following: true } } },
      'no bio': { extends: 'following', data: { user: { bio: null }, veiwer: null }, route: { query: null } },
      nameless: { extends: 'typical', data: { user: { name: null } } },
    })
    expect(check(source)).toEqual([
      { ...at(source, '"viewer": null'), severity: 'warning', message: 'snapshots["typical"].data.viewer: null removes a field the snapshot inherits, and this one extends no other; leave the field out' },
      { ...at(source, '"veiwer": null'), severity: 'warning', message: `snapshots["no bio"].data.veiwer: 'following' has no 'veiwer' here, so null removes nothing (did you mean 'viewer'?)` },
      { ...at(source, '"query": null'), severity: 'warning', message: `snapshots["no bio"].route.query: 'following' has no 'query' here, so null removes nothing` },
      { ...at(source, '"name": null'), severity: 'error', message: `snapshots["nameless"].data.user.name: the schema requires this field, so null can't remove it` },
    ])
  })

  test('a problem in an inherited value is reported once, at the snapshot that sets it', () => {
    const source = page({
      typical: { ...TYPICAL, data: { ...TYPICAL.data, homeUrl: '/u/ana' } },
      following: { extends: 'typical', data: { viewer: { following: true } } },
      'no bio': { extends: 'following', data: { user: { bio: null }, homeUrl: '/u/bruno' } },
    })
    expect(check(source)).toEqual([
      { ...at(source, '"homeUrl": "/u/ana"'), severity: 'error', message: `snapshots["typical"].data.homeUrl: '/u/ana' isn't a URL of route 'home' (/); it's a URL of route 'profile'` },
      { ...at(source, '"homeUrl": "/u/bruno"'), severity: 'error', message: `snapshots["no bio"].data.homeUrl: '/u/bruno' isn't a URL of route 'home' (/); it's a URL of route 'profile'` },
    ])
  })

  test('a route parameter the view shows: missing in the base is warned once; removed later, warned where removed', () => {
    const source = page({
      typical: { data: TYPICAL.data },
      following: { extends: 'typical', data: { viewer: { following: true } } },
      'with handle': { extends: 'typical', data: { user: { bio: null } }, route: { params: { handle: 'ana' } } },
      'handle removed': { extends: 'with handle', route: { params: { handle: null } } },
    })
    const fix = 'which the view shows; add "route": { "params": { "handle": "..." } }'
    expect(check(source)).toEqual([
      { ...at(source, '"typical": {'), severity: 'warning', message: `snapshots["typical"] has no route.params.handle, ${fix}` },
      { ...at(source, '"handle removed": {'), severity: 'warning', message: `snapshots["handle removed"] has no route.params.handle, ${fix}` },
    ])
  })
})
