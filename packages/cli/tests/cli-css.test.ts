import { afterAll, beforeAll, describe, expect, test } from 'bun:test'
import { mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { buildCss, entryCss } from '../src/css.ts'

const cli = join(import.meta.dir, '../src/index.ts')
let dir = ''

beforeAll(() => {
  dir = mkdtempSync(join(tmpdir(), 'melzin-css-'))
  mkdirSync(join(dir, 'views'))
  mkdirSync(join(dir, 'other'))
  writeFileSync(
    join(dir, 'views/a.mel.html'),
    '<!doctype html><html><head><title>A</title></head><body><p class="text-brand p-4 hover:bg-zinc-50">x</p></body></html>',
  )
  // Outside the views dir: must not be scanned.
  writeFileSync(join(dir, 'other/b.html'), '<p class="bg-red-500 text-9xl">y</p>')
  writeFileSync(join(dir, 'theme.css'), '@theme {\n  --color-brand: #ff0066;\n}\n.plain-rule { color: red; }\n')
})

afterAll(() => {
  rmSync(dir, { recursive: true, force: true })
})

describe('buildCss', () => {
  test('includes used classes and leaves out unused ones', async () => {
    const css = await buildCss({ projectDir: dir, viewsDir: 'views', themeFile: 'theme.css' })
    expect(css).toContain('.p-4')
    expect(css).toContain('.hover\\:bg-zinc-50')
    expect(css).not.toContain('.bg-red-500')
    expect(css).not.toContain('.text-9xl')
    expect(css).not.toContain('.p-8')
  })

  test('honors theme variables and plain CSS from the theme file', async () => {
    const css = await buildCss({ projectDir: dir, viewsDir: join(dir, 'views'), themeFile: join(dir, 'theme.css') })
    expect(css).toContain('.text-brand')
    expect(css).toContain('--color-brand: #ff0066')
    expect(css).toContain('.plain-rule')
  })

  test('a theme that imports tailwindcss itself is refused with a clear message', async () => {
    writeFileSync(join(dir, 'bad-theme.css'), '@import "tailwindcss";\n@theme { --color-brand: #000; }\n')
    await expect(buildCss({ projectDir: dir, viewsDir: 'views', themeFile: 'bad-theme.css' })).rejects.toThrow(
      /bad-theme\.css must not import tailwindcss; melzin adds it/,
    )
  })

  test('a missing theme file is skipped', async () => {
    const css = await buildCss({ projectDir: dir, viewsDir: 'views', themeFile: 'nope.css' })
    expect(css).toContain('.p-4')
    expect(css).not.toContain('.text-brand')
  })

  test('minify', async () => {
    const pretty = await buildCss({ projectDir: dir, viewsDir: 'views', themeFile: 'theme.css' })
    const min = await buildCss({ projectDir: dir, viewsDir: 'views', themeFile: 'theme.css', minify: true })
    expect(min.length).toBeLessThan(pretty.length)
    expect(min).toContain('.p-4{')
    expect(min.split('\n').length).toBeLessThan(5)
  })

  test('entry CSS', () => {
    expect(entryCss(['/v'], [undefined])).toBe('@import "tailwindcss" source(none);\n@source "/v";\n')
    const themed = entryCss(['/v', '/x'], [join(dir, 'theme.css'), join(dir, 'missing.css')])
    expect(themed).toBe(`@import "tailwindcss" source(none);\n@source "/v";\n@source "/x";\n@import ${JSON.stringify(join(dir, 'theme.css'))};\n`)
  })

  test("an alternative's folder is scanned too, and its theme wins where it sets a token (SPEC D31, D32)", async () => {
    mkdirSync(join(dir, 'explore/night'), { recursive: true })
    writeFileSync(join(dir, 'explore/night/a.mel.html'), '<p class="text-brand rounded-card ring-2">x</p>')
    writeFileSync(join(dir, 'explore/night/theme.css'), '@theme {\n  --color-brand: #0a0a0a;\n  --radius-card: 2rem;\n}\n')
    const css = await buildCss({ projectDir: dir, viewsDir: 'views', themeFile: 'theme.css', alternative: { dir: 'explore/night', themeFile: 'explore/night/theme.css' } })
    expect(css).toContain('.p-4') // from views/
    expect(css).toContain('.ring-2') // from the alternative
    expect(css).toContain('.rounded-card')
    expect(css).toContain('--color-brand: #0a0a0a')
    expect(css).not.toContain('#ff0066')
    expect(css).toContain('.plain-rule') // the project theme still applies
    const plain = await buildCss({ projectDir: dir, viewsDir: 'views', themeFile: 'theme.css' })
    expect(plain).not.toContain('.ring-2')
    expect(plain).toContain('--color-brand: #ff0066')
  })

  test("an alternative's theme that imports tailwindcss is refused too", async () => {
    mkdirSync(join(dir, 'explore/bad'), { recursive: true })
    writeFileSync(join(dir, 'explore/bad/theme.css'), '@import "tailwindcss";\n')
    await expect(buildCss({ projectDir: dir, viewsDir: 'views', alternative: { dir: 'explore/bad', themeFile: 'explore/bad/theme.css' } })).rejects.toThrow(
      /explore\/bad\/theme\.css must not import tailwindcss/,
    )
  })
})

describe('melzin css', () => {
  test('writes the file with -o and --minify', async () => {
    const proc = Bun.spawn(['bun', cli, 'css', '-o', 'dist/app.css', '--minify'], { cwd: dir, stdout: 'pipe', stderr: 'pipe' })
    expect(await proc.exited).toBe(0)
    const css = readFileSync(join(dir, 'dist/app.css'), 'utf8')
    expect(css).toContain('.text-brand{')
    expect(css).toContain('#f06')
  })

  test('prints to stdout, with --views and --theme', async () => {
    mkdirSync(join(dir, 'alt'), { recursive: true })
    writeFileSync(join(dir, 'alt/c.mel.html'), '<p class="text-accent underline"></p>')
    writeFileSync(join(dir, 'alt.css'), '@theme { --color-accent: #123456; }')
    const proc = Bun.spawn(['bun', cli, 'css', '--views', 'alt', '--theme', 'alt.css'], { cwd: dir, stdout: 'pipe' })
    const out = await new Response(proc.stdout).text()
    expect(await proc.exited).toBe(0)
    expect(out).toContain('.underline')
    expect(out).toContain('#123456')
    expect(out).not.toContain('.p-4')
  })

  test('fails on a missing views dir or theme file, and on bad flags', async () => {
    const run = (args: string[]) => Bun.spawn(['bun', cli, 'css', ...args], { cwd: dir, stdout: 'pipe', stderr: 'pipe' }).exited
    expect(await run(['--views', 'missing'])).toBe(1)
    expect(await run(['--theme', 'missing.css'])).toBe(1)
    expect(await run(['--bogus'])).toBe(2)
  })
})
