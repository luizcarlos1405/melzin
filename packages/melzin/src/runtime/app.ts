// startApp: the standalone host (SPEC §7, D11, D20–D27). The route table picks the view for the URL, the
// app's source loads its data and handles its events, and every navigation goes through one
// `navigate` hook (D25). View code and data load by each route's policies (D24).

import {
  type Issue,
  type Route,
  type RouteInput,
  type RouteMatch,
  type RouteTable,
  VIEW_FILE_SUFFIX,
  buildUrl,
  findRoute,
  hasField,
  matchRoute,
  validateRouteTable,
} from '../core/index.ts'
import { type MelzinView, mountSource } from './mount.ts'

/**
 * A URL for route `R`, made by an href helper (SPEC D23). Link fields have this type in the generated
 * view types, so a source can't send a hand-built string where a link goes.
 */
export type Href<R extends string = string> = string & { readonly __melzinRoute: R }

/** What the generated `routes.types.ts` describes for each route. */
export type RouteTypes = { [name: string]: { params: object; query: object; data: object; handlers: object } }

/** A URL matched to a route: what a loader, a handler and the navigate hook see. */
export type RouteState<P = Record<string, string>, Q = Record<string, string | undefined>, N extends string = string> = {
  name: N
  params: P
  query: Q
  /** The path plus the declared query parameters that are set, such as `/u/ana?as=bruno`. */
  url: string
}

export type RouteOf<R extends RouteTypes, K extends keyof R & string> = RouteState<R[K]['params'], R[K]['query'], K>
/** Any route of the app. */
export type AnyRouteOf<R extends RouteTypes> = { [K in keyof R & string]: RouteOf<R, K> }[keyof R & string]

/** The screen on display, as a handler sees it. */
export type Page<D, Rt = RouteState> = {
  readonly route: Rt
  readonly data: D
  /** False once the app has moved on to another screen; update() is then ignored. */
  readonly current: boolean
  /** Replaces the screen's data (and the cached copy, for stale-while-revalidate routes). */
  update(data: D): void
  navigate(url: string, options?: NavigateOptions): Promise<void>
  /** Runs the route's loader again and shows the result. */
  reload(): Promise<void>
}

export type NavigateOptions = { replace?: boolean }

export type LoadContext = {
  /** Aborted when the user navigates elsewhere before the load finishes. */
  signal: AbortSignal
}

type EventHandlers<H, D, Rt> = { [E in keyof H]-?: (payload: undefined, page: Page<D, Rt>) => void | Promise<void> }

/** One route's part of the source: its loader and the handlers for its view's events (D20). */
export type RouteSource<R extends RouteTypes, K extends keyof R & string> = {
  load(route: RouteOf<R, K>, context: LoadContext): R[K]['data'] | Promise<R[K]['data']>
} & (string extends keyof R[K]['handlers']
  ? { on?: Record<string, never> }
  : { on: EventHandlers<R[K]['handlers'], R[K]['data'], RouteOf<R, K>> })

/**
 * Where the data comes from (D20): a loader and handlers per route. Whether they fetch from a server,
 * read IndexedDB or return constants is the app's choice; Melzin only types the contract.
 */
export type Source<R extends RouteTypes> = { [K in keyof R & string]: RouteSource<R, K> }

/** Undefined or true: navigate. False: stay. A string: go to that URL instead. */
export type NavigateResult = void | undefined | boolean | string

export type AppOptions<R extends RouteTypes> = {
  /** The parsed routes.json. */
  routes: unknown
  source: Source<R>
  /**
   * Runs before every navigation the app handles: a link click, back and forward, or a handler's
   * navigate (D25). `from` is null for the first screen, which this hook doesn't see.
   */
  navigate?: (to: AnyRouteOf<R>, from: AnyRouteOf<R> | null) => NavigateResult | Promise<NavigateResult>
  /** Where a view's file is served. Default: `/views/<view>.mel.html`. */
  viewUrl?: (view: string) => string
  /** Loads a view's source; replaces fetching viewUrl (tests, bundled views). */
  loadView?: (view: string) => Promise<string>
  onWarning?: (message: string) => void
}

