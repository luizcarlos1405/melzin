// startApp, the standalone host (SPEC §7): routes, sources, navigation through one hook (D25), loading
// policies (D24) and the URL input (D27).

import { afterEach, beforeEach, describe, expect, spyOn, test } from 'bun:test'
import { type MelzinApp, type RouteState, type RouteTypes, type Source, hrefs, startApp } from '../src/runtime/index.ts'
import { useDom } from './helpers/dom.ts'
import { view } from './runtime-fixtures.ts'

useDom('http://localhost:3000/')

const ROUTES = {
  routes: {
    home: { path: '/', view: 'home', query: { as: {} }, code: 'eager' },
    profile: { path: '/u/:handle', view: 'profile', query: { as: {} } },
    settings: { path: '/settings', view: 'settings', code: 'lazy', data: 'network-only' },
  },
}

const VIEWS: Record<string, string> = {
  home: view({
    title: 'Home',
    schema: { data: { type: 'object', properties: { title: { type: 'string' }, anaUrl: { type: 'string', route: 'profile' } }, required: ['title', 'anaUrl'] } },
    body: `<h1 id="title" m-text="title"></h1><a id="ana" m-bind:href="anaUrl">Ana</a><a id="settings" href="/settings">Settings</a>
      <a id="away" href="/elsewhere">Away</a><a id="blank" href="/u/bruno" target="_blank">New tab</a><p id="as" m-text="route.query.as"></p>`,
  }),
  profile: view({
    title: 'Profile',
    schema: {
      data: { type: 'object', properties: { name: { type: 'string' }, follows: { type: 'boolean' }, homeUrl: { type: 'string', route: 'home' } }, required: ['name', 'follows', 'homeUrl'] },
      events: { follow: {}, signIn: {} },
    },
    body: `<h1 id="name" m-text="name"></h1><p id="handle" m-text="route.params.handle"></p><p id="following" m-show="follows">Following</p>
      <button id="follow" m-on:click="emit('follow')">Follow</button><button id="sign-in" m-on:click="emit('signIn')">Sign in</button>
      <a id="home" m-bind:href="homeUrl">Home</a>`,
  }),
  settings: view({ title: 'Settings', body: '<h1 id="settings-title">Settings</h1><a id="back" href="/">Back</a>' }),
}

type Routes = {
  home: { params: Record<string, never>; query: { as?: string }; data: { title: string; anaUrl: string }; handlers: Record<string, never> }
  profile: { params: { handle: string }; query: { as?: string }; data: { name: string; follows: boolean; homeUrl: string }; handlers: { follow: () => void; signIn: () => void } }
  settings: { params: Record<string, never>; query: Record<string, never>; data: Record<string, never>; handlers: Record<string, never> }
}

let root: HTMLElement
let warnings: string[]
let viewLoads: string[]
let dataLoads: string[]
let app: MelzinApp<Routes> | null
let follows: Set<string>
let failNext: string | null

const href = hrefs<Routes>(ROUTES)

function profileData(state: RouteState): Routes['profile']['data'] {
  const handle = state.params.handle ?? ''
  return { name: handle.toUpperCase(), follows: follows.has(handle), homeUrl: href('home', {}, { as: state.query.as }) }
}

function source() {
  return {
    home: {
      load: (state: RouteState) => {
        dataLoads.push(state.url)
        return { title: `Home${state.query.as ? ` for ${state.query.as}` : ''}`, anaUrl: href('profile', { handle: 'ana' }, { as: state.query.as }) }
      },
    },
    profile: {
      load: async (state: RouteState) => {
        dataLoads.push(state.url)
        await Promise.resolve()
        if (failNext === state.url) {
          failNext = null
          throw new Error('the server is down')
        }
        return profileData(state)
      },
      on: {
        follow: (_payload: undefined, page: { route: RouteState; update(data: Routes['profile']['data']): void }) => {
          follows.add(page.route.params.handle ?? '')
          page.update(profileData(page.route))
        },
        signIn: (_payload: undefined, page: { route: RouteState; navigate(url: string): Promise<void> }) =>
          page.navigate(href('profile', { handle: page.route.params.handle ?? '' }, { as: 'ana' })),
      },
    },
    settings: { load: () => (dataLoads.push('/settings'), {}) },
  }
}

async function start(path: string, options: Partial<Parameters<typeof startApp<Routes>>[1]> = {}): Promise<MelzinApp<Routes>> {
  history.replaceState(null, '', path)
  app = await startApp<Routes>(root, {
    routes: ROUTES,
    source: source() as never,
    loadView: async (name) => {
      viewLoads.push(name)
      const html = VIEWS[name]
      if (html === undefined) throw new Error(`no view ${name}`)
      return html
    },
    onWarning: (message) => warnings.push(message),
    ...options,
  })
  return app
}

