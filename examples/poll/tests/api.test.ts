// API tests against the real server on a random port. Each test gets a fresh server, so the vote
// counts don't depend on test order.

import { afterEach, beforeEach, describe, expect, test } from 'bun:test'
import { connect } from 'node:net'
import { join } from 'node:path'
import { validateData } from 'melzin/core'
import { loadViewFile } from '@melzin/cli/tools'
import { createPollServer, toViewModel, type Poll } from '../server.ts'

let server: ReturnType<typeof createPollServer>
let base: string

beforeEach(() => {
  server = createPollServer({ port: 0, hostname: '127.0.0.1', state: { pizza: 2, tacos: 1, sushi: 0 } })
  base = server.url.href.replace(/\/$/, '')
})

afterEach(async () => {
  await server.stop(true)
})

function vote(body: string): Promise<Response> {
  return fetch(`${base}/api/poll/votes`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body,
  })
}

/** Sends the request line as written; fetch would normalise `..` away before it reached the server. */
function rawGet(path: string): Promise<string> {
  return new Promise((resolve, reject) => {
    const socket = connect(Number(server.port), '127.0.0.1', () => {
      socket.write(`GET ${path} HTTP/1.1\r\nHost: 127.0.0.1\r\nConnection: close\r\n\r\n`)
    })
    let response = ''
    socket.setEncoding('utf8')
    socket.on('data', (chunk) => (response += chunk))
    socket.on('end', () => resolve(response))
    socket.on('error', reject)
  })
}

