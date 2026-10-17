import { describe, expect, test } from 'bun:test'
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { COMMANDS, helpText } from '../src/cli/index.ts'
import { resolveProject } from '../src/cli/project.ts'

const cli = join(import.meta.dir, '../src/cli/index.ts')

async function run(args: string[]) {
  const proc = Bun.spawn(['bun', cli, ...args], { stdout: 'pipe', stderr: 'pipe' })
  const [stdout, stderr, code] = await Promise.all([new Response(proc.stdout).text(), new Response(proc.stderr).text(), proc.exited])
  return { stdout, stderr, code }
}

describe('melzin CLI', () => {
  test('dispatches the four commands', () => {
    expect(Object.keys(COMMANDS)).toEqual(['check', 'types', 'shell', 'css'])
    expect(helpText()).toContain('melzin css [-o file]')
  })

  test('--help', async () => {
    const result = await run(['--help'])
    expect(result.code).toBe(0)
    expect(result.stdout).toContain('melzin check')
  })

  test('command --help', async () => {
    const result = await run(['css', '--help'])
    expect(result.code).toBe(0)
    expect(result.stdout).toContain('usage: melzin css')
  })

  test('no command and unknown commands exit with 2', async () => {
    expect((await run([])).code).toBe(2)
    const result = await run(['nope'])
    expect(result.code).toBe(2)
    expect(result.stderr).toContain("unknown command 'nope'")
  })
})

describe('resolveProject', () => {
  test('defaults and listViews', () => {
    const dir = mkdtempSync(join(tmpdir(), 'melzin-project-'))
    try {
      const empty = resolveProject({ cwd: dir })
      expect(empty.root).toBe(dir)
      expect(empty.viewsDir).toBe(join(dir, 'views'))
      expect(empty.themeFile).toBe(join(dir, 'theme.css'))
      expect(empty.listViews()).toEqual([])
      mkdirSync(join(dir, 'views/nested.mel.html'), { recursive: true })
      for (const name of ['b.mel.html', 'a.mel.html', 'notes.html', 'c.types.ts']) {
        writeFileSync(join(dir, 'views', name), '')
      }
      expect(empty.listViews()).toEqual([join(dir, 'views/a.mel.html'), join(dir, 'views/b.mel.html')])
      const custom = resolveProject({ cwd: dir, views: 'pages', theme: 'styles/theme.css' })
      expect(custom.viewsDir).toBe(join(dir, 'pages'))
      expect(custom.themeFile).toBe(join(dir, 'styles/theme.css'))
    } finally {
      rmSync(dir, { recursive: true, force: true })
    }
  })
})
