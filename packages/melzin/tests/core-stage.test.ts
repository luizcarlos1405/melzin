import { expect, test } from 'bun:test'
import { type MelzinSchema, linkFields } from '../src/core/schema.ts'
import { STAGES, type StageFacts, viewStage } from '../src/core/stage.ts'

const none: StageFacts = { schemaBlock: false, snapshotsBlock: false, schema: null, readsRoute: false }
const data: MelzinSchema = { data: { type: 'object', properties: { name: { type: 'string' } } } }

test('the stages, in order (SPEC D28)', () => {
  expect(STAGES).toEqual(['exploration', 'states', 'contracts'])
})

test('a file with no schema, no snapshots and no URL input is at exploration', () => {
  expect(viewStage(none)).toBe('exploration')
})

test('a schema block or a snapshots block starts the states stage', () => {
  expect(viewStage({ ...none, schemaBlock: true, schema: data })).toBe('states')
  expect(viewStage({ ...none, snapshotsBlock: true })).toBe('states')
  // An invalid schema is still a schema block.
  expect(viewStage({ ...none, schemaBlock: true })).toBe('states')
  expect(viewStage({ ...none, schemaBlock: true, schema: { ...data, events: {} } })).toBe('states')
})

test('events, link fields or reading the URL make it contracts', () => {
  expect(viewStage({ ...none, schemaBlock: true, schema: { events: { save: {} } } })).toBe('contracts')
  const link: MelzinSchema = { data: { type: 'object', properties: { home: { type: 'object', properties: { url: { type: 'string', route: 'home' } } } } } }
  expect(viewStage({ ...none, schemaBlock: true, schema: link })).toBe('contracts')
  expect(viewStage({ ...none, readsRoute: true })).toBe('contracts')
})

test("a link field inside a list's items makes it contracts; a list and its key don't (D34)", () => {
  const items = { type: 'object' as const, properties: { handle: { type: 'string' as const } }, required: ['handle'] }
  const list: MelzinSchema = { data: { type: 'object', properties: { members: { type: 'array', key: 'handle', items } } } }
  expect(viewStage({ ...none, schemaBlock: true, schema: list })).toBe('states')
  const linked: MelzinSchema = {
    data: {
      type: 'object',
      properties: {
        members: { type: 'array', key: 'handle', items: { ...items, properties: { ...items.properties, url: { type: 'string', route: 'profile' } } } },
      },
    },
  }
  expect(viewStage({ ...none, schemaBlock: true, schema: linked })).toBe('contracts')
  expect(linkFields(linked)).toEqual([{ path: ['members', '[]', 'url'], route: 'profile' }])
  const links: MelzinSchema = { data: { type: 'object', properties: { urls: { type: 'array', uniqueItems: true, items: { type: 'string', route: 'home' } } } } }
  expect(viewStage({ ...none, schemaBlock: true, schema: links })).toBe('contracts')
})

test('linkFields lists every link field with its path', () => {
  const schema: MelzinSchema = {
    data: {
      type: 'object',
      properties: {
        title: { type: 'string' },
        author: { type: 'object', properties: { url: { type: 'string', route: 'profile' }, name: { type: 'string' } } },
        homeUrl: { type: 'string', route: 'home' },
      },
    },
  }
  expect(linkFields(schema)).toEqual([
    { path: ['author', 'url'], route: 'profile' },
    { path: ['homeUrl'], route: 'home' },
  ])
  expect(linkFields(null)).toEqual([])
})
