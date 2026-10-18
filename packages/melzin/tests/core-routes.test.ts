// The route table (SPEC D21–D24): validation, matching and building URLs, and the URL input (D27).

import { describe, expect, test } from 'bun:test'
import {
  type RouteTable,
  buildUrl,
  matchPath,
  matchRoute,
  parseRoutePath,
  parseRouteRef,
  routeValue,
  routesForView,
  validateRouteTable,
} from '../src/core/index.ts'

const TABLE = {
  routes: {
    home: { path: '/', view: 'home', query: { as: {} } },
    newPost: { path: '/u/new', view: 'composer', code: 'eager' },
    profile: { path: '/u/:handle', view: 'profile', query: { as: { description: 'Who is looking' } }, code: 'lazy', data: 'network-only' },
    followers: { path: '/u/:handle/followers', view: 'followers', description: 'Everyone who follows someone' },
  },
}

function table(): RouteTable {
  const { table, issues } = validateRouteTable(TABLE)
  expect(issues).toEqual([])
  return table!
}

describe('validateRouteTable', () => {
  test('reads routes in table order, with defaults', () => {
    expect(table().routes).toEqual([
      { name: 'home', path: '/', view: 'home', params: [], query: ['as'], code: 'prefetch', data: 'stale-while-revalidate' },
      { name: 'newPost', path: '/u/new', view: 'composer', params: [], query: [], code: 'eager', data: 'stale-while-revalidate' },
      { name: 'profile', path: '/u/:handle', view: 'profile', params: ['handle'], query: ['as'], code: 'lazy', data: 'network-only' },
      {
        name: 'followers',
        path: '/u/:handle/followers',
        view: 'followers',
        params: ['handle'],
        query: [],
        code: 'prefetch',
        data: 'stale-while-revalidate',
        description: 'Everyone who follows someone',
      },
    ])
  })

  test('the top level', () => {
    expect(validateRouteTable([]).issues).toEqual([{ message: 'the route table must be a JSON object such as { "routes": { ... } }, got array' }])
    expect(validateRouteTable({}).issues).toEqual([{ message: "missing 'routes', an object mapping route names to routes" }])
    expect(validateRouteTable({ routes: [], extra: 1 }).issues).toEqual([
      { message: "unknown key 'extra'", path: 'extra' },
      { message: "'routes' must be an object, got array", path: 'routes' },
    ])
    expect(validateRouteTable({ routes: {} })).toEqual({ table: { routes: [] }, issues: [] })
  })

  test('route entries', () => {
    const { table, issues } = validateRouteTable({
      routes: {
        'bad-name': { path: '/', view: 'home' },
        noPath: { view: 'home' },
        noView: { path: '/x' },
        file: { path: '/f', view: 'views/profile.mel.html' },
        typo: { path: '/t', view: 't', cod: 'lazy' },
        policies: { path: '/p', view: 'p', code: 'later', data: 'offline' },
        swr: { path: '/s', view: 's', data: 'stale-while-revalidat' },
        query: { path: '/q/:id', view: 'q', query: { 'not ok': {}, id: {}, page: 1 } },
        list: [],
      },
    })
    expect(table).toBeNull()
    expect(issues).toEqual([
      { message: "'bad-name' isn't a valid route name (use letters, digits and _, not starting with a digit)", path: 'routes["bad-name"]' },
      { message: 'missing \'path\', such as "/u/:handle"', path: 'routes.noPath' },
      { message: "missing 'view': the view's file name without .mel.html", path: 'routes.noView' },
      { message: '\'view\' is the view\'s name, such as "profile", without folders or .mel.html', path: 'routes.file.view' },
      { message: "unknown key 'cod' (did you mean 'code'?)", path: 'routes.typo.cod' },
      { message: "'code' must be one of 'eager', 'prefetch', 'lazy', got \"later\"", path: 'routes.policies.code' },
      { message: "'offline' isn't supported yet (it needs the generated service worker); use 'stale-while-revalidate'", path: 'routes.policies.data' },
      { message: "'data' must be one of 'network-only', 'stale-while-revalidate', got \"stale-while-revalidat\" (did you mean 'stale-while-revalidate'?)", path: 'routes.swr.data' },
      { message: "'not ok' isn't a valid query parameter name (use letters, digits and _, not starting with a digit)", path: 'routes.query.query["not ok"]' },
      { message: "'id' is already a path parameter", path: 'routes.query.query.id' },
      { message: 'a query parameter must be an object such as {}, got number', path: 'routes.query.query.page' },
      { message: 'a route must be an object such as { "path": "/", "view": "home" }, got array', path: 'routes.list' },
    ])
  })

  test('two routes for the same URLs', () => {
    const { issues } = validateRouteTable({ routes: { a: { path: '/u/:handle', view: 'a' }, b: { path: '/u/:name', view: 'b' } } })
    expect(issues).toEqual([{ message: "route 'a' already matches every URL this path does, so 'b' would never show", path: 'routes.b.path' }])
  })
})

