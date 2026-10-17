import { afterAll, afterEach, beforeAll, describe, expect, test } from 'bun:test'
import { mount } from '../src/runtime/index.ts'
import { useDom } from './helpers/dom.ts'
import { COUNTER } from './runtime-fixtures.ts'

// Captured before useDom() swaps in happy-dom's fetch, whose node:http client trips over Bun's
// responses ("Duplicate Content-Length"). A real browser's fetch is native too.
// Bun.serve also needs Bun's own Response class, not happy-dom's.
const nativeFetch = globalThis.fetch
const NativeResponse = Response

useDom()

describe('mount() over HTTP (Bun.serve)', () => {
  let server: ReturnType<typeof Bun.serve>
  let base = ''
  let domFetch: typeof fetch

  beforeAll(() => {
    domFetch = globalThis.fetch
    globalThis.fetch = nativeFetch
    server = Bun.serve({
      port: 0,
      fetch(request) {
        const { pathname } = new URL(request.url)
        const headers = { 'Access-Control-Allow-Origin': '*', 'Content-Type': 'text/html; charset=utf-8' }
        if (pathname === '/views/counter.mel.html') return new NativeResponse(COUNTER, { headers })
        if (pathname === '/views/broken.mel.html') {
          return new NativeResponse('<html><head><script type="melzin/schema">{</script></head><body></body></html>', { headers })
        }
        return new NativeResponse('not found', { status: 404, statusText: 'Not Found', headers })
      },
    })
    base = `http://localhost:${server.port}`
  })

  afterAll(() => {
    globalThis.fetch = domFetch
    server.stop(true)
  })

  test('fetches, mounts and wires the click', async () => {
    const root = document.createElement('div')
    const warnings: string[] = []
    let count = 4
    const view = await mount<{ count: number }, { increment: () => void }>(root, `${base}/views/counter.mel.html`, {
      data: { count },
      on: { increment: () => view.update({ count: ++count }) },
      onWarning: (m) => warnings.push(m),
    })
    expect(root.querySelector('p')?.textContent).toBe('4')
    ;(root.querySelector('button') as HTMLElement).click()
    expect(root.querySelector('p')?.textContent).toBe('5')
    expect(view.data).toEqual({ count: 5 })
    expect(warnings).toEqual([])
  })

  test('accepts a URL object', async () => {
    const root = document.createElement('div')
    await mount(root, new URL('/views/counter.mel.html', base), { data: { count: 1 }, on: { increment() {} } })
    expect(root.querySelector('p')?.textContent).toBe('1')
  })

  test('HTTP error throws a clear Error and mounts nothing', async () => {
    const root = document.createElement('div')
    const url = `${base}/views/missing.mel.html`
    await expect(mount(root, url, { data: {}, on: {} })).rejects.toThrow(`melzin: couldn't load view ${url}: HTTP 404 Not Found`)
    expect(root.childNodes.length).toBe(0)
  })

  test('invalid schema in a fetched view names the URL', async () => {
    const root = document.createElement('div')
    const url = `${base}/views/broken.mel.html`
    await expect(mount(root, url, { data: {}, on: {} })).rejects.toThrow(`melzin: view ${url} has an invalid schema:`)
  })
})

describe('mount() with a mocked fetch', () => {
  const realFetch = globalThis.fetch
  afterEach(() => {
    globalThis.fetch = realFetch
  })

  test('passes the URL through unchanged (relative URLs resolve against the page)', async () => {
    const requested: unknown[] = []
    globalThis.fetch = (async (input: unknown) => {
      requested.push(input)
      return new Response(COUNTER)
    }) as typeof fetch
    const root = document.createElement('div')
    await mount(root, '/views/counter.mel.html', { data: { count: 2 }, on: { increment() {} } })
    expect(requested).toEqual(['/views/counter.mel.html'])
    expect(root.querySelector('p')?.textContent).toBe('2')
  })

  test('HTTP 500 without a status text', async () => {
    globalThis.fetch = (async () => new Response('boom', { status: 500 })) as unknown as typeof fetch
    await expect(mount(document.createElement('div'), '/v.mel.html', { data: {}, on: {} })).rejects.toThrow(
      "melzin: couldn't load view /v.mel.html: HTTP 500",
    )
  })

  test('network failure is wrapped with the URL and keeps the cause', async () => {
    const cause = new TypeError('Failed to fetch')
    globalThis.fetch = (async () => {
      throw cause
    }) as unknown as typeof fetch
    let error: unknown
    try {
      await mount(document.createElement('div'), '/v.mel.html', { data: {}, on: {} })
    } catch (caught) {
      error = caught
    }
    expect(error).toBeInstanceOf(Error)
    expect((error as Error).message).toBe("melzin: couldn't load view /v.mel.html: Failed to fetch")
    expect((error as Error).cause).toBe(cause)
  })
})
