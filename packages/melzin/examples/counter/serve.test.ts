// The counter example's server: the page, the view file served verbatim, the CSS, and traversal.

import { afterAll, beforeAll, expect, test } from 'bun:test'
import { join } from 'node:path'
import { createCounterServer } from './serve.ts'

let server: Bun.Server<undefined>
let base: string

beforeAll(async () => {
  server = await createCounterServer({ port: 0 })
  base = server.url.href.replace(/\/$/, '')
})

afterAll(async () => {
  await server.stop(true)
})

test('/ serves the page with the bundled main.ts', async () => {
  const response = await fetch(`${base}/`)
  expect(response.status).toBe(200)
  const html = await response.text()
  expect(html).toContain('<div id="app"></div>')
  const script = html.match(/<script[^>]*src="([^"]+\.js)"/)?.[1]
  expect(script).toBeDefined()
  const js = await (await fetch(new URL(script!, `${base}/`))).text()
  expect(js).toContain('/views/counter.mel.html')
  expect(js).toContain('/styles.css')
})

test('/views/counter.mel.html is the file, byte for byte', async () => {
  const response = await fetch(`${base}/views/counter.mel.html`)
  expect(response.status).toBe(200)
  expect(response.headers.get('content-type')).toBe('text/html; charset=utf-8')
  expect(response.headers.get('content-security-policy')).toBe("sandbox; default-src 'none'")
  const file = Bun.file(join(import.meta.dir, '..', '..', 'views', 'counter.mel.html'))
  expect(new Uint8Array(await response.arrayBuffer())).toEqual(await file.bytes())
})

test('/styles.css has the classes the views use and the theme', async () => {
  const response = await fetch(`${base}/styles.css`)
  expect(response.status).toBe(200)
  expect(response.headers.get('content-type')).toBe('text/css; charset=utf-8')
  const css = await response.text()
  expect(css).toContain('bg-violet-600')
  expect(css).toContain('tabular-nums')
  expect(css).toContain('--color-brand-500')
})

test('only view files in the views dir are served', async () => {
  for (const path of [
    '/views/..%2Fpackage.json',
    '/views/%2e%2e%2fpackage.json',
    '/views/..%5Cpackage.json',
    '/views/%2e%2e%2fviews%2fcounter.mel.html',
    '/views/',
    '/views/%ZZ',
    '/views/missing.mel.html',
    '/views/counter.types.ts',
    '/package.json',
  ]) {
    const response = await fetch(`${base}${path}`)
    expect({ path, status: response.status }).toEqual({ path, status: 404 })
  }
})
