// API tests against the real server on a random port. Each test gets a fresh server and network, so
// the follows don't depend on test order.

import { afterEach, beforeEach, describe, expect, test } from 'bun:test'
import { connect } from 'node:net'
import { join } from 'node:path'
import { validateData } from 'melzin/core'
import { loadViewFile } from '@melzin/cli/tools'
import { createProfileServer, demoNetwork, toViewModel } from '../server.ts'
import type { Data } from '../views/profile.types.ts'

let server: ReturnType<typeof createProfileServer>
let base: string

beforeEach(() => {
  server = createProfileServer({ port: 0, hostname: '127.0.0.1' })
  base = server.url.href.replace(/\/$/, '')
})

afterEach(async () => {
  await server.stop(true)
})

async function profile(path: string): Promise<Data> {
  const response = await fetch(`${base}${path}`)
  expect(response.status).toBe(200)
  return (await response.json()) as Data
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

describe('profile API', () => {
  test('GET /api/profiles/:handle is the profile as nobody sees it', async () => {
    const response = await fetch(`${base}/api/profiles/bruno`)
    expect(response.status).toBe(200)
    expect(response.headers.get('content-type')).toContain('application/json')
    const body = await response.json()
    expect(body).toEqual(toViewModel(demoNetwork(), 'bruno', null) as never)
    const { schema } = await loadViewFile(join(import.meta.dir, '..', 'views', 'profile.mel.html'))
    expect(validateData(schema, body)).toEqual([])
  })

  test('?as= says who is looking', async () => {
    expect((await profile('/api/profiles/bruno?as=ana')).viewer).toEqual({ isSelf: false, following: false, followsYou: true })
    expect((await profile('/api/profiles/ana?as=ana')).viewer).toEqual({ isSelf: true, following: false, followsYou: false })
    expect(await profile('/api/profiles/bruno?as=')).not.toHaveProperty('viewer')
  })

  test('unknown profiles are a 404, an unknown viewer a 400', async () => {
    for (const path of ['/api/profiles/nobody', '/api/profiles/__proto__', '/api/profiles/toString']) {
      const response = await fetch(`${base}${path}`)
      expect({ path, status: response.status }).toEqual({ path, status: 404 })
      expect(((await response.json()) as { error: string }).error).toBeString()
    }
    expect((await fetch(`${base}/api/profiles/bruno?as=nobody`)).status).toBe(400)
  })

  test('PUT follows, DELETE unfollows, and both answer with the profile as the follower sees it', async () => {
    const followed = await fetch(`${base}/api/profiles/bruno/followers/ana`, { method: 'PUT' })
    expect(followed.status).toBe(200)
    const body = (await followed.json()) as Data
    expect(body.viewer).toEqual({ isSelf: false, following: true, followsYou: true })
    expect(body.stats.followers).toBe('2,482')
    expect(await profile('/api/profiles/bruno?as=ana')).toEqual(body)
    // Following twice changes nothing.
    expect(await (await fetch(`${base}/api/profiles/bruno/followers/ana`, { method: 'PUT' })).json()).toEqual(body)

    const unfollowed = (await (await fetch(`${base}/api/profiles/bruno/followers/ana`, { method: 'DELETE' })).json()) as Data
    expect(unfollowed.viewer?.following).toBe(false)
    expect(unfollowed.stats.followers).toBe('2,481')
  })

  test('nobody follows themselves or someone who does not exist', async () => {
    expect((await fetch(`${base}/api/profiles/ana/followers/ana`, { method: 'PUT' })).status).toBe(400)
    expect((await fetch(`${base}/api/profiles/nobody/followers/ana`, { method: 'PUT' })).status).toBe(404)
    expect((await fetch(`${base}/api/profiles/ana/followers/nobody`, { method: 'DELETE' })).status).toBe(404)
    expect((await profile('/api/profiles/ana')).stats.followers).toBe('18.2K')
  })

  test('only PUT and DELETE change follows', async () => {
    for (const method of ['GET', 'POST']) {
      expect((await fetch(`${base}/api/profiles/bruno/followers/ana`, { method })).status).toBe(404)
    }
    expect((await profile('/api/profiles/bruno?as=ana')).viewer?.following).toBe(false)
  })

  test('view files carry the sandbox CSP', async () => {
    const response = await fetch(`${base}/views/profile.mel.html`)
    expect(response.headers.get('content-security-policy')).toBe("sandbox; default-src 'none'")
  })
})

describe('static routes', () => {
  test('view files are served verbatim', async () => {
    for (const name of ['profile.mel.html', 'scenarios.mel.html']) {
      const response = await fetch(`${base}/views/${name}`)
      expect(response.status).toBe(200)
      expect(response.headers.get('content-type')).toBe('text/html; charset=utf-8')
      expect(response.headers.get('cache-control')).toBe('no-store')
      expect(await response.text()).toBe(await Bun.file(join(import.meta.dir, '..', 'views', name)).text())
    }
  })

  test('anything else under /views is a 404, including traversal', async () => {
    for (const path of ['/views/', '/views/profile.types.ts', '/views/missing.mel.html', '/views/..%2Fpackage.json', '/views/%2e%2e%2fserver.ts', '/views/%ZZ']) {
      expect({ path, status: (await fetch(`${base}${path}`)).status }).toEqual({ path, status: 404 })
    }
    for (const path of ['/views/../package.json', '/views/../server.ts', '/views/./../theme.css']) {
      const response = await rawGet(path)
      expect(response.startsWith('HTTP/1.1 404')).toBe(true)
      expect(response).not.toContain('melzin-example-profile')
      expect(response).not.toContain('createProfileServer')
    }
  })

  test('/styles.css is built from the views and the theme', async () => {
    const response = await fetch(`${base}/styles.css`)
    expect(response.status).toBe(200)
    expect(response.headers.get('content-type')).toContain('text/css')
    const css = await response.text()
    expect(css).toContain('--color-brand-600')
    expect(css).toContain('.bg-brand-600')
    expect(css).toContain('.group-hover\\:hidden')
    expect(css).toContain('--color-canvas')
  })

  test('/ serves the page with the bundled client', async () => {
    const response = await fetch(`${base}/`)
    expect(response.status).toBe(200)
    const html = await response.text()
    expect(html).toContain('id="profile"')
    expect(html).toMatch(/<script[^>]+type="module"/)
  })

  test('unknown routes are 404', async () => {
    expect((await fetch(`${base}/nope`)).status).toBe(404)
  })
})
