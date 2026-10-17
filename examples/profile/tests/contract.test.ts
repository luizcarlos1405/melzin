// Contract test (SPEC §9.3): what the backend sends must match what the view declares.

import { describe, expect, test } from 'bun:test'
import { join } from 'node:path'
import { validateData } from 'melzin/core'
import { loadViewFile, type LoadedView } from '@melzin/cli/tools'
import { type Network, countLabel, demoNetwork, initials, joinedLabel, toViewModel } from '../server.ts'

const PROFILE_VIEW = join(import.meta.dir, '..', 'views', 'profile.mel.html')

async function loadProfile(): Promise<LoadedView> {
  const view = await loadViewFile(PROFILE_VIEW)
  expect(view.issues).toEqual([])
  expect(view.schema).not.toBeNull()
  return view
}

const LONG_HANDLE = 'maria_aparecida_dos_santos_albuquerque_vasconcelos'

/** The "very long everything" snapshot's person, following Ana, who doesn't follow back. */
function longNetwork(): Network {
  const network = demoNetwork()
  network.people.set(LONG_HANDLE, {
    name: 'Maria Aparecida dos Santos Albuquerque de Oliveira e Vasconcelos Bragança',
    verified: true,
    pronouns: 'she/her/ela/dela',
    bio: "Principal engineer, part-time ceramicist and full-time collector of unfinished side projects. Ask me about distributed consensus, sourdough hydration ratios, the best bakeries between Porto and Coimbra, or why every calendar app eventually reinvents time zones badly. Opinions are my cat's.",
    location: 'São José dos Campos, São Paulo, Brazil (and sometimes Lisbon)',
    joined: '2009-12',
    posts: 123456789,
    followersElsewhere: 98765432,
    followingElsewhere: 1234566,
  })
  network.follows.add(`${LONG_HANDLE}>ana`)
  return network
}

describe('profile contract', () => {
  test('every profile, seen by nobody and by everyone, matches the schema', async () => {
    const { schema } = await loadProfile()
    const network = longNetwork()
    const handles = [...network.people.keys()]
    for (const handle of handles) {
      for (const viewer of [null, ...handles]) {
        expect({ handle, viewer, issues: validateData(schema, toViewModel(network, handle, viewer)) }).toEqual({ handle, viewer, issues: [] })
      }
    }
  })

  test('the schema declares exactly the events the client handles', async () => {
    const { schema } = await loadProfile()
    expect(Object.keys(schema?.events ?? {}).sort()).toEqual(['follow', 'signIn', 'unfollow'])
  })

  test('the contract catches a drifted adapter', async () => {
    const { schema } = await loadProfile()
    const model = toViewModel(demoNetwork(), 'ana', 'bruno')!
    const drifted = { ...model, user: { ...model.user, bio: null }, stats: { ...model.stats, followers: 18241 }, viewer: { following: true } }
    const paths = validateData(schema, drifted).map((issue) => issue.path)
    expect(paths).toContain('user.bio')
    expect(paths).toContain('stats.followers')
    expect(paths).toContain('viewer.isSelf')
  })

  // The snapshots show real states, so each is exactly what the adapter sends for some person and viewer.
  test('the snapshots are states the adapter can produce', async () => {
    const { snapshots } = await loadProfile()
    const states: Record<string, [Network, string, string | null]> = {
      'signed out': [demoNetwork(), 'bruno', null],
      'follows you': [demoNetwork(), 'bruno', 'ana'],
      following: [demoNetwork(), 'ana', 'bruno'],
      'your own profile': [demoNetwork(), 'ana', 'ana'],
      'empty profile': [demoNetwork(), 'carla', 'ana'],
      'very long everything': [longNetwork(), LONG_HANDLE, 'ana'],
    }
    expect(snapshots.map((snapshot) => snapshot.name)).toEqual(Object.keys(states))
    for (const { name, data } of snapshots) {
      const [network, handle, viewer] = states[name]!
      expect({ name, data }).toEqual({ name, data: toViewModel(network, handle, viewer) as never })
    }
  })
})

describe('toViewModel', () => {
  test('nobody signed in: no viewer at all', () => {
    expect(toViewModel(demoNetwork(), 'bruno', null)).not.toHaveProperty('viewer')
  })

  test('follows both ways', () => {
    const network = demoNetwork()
    expect(toViewModel(network, 'bruno', 'ana')?.viewer).toEqual({ isSelf: false, following: false, followsYou: true })
    expect(toViewModel(network, 'ana', 'bruno')?.viewer).toEqual({ isSelf: false, following: true, followsYou: false })
    network.follows.add('ana>bruno')
    expect(toViewModel(network, 'bruno', 'ana')?.viewer).toEqual({ isSelf: false, following: true, followsYou: true })
  })

  test('your own profile', () => {
    expect(toViewModel(demoNetwork(), 'ana', 'ana')?.viewer).toEqual({ isSelf: true, following: false, followsYou: false })
  })

  test('fields a person left empty are left out, so the view shows its fallbacks', () => {
    const { user } = toViewModel(demoNetwork(), 'carla', null)!
    expect(Object.keys(user)).toEqual(['name', 'handle', 'initials', 'verified', 'joined'])
  })

  test('counts include follows inside the demo', () => {
    const network = demoNetwork()
    expect(toViewModel(network, 'bruno', null)?.stats).toEqual({ posts: '312', followers: '2,481', following: '190' })
    network.follows.add('ana>bruno')
    expect(toViewModel(network, 'bruno', null)?.stats.followers).toBe('2,482')
  })

  test('labels', () => {
    expect([0, 9999, 10000, 18241, 1234567, 98765432].map(countLabel)).toEqual(['0', '9,999', '10K', '18.2K', '1.2M', '98.8M'])
    expect(joinedLabel('2021-03')).toBe('Joined March 2021')
    expect(['Ana Souza', 'carla', 'Maria de Oliveira e Bragança', '  Zé  '].map(initials)).toEqual(['AS', 'C', 'MB', 'Z'])
  })

  test('no such person', () => {
    expect(toViewModel(demoNetwork(), 'nobody', null)).toBeNull()
  })
})
