// The generated types against the real `mount` signature, checked by tsc: correct hosts pass; a
// missing handler, an extra handler, wrong data and a handler that takes the wrong payload fail (D15,
// D35).

import { afterAll, beforeAll, describe, expect, test } from 'bun:test'
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { loadViewFile } from '../src/check.ts'
import { generateTypes } from '../src/types.ts'

const root = join(import.meta.dir, '..')
const tsc = join(root, 'node_modules/.bin/tsc')
const runtime = join(root, '../melzin/src/runtime/index.ts')
const fixtures = join(import.meta.dir, 'fixtures/types')
let dir = ''

/** Each host file mounts one view; `expect` lists the TS error codes it must produce (none = passes). */
type Host = { file: string; types: string; body: string; errors: string[]; mentions?: string }

const hosts: Host[] = [
  {
    file: 'counter-ok.ts',
    types: 'counter',
    errors: [],
    body: `
      let count = 0
      const view = await mount<Data, Handlers>(el, '/views/counter.mel.html', {
        data: { count },
        on: { increment: (payload) => { const nothing: undefined = payload; void nothing; view.update({ count: ++count }) } },
      })
      view.update({ count: 2 })
      const current: number = view.data.count
      void current
      view.destroy()`,
  },
  {
    file: 'counter-missing-handler.ts',
    types: 'counter',
    errors: ['TS2741'],
    mentions: 'increment',
    body: `await mount<Data, Handlers>(el, '/v', { data: { count: 0 }, on: {} })`,
  },
  {
    file: 'counter-extra-handler.ts',
    types: 'counter',
    errors: ['TS2353'],
    mentions: 'decrement',
    body: `await mount<Data, Handlers>(el, '/v', { data: { count: 0 }, on: { increment() {}, decrement() {} } })`,
  },
  {
    file: 'counter-wrong-data.ts',
    types: 'counter',
    errors: ['TS2322'],
    body: `await mount<Data, Handlers>(el, '/v', { data: { count: '3' }, on: { increment() {} } })`,
  },
  {
    file: 'counter-wrong-update.ts',
    types: 'counter',
    errors: ['TS2322'],
    body: `const view = await mount<Data, Handlers>(el, '/v', { data: { count: 0 }, on: { increment() {} } })
      view.update({ count: true })`,
  },
  {
    file: 'counter-missing-data.ts',
    types: 'counter',
    errors: ['TS2741'],
    mentions: 'count',
    body: `await mount<Data, Handlers>(el, '/v', { data: {}, on: { increment() {} } })`,
  },
  {
    file: 'counter-handler-with-payload.ts',
    types: 'counter',
    errors: ['TS2322'],
    body: `await mount<Data, Handlers>(el, '/v', { data: { count: 0 }, on: { increment: (n: number) => { void n } } })`,
  },
  {
    file: 'nested-ok.ts',
    types: 'nested',
    errors: [],
    body: `await mount<Data, Handlers>(el, '/v', { data: { user: { name: 'Ada' } }, on: { follow() {} } })
      await mount<Data, Handlers>(el, '/v', { data: { user: { name: 'Ada', stats: { followers: 3 } } }, on: { follow() {} } })`,
  },
  {
    file: 'nested-wrong-deep-type.ts',
    types: 'nested',
    errors: ['TS2322'],
    body: `await mount<Data, Handlers>(el, '/v', { data: { user: { name: 'Ada', stats: { followers: '3' } } }, on: { follow() {} } })`,
  },
  {
    file: 'nested-unknown-field.ts',
    types: 'nested',
    errors: ['TS2353'],
    mentions: 'nmae',
    body: `await mount<Data, Handlers>(el, '/v', { data: { user: { nmae: 'Ada', name: 'x' } }, on: { follow() {} } })`,
  },
  {
    file: 'no-data-ok.ts',
    types: 'no-data',
    errors: [],
    body: `await mount<Data, Handlers>(el, '/v', { data: {}, on: { dismiss() {} } })`,
  },
  {
    file: 'no-data-with-data.ts',
    types: 'no-data',
    errors: ['TS2322'],
    body: `await mount<Data, Handlers>(el, '/v', { data: { x: 1 }, on: { dismiss() {} } })`,
  },
  {
    file: 'no-events-ok.ts',
    types: 'no-events',
    errors: [],
    body: `await mount<Data, Handlers>(el, '/v', { data: { message: 'hi' }, on: {} })
      await mount<Data, Handlers>(el, '/v', { data: {}, on: {} })`,
  },
  {
    file: 'no-events-with-handler.ts',
    types: 'no-events',
    errors: ['TS2322'],
    body: `await mount<Data, Handlers>(el, '/v', { data: {}, on: { anything() {} } })`,
  },
  // Lists (D34) and payloads (D35).
  {
    file: 'poll-ok.ts',
    types: 'poll',
    errors: [],
    body: `
      const options = [{ id: 'a', label: 'A', votes: 0, mine: false }, { id: 'b', label: 'B', votes: 2, mine: true, note: 'hot' }]
      const view = await mount<Data, Handlers>(el, '/v', {
        data: { question: 'Lunch?', options, tags: ['food'] },
        on: {
          vote: ({ optionId, note }) => {
            const id: string = optionId
            const extra: string | undefined = note
            view.update({ ...view.data, options: view.data.options.map((option) => (option.id === id ? { ...option, votes: option.votes + 1 } : option)) })
            void extra
          },
          pick: (payload) => { const votes: number = payload.votes; void votes },
          reset: (payload) => { const nothing: undefined = payload; void nothing },
        },
      })`,
  },
  {
    file: 'poll-wrong-payload.ts',
    types: 'poll',
    errors: ['TS2322'],
    mentions: 'optionId',
    body: `await mount<Data, Handlers>(el, '/v', {
        data: { question: 'Q', options: [] },
        on: { vote: (payload: { optionId: number }) => { void payload }, pick() {}, reset() {} },
      })`,
  },
  {
    file: 'poll-payload-field-it-lacks.ts',
    types: 'poll',
    errors: ['TS2322'],
    body: `await mount<Data, Handlers>(el, '/v', {
        data: { question: 'Q', options: [] },
        on: { vote: (payload: { optionId: string; userId: string }) => { void payload }, pick() {}, reset() {} },
      })`,
  },
  {
    file: 'poll-wrong-item.ts',
    types: 'poll',
    errors: ['TS2322'],
    body: `await mount<Data, Handlers>(el, '/v', {
        data: { question: 'Q', options: [{ id: 'a', label: 'A', votes: '3', mine: false }] },
        on: { vote() {}, pick() {}, reset() {} },
      })`,
  },
  {
    file: 'poll-list-of-strings.ts',
    types: 'poll',
    errors: ['TS2322'],
    body: `await mount<Data, Handlers>(el, '/v', { data: { question: 'Q', options: [], tags: [1, 2] }, on: { vote() {}, pick() {}, reset() {} } })`,
  },
]

