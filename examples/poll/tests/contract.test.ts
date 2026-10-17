// Contract test (SPEC §9.3): what the backend sends must match what the view declares.

import { describe, expect, test } from 'bun:test'
import { join } from 'node:path'
import { validateData } from 'melzin/core'
import { loadViewFile, type LoadedView } from '@melzin/cli/tools'
import { QUESTION, emptyState, toViewModel, type PollState } from '../server.ts'

const POLL_VIEW = join(import.meta.dir, '..', 'views', 'poll.mel.html')

async function loadPoll(): Promise<LoadedView> {
  const view = await loadViewFile(POLL_VIEW)
  expect(view.issues).toEqual([])
  expect(view.schema).not.toBeNull()
  return view
}

const STATES: Record<string, PollState> = {
  'zero votes': emptyState(),
  'one vote': { pizza: 0, tacos: 1, sushi: 0 },
  'a tie': { pizza: 5, tacos: 5, sushi: 5 },
  'close race': { pizza: 14, tacos: 13, sushi: 12 },
  'landslide': { pizza: 2, tacos: 41, sushi: 3 },
  'huge numbers': { pizza: 1284031, tacos: 987654, sushi: 2345678 },
}

describe('poll contract', () => {
  for (const [name, state] of Object.entries(STATES)) {
    test(`toViewModel matches the poll schema: ${name}`, async () => {
      const { schema } = await loadPoll()
      expect(validateData(schema, toViewModel(state))).toEqual([])
    })
  }

  test('a long question still fits the schema', async () => {
    const { schema } = await loadPoll()
    expect(validateData(schema, toViewModel({ pizza: 1, tacos: 2, sushi: 3 }, 'x'.repeat(500)))).toEqual([])
  })

  test('the schema declares exactly the events the client handles', async () => {
    const { schema } = await loadPoll()
    expect(Object.keys(schema?.events ?? {}).sort()).toEqual(['votePizza', 'voteSushi', 'voteTacos'])
  })

  test('the contract catches a drifted adapter', async () => {
    const { schema } = await loadPoll()
    const drifted = { ...toViewModel(emptyState()), total: 0, totalLabel: 0 }
    const paths = validateData(schema, drifted).map((issue) => issue.path)
    expect(paths).toContain('total')
    expect(paths).toContain('totalLabel')
  })

  // The snapshots show real states, so they are exactly what the adapter produces for those counts.
  test('the snapshots are states the adapter can produce', async () => {
    const { snapshots } = await loadPoll()
    const counts = (data: Record<string, unknown>): PollState => {
      const votes = (option: string) => (data[option] as { votes: number }).votes
      return { pizza: votes('pizza'), tacos: votes('tacos'), sushi: votes('sushi') }
    }
    expect(snapshots.map((snapshot) => snapshot.name)).toEqual([
      'no votes yet',
      'close race',
      'landslide',
      'huge numbers',
      'very long question',
    ])
    for (const { data } of snapshots) {
      const question = typeof data.question === 'string' ? data.question : QUESTION
      expect(data).toEqual(toViewModel(counts(data), question))
    }
  })
})

describe('toViewModel', () => {
  test('zero votes shows 0% everywhere and a friendly total', () => {
    expect(toViewModel(emptyState())).toEqual({
      question: QUESTION,
      pizza: { votes: 0, percent: '0%' },
      tacos: { votes: 0, percent: '0%' },
      sushi: { votes: 0, percent: '0%' },
      totalLabel: 'No votes yet',
    })
  })

  test('singular and grouped totals', () => {
    expect(toViewModel({ pizza: 1, tacos: 0, sushi: 0 }).totalLabel).toBe('1 vote')
    expect(toViewModel({ pizza: 1, tacos: 0, sushi: 0 }).pizza.percent).toBe('100%')
    expect(toViewModel({ pizza: 1000, tacos: 234, sushi: 0 }).totalLabel).toBe('1,234 votes')
  })

  test('percentages are rounded', () => {
    const model = toViewModel({ pizza: 1, tacos: 1, sushi: 1 })
    expect([model.pizza.percent, model.tacos.percent, model.sushi.percent]).toEqual(['33%', '33%', '33%'])
  })
})