export type MelzinApp<R extends RouteTypes> = {
  readonly table: RouteTable
  /** The route on screen; null when the URL matched no route or its screen failed to load. */
  readonly route: AnyRouteOf<R> | null
  /** Goes to a URL. One that matches no route leaves the app with a full page load. */
  navigate(url: string, options?: NavigateOptions): Promise<void>
  destroy(): void
}

// A route whose parameters are all optional (none, really) can be called without them: href('home').
type HrefArgs<T extends { params: object; query: object }> = {} extends T['params']
  ? [params?: T['params'], query?: T['query']]
  : [params: T['params'], query?: T['query']]

/** `href('profile', { handle: 'ana' }, { as: 'bruno' })` → `/u/ana?as=bruno`. */
export type HrefBuilder<R extends RouteTypes> = <K extends keyof R & string>(name: K, ...args: HrefArgs<R[K]>) => Href<K>

type AnyHandler = (payload: undefined, page: Page<unknown>) => unknown
type AnyRouteSource = { load?: (route: RouteState, context: LoadContext) => unknown; on?: Record<string, AnyHandler> }
type Kind = 'initial' | 'push' | 'replace' | 'traverse'

const MAX_REDIRECTS = 10
const tables = new WeakMap<object, RouteTable>()

function formatIssues(issues: readonly Issue[]): string {
  return issues.map((issue) => `  - ${issue.path === undefined ? '' : `${issue.path}: `}${issue.message}`).join('\n')
}

/** Validates a parsed routes.json once per object; throws with every problem. */
function readTable(routes: unknown): RouteTable {
  if (typeof routes === 'object' && routes !== null) {
    const cached = tables.get(routes)
    if (cached !== undefined) return cached
  }
  const { table, issues } = validateRouteTable(routes)
  if (table === null) throw new Error(`melzin: the route table is invalid (run melzin check):\n${formatIssues(issues)}`)
  if (typeof routes === 'object' && routes !== null) tables.set(routes, table)
  return table
}

/** The href helper for a route table (SPEC D23): sources build link fields with it, never by hand. */
export function hrefs<R extends RouteTypes = RouteTypes>(routes: unknown): HrefBuilder<R> {
  const table = readTable(routes)
  return ((name: string, params?: Record<string, unknown>, query?: Record<string, unknown>) => {
    const route = findRoute(table, name)
    if (route === undefined) throw new Error(`melzin: no route named '${name}' in the route table`)
    return buildUrl(route, params ?? {}, query ?? {})
  }) as unknown as HrefBuilder<R>
}

function stateOf(match: RouteMatch): RouteState {
  return { name: match.route.name, params: { ...match.params }, query: { ...match.query }, url: match.url }
}

function inputOf(state: RouteState): RouteInput {
  const query: Record<string, string> = {}
  for (const [name, value] of Object.entries(state.query)) if (value !== undefined) query[name] = value
  return { name: state.name, params: { ...state.params }, query }
}

/** The link an event happened in, with its URL, or null. */
function linkOf(event: Event, base: string): { link: Element; url: URL } | null {
  const target = event.target as { closest?: (selector: string) => Element | null } | null
  const link = typeof target?.closest === 'function' ? target.closest('a[href], area[href]') : null
  const href = link?.getAttribute('href')
  if (link == null || href == null) return null
  try {
    return { link, url: new URL(href, base) }
  } catch {
    return null
  }
}