let output = ''

beforeAll(async () => {
  dir = mkdtempSync(join(tmpdir(), 'melzin-tsc-'))
  for (const name of ['counter', 'nested', 'no-data', 'no-events', 'poll']) {
    const view = await loadViewFile(join(fixtures, `${name}.mel.html`))
    writeFileSync(join(dir, `${name}.types.ts`), generateTypes(view.schema, `${name}.mel.html`))
  }
  for (const host of hosts) {
    const source = [
      `import { mount } from ${JSON.stringify(runtime)}`,
      `import type { Data, Handlers } from './${host.types}.types.ts'`,
      'declare const el: Element',
      `export async function main(): Promise<void> {`,
      host.body,
      '}',
      '',
    ].join('\n')
    writeFileSync(join(dir, host.file), source)
  }
  // The base config minus Bun's types (host code is browser code).
  writeFileSync(
    join(dir, 'tsconfig.json'),
    JSON.stringify({ extends: join(root, '../../tsconfig.base.json'), compilerOptions: { types: [] }, include: ['*.ts'] }),
  )
  const proc = Bun.spawn([tsc, '--noEmit', '--pretty', 'false', '-p', dir], { cwd: dir, stdout: 'pipe', stderr: 'pipe' })
  const [stdout, stderr] = await Promise.all([new Response(proc.stdout).text(), new Response(proc.stderr).text(), proc.exited])
  output = stdout + stderr
})

afterAll(() => {
  rmSync(dir, { recursive: true, force: true })
})

/** tsc error lines for one host file (errors in other files, e.g. the runtime, are ignored here). */
function errorsIn(file: string): string[] {
  return output.split('\n').filter((line) => line.startsWith(`${file}(`) || line.includes(`/${file}(`))
}

describe('generated types with mount<Data, Handlers>', () => {
  test('tsc ran', () => {
    expect(output).not.toContain('error TS5') // config errors
    expect(errorsIn('counter.types.ts')).toEqual([])
  })

  for (const host of hosts) {
    const label = host.errors.length === 0 ? 'passes' : `fails with ${host.errors.join(', ')}`
    test(`${host.file} ${label}`, () => {
      const lines = errorsIn(host.file)
      const codes = [...new Set(lines.map((line) => /error (TS\d+)/.exec(line)?.[1]))]
      expect({ file: host.file, codes }).toEqual({ file: host.file, codes: host.errors })
      if (host.mentions !== undefined) expect(lines.join('\n')).toContain(host.mentions)
    })
  }
})