/** Lets pending loads and renders finish. */
async function settle(): Promise<void> {
  for (let i = 0; i < 10; i++) await new Promise((resolve) => setTimeout(resolve, 0))
}

function text(selector: string): string | null | undefined {
  return root.querySelector(selector)?.textContent
}

function click(selector: string, init: MouseEventInit = {}): MouseEvent {
  const event = new MouseEvent('click', { bubbles: true, cancelable: true, button: 0, ...init })
  root.querySelector(selector)!.dispatchEvent(event)
  return event
}

beforeEach(() => {
  root = document.createElement('div')
  document.body.append(root)
  warnings = []
  viewLoads = []
  dataLoads = []
  follows = new Set()
  failNext = null
  app = null
})

afterEach(() => {
  app?.destroy()
  root.remove()
})

describe('the first screen', () => {
  test('the URL picks the route, the source loads its data', async () => {
    await start('/u/ana?as=bruno&utm=1')
    expect(warnings).toEqual([])
    expect(text('#name')).toBe('ANA')
    expect(text('#handle')).toBe('ana')
    expect(root.querySelector('#home')?.getAttribute('href')).toBe('/?as=bruno')
    expect(app?.route).toEqual({ name: 'profile', params: { handle: 'ana' }, query: { as: 'bruno' }, url: '/u/ana?as=bruno' })
    expect(dataLoads).toEqual(['/u/ana?as=bruno'])
    // The eager home view loads alongside; the URL is left as it was.
    expect(viewLoads.sort()).toEqual(['home', 'profile'])
    expect(location.pathname + location.search).toBe('/u/ana?as=bruno&utm=1')
  })

  test('no route for the URL', async () => {
    await start('/nope')
    expect(app?.route).toBeNull()
    expect(text('[data-melzin-problem]')).toBe('No page here: no route matches /nope')
    expect(warnings).toEqual(['No page here: no route matches /nope'])
  })

  test('a failing loader shows a problem', async () => {
    failNext = '/u/ana'
    await start('/u/ana')
    expect(text('[data-melzin-problem]')).toBe("This page couldn't load: the server is down")
    expect(root.getAttribute('aria-busy')).toBeNull()
  })

  test('an invalid route table throws', async () => {
    history.replaceState(null, '', '/')
    await expect(startApp(root, { routes: { routes: { a: { path: 'x', view: 'a' } } }, source: {} })).rejects.toThrow(
      "melzin: the route table is invalid (run melzin check):\n  - routes.a.path: a path starts with '/', such as '/x'",
    )
  })

  test('sources that miss or add routes warn', async () => {
    const { settings: _settings, ...partial } = source()
    await start('/', { source: { ...partial, extra: { load: () => ({}) } } as never })
    expect(warnings).toEqual(["route 'settings' has no loader; add source.settings.load", "source.extra doesn't match a route in the route table"])
  })
})

describe('links', () => {
  test('a link to a route navigates without a page load', async () => {
    await start('/?as=bruno')
    expect(text('#as')).toBe('bruno')
    const length = history.length
    const event = click('#ana')
    expect(event.defaultPrevented).toBe(true)
    await settle()
    expect(location.pathname + location.search).toBe('/u/ana?as=bruno')
    expect(history.length).toBe(length + 1)
    expect(text('#name')).toBe('ANA')
    expect(app?.route?.name).toBe('profile')
  })

  test('links the app leaves alone', async () => {
    await start('/')
    const assign = spyOn(location, 'assign').mockImplementation(() => {})
    try {
      expect(click('#ana', { metaKey: true }).defaultPrevented).toBe(false)
      expect(click('#ana', { ctrlKey: true }).defaultPrevented).toBe(false)
      expect(click('#ana', { button: 1 }).defaultPrevented).toBe(false)
      expect(click('#blank').defaultPrevented).toBe(false)
      expect(click('#away').defaultPrevented).toBe(false)
      expect(assign).not.toHaveBeenCalled()
    } finally {
      assign.mockRestore()
    }
    expect(app?.route?.name).toBe('home')
  })

  test("a view's named elements can't stop links, problems or destroy", async () => {
    await start('/')
    // Browsers make a document's named images its own properties (<img name="baseURI"> is
    // document.baseURI); happy-dom doesn't, so the test does. (Not createElement: happy-dom's own
    // DOMParser calls it on the document.)
    const img = document.createElement('img')
    const names = ['baseURI', 'getElementById', 'removeEventListener']
    try {
      for (const name of names) Object.defineProperty(document, name, { configurable: true, value: img })
      expect(click('#ana').defaultPrevented).toBe(true)
      await settle()
      expect(text('#name')).toBe('ANA')
      await app!.navigate('/u/bruno#name')
      expect(text('#name')).toBe('BRUNO')
      failNext = '/u/carla'
      await app!.navigate('/u/carla')
      expect(text('[data-melzin-problem]')).toContain('the server is down')
      app!.destroy()
      app = null
    } finally {
      for (const name of names) delete (document as unknown as Record<string, unknown>)[name]
    }
  })

  test('navigate() to a URL with no route leaves the app', async () => {
    await start('/')
    const assign = spyOn(location, 'assign').mockImplementation(() => {})
    try {
      await app!.navigate('/elsewhere')
      expect(assign).toHaveBeenCalledWith('http://localhost:3000/elsewhere')
    } finally {
      assign.mockRestore()
    }
  })
})

