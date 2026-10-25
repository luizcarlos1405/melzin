// Attribute and class bindings in mount (SPEC D37, POC.md §19).

import { afterEach, beforeEach, describe, expect, test } from 'bun:test'
import { mountSource } from '../src/runtime/index.ts'
import { useDom } from './helpers/dom.ts'
import { view } from './runtime-fixtures.ts'

useDom()

const SCHEMA = {
  data: {
    type: 'object',
    properties: {
      label: { type: 'string' },
      count: { type: 'number' },
      open: { type: 'boolean' },
      status: { type: 'string', default: 'idle' },
      tasks: {
        type: 'array',
        key: 'id',
        items: {
          type: 'object',
          properties: { id: { type: 'string' }, text: { type: 'string' }, done: { type: 'boolean' } },
          required: ['id', 'text', 'done'],
        },
      },
    },
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

function mountBody(body: string, data: Record<string, unknown>) {
  return mountSource(root, view({ schema: SCHEMA, body }), { data, on: {}, onWarning })
}

const el = (selector: string): Element => root.querySelector(selector)!
// happy-dom reads `m-bind:class` as a namespaced `class` attribute, so getAttribute('class') goes
// stale; the serialized markup has the real value (browsers keep the two attributes apart).
const classOf = (selector: string): string | undefined => / class="([^"]*)"/.exec(el(selector).outerHTML)?.[1]

describe('m-bind:<attr>', () => {
  test('strings and numbers are text, and a missing value removes the attribute', () => {
    const v = mountBody(
      `<div id="a" role="img" m-bind:aria-label="label" m-bind:data-count="count" m-bind:title="label"></div>`,
      { label: '2 done, 4 left', count: 0 },
    )
    expect(el('#a').getAttribute('aria-label')).toBe('2 done, 4 left')
    expect(el('#a').getAttribute('title')).toBe('2 done, 4 left')
    expect(el('#a').getAttribute('data-count')).toBe('0')
    v.update({ count: 3 })
    expect(el('#a').hasAttribute('aria-label')).toBe(false)
    expect(el('#a').getAttribute('data-count')).toBe('3')
    expect(warnings).toEqual([])
  })

  test('a boolean writes "true" or removes the attribute, and aria-* keeps "false"', () => {
    const v = mountBody(`<button id="b" type="button" m-bind:aria-expanded="open" m-bind:data-open="open">x</button>`, { open: true })
    expect(el('#b').getAttribute('aria-expanded')).toBe('true')
    expect(el('#b').getAttribute('data-open')).toBe('true')
    v.update({ open: false })
    expect(el('#b').getAttribute('aria-expanded')).toBe('false')
    expect(el('#b').hasAttribute('data-open')).toBe(false)
    v.update({})
    expect(el('#b').hasAttribute('aria-expanded')).toBe(false)
  })

  test('defaults apply, and rows bind their own item', () => {
    mountBody(
      `<p id="s" m-bind:data-status="status"></p><ul><li m-for="task in tasks" m-bind:data-done="task.done" m-bind:aria-label="task.text"></li></ul>`,
      { tasks: [{ id: '1', text: 'a', done: true }, { id: '2', text: 'b', done: false }] },
    )
    expect(el('#s').getAttribute('data-status')).toBe('idle')
    const rows = [...root.querySelectorAll('li')]
    expect(rows.map((row) => row.getAttribute('data-done'))).toEqual(['true', null])
    expect(rows.map((row) => row.getAttribute('aria-label'))).toEqual(['a', 'b'])
  })

  test('targets outside the allowlist warn and set nothing', () => {
    mountBody(
      `<p id="p" m-bind:id="label" m-bind:style="label" m-bind:aria-labelledby="label" m-bind:onclick="label" m-bind:data-melzin-x="label"></p>`,
      { label: 'x' },
    )
    expect(el('#p').getAttribute('style')).toBe(null)
    expect(warnings.length).toBe(5)
    expect(warnings.every((w) => w.endsWith('; ignored'))).toBe(true)
  })

  test('! and a wrongly typed ARIA field warn', () => {
    mountBody(`<button type="button" m-bind:aria-pressed="!open"></button><button type="button" m-bind:aria-pressed="count"></button>`, { count: 1 })
    expect(warnings[0]).toContain("'!' only works in conditions")
    expect(warnings[1]).toContain('aria-pressed takes true, false or mixed')
  })
})

describe('m-bind:class', () => {
  test('keys add their classes while their condition holds, next to the static ones', () => {
    const v = mountBody(
      `<p id="t" class="text-sm" m-bind:class="{ 'line-through text-zinc-400': open, 'text-zinc-900': !open }"></p>`,
      { open: false },
    )
    expect(classOf('#t')).toBe('text-sm text-zinc-900')
    v.update({ open: true })
    expect(classOf('#t')).toBe('text-sm line-through text-zinc-400')
    v.update({ open: false })
    expect(classOf('#t')).toBe('text-sm text-zinc-900')
  })

  test('a static class stays whatever its key says', () => {
    const v = mountBody(`<p id="t" class="font-bold" m-bind:class="{ 'font-bold underline': open }"></p>`, { open: true })
    expect(classOf('#t')).toBe('font-bold underline')
    v.update({ open: false })
    expect(classOf('#t')).toBe('font-bold')
  })

  test('counts and rows work as conditions', () => {
    mountBody(
      `<ul id="u" m-bind:class="{ 'border': tasks.length }"><li m-for="task in tasks" m-bind:class="{ 'opacity-50': task.done }"></li></ul>`,
      { tasks: [{ id: '1', text: 'a', done: true }] },
    )
    expect(classOf('#u')).toBe('border')
    expect(classOf('li')).toBe('opacity-50')
  })

  test('a broken object warns and adds nothing', () => {
    mountBody(`<p id="t" class="a" m-bind:class="'b'"></p><p m-bind:class="{ 'c': nope }"></p>`, {})
    expect(classOf('#t')).toBe('a')
    expect(warnings[0]).toContain('never built from data')
    expect(warnings[1]).toContain("unknown field 'nope'")
  })
})
