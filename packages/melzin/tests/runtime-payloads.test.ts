// Event payloads in the runtime (SPEC D35): what a click sends, built from the row's current item, the
// data and the URL input; events without a payload; and the warnings for emits that don't match.

import { afterEach, beforeEach, describe, expect, test } from 'bun:test'
import { mountSource } from '../src/runtime/index.ts'
import { useDom } from './helpers/dom.ts'
import { view } from './runtime-fixtures.ts'

useDom()

const SCHEMA = {
  data: {
    type: 'object',
    properties: {
      pollId: { type: 'number' },
      closed: { type: 'boolean', default: false },
      options: {
        type: 'array',
        key: 'id',
        minItems: 2,
        items: {
          type: 'object',
          properties: {
            id: { type: 'string' },
            label: { type: 'string' },
            note: { type: 'string' },
            votes: { type: 'number', default: 0 },
          },
          required: ['id', 'label'],
        },
      },
    },
    required: ['pollId', 'options'],
  },
  events: {
    vote: {
      payload: {
        type: 'object',
        properties: {
          optionId: { type: 'string' },
          pollId: { type: 'number' },
          note: { type: 'string' },
          votes: { type: 'number' },
          closed: { type: 'boolean' },
          tab: { type: 'string' },
          handle: { type: 'string' },
        },
        required: ['optionId'],
      },
    },
    refresh: {},
  },
}

type Option = { id: string; label: string; note?: string; votes?: number }
type Data = { pollId: number; closed?: boolean; options: Option[] }

let root: HTMLElement
let warnings: string[]
let calls: unknown[][]
const onWarning = (message: string): void => {
  warnings.push(message)
}
const handlers = {
  vote: (...args: unknown[]) => calls.push(['vote', ...args]),
  refresh: (...args: unknown[]) => calls.push(['refresh', ...args]),
}

beforeEach(() => {
  root = document.createElement('div')
  document.body.append(root)
  warnings = []
  calls = []
})

afterEach(() => {
  root.remove()
})

function mountBody(body: string, data: Data, route = {}) {
  return mountSource(root, view({ schema: SCHEMA, body }), { data, on: handlers, route, onWarning })
}

const options = (...ids: string[]): Option[] => ids.map((id) => ({ id, label: id.toUpperCase() }))
const buttons = (): HTMLButtonElement[] => [...root.querySelectorAll('button')]

describe('payloads', () => {
  test("a click sends its row's item as it is now, with defaults, leaving out missing fields", () => {
    const v = mountBody(
      `<button m-for="option in options" m-on:click="emit('vote', { optionId: option.id, note: option.note, votes: option.votes })" m-text="option.label"></button>`,
      { pollId: 7, options: options('pizza', 'tacos') },
    )
    buttons()[1]!.click()
    expect(calls).toEqual([['vote', { optionId: 'tacos', votes: 0 }]])
    expect(Object.keys(calls[0]![1] as object)).toEqual(['optionId', 'votes'])

    // The same row, with new values for its item.
    const tacos = buttons()[1]!
    v.update({ pollId: 7, options: [{ id: 'tacos', label: 'Tacos', note: 'spicy', votes: 3 }, ...options('pizza')] })
    expect(buttons()[0]).toBe(tacos)
    tacos.click()
    expect(calls[1]).toEqual(['vote', { optionId: 'tacos', note: 'spicy', votes: 3 }])
    expect(warnings).toEqual([])
  })

  test('values can come from the data and the URL input too', () => {
    mountBody(
      `<div m-for="option in options"><button m-on:click="emit('vote', { optionId: option.id, pollId: pollId, closed: closed, tab: route.query.tab, handle: route.params.handle })"></button></div>`,
      { pollId: 7, options: options('pizza', 'tacos') },
      { name: 'poll', params: { handle: 'ana' }, query: {} },
    )
    buttons()[0]!.click()
    expect(calls).toEqual([['vote', { optionId: 'pizza', pollId: 7, closed: false, handle: 'ana' }]])
    expect(warnings).toEqual([])
  })

  test('outside a row, an emit can fill a payload from the data', () => {
    mountBody(`<button m-on:click="emit('vote', { optionId: route.params.option, pollId: pollId })"></button>`, { pollId: 3, options: options('a', 'b') }, {
      params: { option: 'sushi' },
    })
    buttons()[0]!.click()
    expect(calls).toEqual([['vote', { optionId: 'sushi', pollId: 3 }]])
  })

  test('an event without a payload still gets undefined', () => {
    mountBody(`<button m-on:click="emit('refresh')"></button>`, { pollId: 1, options: options('a', 'b') })
    buttons()[0]!.click()
    expect(calls).toEqual([['refresh', undefined]])
    expect(calls[0]).toHaveLength(2)
  })
})