describe('the navigate hook (D25)', () => {
  test('sees every navigation, and can cancel or redirect it', async () => {
    const seen: string[] = []
    let answer: false | string | undefined
    await start('/', {
      // A redirect is a navigation too, so the hook sees it and must not redirect it again.
      navigate: (to, from) => {
        seen.push(`${from?.url} -> ${to.url}`)
        return to.name === 'profile' ? answer : undefined
      },
    })
    expect(seen).toEqual([])

    answer = false
    click('#ana')
    await settle()
    expect(app?.route?.name).toBe('home')
    expect(location.pathname).toBe('/')

    answer = '/settings'
    click('#ana')
    await settle()
    expect(app?.route?.name).toBe('settings')
    expect(location.pathname).toBe('/settings')
    expect(seen).toEqual(['/ -> /u/ana', '/ -> /u/ana', '/ -> /settings'])
  })

  test('a redirect loop stops', async () => {
    await start('/', { navigate: (to) => (to.name === 'profile' ? '/u/again' : undefined) })
    click('#ana')
    await settle()
    expect(warnings).toEqual(['navigate redirected 10 times in a row; stopped at /u/again'])
    expect(app?.route?.name).toBe('home')
  })
})

describe('handlers', () => {
  test('get the page: update it, or navigate', async () => {
    await start('/u/ana')
    expect(root.querySelector<HTMLElement>('#following')?.style.display).toBe('none')
    const name = root.querySelector('#name')
    click('#follow')
    expect(root.querySelector<HTMLElement>('#following')?.style.display).toBe('')
    expect(root.querySelector('#name')).toBe(name)

    click('#sign-in')
    await settle()
    expect(location.pathname + location.search).toBe('/u/ana?as=ana')
    expect(root.querySelector('#home')?.getAttribute('href')).toBe('/?as=ana')
  })

  test('a page that is gone ignores updates', async () => {
    let saved: { current: boolean; update(data: unknown): void } | undefined
    await start('/u/ana', {
      source: { ...source(), profile: { ...source().profile, on: { follow: (_: undefined, page: never) => void (saved = page), signIn: () => {} } } } as never,
    })
    click('#follow')
    expect(saved?.current).toBe(true)
    await app!.navigate('/settings')
    expect(saved?.current).toBe(false)
    saved?.update({ name: 'X', follows: true, homeUrl: '/' })
    expect(text('#settings-title')).toBe('Settings')
  })

  test("get the event's payload first, built from the row that was clicked", async () => {
    type PollRoutes = {
      poll: {
        params: Record<string, never>
        query: Record<string, never>
        data: { options: { id: string; votes: number }[] }
        handlers: { vote: (payload: { optionId: string }) => void }
      }
    }
    const poll = view({
      schema: {
        data: {
          type: 'object',
          properties: {
            options: {
              type: 'array',
              key: 'id',
              items: { type: 'object', properties: { id: { type: 'string' }, votes: { type: 'number' } }, required: ['id', 'votes'] },
            },
          },
          required: ['options'],
        },
        events: { vote: { payload: { type: 'object', properties: { optionId: { type: 'string' } }, required: ['optionId'] } } },
      },
      body: `<button m-for="option in options" m-on:click="emit('vote', { optionId: option.id })" m-text="option.votes"></button>`,
    })
    const votes = new Map([['pizza', 0], ['tacos', 0]])
    const data = (): PollRoutes['poll']['data'] => ({ options: [...votes].map(([id, count]) => ({ id, votes: count })) })
    const received: unknown[] = []
    const source: Source<PollRoutes> = {
      poll: {
        load: data,
        on: {
          vote: ({ optionId }, page) => {
            received.push(optionId)
            votes.set(optionId, (votes.get(optionId) ?? 0) + 1)
            page.update(data())
          },
        },
      },
    }
    history.replaceState(null, '', '/')
    app = (await startApp<PollRoutes>(root, {
      routes: { routes: { poll: { path: '/', view: 'poll' } } },
      source,
      loadView: async () => poll,
      onWarning: (message) => warnings.push(message),
    })) as never
    const tacos = root.querySelectorAll('button')[1]!
    tacos.click()
    tacos.click()
    expect(received).toEqual(['tacos', 'tacos'])
    expect([...root.querySelectorAll('button')].map((button) => button.textContent)).toEqual(['0', '2'])
    expect(root.querySelectorAll('button')[1]).toBe(tacos)
    expect(warnings).toEqual([])

    // Handlers are typed by the generated Handlers: the payload's fields, or undefined without one.
    const typed: Source<PollRoutes> = {
      poll: {
        load: data,
        // @ts-expect-error: optionId is a string, not a number
        on: { vote: (payload: { optionId: number }) => void payload },
      },
    }
    const untyped: Source<Routes>['profile']['on'] = {
      follow: (payload) => {
        const nothing: undefined = payload
        void nothing
      },
      signIn: () => {},
    }
    void typed
    void untyped
  })

  test('a failing handler warns', async () => {
    await start('/u/ana', {
      source: { ...source(), profile: { ...source().profile, on: { follow: () => Promise.reject(new Error('nope')), signIn: () => { throw new Error('boom') } } } } as never,
    })
    click('#follow')
    click('#sign-in')
    await settle()
    expect(warnings).toEqual(["handler 'signIn' of route 'profile' failed: boom", "handler 'follow' of route 'profile' failed: nope"])
  })
})