describe('parseRoutePath', () => {
  test('literal segments and whole-segment parameters', () => {
    expect(parseRoutePath('/')).toEqual({ ok: true, params: [] })
    expect(parseRoutePath('/about')).toEqual({ ok: true, params: [] })
    expect(parseRoutePath('/u/:handle/posts/:id')).toEqual({ ok: true, params: ['handle', 'id'] })
    expect(parseRoutePath('/a.b/~c/d-e_f')).toEqual({ ok: true, params: [] })
  })

  test('problems', () => {
    const message = (path: string) => {
      const result = parseRoutePath(path)
      return result.ok ? undefined : result.message
    }
    expect(message('about')).toBe("a path starts with '/', such as '/about'")
    expect(message('/about/')).toBe("drop the trailing '/': '/about'")
    expect(message('/a//b')).toBe("a path can't have an empty segment ('//')")
    expect(message('/u/:id?')).toBe("':id?': optional parts aren't supported yet; a parameter is a whole segment such as ':handle'")
    expect(message('/files/*')).toBe("'*' in '*': wildcards aren't supported yet; paths are literal segments and :name parameters")
    expect(message('/u/@:handle')).toBe("'@:handle': a parameter takes a whole segment for now, such as '/u/:handle'")
    expect(message('/u/:1x')).toBe("':1x' isn't a valid parameter (use letters, digits and _, not starting with a digit)")
    expect(message('/u/:id/:id')).toBe("parameter ':id' appears twice")
    expect(message('/caf%C3%A9')).toBe("'%' in 'caf%C3%A9': percent-escapes aren't supported yet; paths are literal segments and :name parameters")
    expect(message('/café')).toBe("'café' has characters a URL path would escape; use letters, digits, '-', '_', '.' and '~'")
  })
})

describe('matching', () => {
  test('first match in table order, params decoded, declared query only', () => {
    const routes = table()
    expect(matchRoute(routes, '/u/new')?.route.name).toBe('newPost')
    const match = matchRoute(routes, 'http://example.com/u/ana%20b?as=bruno&utm=x#top')
    expect(match).toMatchObject({ params: { handle: 'ana b' }, query: { as: 'bruno' }, url: '/u/ana%20b?as=bruno' })
    expect(match?.route.name).toBe('profile')
    expect(matchRoute(routes, '/')?.route.name).toBe('home')
    expect(matchRoute(routes, '/u/ana/followers')?.params).toEqual({ handle: 'ana' })
  })

  test('no match', () => {
    const routes = table()
    for (const url of ['/u', '/u/', '/u/ana/', '/U/ana', '/u/ana/followers/x', '/nope']) expect(matchRoute(routes, url)).toBeNull()
  })

  test('agrees with URLPattern', () => {
    const URLPatternClass = (globalThis as { URLPattern?: new (init: { pathname: string }) => { exec(input: { pathname: string }): { pathname: { groups: Record<string, string> } } | null } }).URLPattern
    if (URLPatternClass === undefined) return
    const routes = table()
    for (const pathname of ['/', '/u/new', '/u/ana', '/u/a%20b', '/u/ana/followers', '/u', '/u/ana/', '/U/ana']) {
      for (const route of routes.routes) {
        const ours = matchPath(route, pathname)
        const theirs = new URLPatternClass({ pathname: route.path }).exec({ pathname })
        expect(ours === null).toBe(theirs === null)
        if (ours !== null && theirs !== null) {
          const decoded = Object.fromEntries(Object.entries(theirs.pathname.groups).map(([key, value]) => [key, decodeURIComponent(value)]))
          expect(ours).toEqual(decoded)
        }
      }
    }
  })

  test('routesForView', () => {
    expect(routesForView(table(), 'profile').map((route) => route.name)).toEqual(['profile'])
    expect(routesForView(table(), 'nothing')).toEqual([])
  })
})

