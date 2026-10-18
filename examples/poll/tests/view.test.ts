// The real poll view, mounted by the real runtime in happy-dom with what the adapter sends: one row per
// option, each Vote button sends its option's id, and a vote's answer updates the rows in place, keyed
// by id, as client.ts does with the server's answer.

import { GlobalRegistrator } from '@happy-dom/global-registrator'
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, test } from 'bun:test'
import { join } from 'node:path'
import { mountSource } from 'melzin'
import { MEETUP_POLL, emptyState, toViewModel, type Poll, type PollState } from '../server.ts'
import type { Data, Handlers } from '../views/poll.types.ts'

const source = await Bun.file(join(import.meta.dir, '..', 'views', 'poll.mel.html')).text()

// DOM globals for this file only; the other test files keep a plain Bun environment.
beforeAll(() => {
  if (!GlobalRegistrator.isRegistered) GlobalRegistrator.register({ url: 'http://localhost:3000/' })
})
afterAll(async () => {
  if (GlobalRegistrator.isRegistered) await GlobalRegistrator.unregister()
})

let root: HTMLElement
let warnings: string[]
let votes: string[]

beforeEach(() => {
  root = document.createElement('div')
  document.body.append(root)
  warnings = []
  votes = []
})

afterEach(() => {
  root.remove()
})

function mountPoll(state: PollState, poll: Poll = MEETUP_POLL) {
  const on: Handlers = { vote: ({ optionId }) => votes.push(optionId) }
  return mountSource<Data, Handlers>(root, source, { data: toViewModel(state, poll), on, onWarning: (message) => warnings.push(message) })
}

/** What a sighted user reads: no display: none, no sr-only text. */
function visibleText(node: Node): string {
  if (node.nodeType === 3) return node.textContent ?? ''
  if (node.nodeType !== 1) return ''
  const el = node as HTMLElement
  if (el.style?.display === 'none' || el.classList.contains('sr-only')) return ' '
  return [...el.childNodes].map(visibleText).join('')
}

const text = (node: Node = root): string => visibleText(node).replace(/\s+/g, ' ').trim()
const rows = (): HTMLLIElement[] => [...root.querySelectorAll('li')]
/** The rows' Vote buttons by their accessible name ("Vote for Pizza"), in page order. */
function buttons(): Map<string, HTMLButtonElement> {
  return new Map([...root.querySelectorAll('li button')].map((button) => [(button.textContent ?? '').replace(/\s+/g, ' ').trim(), button as HTMLButtonElement]))
}

describe('poll view', () => {
  test('a row per option, in the poll\'s order, with its emoji, votes and share', () => {
    mountPoll({ pizza: 14, tacos: 13, sushi: 12 })
    expect(rows().map((row) => text(row))).toEqual(['🍕 Pizza 14 36% Vote', '🌮 Tacos 13 33% Vote', '🍣 Sushi 12 31% Vote'])
    expect([...buttons().keys()]).toEqual(['Vote for Pizza', 'Vote for Tacos', 'Vote for Sushi'])
    expect(text()).toContain('39 votes')
    expect(warnings).toEqual([])
  })

  test("each Vote button sends its own option's id", () => {
    mountPoll(emptyState())
    buttons().get('Vote for Tacos')!.click()
    buttons().get('Vote for Pizza')!.click()
    buttons().get('Vote for Tacos')!.click()
    expect(votes).toEqual(['tacos', 'pizza', 'tacos'])
  })

  test("a vote's answer changes only the counts: every row and button keeps its element", () => {
    const view = mountPoll(emptyState())
    const before = { rows: rows(), buttons: buttons() }
    view.update(toViewModel({ pizza: 0, tacos: 1, sushi: 0 }))
    expect(rows()).toHaveLength(3)
    rows().forEach((row, i) => expect(row).toBe(before.rows[i]!))
    expect(buttons().get('Vote for Tacos')).toBe(before.buttons.get('Vote for Tacos')!)
    expect(text(rows()[1]!)).toBe('🌮 Tacos 1 100% Vote')
    expect(text()).toContain('1 vote')
    buttons().get('Vote for Tacos')!.click()
    expect(votes).toEqual(['tacos'])
  })

  test('a poll that gains, drops and reorders options keeps the rows it still has, by id', () => {
    const view = mountPoll(emptyState())
    const [pizza, , sushi] = rows()
    const next: Poll = { question: MEETUP_POLL.question, options: [MEETUP_POLL.options[2]!, { id: 'curry', label: 'Curry', emoji: '🍛' }, MEETUP_POLL.options[0]!] }
    view.update(toViewModel({ curry: 2 }, next))
    expect(rows().map((row) => text(row))).toEqual(['🍣 Sushi 0 0% Vote', '🍛 Curry 2 100% Vote', '🍕 Pizza 0 0% Vote'])
    expect(rows()[0]).toBe(sushi!)
    expect(rows()[2]).toBe(pizza!)
    buttons().get('Vote for Curry')!.click()
    expect(votes).toEqual(['curry'])
    expect(warnings).toEqual([])
  })

  test('six options with long labels all show, each with its own vote', () => {
    const six: Poll = {
      question: MEETUP_POLL.question,
      options: ['pizza', 'tacos', 'sushi', 'curry', 'burgers', 'salad'].map((id) => ({ id, label: `${id} ${'x'.repeat(80)}`, emoji: '🍽️' })),
    }
    mountPoll({ salad: 1 }, six)
    expect(rows()).toHaveLength(6)
    rows().at(-1)!.querySelector('button')!.click()
    expect(votes).toEqual(['salad'])
    expect(warnings).toEqual([])
  })
})
