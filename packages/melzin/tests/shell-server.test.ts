// The shell server's routes, against a temporary project on a random port.

import { afterAll, beforeAll, describe, expect, test } from 'bun:test'
import { mkdirSync, mkdtempSync, rmSync, symlinkSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { createShellServer, listViewEntries, resolveViewFile } from '../src/cli/shell.ts'
import { resolveProject } from '../src/cli/project.ts'

const COUNTER = `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <title>  My
    Counter </title>
  <script type="melzin/schema">{ "data": { "type": "object", "properties": { "count": { "type": "number" } } } }</script>
</head>
<body>
  <p class="text-6xl text-brand-600" m-text="count"></p>
</body>
</html>
`
const UNTITLED = '<!doctype html><html><head></head><body><p class="underline">hi</p></body></html>\n'

let dir: string
let server: ReturnType<typeof createShellServer>
let base: string

beforeAll(() => {
  dir = mkdtempSync(join(tmpdir(), 'melzin-shell-'))
  mkdirSync(join(dir, 'views', 'nested'), { recursive: true })
  writeFileSync(join(dir, 'views', 'counter.mel.html'), COUNTER)
  writeFileSync(join(dir, 'views', 'untitled.mel.html'), UNTITLED)
  writeFileSync(join(dir, 'views', 'notes.html'), '<p>not a view</p>')
  writeFileSync(join(dir, 'views', 'nested', 'deep.mel.html'), UNTITLED)
  writeFileSync(join(dir, 'secret.mel.html'), 'SECRET')
  symlinkSync(join(dir, 'secret.mel.html'), join(dir, 'views', 'link.mel.html'))
  // A dangling symlink and an editor lock file (Emacs' `.#name`) must not break the listing.
  symlinkSync(join(dir, 'nowhere.mel.html'), join(dir, 'views', 'broken.mel.html'))
  symlinkSync('user@host.1234:1700000000', join(dir, 'views', '.#counter.mel.html'))
  writeFileSync(join(dir, 'theme.css'), '@theme { --color-brand-600: #123456; }\n')
  server = createShellServer({ project: resolveProject({ cwd: dir }), port: 0, development: false })
  base = server.url.href.replace(/\/$/, '')
})

afterAll(async () => {
  await server.stop(true)
  rmSync(dir, { recursive: true, force: true })
})

describe('shell server', () => {
  test('listens on 127.0.0.1', () => {
    expect(server.hostname).toBe('127.0.0.1')
    expect(server.port).toBeGreaterThan(0)
  })

  test('/ serves the shell page and /frame the frame page', async () => {
    const shell = await fetch(`${base}/`)
    expect(shell.status).toBe(200)
    expect(shell.headers.get('content-type')).toContain('text/html')
    const shellHtml = await shell.text()
    expect(shellHtml).toContain('id="view-picker"')
    expect(shellHtml).toContain('id="canvas"')

    const frame = await fetch(`${base}/frame?view=counter.mel.html&snapshot=zero`)
    expect(frame.status).toBe(200)
    expect(await frame.text()).toContain('id="melzin-root"')
  })

  test('the pages never link the dynamic URLs statically', async () => {
    for (const path of ['/', '/frame']) {
      const html = await (await fetch(base + path)).text()
      expect(html).not.toContain('/__melzin/styles.css')
      expect(html).not.toContain('/__melzin/api/views')
    }
  })

  test('/__melzin/api/views lists the views with their titles', async () => {
    const response = await fetch(`${base}/__melzin/api/views`)
    expect(response.status).toBe(200)
    expect(response.headers.get('cache-control')).toBe('no-store')
    const list = await response.json()
    // Nested folders, other files and the symlink that points outside the views dir are left out.
    const names = (list as { name: string }[]).map((entry) => entry.name)
    expect(names).toContain('counter')
    expect(names).toContain('untitled')
    expect(names).not.toContain('notes')
    expect(names).not.toContain('deep')
    expect(names).not.toContain('link')
    expect(names).not.toContain('broken')
    expect(names.some((name) => name.startsWith('.'))).toBe(false)
    expect(list).toContainEqual({ name: 'counter', file: 'counter.mel.html', url: '/views/counter.mel.html', title: 'My Counter' })
    expect(list).toContainEqual({ name: 'untitled', file: 'untitled.mel.html', url: '/views/untitled.mel.html', title: 'untitled' })
  })

  test('/views/<file> serves the file verbatim with no-store', async () => {
    const response = await fetch(`${base}/views/counter.mel.html`)
    expect(response.status).toBe(200)
    expect(response.headers.get('cache-control')).toBe('no-store')
    expect(response.headers.get('content-type')).toContain('text/html')
    // Opened directly, the file renders sandboxed instead of as a page of the shell's origin.
    expect(response.headers.get('content-security-policy')).toBe("sandbox; default-src 'none'")
    expect(response.headers.get('x-content-type-options')).toBe('nosniff')
    expect(await response.text()).toBe(COUNTER)
  })

  test('/views/ rejects traversal, other files and symlinks that leave the views dir', async () => {
    const paths = [
      '/views/../secret.mel.html',
      '/views/..%2Fsecret.mel.html',
      '/views/%2e%2e%2fsecret.mel.html',
      '/views/..%5Csecret.mel.html',
      '/views/nested%2Fdeep.mel.html',
      '/views/nested/deep.mel.html',
      '/views/notes.html',
      '/views/missing.mel.html',
      '/views/link.mel.html',
      '/views/%E0%A4%A',
      '/views/',
      '/views/counter.mel.html%00',
    ]
    for (const path of paths) {
      const response = await fetch(base + path)
      expect({ path, status: response.status }).toEqual({ path, status: 404 })
      expect(await response.text()).not.toContain('SECRET')
    }
  })

  test('/__melzin/styles.css compiles Tailwind for the views with the theme', async () => {
    const response = await fetch(`${base}/__melzin/styles.css`)
    expect(response.status).toBe(200)
    expect(response.headers.get('cache-control')).toBe('no-store')
    expect(response.headers.get('content-type')).toContain('text/css')
    const css = await response.text()
    expect(css).toContain('.text-6xl')
    expect(css).toContain('.text-brand-600')
    expect(css).toContain('.underline')
    expect(css).toContain('#123456')
  })

  test('unknown paths are 404', async () => {
    expect((await fetch(`${base}/nope`)).status).toBe(404)
    expect((await fetch(`${base}/__melzin/other`)).status).toBe(404)
  })

  test('the favicon request gets an empty answer, not a 404 in the console', async () => {
    expect((await fetch(`${base}/favicon.ico`)).status).toBe(204)
  })

  test('project data is refused to other host names (DNS rebinding)', async () => {
    for (const path of ['/__melzin/api/views', '/views/counter.mel.html', '/__melzin/styles.css', '/nope']) {
      const response = await fetch(base + path, { headers: { Host: `evil.example:${server.port}` } })
      expect({ path, status: response.status }).toEqual({ path, status: 403 })
    }
    const local = await fetch(`http://localhost:${server.port}/__melzin/api/views`).catch(() => null)
    if (local !== null) expect(local.status).toBe(200)
  })
})

describe('resolveViewFile', () => {
  test('accepts only listed *.mel.html files inside the views dir', () => {
    const project = resolveProject({ cwd: dir })
    expect(resolveViewFile(project, 'counter.mel.html')).toBe(join(dir, 'views', 'counter.mel.html'))
    expect(resolveViewFile(project, 'counter%2Emel.html')).toBe(join(dir, 'views', 'counter.mel.html'))
    for (const name of ['', '..', '../secret.mel.html', 'notes.html', '.mel.html', 'link.mel.html', '%', 'nested/deep.mel.html']) {
      expect(resolveViewFile(project, name)).toBeNull()
    }
  })

  test('listViewEntries falls back to the name when the title is missing', async () => {
    const entries = await listViewEntries(resolveProject({ cwd: dir }))
    expect(entries.find((entry) => entry.name === 'untitled')?.title).toBe('untitled')
  })
})
