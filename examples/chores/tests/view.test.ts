// The real chores view, mounted by the real runtime in happy-dom with what the adapter sends: the
// bindings follow the data (aria-pressed, data-*, classes), the toggles send their chore's id, and an
// update keeps each row's elements.

import { GlobalRegistrator } from '@happy-dom/global-registrator'
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, test } from 'bun:test'
import { join } from 'node:path'
import { mountSource } from 'melzin'
import { STARTING_CHORES, toViewModel, type Chore, type Filter } from '../server.ts'
import type { Data, Handlers } from '../views/chores.types.ts'

const source = await Bun.file(join(import.meta.dir, '..', 'views', 'chores.mel.html')).text()

beforeAll(() => {
  if (!GlobalRegistrator.isRegistered) GlobalRegistrator.register({ url: 'http://localhost:3000/' })
})
afterAll(async () => {
  if (GlobalRegistrator.isRegistered) await GlobalRegistrator.unregister()
})

let root: HTMLElement
let warnings: string[]
let sent: string[]

beforeEach(() => {
  root = document.createElement('div')
  document.body.append(root)
  warnings = []
  sent = []
})
afterEach(() => {
  root.remove()
})

function mountChores(chores: readonly Chore[] = STARTING_CHORES, filter: Filter = 'all') {
  const on: Handlers = {
    toggle: ({ choreId }) => sent.push(`toggle ${choreId}`),
    filter: ({ filterId }) => sent.push(`filter ${filterId}`),
  }
  return mountSource<Data, Handlers>(root, source, { data: toViewModel(chores, filter), on, onWarning: (message) => warnings.push(message) })
}

const rows = (): HTMLLIElement[] => [...root.querySelectorAll('li')]
// happy-dom reads `m-bind:class` as a namespaced `class` attribute, so read classes from the markup.
const classOf = (el: Element): string => / class="([^"]*)"/.exec(el.outerHTML)?.[1] ?? ''

describe('chores view', () => {
  test('rows carry their state as attributes and classes', () => {
    mountChores()
    expect(warnings).toEqual([])
    const [plants, bins, , , groceries] = rows()
    expect(plants!.getAttribute('data-done')).toBe('true')
    expect(bins!.hasAttribute('data-done')).toBe(false)
    expect(bins!.getAttribute('data-priority')).toBe('high')
    expect(groceries!.getAttribute('data-priority')).toBe('low')
    expect(plants!.querySelector('button')!.getAttribute('aria-pressed')).toBe('true')
    expect(bins!.querySelector('button')!.getAttribute('aria-pressed')).toBe('false')
    expect(bins!.querySelector('button')!.getAttribute('aria-label')).toBe('Take the bins out')
    expect(classOf(plants!.querySelector('p')!)).toContain('line-through')
    expect(classOf(bins!.querySelector('p')!)).toContain('text-zinc-900')
    expect(root.querySelector('[role="img"]')!.getAttribute('aria-label')).toBe('2 of 5 done')
  })

  test('the filters say which one is current, and send their id', () => {
    mountChores(STARTING_CHORES, 'open')
    const filters = [...root.querySelectorAll('nav button')] as HTMLButtonElement[]
    expect(filters.map((button) => button.getAttribute('aria-pressed'))).toEqual(['false', 'true', 'false'])
    filters[2]!.click()
    expect(sent).toEqual(['filter done'])
    expect(rows().length).toBe(3)
  })

  test("a toggle sends its chore's id, and the update keeps the row and flips its bindings", () => {
    const view = mountChores()
    const bins = rows()[1]!
    const button = bins.querySelector('button')!
    button.click()
    expect(sent).toEqual(['toggle bins'])
    view.update(toViewModel(STARTING_CHORES.map((chore) => (chore.id === 'bins' ? { ...chore, done: true } : chore))))
    expect(rows()[1]).toBe(bins)
    expect(bins.querySelector('button')).toBe(button)
    expect(bins.getAttribute('data-done')).toBe('true')
    expect(button.getAttribute('aria-pressed')).toBe('true')
    expect(classOf(bins.querySelector('p')!)).toContain('line-through')
    expect(root.querySelector('[role="img"]')!.getAttribute('aria-label')).toBe('3 of 5 done')
  })

  test('an empty list shows its empty state', () => {
    mountChores(STARTING_CHORES.map((chore) => ({ ...chore, done: true })), 'open')
    expect(rows()).toEqual([])
    expect(root.textContent).toContain('Nothing left to do')
  })
})
