// How the runtime reads data and handlers: getters and class methods count, Object.prototype members
// never do, and odd values can't break a render.

import { afterEach, beforeEach, describe, expect, test } from 'bun:test'
import { mountSource } from '../src/runtime/index.ts'
import { useDom } from './helpers/dom.ts'
import { view } from './runtime-fixtures.ts'

useDom()

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

const texts = (): string[] => [...root.querySelectorAll('p')].map((p) => p.textContent ?? '')

const COUNT = view({
  schema: { data: { type: 'object', properties: { count: { type: 'number' } }, required: ['count'] } },
  body: '<p m-text="count"></p>',
})

describe('data lookup', () => {
  test('a getter on a class instance renders, like any field', () => {
    class Model {
      get count(): number {
        return 5
      }
    }
    const v = mountSource(root, COUNT, { data: new Model(), on: {}, onWarning })
    expect(texts()).toEqual(['5'])
    v.update(Object.create({ count: 7 }))
    expect(texts()).toEqual(['7'])
    expect(warnings).toEqual([])
  })

  test("a class instance's constructor is no data field", () => {
    class Item {
      readonly id: string
      constructor(id: string) {
        this.id = id
      }
    }
    const src = view({
      schema: {
        data: {
          type: 'object',
          properties: { items: { type: 'array', key: 'id', items: { type: 'object', properties: { id: { type: 'string' }, constructor: { type: 'string' } }, required: ['id'] } } },
        },
      },
      body: '<ul><li m-for="item in items"><p m-text="item.id"></p><p m-text="item.constructor"></p></li></ul>',
    })
    mountSource(root, src, { data: { items: [new Item('a')] }, on: {}, onWarning })
    expect(texts()).toEqual(['a', ''])
    expect(warnings).toEqual([])
  })

  test('a missing required field named like an Object.prototype member is reported and renders empty', () => {
    const src = view({
      schema: { data: { type: 'object', properties: { toString: { type: 'string' }, constructor: { type: 'string' } }, required: ['toString'] } },
      body: '<p m-text="toString"></p><p m-text="constructor"></p>',
    })
    mountSource(root, src, { data: {}, on: {}, onWarning })
    expect(texts()).toEqual(['', ''])
    expect(warnings).toEqual(["data doesn't match the schema: toString: missing required field 'toString'"])
  })

  test('a value that String() can\'t convert renders empty instead of throwing mid-update', () => {
    const src = view({
      schema: { data: { type: 'object', properties: { a: { type: 'string' }, b: { type: 'string' } } } },
      body: '<p m-text="b"></p><p m-text="a"></p>',
    })
    const v = mountSource(root, src, { data: { a: 'one', b: 'x' }, on: {}, onWarning })
    expect(() => v.update({ a: 'two', b: Object.create(null) })).not.toThrow()
    expect(texts()).toEqual(['', 'two'])
    expect(warnings).toEqual(["data doesn't match the schema: b: expected string, got object"])
  })

  test('NaN and Infinity are flagged, like a non-finite default', () => {
    mountSource(root, COUNT, { data: { count: 0 / 0 }, on: {}, onWarning })
    expect(warnings).toEqual(["data doesn't match the schema: count: expected a finite number, got NaN"])
  })
})

describe('handler lookup', () => {
  test('events named like Object.prototype members get the missing-handler warnings, not the builtin', () => {
    const src = view({
      schema: { events: { toString: {}, valueOf: {} } },
      body: `<button id="a" m-on:click="emit('toString')">a</button><button id="b" m-on:click="emit('valueOf')">b</button>`,
    })
    mountSource(root, src, { data: {}, on: {}, onWarning })
    expect(warnings).toEqual([
      "declared event 'toString' has no handler; add on.toString",
      "declared event 'valueOf' has no handler; add on.valueOf",
    ])
    warnings = []
    root.querySelector<HTMLElement>('#a')!.click()
    root.querySelector<HTMLElement>('#b')!.click()
    expect(warnings).toEqual(["no handler for event 'toString'; add on.toString", "no handler for event 'valueOf'; add on.valueOf"])
  })

  // A class's prototype has `constructor` (the class): it is no handler, so the event still warns.
  test("a class's constructor is never a handler", () => {
    const calls: string[] = []
    class Handlers {
      save(): void {
        calls.push('save')
      }
    }
    const src = view({
      schema: { events: { constructor: {}, save: {} } },
      body: `<button id="a" m-on:click="emit('constructor')">a</button><button id="b" m-on:click="emit('save')">b</button>`,
    })
    mountSource(root, src, { data: {}, on: new Handlers(), onWarning })
    expect(warnings).toEqual(["declared event 'constructor' has no handler; add on.constructor"])
    warnings = []
    expect(() => root.querySelector<HTMLElement>('#a')!.click()).not.toThrow()
    root.querySelector<HTMLElement>('#b')!.click()
    expect(warnings).toEqual(["no handler for event 'constructor'; add on.constructor"])
    expect(calls).toEqual(['save'])
  })

  test('handlers may be methods of a class', () => {
    const calls: string[] = []
    class Host {
      go(): void {
        calls.push('go')
      }
    }
    const src = view({ schema: { events: { go: {} } }, body: `<button m-on:click="emit('go')">go</button>` })
    mountSource(root, src, { data: {}, on: new Host(), onWarning })
    root.querySelector<HTMLElement>('button')!.click()
    expect(calls).toEqual(['go'])
    expect(warnings).toEqual([])
  })
})

test('m-text on a void element is warned about and skipped', () => {
  const src = view({
    schema: { data: { type: 'object', properties: { a: { type: 'string' } } } },
    body: '<input m-text="a"><p m-text="a"></p>',
  })
  mountSource(root, src, { data: { a: 'x' }, on: {}, onWarning })
  expect(texts()).toEqual(['x'])
  expect(warnings).toEqual(['<input m-text="a">: <input> has no content to set; skipped'])
})
