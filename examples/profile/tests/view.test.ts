// The real view files, mounted by the real runtime in happy-dom with what the adapter sends: each state
// of the backend shows the right controls, they send the right events, and the members' cards keep
// their elements across updates, keyed by handle.

import { GlobalRegistrator } from '@happy-dom/global-registrator'
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, test } from 'bun:test'
import { join } from 'node:path'
import { mountSource } from 'melzin'
import { type Network, demoNetwork, toMembersModel, toViewModel } from '../model.ts'
import type { Data as MembersData, Handlers as MembersHandlers } from '../views/members.types.ts'
import type { Data, Handlers } from '../views/profile.types.ts'

const VIEWS = join(import.meta.dir, '..', 'views')
const source = await Bun.file(join(VIEWS, 'profile.mel.html')).text()
const membersSource = await Bun.file(join(VIEWS, 'members.mel.html')).text()

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

/** The members page at the URL that shows it: `/`, or `/?as=<viewer>`. */
function mountMembers(network: Network, viewer: string | null) {
  const data: MembersData = toMembersModel(network, viewer)
  const route = { name: 'members', ...(viewer === null ? {} : { query: { as: viewer } }) }
  return mountSource<MembersData, MembersHandlers>(root, membersSource, { data, on: {}, route, onWarning: (message) => warnings.push(message) })
}

/** The members' cards, by handle, in page order. */
function cards(): Map<string, HTMLLIElement> {
  const rows = [...root.querySelectorAll('li')]
  return new Map(rows.map((row) => [text(row).match(/@(\S+)/)?.[1] ?? '', row]))
}

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

describe('members view', () => {
  test('a card per member, in the order the adapter sends, each linking to their profile', () => {
    mountMembers(demoNetwork(), 'ana')
    expect([...cards().keys()]).toEqual(['ana', 'bruno', 'carla'])
    expect(text(cards().get('bruno'))).toBe('BL Bruno Lima @bruno 2,481 followers')
    expect([...root.querySelectorAll('li a')].map((link) => link.getAttribute('href'))).toEqual(['/u/ana?as=ana', '/u/bruno?as=ana', '/u/carla?as=ana'])
    expect(text()).toContain('Browsing as @ana')
    expect(text()).not.toContain('No members yet')
    expect(warnings).toEqual([])
  })

  test('an update keeps each card, changes what changed and moves it with its member', () => {
    const network = demoNetwork()
    const view = mountMembers(network, null)
    const before = cards()
    // Someone new sorts first and follows Carla: every card moves down one, and only Carla's count changes.
    network.people.set('abel', { name: 'Abel Costa', verified: false, joined: '2026-10', posts: 0, followersElsewhere: 0, followingElsewhere: 0 })
    network.follows.add('abel>carla')
    view.update(toMembersModel(network, null))
    const after = cards()
    expect([...after.keys()]).toEqual(['abel', 'ana', 'bruno', 'carla'])
    for (const handle of ['ana', 'bruno', 'carla']) expect({ handle, same: after.get(handle) === before.get(handle) }).toEqual({ handle, same: true })
    expect(text(after.get('carla'))).toBe('CM Carla Mendes @carla 1 follower')
    expect(warnings).toEqual([])
  })

  test('someone leaving takes their card along, and the others stay', () => {
    const network = demoNetwork()
    const view = mountMembers(network, null)
    const before = cards()
    network.people.delete('bruno')
    network.follows.delete('bruno>ana')
    view.update(toMembersModel(network, null))
    expect([...cards().keys()]).toEqual(['ana', 'carla'])
    expect(before.get('bruno')?.isConnected).toBe(false)
    expect(cards().get('carla')).toBe(before.get('carla')!)
  })

  test('nobody in the network: the empty state instead of the list, until someone joins', () => {
    const network: Network = { people: new Map(), follows: new Set() }
    const view = mountMembers(network, null)
    expect(root.querySelector('ul')).toBeNull()
    expect(text()).toContain('Members Nobody is signed in')
    expect(text()).toContain('No members yet When people join, they show up here')
    network.people.set('carla', demoNetwork().people.get('carla')!)
    view.update(toMembersModel(network, null))
    expect([...cards().keys()]).toEqual(['carla'])
    expect(text()).not.toContain('No members yet')
    expect(warnings).toEqual([])
  })
})
