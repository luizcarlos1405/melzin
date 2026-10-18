// The whole app, with no server: the standalone host runs the real view files and routes.json on the
// local source, which computes every screen on the device (SPEC D20). Links switch screens, the
// follow button updates the page, and signing in navigates.

import { GlobalRegistrator } from '@happy-dom/global-registrator'
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, test } from 'bun:test'
import { join } from 'node:path'
import { type MelzinApp, startApp } from 'melzin'
import { type Network, demoNetwork } from '../model.ts'
import routes from '../routes.json'
import type { Routes } from '../routes.types.ts'
import { localSource } from '../source.ts'

const VIEWS = join(import.meta.dir, '..', 'views')

beforeAll(() => {
  if (!GlobalRegistrator.isRegistered) GlobalRegistrator.register({ url: 'http://localhost:3002/' })
})
afterAll(async () => {
  if (GlobalRegistrator.isRegistered) await GlobalRegistrator.unregister()
})

let root: HTMLElement
let app: MelzinApp<Routes> | null = null
let network: Network
let warnings: string[]

beforeEach(() => {
  root = document.createElement('div')
  document.body.append(root)
  network = demoNetwork()
  warnings = []
})

afterEach(() => {
  app?.destroy()
  app = null
  root.remove()
})

async function start(path: string): Promise<MelzinApp<Routes>> {
  history.replaceState(null, '', path)
  app = await startApp<Routes>(root, {
    routes,
    source: localSource(network),
    loadView: (view) => Bun.file(join(VIEWS, `${view}.mel.html`)).text(),
    onWarning: (message) => warnings.push(message),
  })
  return app
}

async function settle(): Promise<void> {
  for (let i = 0; i < 10; i++) await new Promise((resolve) => setTimeout(resolve, 0))
}

const text = (): string => (root.textContent ?? '').replace(/\s+/g, ' ').trim()

function clickLink(label: string): void {
  const link = [...root.querySelectorAll('a')].find((item) => item.textContent?.replace(/\s+/g, ' ').includes(label))
  if (link === undefined) throw new Error(`no link with '${label}'`)
  link.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true, button: 0 }))
}

function clickButton(label: string): void {
  const button = [...root.querySelectorAll('button')].find((item) => item.textContent?.includes(label))
  if (button === undefined) throw new Error(`no button with '${label}'`)
  button.click()
}

describe('the app on the local source', () => {
  test('members, then a profile, then back, keeping who is looking', async () => {
    await start('/?as=bruno')
    expect(text()).toContain('Browsing as @bruno')
    expect(text()).toContain('Ana Souza @ana 18.2K followers')

    clickLink('Ana Souza')
    await settle()
    expect(location.pathname + location.search).toBe('/u/ana?as=bruno')
    expect(app?.route).toMatchObject({ name: 'profile', params: { handle: 'ana' }, query: { as: 'bruno' } })
    expect(text()).toContain('Following')

    clickLink('Members')
    await settle()
    expect(location.pathname + location.search).toBe('/?as=bruno')
    expect(text()).toContain('Browsing as @bruno')
    expect(warnings).toEqual([])
  })

  test('the members page lists everyone in the network, by handle', async () => {
    network.people.set('abel', { name: 'Abel Costa', verified: false, joined: '2026-10', posts: 0, followersElsewhere: 0, followingElsewhere: 0 })
    await start('/')
    expect(text()).toContain('Abel Costa @abel 0 followers AS Ana Souza @ana')
    expect(root.querySelectorAll('li')).toHaveLength(4)
    clickLink('Abel Costa')
    await settle()
    expect(location.pathname).toBe('/u/abel')
    expect(warnings).toEqual([])
  })

  test('with nobody in the network, the members page shows its empty state', async () => {
    network.people.clear()
    network.follows.clear()
    await start('/')
    expect(text()).toContain('No members yet')
    expect(root.querySelector('ul')).toBeNull()
    expect(warnings).toEqual([])
  })

  test('following updates the page and the network', async () => {
    await start('/u/bruno?as=ana')
    expect(text()).toContain('Follow back')
    clickButton('Follow back')
    expect(text()).toContain('Following')
    expect(text()).toContain('2,482')
    expect(network.follows.has('ana>bruno')).toBe(true)
  })

  test('signing in navigates to the same profile as the demo viewer', async () => {
    await start('/u/carla')
    clickButton('Sign in to follow')
    await settle()
    expect(location.pathname + location.search).toBe('/u/carla?as=ana')
    expect(text()).toContain('Follow')
    expect(text()).not.toContain('Sign in to follow')
  })

  test('an unknown profile shows a problem', async () => {
    await start('/u/nobody')
    expect(text()).toBe("This page couldn't load: no profile named 'nobody'")
  })
})
