// m-if, m-else-if, m-else and m-show in the runtime: which branch is in the document, element identity
// across updates, bindings inside hidden branches, warnings and destroy.

import { afterEach, beforeEach, describe, expect, test } from 'bun:test'
import { mountSource } from '../src/runtime/index.ts'
import { useDom } from './helpers/dom.ts'
import { view } from './runtime-fixtures.ts'

useDom()

const SCHEMA = {
  data: {
    type: 'object',
    properties: {
      name: { type: 'string' },
      bio: { type: 'string' },
      unread: { type: 'number' },
      verified: { type: 'boolean' },
      viewer: {
        type: 'object',
        properties: { isSelf: { type: 'boolean' }, following: { type: 'boolean' } },
        required: ['isSelf', 'following'],
      },
    },
    required: ['name'],
  },
  events: { follow: {}, unfollow: {} },
}

let root: HTMLElement
let warnings: string[]
const onWarning = (message: string): void => {
  warnings.push(message)
}

beforeEach(() => {
  root = document.createElement('div')
  document.body.append(root)
  warnings = []
})

afterEach(() => {
  root.remove()
})

function mountBody(body: string, data: Record<string, unknown>, on: object = { follow() {}, unfollow() {} }) {
  return mountSource(root, view({ schema: SCHEMA, body }), { data, on, onWarning })
}

/** Ids of the elements in the document, in order. */
const ids = (): string[] => [...root.querySelectorAll('[id]')].map((el) => el.id)
const byId = (id: string): HTMLElement => root.querySelector(`#${id}`) as HTMLElement
const comments = (parent: Node): string[] => [...parent.childNodes].filter((node) => node.nodeType === 8).map((node) => (node as Comment).data)

