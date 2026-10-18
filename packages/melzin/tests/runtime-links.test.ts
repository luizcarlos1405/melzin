// The URL input (`route`, SPEC D27) and links (m-bind:href, D23) in mount.

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
      authorUrl: { type: 'string', route: 'profile' },
      plain: { type: 'string' },
    },
    required: ['name'],
  },
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

function mountBody(body: string, data: Record<string, unknown>, route?: Record<string, unknown>) {
  return mountSource(root, view({ schema: SCHEMA, body }), { data, on: {}, route, onWarning })
}

describe('the URL input', () => {
  test('m-text and conditions read route', () => {
    const view = mountBody(
      `<p id="handle" m-text="route.params.handle"></p><p id="name" m-text="route.name"></p>` +
        `<p id="as" m-if="route.query.as">as <span m-text="route.query.as"></span></p><p id="nobody" m-else>nobody</p>`,
      { name: 'x' },
      { name: 'profile', params: { handle: 'ana' }, query: {} },
    )
    expect(warnings).toEqual([])
    expect(root.querySelector('#handle')?.textContent).toBe('ana')
    expect(root.querySelector('#name')?.textContent).toBe('profile')
    expect(root.querySelector('#as')).toBeNull()
    expect(root.querySelector('#nobody')).not.toBeNull()
    const handle = root.querySelector('#handle')
    view.setRoute({ name: 'profile', params: { handle: 'bruno' }, query: { as: 'ana' } })
    expect(root.querySelector('#handle')).toBe(handle)
    expect(handle?.textContent).toBe('bruno')
    expect(root.querySelector('#as')?.textContent).toBe('as ana')
    expect(root.querySelector('#nobody')).toBeNull()
    expect(view.route).toEqual({ name: 'profile', params: { handle: 'bruno' }, query: { as: 'ana' } })
  })

  test('without a route, route paths are empty', () => {
    mountBody(`<p id="handle" m-text="route.params.handle">x</p><p id="shown" m-show="route.name">y</p>`, { name: 'x' })
    expect(warnings).toEqual([])
    expect(root.querySelector('#handle')?.textContent).toBe('')
    expect((root.querySelector('#shown') as HTMLElement).style.display).toBe('none')
  })

  test('malformed route paths warn', () => {
    mountBody(`<p m-text="route.params"></p><p m-if="route.page">x</p>`, { name: 'x' })
    expect(warnings).toEqual([
      `<p m-text="route.params">: 'route.params' is an object; name one, such as route.params.handle; skipped`,
      `<p m-if="route.page">: unknown field 'route.page'; use route.name, route.params.<name> or route.query.<name>; treated as false`,
    ])
  })

  test('setRoute after destroy warns', () => {
    const view = mountBody('<p></p>', { name: 'x' })
    view.destroy()
    view.setRoute({})
    expect(warnings).toEqual(['setRoute() called after destroy(); ignored'])
  })
})

describe('m-bind:href', () => {
  test('sets the link from a link field, and removes it while the field is missing', () => {
    const view = mountBody(`<a id="author" class="link" m-bind:href="authorUrl">Author</a>`, { name: 'x', authorUrl: '/u/ana' })
    expect(warnings).toEqual([])
    const link = root.querySelector('#author')!
    expect(link.getAttribute('href')).toBe('/u/ana')
    view.update({ name: 'x', authorUrl: '/u/bruno?as=ana' })
    expect(root.querySelector('#author')).toBe(link)
    expect(link.getAttribute('href')).toBe('/u/bruno?as=ana')
    view.update({ name: 'x' })
    expect(link.hasAttribute('href')).toBe(false)
    expect(link.getAttribute('m-bind:href')).toBe('authorUrl')
  })

  // happy-dom confuses href with m-bind:href on one element, so only the warning is checked here.
  test('warns about a static href too', () => {
    mountBody(`<a id="a" href="/old" m-bind:href="authorUrl">A</a>`, { name: 'x', authorUrl: '/u/ana' })
    expect(warnings).toEqual([`<a m-bind:href="authorUrl">: the link also has a static href, which the field's URL replaces; keep one`])
  })

  test('script URLs never reach the link', () => {
    for (const url of ['javascript:alert(1)', ' JavaScript:alert(1)', 'data:text/html,x', 'vbscript:x']) {
      warnings = []
      root.replaceChildren()
      mountBody(`<a id="a" m-bind:href="authorUrl">A</a>`, { name: 'x', authorUrl: url })
      expect(root.querySelector('#a')?.hasAttribute('href')).toBe(false)
      expect(warnings[0]).toMatch(/URLs aren't allowed in links; the link has no href$/)
    }
  })

  test('problems are warned and skipped', () => {
    mountBody(
      `<p m-bind:href="authorUrl"></p><a m-bind:href="plain"></a><a m-bind:href="nope"></a><a m-bind:href="route.name"></a><a m-bind:href="!authorUrl"></a>`,
      { name: 'x', authorUrl: '/u/ana', plain: '/x' },
    )
    expect(warnings).toEqual([
      '<p m-bind:href="authorUrl">: m-bind:href only works on links (<a> and <area>); skipped',
      `<a m-bind:href="plain">: 'plain' isn't a link field; give it "route": "<route name>" in the schema; skipped`,
      "<a m-bind:href=\"nope\">: unknown field 'nope'; skipped",
      "<a m-bind:href=\"route.name\">: m-bind:href needs a link field; the URL input isn't a URL; skipped",
      `<a m-bind:href="!authorUrl">: m-bind:href needs a path such as author.profileUrl; '!' only works in conditions (m-if, m-show) (at column 1); skipped`,
    ])
    for (const link of root.querySelectorAll('a')) expect(link.hasAttribute('href')).toBe(false)
  })
})
