// `melzin check` as a process: output format, summary line, exit codes and the default file list.

import { afterAll, beforeAll, describe, expect, test } from 'bun:test'
import { copyFileSync, mkdirSync, mkdtempSync, rmSync, symlinkSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

const cli = join(import.meta.dir, '../src/index.ts')
const fixtures = join(import.meta.dir, 'fixtures/check')
let dir = ''

async function run(args: string[], cwd = dir): Promise<{ code: number; stdout: string; stderr: string }> {
  const proc = Bun.spawn(['bun', cli, 'check', ...args], { cwd, stdout: 'pipe', stderr: 'pipe' })
  const [stdout, stderr, code] = await Promise.all([new Response(proc.stdout).text(), new Response(proc.stderr).text(), proc.exited])
  return { code, stdout, stderr }
}

beforeAll(() => {
  dir = mkdtempSync(join(tmpdir(), 'melzin-check-'))
  mkdirSync(join(dir, 'views'))
  mkdirSync(join(dir, 'clean'))
  mkdirSync(join(dir, 'empty'))
  copyFileSync(join(fixtures, 'good-counter.mel.html'), join(dir, 'views/a-counter.mel.html'))
  copyFileSync(join(fixtures, 'text-unknown-path.mel.html'), join(dir, 'views/b-unknown.mel.html'))
  copyFileSync(join(fixtures, 'text-content.mel.html'), join(dir, 'views/c-content.mel.html'))
  copyFileSync(join(fixtures, 'good-static.mel.html'), join(dir, 'clean/static.mel.html'))
  copyFileSync(join(fixtures, 'good-nested.mel.html'), join(dir, 'clean/nested.mel.html'))
  // Neither a dangling symlink nor an editor lock file may abort the default run.
  symlinkSync(join(dir, 'nowhere.mel.html'), join(dir, 'clean/broken.mel.html'))
  symlinkSync('user@host.1234:1700000000', join(dir, 'clean/.#static.mel.html'))
  copyFileSync(join(fixtures, 'wrong-name.html'), join(dir, 'views/not-a-view.html'))
})

afterAll(() => {
  rmSync(dir, { recursive: true, force: true })
})

describe('melzin check', () => {
  test('defaults to every view in views/, compiler-style lines and a summary, exit 1 on errors', async () => {
    const { code, stdout } = await run([])
    expect(stdout).toBe(
      [
        "views/b-unknown.mel.html:15:14: error: m-text: unknown field 'cuont' (did you mean 'count'?)",
        'views/c-content.mel.html:14:21: warning: m-text elements should be empty; sample text belongs in snapshots',
        '1 error, 1 warning in 3 files',
        '',
      ].join('\n'),
    )
    expect(code).toBe(1)
  })

  test('exit 0 with only warnings', async () => {
    const { code, stdout } = await run(['views/c-content.mel.html'])
    expect(stdout.trim().split('\n').at(-1)).toBe('0 errors, 1 warning in 1 file')
    expect(code).toBe(0)
  })

  test('--views picks another directory; a clean run exits 0', async () => {
    const { code, stdout } = await run(['--views', 'clean'])
    expect(stdout).toBe('0 errors, 0 warnings in 2 files\n')
    expect(code).toBe(0)
  })

  test('explicit files, paths relative to the cwd', async () => {
    const { code, stdout } = await run(['b-unknown.mel.html', 'not-a-view.html', 'missing.mel.html'], join(dir, 'views'))
    expect(stdout).toBe(
      [
        "b-unknown.mel.html:15:14: error: m-text: unknown field 'cuont' (did you mean 'count'?)",
        "not-a-view.html:1:1: error: view files must be named *.mel.html (got 'not-a-view.html')",
        "missing.mel.html:1:1: error: can't read the file: file not found",
        '3 errors, 0 warnings in 3 files',
        '',
      ].join('\n'),
    )
    expect(code).toBe(1)
  })

  test('no views to check is an error', async () => {
    const { code, stdout, stderr } = await run(['--views', 'empty'])
    expect(stdout).toBe('')
    expect(stderr.trim()).toBe('melzin check: no *.mel.html files in empty')
    expect(code).toBe(1)
  })

  test('unknown flags are usage errors (exit 2)', async () => {
    const { code, stderr } = await run(['--bogus'])
    expect(stderr).toContain('usage: melzin check [files...] [--views dir]')
    expect(code).toBe(2)
  })
})

describe('melzin check with alternatives in explore/ (SPEC D31)', () => {
  let project = ''

  beforeAll(() => {
    project = mkdtempSync(join(tmpdir(), 'melzin-check-explore-'))
    mkdirSync(join(project, 'views'))
    mkdirSync(join(project, 'explore/cards'), { recursive: true })
    mkdirSync(join(project, 'explore/current'))
    mkdirSync(join(project, 'explore/.hidden'))
    copyFileSync(join(fixtures, 'good-counter.mel.html'), join(project, 'views/counter.mel.html'))
    // An alternative of the counter, with a mistake, and a screen that only exists as an alternative.
    copyFileSync(join(fixtures, 'text-unknown-path.mel.html'), join(project, 'explore/cards/counter.mel.html'))
    copyFileSync(join(fixtures, 'good-static.mel.html'), join(project, 'explore/cards/settings.mel.html'))
    copyFileSync(join(fixtures, 'good-static.mel.html'), join(project, 'explore/stray.mel.html'))
    copyFileSync(join(fixtures, 'good-static.mel.html'), join(project, 'explore/current/counter.mel.html'))
    copyFileSync(join(fixtures, 'text-unknown-path.mel.html'), join(project, 'explore/.hidden/counter.mel.html'))
  })

  afterAll(() => {
    rmSync(project, { recursive: true, force: true })
  })

  test('checks every alternative, and the view files explore/ has no place for', async () => {
    const { code, stdout } = await run([], project)
    expect(stdout).toBe(
      [
        "explore/cards/counter.mel.html:15:14: error: m-text: unknown field 'cuont' (did you mean 'count'?)",
        "explore/stray.mel.html:1:1: error: alternatives go in a folder each, such as explore/<alternative>/stray.mel.html; the folder's name is the alternative's",
        "explore/current/counter.mel.html:1:1: error: 'current' is what the shell calls the version in the views folder, so it can't name an alternative; rename explore/current/",
        '3 errors, 0 warnings in 5 files',
        '',
      ].join('\n'),
    )
    expect(code).toBe(1)
  })

  test('a project whose only views are alternatives still has something to check', async () => {
    const fresh = mkdtempSync(join(tmpdir(), 'melzin-check-fresh-'))
    try {
      mkdirSync(join(fresh, 'views'))
      mkdirSync(join(fresh, 'explore/warm'), { recursive: true })
      copyFileSync(join(fixtures, 'good-static.mel.html'), join(fresh, 'explore/warm/home.mel.html'))
      const { code, stdout } = await run([], fresh)
      expect(stdout).toBe('0 errors, 0 warnings in 1 file\n')
      expect(code).toBe(0)
    } finally {
      rmSync(fresh, { recursive: true, force: true })
    }
  })
})