describe('m-if, m-else-if and m-else', () => {
  const ACTIONS = `
    <p id="out" m-if="!viewer">Sign in</p>
    <p id="self" m-else-if="viewer.isSelf">This is you</p>
    <p id="following" m-else-if="viewer.following">Following</p>
    <p id="follow" m-else>Follow</p>`

  test('only the first branch whose condition holds is in the document', () => {
    const v = mountBody(ACTIONS, { name: 'Ana' })
    expect(ids()).toEqual(['out'])
    v.update({ name: 'Ana', viewer: { isSelf: true, following: false } })
    expect(ids()).toEqual(['self'])
    v.update({ name: 'Ana', viewer: { isSelf: false, following: true } })
    expect(ids()).toEqual(['following'])
    v.update({ name: 'Ana', viewer: { isSelf: false, following: false } })
    expect(ids()).toEqual(['follow'])
    v.update({ name: 'Ana' })
    expect(ids()).toEqual(['out'])
    expect(warnings).toEqual([])
  })

  test('without m-else, nothing shows when no condition holds; an anchor comment keeps the place', () => {
    const v = mountBody('<ul><li id="first">1</li><li id="maybe" m-if="verified">2</li><li id="last">3</li></ul>', { name: 'A' })
    expect(ids()).toEqual(['first', 'last'])
    expect(comments(root.querySelector('ul')!)).toEqual(['m-if'])
    v.update({ name: 'A', verified: true })
    expect(ids()).toEqual(['first', 'maybe', 'last'])
    v.update({ name: 'A', verified: false })
    expect(ids()).toEqual(['first', 'last'])
  })

  test('branches keep their identity, and their bindings stay current while out of the document', () => {
    const v = mountBody('<div id="card" m-if="verified"><span id="name" m-text="name"></span></div><p id="other" m-else>x</p>', {
      name: 'Ana',
      verified: true,
    })
    const card = byId('card')
    v.update({ name: 'Bruno', verified: false })
    expect(card.isConnected).toBe(false)
    expect(card.querySelector('#name')?.textContent).toBe('Bruno')
    v.update({ name: 'Carla', verified: true })
    expect(byId('card')).toBe(card)
    expect(byId('name').textContent).toBe('Carla')
    expect(ids()).toEqual(['card', 'name'])
  })

  test('clicks inside a branch reach the host while it shows', () => {
    const calls: string[] = []
    const v = mountBody(
      `<button id="f" m-if="!viewer.following" m-on:click="emit('follow')">Follow</button>
       <button id="u" m-else m-on:click="emit('unfollow')">Unfollow</button>`,
      { name: 'A', viewer: { isSelf: false, following: false } },
      { follow: () => calls.push('follow'), unfollow: () => calls.push('unfollow') },
    )
    byId('f').click()
    v.update({ name: 'A', viewer: { isSelf: false, following: true } })
    byId('u').click()
    expect(calls).toEqual(['follow', 'unfollow'])
  })

  test('whitespace and comments may sit between the branches', () => {
    const v = mountBody('<p id="a" m-if="verified">A</p>\n  <!-- otherwise -->\n  <p id="b" m-else>B</p>', { name: 'A' })
    expect(ids()).toEqual(['b'])
    v.update({ name: 'A', verified: true })
    expect(ids()).toEqual(['a'])
    expect(warnings).toEqual([])
  })

  test('text between the branches ends the chain', () => {
    mountBody('<p id="a" m-if="verified">A</p> or <p id="b" m-else>B</p>', { name: 'A', verified: true })
    expect(ids()).toEqual(['a', 'b'])
    expect(warnings).toEqual(['<p m-else>: m-else must come right after an element with m-if or m-else-if; ignored'])
  })

  test('chains nest', () => {
    const v = mountBody(
      `<div id="in" m-if="viewer"><p id="self" m-if="viewer.isSelf">You</p><p id="other" m-else>Other</p></div>
       <p id="out" m-else>Signed out</p>`,
      { name: 'A' },
    )
    expect(ids()).toEqual(['out'])
    v.update({ name: 'A', viewer: { isSelf: true, following: false } })
    expect(ids()).toEqual(['in', 'self'])
    v.update({ name: 'A', viewer: { isSelf: false, following: false } })
    expect(ids()).toEqual(['in', 'other'])
  })

  test('adjacent chains keep their order', () => {
    const v = mountBody(
      '<p id="a1" m-if="verified">1</p><p id="a2" m-else>2</p><p id="b1" m-if="bio">3</p><p id="b2" m-else>4</p>',
      { name: 'A', verified: true },
    )
    expect(ids()).toEqual(['a1', 'b2'])
    v.update({ name: 'A', verified: false, bio: 'Hi' })
    expect(ids()).toEqual(['a2', 'b1'])
  })

  test('an update that keeps the same branch touches nothing; a switch only moves the branches', () => {
    const v = mountBody('<h1 m-text="name"></h1><p id="a" m-if="verified">A</p><p id="b" m-else>B</p>', { name: 'Ana', verified: true })
    const observer = new MutationObserver(() => {})
    observer.observe(root, { childList: true, subtree: true, characterData: true, attributes: true })
    v.update({ name: 'Ana', verified: true })
    expect(observer.takeRecords()).toEqual([])
    v.update({ name: 'Ana', verified: false })
    const records = observer.takeRecords()
    observer.disconnect()
    expect(records.every((record) => record.type === 'childList' && record.target === root)).toBe(true)
    const moved = records.flatMap((record) => [...record.addedNodes, ...record.removedNodes]).map((node) => (node as Element).id)
    expect(moved.sort()).toEqual(['a', 'b'])
  })

  test('destroy removes the branch that shows and the anchors', () => {
    const existing = document.createElement('span')
    root.append(existing)
    const v = mountBody('<p id="a" m-if="verified">A</p><p id="b" m-else>B</p><p id="c">C</p>', { name: 'A' })
    expect(ids()).toEqual(['b', 'c'])
    v.destroy()
    expect([...root.childNodes]).toEqual([existing])
  })
})

