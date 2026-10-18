// The real view file, mounted by the real runtime in happy-dom with what the adapter sends: each state
// of the backend shows the right controls, and they send the right events.

import { GlobalRegistrator } from '@happy-dom/global-registrator'
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, test } from 'bun:test'
import { join } from 'node:path'
import { mountSource } from 'melzin'
import { type Network, demoNetwork, toViewModel } from '../model.ts'
import type { Data, Handlers } from '../views/profile.types.ts'

const source = await Bun.file(join(import.meta.dir, '..', 'views', 'profile.mel.html')).text()

// DOM globals for this file only; the other test files keep a plain Bun environment.
beforeAll(() => {
  if (!GlobalRegistrator.isRegistered) GlobalRegistrator.register({ url: 'http://localhost:3002/' })
})
afterAll(async () => {
  if (GlobalRegistrator.isRegistered) await GlobalRegistrator.unregister()
})

let root: HTMLElement
let warnings: string[]
let events: string[]

beforeEach(() => {
  root = document.createElement('div')
  document.body.append(root)
  warnings = []
  events = []
})

afterEach(() => {
  root.remove()
})

function mountProfile(network: Network, handle: string, viewer: string | null) {
  const on: Handlers = {
    follow: () => events.push('follow'),
    unfollow: () => events.push('unfollow'),
    signIn: () => events.push('signIn'),
  }
  const data = toViewModel(network, handle, viewer) as Data
  return mountSource<Data, Handlers>(root, source, { data, on, onWarning: (message) => warnings.push(message) })
}

/** What a sighted user reads: no display: none, no Tailwind `hidden` (hover-only text), no sr-only text. */
function visibleText(node: Node): string {
  if (node.nodeType === 3) return node.textContent ?? ''
  if (node.nodeType !== 1) return ''
  const el = node as HTMLElement
  if (el.style?.display === 'none' || el.classList.contains('hidden') || el.classList.contains('sr-only')) return ' '
  return [...el.childNodes].map(visibleText).join('')
}

const text = (node: Node = root): string => visibleText(node).replace(/\s+/g, ' ').trim()
const buttons = (): string[] => [...root.querySelectorAll('button')].map((button) => text(button))

describe('profile view', () => {
  test('signed out: the only action is signing in', () => {
    mountProfile(demoNetwork(), 'bruno', null)
    expect(buttons()).toEqual(['Sign in to follow'])
    expect(text()).not.toContain('Follows you')
    root.querySelector('button')!.click()
    expect(events).toEqual(['signIn'])
    expect(warnings).toEqual([])
  })

  test('someone who follows you gets "Follow back" and a badge', () => {
    mountProfile(demoNetwork(), 'bruno', 'ana')
    expect(buttons()).toEqual(['Follow back'])
    expect(text()).toContain('@bruno Follows you')
    root.querySelector('button')!.click()
    expect(events).toEqual(['follow'])
  })

  test('someone you follow gets "Following", which unfollows', () => {
    mountProfile(demoNetwork(), 'ana', 'bruno')
    expect(buttons()).toEqual(['Following'])
    root.querySelector('button')!.click()
    expect(events).toEqual(['unfollow'])
  })

  test('your own profile has no follow button', () => {
    mountProfile(demoNetwork(), 'ana', 'ana')
    expect(buttons()).toEqual([])
    expect(text()).toContain('This is you')
  })

  test('verified, pronouns, bio and location show when the profile has them', () => {
    mountProfile(demoNetwork(), 'ana', null)
    expect(root.querySelector('.sr-only')?.textContent).toBe('Verified')
    expect((root.querySelector('.sr-only')!.parentElement as HTMLElement).style.display).toBe('')
    expect(text()).toContain('Ana Souza she/her @ana Designs tools for people who make things.')
    expect(text()).toContain('Recife, Brazil Joined June 2019')
    expect(text()).not.toContain('No bio yet.')
  })

  test('an empty profile shows the fallbacks', () => {
    mountProfile(demoNetwork(), 'carla', 'ana')
    expect((root.querySelector('.sr-only')!.parentElement as HTMLElement).style.display).toBe('none')
    expect(text()).toContain('Carla Mendes @carla No bio yet. Joined September 2026')
    expect(buttons()).toEqual(['Follow'])
  })

  test('a follow switches the button in place, as the client does with the server answer', () => {
    const network = demoNetwork()
    const view = mountProfile(network, 'bruno', 'ana')
    const card = root.querySelector('article')
    network.follows.add('ana>bruno')
    view.update(toViewModel(network, 'bruno', 'ana')!)
    expect(buttons()).toEqual(['Following'])
    expect(text()).toContain('2,482')
    expect(root.querySelector('article')).toBe(card)
  })
})