export async function startApp<R extends RouteTypes = RouteTypes>(root: Element, options: AppOptions<R>): Promise<MelzinApp<R>> {
  const table = readTable(options.routes)
  const doc = root.ownerDocument
  const win = doc.defaultView
  if (win === null) throw new Error('melzin: startApp needs an element in a window')
  const warn = (message: string): void => {
    if (options.onWarning) options.onWarning(message)
    else console.warn(`[melzin] ${message}`)
  }

  const source = options.source as unknown as Record<string, AnyRouteSource | undefined>
  const sourceFor = (name: string): AnyRouteSource | undefined => (hasField(source, name) ? source[name] : undefined)
  for (const route of table.routes) {
    if (typeof sourceFor(route.name)?.load !== 'function') warn(`route '${route.name}' has no loader; add source.${route.name}.load`)
  }
  for (const name of Object.keys(source)) {
    if (findRoute(table, name) === undefined) warn(`source.${name} doesn't match a route in the route table`)
  }

  // --- view code (D24): one fetch per view, shared by navigation and prefetching
  const viewUrl = options.viewUrl ?? ((view: string) => `/views/${encodeURIComponent(view + VIEW_FILE_SUFFIX)}`)
  const fetchView = options.loadView ?? (async (view: string): Promise<string> => {
    const url = viewUrl(view)
    const response = await fetch(url)
    if (!response.ok) throw new Error(`couldn't load view ${url}: HTTP ${response.status}`)
    return response.text()
  })
  const views = new Map<string, Promise<string>>()
  const loadView = (view: string): Promise<string> => {
    let html = views.get(view)
    if (html === undefined) {
      html = fetchView(view)
      views.set(view, html)
      // A failed load is retried next time instead of failing forever.
      html.catch(() => views.delete(view))
    }
    return html
  }

  // --- data (D24): stale-while-revalidate routes keep the last data per URL. `fresh` marks data a
  // prefetch loaded and nobody has seen yet, so showing it needs no second load.
  const cache = new Map<string, { data: unknown; fresh: boolean }>()
  const prefetching = new Map<string, Promise<unknown>>()

  const loadData = async (route: Route, state: RouteState, signal: AbortSignal): Promise<unknown> => {
    const load = sourceFor(route.name)?.load
    if (typeof load !== 'function') throw new Error(`route '${route.name}' has no loader; add source.${route.name}.load`)
    const data = await load.call(sourceFor(route.name), state, { signal })
    if (route.data === 'stale-while-revalidate' && !signal.aborted) cache.set(state.url, { data, fresh: false })
    return data
  }

  const prefetchData = (match: RouteMatch): void => {
    const key = match.url
    if (match.route.data !== 'stale-while-revalidate' || cache.has(key) || prefetching.has(key) || current?.state.url === key) return
    const loading = loadData(match.route, stateOf(match), new AbortController().signal).then((data) => {
      cache.set(key, { data, fresh: true })
      return data
    })
    prefetching.set(key, loading)
    loading.catch(() => {}).finally(() => prefetching.delete(key))
  }

  // --- the screen
  type Current = { state: RouteState; route: Route; view: MelzinView<unknown>; page: Page<unknown> }
  let current: Current | null = null
  let token = 0
  let controller: AbortController | null = null
  let destroyed = false
  let prefetchScheduled = false

  const clear = (): void => {
    current?.view.destroy()
    current = null
    root.replaceChildren()
  }

  // Not-found and error screens aren't designed yet (SPEC §7), so problems show as plain text.
  const showProblem = (message: string): void => {
    warn(message)
    clear()
    const box = doc.createElement('p')
    box.setAttribute('role', 'alert')
    box.setAttribute('data-melzin-problem', '')
    box.textContent = message
    root.append(box)
  }

  const render = (route: Route, state: RouteState, html: string, data: unknown): Page<unknown> => {
    clear()
    let view: MelzinView<unknown> | null = null
    const page: Page<unknown> = {
      route: state,
      get data() {
        return view?.data
      },
      get current() {
        return !destroyed && current?.page === page
      },
      update(next: unknown) {
        if (route.data === 'stale-while-revalidate') cache.set(state.url, { data: next, fresh: false })
        if (page.current) view?.update(next)
      },
      navigate: (url, navigateOptions) => app.navigate(url, navigateOptions),
      async reload() {
        if (!page.current) return
        const fresh = await loadData(route, state, new AbortController().signal)
        page.update(fresh)
      },
    }
    const handlers = sourceFor(route.name)?.on ?? {}
    const on: Record<string, (payload: undefined) => void> = {}
    for (const name of Object.keys(handlers)) {
      const handler = handlers[name]
      if (typeof handler !== 'function') continue
      on[name] = (payload) => {
        const failed = (error: unknown): void => warn(`handler '${name}' of route '${route.name}' failed: ${error instanceof Error ? error.message : String(error)}`)
        try {
          const result = handler.call(handlers, payload, page) as { then?: unknown; catch?: (onRejected: (error: unknown) => void) => unknown } | undefined
          if (result != null && typeof result.then === 'function' && typeof result.catch === 'function') result.catch(failed)
        } catch (error) {
          failed(error)
        }
      }
    }
    view = mountSource(root, html, { data, on, route: inputOf(state), onWarning: options.onWarning })
    current = { state, route, view, page }
    return page
  }

  const scrollTo = (x: number, y: number): void => {
    if (typeof win.scrollTo === 'function') win.scrollTo(x, y)
  }

  const saveScroll = (): void => {
    const state = (win.history.state ?? {}) as Record<string, unknown>
    win.history.replaceState({ ...state, melzinScroll: [win.scrollX ?? 0, win.scrollY ?? 0] }, '')
  }

  const schedulePrefetch = (): void => {
    if (prefetchScheduled) return
    prefetchScheduled = true
    const run = (): void => {
      if (destroyed) return
      for (const route of table.routes) if (route.code === 'prefetch') loadView(route.view).catch(() => {})
    }
    const idle = (win as { requestIdleCallback?: (callback: () => void) => void }).requestIdleCallback
    if (typeof idle === 'function') idle.call(win, run)
    else win.setTimeout(run, 200)
  }

  const go = async (target: URL, kind: Kind, redirects = 0): Promise<void> => {
    if (destroyed) return
    const match = matchRoute(table, target)
    if (match === null) {
      if (kind === 'initial' || kind === 'traverse') showProblem(`No page here: no route matches ${target.pathname}`)
      else win.location.assign(target.href)
      return
    }
    const to = stateOf(match)
    if (kind !== 'initial' && options.navigate !== undefined) {
      let result: NavigateResult
      try {
        result = await options.navigate(to as AnyRouteOf<R>, (current?.state ?? null) as AnyRouteOf<R> | null)
      } catch (error) {
        warn(`navigate failed: ${error instanceof Error ? error.message : String(error)}; staying on this page`)
        result = false
      }
      if (destroyed) return
      if (result === false) {
        // Back and forward have already changed the URL; put the current page's back.
        if (kind === 'traverse' && current !== null) {
          win.history.replaceState(win.history.state, '', current.state.url)
          shownUrl = here()
        }
        return
      }
      if (typeof result === 'string') {
        if (redirects >= MAX_REDIRECTS) {
          warn(`navigate redirected ${MAX_REDIRECTS} times in a row; stopped at ${target.pathname}`)
          return
        }
        return go(new URL(result, win.location.href), kind === 'traverse' ? 'replace' : kind, redirects + 1)
      }
    }

    const mine = ++token
    controller?.abort()
    const ownController = new AbortController()
    controller = ownController
    const { signal } = ownController
    // The URL changes first, as with a normal link: the address bar shows where the user is going.
    if (kind === 'push') {
      saveScroll()
      win.history.pushState({}, '', target.href)
    } else if (kind === 'replace') {
      win.history.replaceState({}, '', target.href)
    }
    shownUrl = here()

    const { route } = match
    const html = loadView(route.view)
    html.catch(() => {}) // awaited below; this only keeps an early failure from going unhandled
    let data: unknown
    let stale = false
    const cached = route.data === 'stale-while-revalidate' ? cache.get(to.url) : undefined
    try {
      if (cached !== undefined) {
        data = cached.data
        stale = !cached.fresh
        cached.fresh = false
      } else {
        data = await (prefetching.get(to.url) ?? loadData(route, to, signal))
      }
    } catch (error) {
      if (mine !== token || destroyed || signal.aborted) return
      showProblem(`This page couldn't load: ${error instanceof Error ? error.message : String(error)}`)
      return
    }
    let source: string
    try {
      source = await html
    } catch (error) {
      if (mine !== token || destroyed) return
      showProblem(`This page couldn't load: ${error instanceof Error ? error.message : String(error)}`)
      return
    }
    if (mine !== token || destroyed) return

    let page: Page<unknown>
    try {
      page = render(route, to, source, data)
    } catch (error) {
      showProblem(error instanceof Error ? error.message : String(error))
      return
    }
    if (kind === 'traverse') {
      const saved = (win.history.state as { melzinScroll?: unknown } | null)?.melzinScroll
      if (Array.isArray(saved)) scrollTo(Number(saved[0]) || 0, Number(saved[1]) || 0)
    } else if (kind !== 'initial') {
      const anchor = target.hash === '' ? null : doc.getElementById(decodeURIComponent(target.hash.slice(1)))
      if (anchor !== null && typeof anchor.scrollIntoView === 'function') anchor.scrollIntoView()
      else scrollTo(0, 0)
    }
    schedulePrefetch()

    if (stale) {
      try {
        const fresh = await loadData(route, to, signal)
        if (!signal.aborted) page.update(fresh)
      } catch (error) {
        if (!signal.aborted) warn(`couldn't refresh ${to.url}: ${error instanceof Error ? error.message : String(error)}; showing the cached data`)
      }
    }
  }

  // --- navigation: links, back and forward, and intent to navigate
  const here = (): URL => new URL(win.location.href)
  const samePage = (url: URL, other: URL): boolean => url.pathname === other.pathname && url.search === other.search
  let shownUrl = here()

  const onClick = (event: Event): void => {
    const mouse = event as MouseEvent
    if (mouse.defaultPrevented || mouse.button !== 0 || mouse.metaKey || mouse.ctrlKey || mouse.shiftKey || mouse.altKey) return
    const found = linkOf(event, doc.baseURI)
    if (found === null) return
    const { link, url } = found
    const target = link.getAttribute('target')
    if ((target !== null && target !== '' && target !== '_self') || link.hasAttribute('download')) return
    if (url.origin !== win.location.origin || matchRoute(table, url) === null) return
    // A link to a spot on the same page only scrolls, as usual.
    if (url.hash !== '' && samePage(url, here())) return
    event.preventDefault()
    void go(url, samePage(url, here()) ? 'replace' : 'push')
  }

  const onPopState = (): void => {
    const url = here()
    // Only the hash changed: the browser scrolls, the screen stays.
    if (samePage(url, shownUrl)) return
    void go(url, 'traverse')
  }

  const onIntent = (event: Event): void => {
    const found = linkOf(event, doc.baseURI)
    if (found === null || found.url.origin !== win.location.origin) return
    const match = matchRoute(table, found.url)
    if (match === null) return
    loadView(match.route.view).catch(() => {})
    prefetchData(match)
  }

  doc.addEventListener('click', onClick)
  doc.addEventListener('pointerover', onIntent)
  doc.addEventListener('focusin', onIntent)
  doc.addEventListener('touchstart', onIntent, { passive: true })
  win.addEventListener('popstate', onPopState)
  const previousRestoration = win.history.scrollRestoration
  win.history.scrollRestoration = 'manual'

  const app: MelzinApp<R> = {
    table,
    get route() {
      return (current?.state ?? null) as AnyRouteOf<R> | null
    },
    async navigate(url: string, navigateOptions: NavigateOptions = {}): Promise<void> {
      await go(new URL(url, win.location.href), navigateOptions.replace === true ? 'replace' : 'push')
    },
    destroy(): void {
      if (destroyed) return
      destroyed = true
      controller?.abort()
      doc.removeEventListener('click', onClick)
      doc.removeEventListener('pointerover', onIntent)
      doc.removeEventListener('focusin', onIntent)
      doc.removeEventListener('touchstart', onIntent)
      win.removeEventListener('popstate', onPopState)
      win.history.scrollRestoration = previousRestoration
      current?.view.destroy()
      current = null
    },
  }

  // Eager routes' views load right away, alongside the first screen.
  for (const route of table.routes) if (route.code === 'eager') loadView(route.view).catch(() => {})
  await go(here(), 'initial')
  return app
}