describe('back and forward', () => {
  test('show the cached data at once, then refresh it (stale-while-revalidate)', async () => {
    await start('/u/ana')
    await app!.navigate('/u/bruno')
    expect(text('#name')).toBe('BRUNO')
    follows.add('ana')
    dataLoads = []

    history.replaceState(history.state, '', '/u/ana')
    window.dispatchEvent(new PopStateEvent('popstate'))
    await Promise.resolve()
    await Promise.resolve()
    expect(text('#name')).toBe('ANA')
    expect(root.querySelector<HTMLElement>('#following')?.style.display).toBe('none')
    await settle()
    expect(dataLoads).toEqual(['/u/ana'])
    expect(root.querySelector<HTMLElement>('#following')?.style.display).toBe('')
  })

  test('network-only routes always load', async () => {
    await start('/settings')
    await app!.navigate('/')
    dataLoads = []
    history.replaceState(history.state, '', '/settings')
    window.dispatchEvent(new PopStateEvent('popstate'))
    await settle()
    expect(dataLoads).toEqual(['/settings'])
  })

  test('only the hash changed: nothing happens', async () => {
    await start('/u/ana')
    dataLoads = []
    history.replaceState(history.state, '', '/u/ana#bio')
    window.dispatchEvent(new PopStateEvent('popstate'))
    await settle()
    expect(dataLoads).toEqual([])
  })
})

describe('loading policies (D24)', () => {
  test('prefetch views load after the first screen; lazy ones wait for intent', async () => {
    await start('/')
    expect(viewLoads).toEqual(['home'])
    await new Promise((resolve) => setTimeout(resolve, 250))
    expect(viewLoads).toEqual(['home', 'profile'])

    root.querySelector('#settings')!.dispatchEvent(new Event('pointerover', { bubbles: true }))
    expect(viewLoads).toEqual(['home', 'profile', 'settings'])
    // settings is network-only: its data isn't prefetched.
    expect(dataLoads).toEqual(['/'])
  })

  test('intent prefetches stale-while-revalidate data, which then shows without a second load', async () => {
    await start('/')
    root.querySelector('#ana')!.dispatchEvent(new Event('focusin', { bubbles: true }))
    await settle()
    expect(dataLoads).toEqual(['/', '/u/ana'])
    click('#ana')
    await settle()
    expect(text('#name')).toBe('ANA')
    expect(dataLoads).toEqual(['/', '/u/ana'])
  })
})

describe('hrefs', () => {
  test('builds typed URLs from the table', () => {
    expect<string>(href('profile', { handle: 'ana b' }, { as: 'bruno' })).toBe('/u/ana%20b?as=bruno')
    expect<string>(href('home')).toBe('/')
    expect(() => (href as unknown as (name: string) => string)('nope')).toThrow("melzin: no route named 'nope' in the route table")
  })

  test('the same untyped', () => {
    const untyped = hrefs<RouteTypes>(ROUTES)
    expect<string>(untyped('settings', {})).toBe('/settings')
  })
})
