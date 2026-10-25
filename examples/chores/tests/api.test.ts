// API tests against the real server on a random port, a fresh server per test.

import { afterEach, beforeEach, describe, expect, test } from 'bun:test'
import { createChoresServer } from '../server.ts'

let server: ReturnType<typeof createChoresServer>
let base: string

beforeEach(() => {
  server = createChoresServer({ port: 0, hostname: '127.0.0.1', development: false })
  base = server.url.href.replace(/\/$/, '')
})
afterEach(async () => {
  await server.stop(true)
})

const toggle = (body: string, query = '') =>
  fetch(`${base}/api/chores/toggle${query}`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body })

describe('chores API', () => {
  test('GET filters the list', async () => {
    const open = await (await fetch(`${base}/api/chores?show=open`)).json()
    expect(open.chores.map((chore: { id: string }) => chore.id)).toEqual(['bins', 'bathroom', 'groceries'])
    expect(open.filters.find((filter: { current: boolean }) => filter.current).id).toBe('open')
    const unknown = await (await fetch(`${base}/api/chores?show=nope`)).json()
    expect(unknown.chores.length).toBe(5)
  })

  test('POST toggle takes the view payload and answers with the new view model', async () => {
    const response = await toggle('{"choreId":"bins"}', '?show=done')
    expect(response.status).toBe(200)
    const data = await response.json()
    expect(data.chores.map((chore: { id: string }) => chore.id)).toEqual(['plants', 'bins', 'laundry'])
    expect(data.progressLabel).toBe('3 of 5 done')
  })

  test('bad requests are refused', async () => {
    expect((await toggle('{"choreId":"nope"}')).status).toBe(400)
    expect((await toggle('not json')).status).toBe(400)
    const form = await fetch(`${base}/api/chores/toggle`, { method: 'POST', body: 'choreId=bins', headers: { 'Content-Type': 'application/x-www-form-urlencoded' } })
    expect(form.status).toBe(415)
  })
})