describe('m-show', () => {
  test('hides with display: none and keeps the element in place', () => {
    const v = mountBody('<span id="badge" m-show="verified">Verified</span>', { name: 'A' })
    const badge = byId('badge')
    expect(badge.style.display).toBe('none')
    v.update({ name: 'A', verified: true })
    expect(byId('badge')).toBe(badge)
    expect(badge.style.display).toBe('')
  })

  test("restores the element's own display", () => {
    const v = mountBody('<span id="s" style="display: inline-block" m-show="verified">x</span>', { name: 'A' })
    expect(byId('s').style.display).toBe('none')
    v.update({ name: 'A', verified: true })
    expect(byId('s').style.display).toBe('inline-block')
    expect(warnings).toEqual(["<span>: style attributes aren't allowed; styling is Tailwind classes only, with design tokens in theme.css"])
  })

  test('numbers, strings and objects as conditions', () => {
    const v = mountBody(
      '<b id="n" m-show="unread" m-text="unread"></b><i id="s" m-show="bio"></i><u id="o" m-show="viewer"></u>',
      { name: 'A', unread: 0, bio: '' },
    )
    const shown = (): string[] => ids().filter((id) => byId(id).style.display !== 'none')
    expect(shown()).toEqual([])
    v.update({ name: 'A', unread: 3, bio: 'Hi', viewer: { isSelf: false, following: false } })
    expect(shown()).toEqual(['n', 's', 'o'])
  })

  test('works on SVG elements, and together with m-if', () => {
    const v = mountBody('<svg><g id="g" m-show="verified"></g></svg><p id="p" m-if="bio" m-show="verified">x</p>', { name: 'A', bio: 'Hi' })
    expect((root.querySelector('#g') as SVGGElement).style.display).toBe('none')
    expect(byId('p').style.display).toBe('none')
    v.update({ name: 'A', bio: 'Hi', verified: true })
    expect((root.querySelector('#g') as SVGGElement).style.display).toBe('')
    expect(byId('p').style.display).toBe('')
    v.update({ name: 'A', verified: true })
    expect(ids()).toEqual(['g'])
  })
})

describe('warnings', () => {
  test('a condition that cannot be used counts as false', () => {
    mountBody('<p id="a" m-if="verifed">A</p><p id="b" m-else>B</p><p id="c" m-show="unread > 0">C</p>', { name: 'A', verified: true })
    expect(ids()).toEqual(['b', 'c'])
    expect(byId('c').style.display).toBe('none')
    expect(warnings).toEqual([
      `<p m-if="verifed">: unknown field 'verifed' (did you mean 'verified'?); treated as false`,
      `<p m-show="unread > 0">: '>' isn't supported yet: a condition is a path, optionally negated with !, so have the host send a boolean field such as hasUnread (at column 8); treated as false`,
    ])
  })

  test('an m-else-if without an m-if before it works as an m-if', () => {
    const v = mountBody('<p id="x" m-else-if="verified">X</p><p id="y" m-else>Y</p>', { name: 'A' })
    expect(ids()).toEqual(['y'])
    v.update({ name: 'A', verified: true })
    expect(ids()).toEqual(['x'])
    expect(warnings).toEqual(['<p m-else-if="verified">: m-else-if must come right after an element with m-if or m-else-if; treated as m-if'])
  })

  test('m-else takes no value', () => {
    mountBody('<p id="a" m-if="verified">A</p><p id="b" m-else="bio">B</p>', { name: 'A', bio: '' })
    expect(ids()).toEqual(['b'])
    expect(warnings).toEqual(['<p m-else="bio">: m-else takes no value; for another condition use m-else-if="bio"'])
  })

  test('only one of m-if, m-else-if and m-else per element; the first one counts', () => {
    mountBody('<p id="a" m-if="verified" m-else>A</p>', { name: 'A' })
    expect(ids()).toEqual([])
    expect(warnings).toEqual(['<p>: an element can have only one of m-if, m-else-if and m-else; m-else ignored'])
  })

  test('Vue spellings get the m- equivalent', () => {
    mountBody('<p v-if="verified">A</p><p v-else>B</p><p v-show="verified">C</p>', { name: 'A' })
    expect(warnings).toEqual([
      "<p>: 'v-if' is Vue/Alpine syntax; use m-if; ignored",
      "<p>: 'v-else' is Vue/Alpine syntax; use m-else; ignored",
      "<p>: 'v-show' is Vue/Alpine syntax; use m-show; ignored",
    ])
  })
})