describe('poll API', () => {
  test('GET /api/poll returns the view model', async () => {
    const response = await fetch(`${base}/api/poll`)
    expect(response.status).toBe(200)
    expect(response.headers.get('content-type')).toContain('application/json')
    const body = await response.json()
    expect(body).toEqual(toViewModel({ pizza: 2, tacos: 1, sushi: 0 }))
    const { schema } = await loadViewFile(join(import.meta.dir, '..', 'views', 'poll.mel.html'))
    expect(validateData(schema, body)).toEqual([])
  })

  test('POST /api/poll/votes takes the view\'s vote payload, counts the vote and returns the new model', async () => {
    const response = await vote(JSON.stringify({ optionId: 'sushi' }))
    expect(response.status).toBe(200)
    const body = (await response.json()) as ReturnType<typeof toViewModel>
    expect(body.options.map((option) => [option.id, option.votes])).toEqual([['pizza', 2], ['tacos', 1], ['sushi', 1]])
    expect(body.totalLabel).toBe('4 votes')
    const after = (await (await fetch(`${base}/api/poll`)).json()) as ReturnType<typeof toViewModel>
    expect(after).toEqual(body)
  })

  test('POST with a bad option is a 400 and changes nothing', async () => {
    const before = await (await fetch(`${base}/api/poll`)).json()
    for (const body of [
      JSON.stringify({ optionId: 'burgers' }),
      JSON.stringify({ optionId: '__proto__' }),
      JSON.stringify({ optionId: 'toString' }),
      JSON.stringify({ optionId: 1 }),
      JSON.stringify({ optionId: 'Pizza' }),
      JSON.stringify({ option: 'pizza' }),
      JSON.stringify({}),
      JSON.stringify(null),
      JSON.stringify(['pizza']),
      'not json',
    ]) {
      const response = await vote(body)
      expect({ body, status: response.status }).toEqual({ body, status: 400 })
      expect(((await response.json()) as { error: string }).error).toBeString()
    }
    expect(await (await fetch(`${base}/api/poll`)).json()).toEqual(before)
  })

  test('the error names the options the poll has', async () => {
    const response = await vote(JSON.stringify({ optionId: 'burgers' }))
    expect(await response.json()).toEqual({ error: 'optionId must be one of pizza, tacos, sushi' })
  })

  test('votes must be sent as JSON (a cross-site form or no-cors fetch would be text/plain)', async () => {
    for (const type of ['text/plain', 'application/x-www-form-urlencoded', '']) {
      const response = await fetch(`${base}/api/poll/votes`, { method: 'POST', headers: type ? { 'Content-Type': type } : {}, body: '{"optionId":"pizza"}' })
      expect({ type, status: response.status }).toEqual({ type, status: 415 })
    }
    expect((await (await fetch(`${base}/api/poll`)).json()).options[0].votes).toBe(2)
    expect((await fetch(`${base}/api/poll/votes`, { method: 'POST', headers: { 'Content-Type': 'application/json; charset=utf-8' }, body: '{"optionId":"pizza"}' })).status).toBe(200)
  })

  test('another poll: its own options, in its order, whatever the starting counts name', async () => {
    const poll: Poll = {
      question: 'Where to next?',
      options: [
        { id: 'beach', label: 'The beach', emoji: '🏖️' },
        { id: 'hills', label: 'The hills', emoji: '⛰️' },
      ],
    }
    const other = createPollServer({ port: 0, hostname: '127.0.0.1', poll, state: { hills: 3, pizza: 9 } })
    try {
      const url = `${other.url.href}api/poll`
      const body = (await (await fetch(url)).json()) as ReturnType<typeof toViewModel>
      expect(body).toEqual(toViewModel({ hills: 3 }, poll))
      expect(body.options.map((option) => option.id)).toEqual(['beach', 'hills'])
      const voted = await fetch(`${other.url.href}api/poll/votes`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{"optionId":"beach"}' })
      expect(((await voted.json()) as ReturnType<typeof toViewModel>).totalLabel).toBe('4 votes')
      const pizza = await fetch(`${other.url.href}api/poll/votes`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{"optionId":"pizza"}' })
      expect(await pizza.json()).toEqual({ error: 'optionId must be one of beach, hills' })
    } finally {
      await other.stop(true)
    }
  })

  test('view files carry the sandbox CSP', async () => {
    const response = await fetch(`${base}/views/poll.mel.html`)
    expect(response.headers.get('content-security-policy')).toBe("sandbox; default-src 'none'")
  })

  test('only POST counts votes', async () => {
    expect((await fetch(`${base}/api/poll/votes`)).status).toBe(404)
  })
})

describe('static routes', () => {
  test('view files are served verbatim', async () => {
    for (const name of ['poll.mel.html', 'header.mel.html']) {
      const response = await fetch(`${base}/views/${name}`)
      expect(response.status).toBe(200)
      expect(response.headers.get('content-type')).toBe('text/html; charset=utf-8')
      expect(response.headers.get('cache-control')).toBe('no-store')
      expect(await response.text()).toBe(await Bun.file(join(import.meta.dir, '..', 'views', name)).text())
    }
  })

  test('anything else under /views is a 404, including traversal', async () => {
    for (const path of [
      '/views/',
      '/views/poll.types.ts',
      '/views/missing.mel.html',
      '/views/..%2Fpackage.json',
      '/views/%2e%2e%2fpackage.json',
      '/views/..%5Cpackage.json',
      '/views/%2e%2e%2fviews%2fpoll.mel.html',
      '/views/%ZZ',
    ]) {
      expect({ path, status: (await fetch(`${base}${path}`)).status }).toEqual({ path, status: 404 })
    }
    for (const path of ['/views/../package.json', '/views/../server.ts', '/views/./../theme.css']) {
      const response = await rawGet(path)
      expect(response.startsWith('HTTP/1.1 404')).toBe(true)
      expect(response).not.toContain('melzin-example-poll')
      expect(response).not.toContain('createPollServer')
    }
  })

  test('/styles.css is built from the views and the theme', async () => {
    const response = await fetch(`${base}/styles.css`)
    expect(response.status).toBe(200)
    expect(response.headers.get('content-type')).toContain('text/css')
    const css = await response.text()
    expect(css).toContain('--color-brand-600')
    expect(css).toContain('.bg-brand-600')
    expect(css).toContain('.wrap-anywhere')
    expect(css).toContain('--color-canvas')
  })

  test('/ serves the page with the bundled client', async () => {
    const response = await fetch(`${base}/`)
    expect(response.status).toBe(200)
    const html = await response.text()
    expect(html).toContain('id="poll"')
    expect(html).toMatch(/<script[^>]+type="module"/)
  })

  test('unknown routes are 404', async () => {
    expect((await fetch(`${base}/nope`)).status).toBe(404)
  })
})
