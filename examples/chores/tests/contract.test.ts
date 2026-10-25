// Contract test (SPEC §9.3): what the backend sends must match what the view declares, and every
// snapshot is a state the adapter can produce.

import { describe, expect, test } from 'bun:test'
import { join } from 'node:path'
import { validateData } from 'melzin/core'
import { loadViewFile } from '@melzin/cli/tools'
import { FILTERS, STARTING_CHORES, toViewModel, type Chore } from '../server.ts'

const view = await loadViewFile(join(import.meta.dir, '..', 'views', 'chores.mel.html'))

const STATES: Record<string, readonly Chore[]> = {
  'a typical week': STARTING_CHORES,
  'all done': STARTING_CHORES.map((chore) => ({ ...chore, done: true })),
  'a new week': [],
}

describe('chores contract', () => {
  test('the view loads without problems', () => {
    expect(view.issues).toEqual([])
  })

  for (const [name, chores] of Object.entries(STATES)) {
    for (const { id } of FILTERS) {
      test(`toViewModel matches the schema: ${name}, ${id}`, () => {
        expect(validateData(view.schema, toViewModel(chores, id))).toEqual([])
      })
    }
  }

  test('the snapshots are states the adapter produces', () => {
    const data = (name: string) => view.snapshots.find((snapshot) => snapshot.name === name)!.data
    expect(toViewModel(STARTING_CHORES)).toEqual(data('a typical week') as never)
    expect(toViewModel(STARTING_CHORES, 'open')).toEqual(data('only the open ones') as never)
    expect(toViewModel([])).toEqual(data('a new week') as never)
  })
})
