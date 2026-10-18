// Contract test (SPEC §9.3): what the backend sends must match what the view declares.

import { describe, expect, test } from 'bun:test'
import { join } from 'node:path'
import { validateData } from 'melzin/core'
import { loadViewFile, type LoadedView } from '@melzin/cli/tools'
import { MEETUP_POLL, emptyState, toViewModel, type Poll, type PollState } from '../server.ts'

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

/** Two options, the fewest the view allows. */
const TWO_OPTIONS: Poll = { question: 'Tea or coffee?', options: [{ id: 'tea', label: 'Tea', emoji: '🍵' }, { id: 'coffee', label: 'Coffee', emoji: '☕' }] }

describe('poll contract', () => {
  for (const [name, state] of Object.entries(STATES)) {
    test(`toViewModel matches the poll schema: ${name}`, async () => {
      const { schema } = await loadPoll()
      expect(validateData(schema, toViewModel(state))).toEqual([])
    })
  }

  test('a long question, two options or a dozen still fit the schema', async () => {
    const { schema } = await loadPoll()
    expect(validateData(schema, toViewModel({ pizza: 1, tacos: 2, sushi: 3 }, { ...MEETUP_POLL, question: 'x'.repeat(500) }))).toEqual([])
    expect(validateData(schema, toViewModel({ coffee: 1 }, TWO_OPTIONS))).toEqual([])
    const dozen: Poll = { question: 'Pick a number', options: Array.from({ length: 12 }, (_, i) => ({ id: `n${i}`, label: 'y'.repeat(200), emoji: '🔢' })) }
    expect(validateData(schema, toViewModel({}, dozen))).toEqual([])
  })

  test('the schema declares exactly the events the client handles, with the payload it reads', async () => {
    const { schema } = await loadPoll()
    expect(Object.keys(schema?.events ?? {})).toEqual(['vote'])
    const payload = schema?.events?.vote?.payload
    expect(Object.keys(payload?.properties ?? {})).toEqual(['optionId'])
    expect(payload?.required).toEqual(['optionId'])
  })

  test('the contract catches a drifted adapter', async () => {
    const { schema } = await loadPoll()
    const model = toViewModel(emptyState())
    const drifted = { ...model, total: 0, totalLabel: 0 }
    const paths = validateData(schema, drifted).map((issue) => issue.path)
    expect(paths).toContain('total')
    expect(paths).toContain('totalLabel')
  })

  test('the contract catches options without their key, keys used twice and a poll with one option', async () => {
    const { schema } = await loadPoll()
    const [pizza, tacos, sushi] = toViewModel(emptyState()).options
    // A row without its id, the same id twice and a count sent as text.
    const issues = validateData(schema, { ...toViewModel(emptyState()), options: [pizza, { ...tacos, id: undefined }, { ...sushi, id: 'pizza', votes: '0' }] })
    expect(issues.map((issue) => issue.path)).toEqual(['options[1].id', 'options[2].votes', 'options[2].id'])
    expect(issues).toContainEqual({ path: 'options[2].id', message: 'duplicate key "pizza": options[0] has it too; keys must be unique in a list' })
    // A poll the backend got wrong: the view designs for two options or more (minItems).
    const lonely = toViewModel({}, { question: 'Pizza?', options: [{ id: 'pizza', label: 'Pizza', emoji: '🍕' }] })
    expect(validateData(schema, lonely).map((issue) => issue.path)).toEqual(['options'])
  })

  // The snapshots show real states, so each is exactly what the adapter produces for some poll and its
  // counts: the meetup poll, or (for the hostile one) a poll with six options and long labels.
  test('the snapshots are states the adapter can produce', async () => {
    const { snapshots } = await loadPoll()
    expect(snapshots.map((snapshot) => snapshot.name)).toEqual([
      'no votes yet',
      'close race',
      'landslide',
      'huge numbers',
      'very long question',
      'six options with long labels',
    ])
    for (const { name, data } of snapshots) {
      const rows = data.options as { id: string; label: string; emoji: string; votes: number }[]
      const poll: Poll = { question: data.question as string, options: rows.map(({ id, label, emoji }) => ({ id, label, emoji })) }
      const counts: PollState = Object.fromEntries(rows.map(({ id, votes }) => [id, votes]))
      expect({ name, data }).toEqual({ name, data: toViewModel(counts, poll) as never })
      if (name !== 'six options with long labels') expect({ name, options: poll.options }).toEqual({ name, options: MEETUP_POLL.options })
    }
  })
})

describe('toViewModel', () => {
  test('zero votes shows 0% everywhere and a friendly total', () => {
    expect(toViewModel(emptyState())).toEqual({
      question: MEETUP_POLL.question,
      options: [
        { id: 'pizza', label: 'Pizza', emoji: '🍕', votes: 0, percent: '0%' },
        { id: 'tacos', label: 'Tacos', emoji: '🌮', votes: 0, percent: '0%' },
        { id: 'sushi', label: 'Sushi', emoji: '🍣', votes: 0, percent: '0%' },
      ],
      totalLabel: 'No votes yet',
    })
  })

  test('singular and grouped totals', () => {
    expect(toViewModel({ pizza: 1, tacos: 0, sushi: 0 }).totalLabel).toBe('1 vote')
    expect(toViewModel({ pizza: 1, tacos: 0, sushi: 0 }).options[0]?.percent).toBe('100%')
    expect(toViewModel({ pizza: 1000, tacos: 234, sushi: 0 }).totalLabel).toBe('1,234 votes')
  })

  test('percentages are rounded', () => {
    expect(toViewModel({ pizza: 1, tacos: 1, sushi: 1 }).options.map((option) => option.percent)).toEqual(['33%', '33%', '33%'])
  })

  test("options keep the poll's order, whatever the votes", () => {
    expect(toViewModel({ pizza: 0, tacos: 1, sushi: 99 }).options.map((option) => option.id)).toEqual(['pizza', 'tacos', 'sushi'])
  })

  test('only the poll\'s own options count: a missing one has no votes, an unknown or inherited id is ignored', () => {
    const model = toViewModel({ tacos: 2, burgers: 5, toString: 7 })
    expect(model.options.map((option) => option.votes)).toEqual([0, 2, 0])
    expect(model.totalLabel).toBe('2 votes')
    expect(toViewModel(Object.create({ pizza: 3 }) as PollState).totalLabel).toBe('No votes yet')
  })
})