describe('buildUrl', () => {
  test('encodes parameters and keeps declared query in table order', () => {
    const [home, , profile] = table().routes
    expect(buildUrl(home!)).toBe('/')
    expect(buildUrl(home!, {}, { as: 'ana', other: 'x' })).toBe('/?as=ana')
    expect(buildUrl(profile!, { handle: 'ana b/c' })).toBe('/u/ana%20b%2Fc')
    expect(buildUrl(profile!, { handle: 'ana' }, { as: undefined })).toBe('/u/ana')
    expect(matchRoute(table(), buildUrl(profile!, { handle: 'é?#' }))?.params).toEqual({ handle: 'é?#' })
  })

  test('a missing parameter throws', () => {
    const profile = table().routes[2]!
    expect(() => buildUrl(profile, {})).toThrow("melzin: route 'profile' (/u/:handle) needs the parameter 'handle'")
    expect(() => buildUrl(profile, { handle: '' })).toThrow('needs the parameter')
  })
})

describe('the URL input', () => {
  test('parseRouteRef', () => {
    expect(parseRouteRef(['user', 'name'])).toBeUndefined()
    expect(parseRouteRef(['route', 'name'])).toEqual({ ok: true, ref: { kind: 'name' } })
    expect(parseRouteRef(['route', 'params', 'handle'])).toEqual({ ok: true, ref: { kind: 'param', name: 'handle' } })
    expect(parseRouteRef(['route', 'query', 'as'])).toEqual({ ok: true, ref: { kind: 'query', name: 'as' } })
    const message = (segments: string[]) => {
      const result = parseRouteRef(segments)
      return result?.ok === false ? result.message : undefined
    }
    expect(message(['route'])).toBe("'route' is the URL input, an object; use route.name, route.params.<name> or route.query.<name>")
    expect(message(['route', 'params'])).toBe("'route.params' is an object; name one, such as route.params.handle")
    expect(message(['route', 'query'])).toBe("'route.query' is an object; name one, such as route.query.tab")
    expect(message(['route', 'param', 'x'])).toBe("unknown field 'route.param' (did you mean 'route.params'?); use route.name, route.params.<name> or route.query.<name>")
    expect(message(['route', 'name', 'x'])).toBe("'route.name' is a string and has no fields")
    expect(message(['route', 'query', 'a', 'b'])).toBe("'route.query.a' is a string and has no fields")
  })

  test('routeValue', () => {
    const route = { name: 'profile', params: { handle: 'ana' }, query: { as: 'bruno' } }
    expect(routeValue(route, { kind: 'name' })).toBe('profile')
    expect(routeValue(route, { kind: 'param', name: 'handle' })).toBe('ana')
    expect(routeValue(route, { kind: 'query', name: 'as' })).toBe('bruno')
    expect(routeValue(route, { kind: 'query', name: 'tab' })).toBeUndefined()
    expect(routeValue(route, { kind: 'param', name: 'constructor' })).toBeUndefined()
    expect(routeValue(undefined, { kind: 'name' })).toBeUndefined()
    expect(routeValue({}, { kind: 'param', name: 'x' })).toBeUndefined()
  })
})