describe('emits that do not match the payload', () => {
  test('a missing payload warns, and the handler gets an empty object', () => {
    mountBody(`<button m-on:click="emit('vote')"></button>`, { pollId: 1, options: options('a', 'b') })
    expect(warnings).toEqual([`<button m-on:click="emit('vote')">: event 'vote' has a payload; send it: emit('vote', { optionId: ... })`])
    buttons()[0]!.click()
    expect(calls).toEqual([['vote', {}]])
  })

  test("a payload for an event that declares none warns and isn't sent", () => {
    mountBody(`<button m-on:click="emit('refresh', { pollId: pollId })"></button>`, { pollId: 1, options: options('a', 'b') })
    expect(warnings).toEqual([
      `<button m-on:click="emit('refresh', { pollId: pollId })">: event 'refresh' has no payload; send emit('refresh'), or declare its payload in the schema's events`,
    ])
    buttons()[0]!.click()
    expect(calls).toEqual([['refresh', undefined]])
  })

  test('fields that are unknown, unreadable or of the wrong type warn once and are left out', () => {
    mountBody(
      `<button m-for="option in options" m-on:click="emit('vote', { optionId: option.id, optionLabel: option.label, pollId: option.label, note: option.nope })"></button>`,
      { pollId: 1, options: options('pizza', 'tacos', 'sushi') },
    )
    const where = `<button m-on:click="emit('vote', { optionId: option.id, optionLabel: option.label, pollId: option.label, note: option.nope })">`
    expect(warnings).toEqual([
      `${where}: 'optionLabel' isn't a field of the payload of 'vote'`,
      `${where}: 'option.label' is a string, but the payload's 'pollId' is a number`,
      `${where}: unknown field 'option.nope' (did you mean 'option.note'?)`,
    ])
    buttons()[2]!.click()
    expect(calls).toEqual([['vote', { optionId: 'sushi' }]])
  })

  test('a required field filled from a value that may be missing warns, and is sent when it is there', () => {
    const v = mountBody(`<button m-for="option in options" m-on:click="emit('vote', { optionId: option.note })"></button>`, {
      pollId: 1,
      options: options('pizza', 'tacos'),
    })
    expect(warnings).toEqual([
      `<button m-on:click="emit('vote', { optionId: option.note })">: 'option.note' may be missing, but the payload requires 'optionId'`,
    ])
    buttons()[0]!.click()
    v.update({ pollId: 1, options: [{ id: 'pizza', label: 'Pizza', note: 'p' }, ...options('tacos')] })
    buttons()[0]!.click()
    expect(calls).toEqual([['vote', {}], ['vote', { optionId: 'p' }]])
  })

  test("a payload in a form emit doesn't take warns with the event's fields and the row's alias", () => {
    mountBody(
      `<button m-for="option in options" m-on:click="emit('vote', option.id)"></button><button m-on:click="emit('vote', { 'optionId' })"></button>`,
      { pollId: 1, options: options('a', 'b') },
    )
    expect(warnings).toEqual([
      `<button m-on:click="emit('vote', option.id)">: a payload is an object of named fields: emit('vote', { optionId: option.id }) (at column 14); skipped`,
      `<button m-on:click="emit('vote', { 'optionId' })">: write field names without quotes: { optionId: <path> } (at column 16); skipped`,
    ])
    buttons()[0]!.click()
    expect(calls).toEqual([])
  })

  test('an undeclared event sends the fields it can read', () => {
    const extra: unknown[] = []
    mountSource(root, view({ schema: SCHEMA, body: `<button m-for="option in options" m-on:click="emit('pick', { id: option.id, nope: option.nope })"></button>` }), {
      data: { pollId: 1, options: options('pizza', 'tacos') },
      on: { ...handlers, pick: (payload: unknown) => extra.push(payload) },
      onWarning,
    })
    buttons()[1]!.click()
    expect(extra).toEqual([{ id: 'tacos' }])
    expect(warnings).toEqual([
      "m-on:click emits 'pick', which isn't declared in the schema's events",
      "handler 'pick' doesn't match a declared event (possible typo)",
    ])
  })
})
