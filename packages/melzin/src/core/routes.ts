// The route table (SPEC D21–D24) and the URL input views read as `route` (D27). Shared by the
// standalone host, the checker and the shell, so all three match and build URLs the same way.
//
// routes.json, at the project root:
//
//   {
//     "routes": {
//       "home": { "path": "/", "view": "home" },
//       "profile": { "path": "/u/:handle", "view": "profile", "query": { "as": {} }, "code": "lazy" }
//     }
//   }
//
// Paths use URLPattern syntax (D22), for now only its simplest part: literal segments and whole-segment
// `:name` parameters. Routes match in table order, case-sensitively, like URLPattern.

import { ROUTE_INPUT, isIdent } from './constants.ts'
import { type Issue, isPlainObject, joinPath, suggest } from './schema.ts'

export const CODE_POLICIES = ['eager', 'prefetch', 'lazy'] as const
export type CodePolicy = (typeof CODE_POLICIES)[number]
export const DATA_POLICIES = ['network-only', 'stale-while-revalidate'] as const
export type DataPolicy = (typeof DATA_POLICIES)[number]
export const DEFAULT_CODE_POLICY: CodePolicy = 'prefetch'
export const DEFAULT_DATA_POLICY: DataPolicy = 'stale-while-revalidate'

export type Route = {
  name: string
  /** As written in the table, such as `/u/:handle`. */
  path: string
  /** The view's name: its file name minus `.mel.html`. */
  view: string
  /** Parameter names, in path order. */
  params: string[]
  /** Declared query parameters, in table order. Others in the URL are ignored. */
  query: string[]
  code: CodePolicy
  data: DataPolicy
  description?: string
}

/** Routes in table order (the order they match in). */
export type RouteTable = { routes: Route[] }

/** What a view reads as `route`. Every part is optional, so a view previewed alone still renders. */
export type RouteInput = {
  name?: string
  params?: Record<string, string>
  query?: Record<string, string>
}

/** A URL matched to a route. `url` is the path plus the declared query parameters that are set. */
export type RouteMatch = {
  route: Route
  params: Record<string, string>
  query: Record<string, string>
  url: string
}

const TOP_LEVEL_KEYS = new Set(['routes', 'description'])
const ROUTE_KEYS = new Set(['path', 'view', 'query', 'code', 'data', 'description'])
const QUERY_KEYS = new Set(['description'])
const NAME_RULE = 'use letters, digits and _, not starting with a digit'
const RESERVED_NAME = '__proto__'
// What a literal path segment may contain: URL characters that need no escaping and mean nothing to
// URLPattern.
const LITERAL_SEGMENT_RE = /^[A-Za-z0-9._~!$&'@,;=-]+$/
const PATTERN_CHARACTERS: Readonly<Record<string, string>> = {
  '*': 'wildcards',
  '(': 'regular expression groups',
  ')': 'regular expression groups',
  '{': 'groups',
  '}': 'groups',
  '?': 'optional parts',
  '+': 'repeated parts',
  '\\': 'escapes',
  '%': 'percent-escapes',
}

function typeName(value: unknown): string {
  if (value === null) return 'null'
  if (Array.isArray(value)) return 'array'
  return typeof value
}

/** Problems with a path, or its parameter names. */
export function parseRoutePath(path: string): { ok: true; params: string[] } | { ok: false; message: string } {
  if (!path.startsWith('/')) return { ok: false, message: `a path starts with '/', such as '/${path}'` }
  if (path === '/') return { ok: true, params: [] }
  if (path.endsWith('/')) return { ok: false, message: `drop the trailing '/': '${path.replace(/\/+$/, '') || '/'}'` }
  const params: string[] = []
  for (const segment of path.slice(1).split('/')) {
    if (segment === '') return { ok: false, message: "a path can't have an empty segment ('//')" }
    if (segment.startsWith(':')) {
      const name = segment.slice(1)
      const special = [...name].find((ch) => Object.hasOwn(PATTERN_CHARACTERS, ch))
      if (special !== undefined) {
        return { ok: false, message: `'${segment}': ${PATTERN_CHARACTERS[special]} aren't supported yet; a parameter is a whole segment such as ':handle'` }
      }
      if (!isIdent(name) || name === RESERVED_NAME) return { ok: false, message: `'${segment}' isn't a valid parameter (${NAME_RULE})` }
      if (params.includes(name)) return { ok: false, message: `parameter ':${name}' appears twice` }
      params.push(name)
      continue
    }
    if (segment.includes(':')) {
      return { ok: false, message: `'${segment}': a parameter takes a whole segment for now, such as '/u/:handle'` }
    }
    const special = [...segment].find((ch) => Object.hasOwn(PATTERN_CHARACTERS, ch))
    if (special !== undefined) {
      return { ok: false, message: `'${special}' in '${segment}': ${PATTERN_CHARACTERS[special]} aren't supported yet; paths are literal segments and :name parameters` }
    }
    if (!LITERAL_SEGMENT_RE.test(segment)) {
      return { ok: false, message: `'${segment}' has characters a URL path would escape; use letters, digits, '-', '_', '.' and '~'` }
    }
  }
  return { ok: true, params }
}

function policy<T extends string>(value: unknown, allowed: readonly T[], fallback: T, path: string, key: string, issues: Issue[]): T {
  if (value === undefined) return fallback
  if (typeof value === 'string' && (allowed as readonly string[]).includes(value)) return value as T
  if (key === 'data' && value === 'offline') {
    issues.push({ message: "'offline' isn't supported yet (it needs the generated service worker); use 'stale-while-revalidate'", path })
    return fallback
  }
  const list = allowed.map((item) => `'${item}'`).join(', ')
  const hint = typeof value === 'string' ? suggest(value, allowed) : ''
  issues.push({ message: `'${key}' must be one of ${list}, got ${JSON.stringify(value)}${hint}`, path })
  return fallback
}

function checkKeys(node: Record<string, unknown>, allowed: Set<string>, path: string, issues: Issue[]): void {
  for (const key of Object.keys(node)) {
    if (!allowed.has(key)) issues.push({ message: `unknown key '${key}'${suggest(key, allowed)}`, path: joinPath(path, key) })
  }
}

function checkDescription(node: Record<string, unknown>, path: string, issues: Issue[]): string | undefined {
  if (!('description' in node)) return undefined
  if (typeof node.description === 'string') return node.description
  issues.push({ message: "'description' must be a string", path: joinPath(path, 'description') })
  return undefined
}

function validateRoute(name: string, value: unknown, path: string, issues: Issue[]): Route | null {
  if (!isPlainObject(value)) {
    issues.push({ message: `a route must be an object such as { "path": "/", "view": "home" }, got ${typeName(value)}`, path })
    return null
  }
  const before = issues.length
  checkKeys(value, ROUTE_KEYS, path, issues)
  const description = checkDescription(value, path, issues)
  let params: string[] = []
  if (typeof value.path !== 'string') {
    issues.push({ message: value.path === undefined ? "missing 'path', such as \"/u/:handle\"" : "'path' must be a string", path: value.path === undefined ? path : joinPath(path, 'path') })
  } else {
    const parsed = parseRoutePath(value.path)
    if (parsed.ok) params = parsed.params
    else issues.push({ message: parsed.message, path: joinPath(path, 'path') })
  }
  if (typeof value.view !== 'string') {
    issues.push({ message: value.view === undefined ? "missing 'view': the view's file name without .mel.html" : "'view' must be a string", path: value.view === undefined ? path : joinPath(path, 'view') })
  } else if (value.view.endsWith('.mel.html') || value.view.includes('/')) {
    issues.push({ message: `'view' is the view's name, such as "${value.view.replace(/^.*\//, '').replace(/\.mel\.html$/, '')}", without folders or .mel.html`, path: joinPath(path, 'view') })
  }
  const query: string[] = []
  if ('query' in value) {
    const queryPath = joinPath(path, 'query')
    if (!isPlainObject(value.query)) {
      issues.push({ message: `'query' must be an object mapping parameter names to {}, got ${typeName(value.query)}`, path: queryPath })
    } else {
      for (const [key, entry] of Object.entries(value.query)) {
        const entryPath = joinPath(queryPath, key)
        if (!isIdent(key) || key === RESERVED_NAME) {
          issues.push({ message: `'${key}' isn't a valid query parameter name (${NAME_RULE})`, path: entryPath })
        } else if (!isPlainObject(entry)) {
          issues.push({ message: `a query parameter must be an object such as {}, got ${typeName(entry)}`, path: entryPath })
        } else {
          checkKeys(entry, QUERY_KEYS, entryPath, issues)
          checkDescription(entry, entryPath, issues)
          if (params.includes(key)) issues.push({ message: `'${key}' is already a path parameter`, path: entryPath })
          query.push(key)
        }
      }
    }
  }
  const code = policy(value.code, CODE_POLICIES, DEFAULT_CODE_POLICY, joinPath(path, 'code'), 'code', issues)
  const data = policy(value.data, DATA_POLICIES, DEFAULT_DATA_POLICY, joinPath(path, 'data'), 'data', issues)
  if (issues.length > before) return null
  const route: Route = { name, path: value.path as string, view: value.view as string, params, query, code, data }
  if (description !== undefined) route.description = description
  return route
}

/** A path with every parameter replaced, so two paths that match the same URLs compare equal. */
function pathShape(path: string): string {
  return path.replace(/:[A-Za-z_][A-Za-z0-9_]*/g, ':')
}

/**
 * Checks a parsed routes.json. `table` is null when there are issues. Issue paths look like
 * `routes.profile.path`.
 */
export function validateRouteTable(value: unknown): { table: RouteTable | null; issues: Issue[] } {
  const issues: Issue[] = []
  if (!isPlainObject(value)) {
    issues.push({ message: `the route table must be a JSON object such as { "routes": { ... } }, got ${typeName(value)}` })
    return { table: null, issues }
  }
  checkKeys(value, TOP_LEVEL_KEYS, '', issues)
  checkDescription(value, '', issues)
  const routes: Route[] = []
  if (!isPlainObject(value.routes)) {
    issues.push({ message: value.routes === undefined ? "missing 'routes', an object mapping route names to routes" : `'routes' must be an object, got ${typeName(value.routes)}`, path: value.routes === undefined ? undefined : 'routes' })
  } else {
    const shapes = new Map<string, string>()
    for (const [name, entry] of Object.entries(value.routes)) {
      const path = joinPath('routes', name)
      if (!isIdent(name) || name === RESERVED_NAME) {
        issues.push({ message: `'${name}' isn't a valid route name (${NAME_RULE})`, path })
        continue
      }
      const route = validateRoute(name, entry, path, issues)
      if (route === null) continue
      const shape = pathShape(route.path)
      const earlier = shapes.get(shape)
      if (earlier !== undefined) {
        issues.push({ message: `route '${earlier}' already matches every URL this path does, so '${name}' would never show`, path: joinPath(path, 'path') })
        continue
      }
      shapes.set(shape, name)
      routes.push(route)
    }
  }
  return { table: issues.length === 0 ? { routes } : null, issues }
}

/** Decodes a percent-encoded segment; a malformed escape is kept as written. */
function decodeSegment(segment: string): string {
  try {
    return decodeURIComponent(segment)
  } catch {
    return segment
  }
}

/** The route's parameters for a pathname (as in `URL.pathname`), decoded, or null when it doesn't match. */
export function matchPath(route: Route, pathname: string): Record<string, string> | null {
  if (route.path === '/') return pathname === '/' ? {} : null
  const pattern = route.path.slice(1).split('/')
  const segments = pathname.startsWith('/') ? pathname.slice(1).split('/') : []
  if (segments.length !== pattern.length) return null
  const params: Record<string, string> = {}
  for (let i = 0; i < pattern.length; i++) {
    const expected = pattern[i]!
    const actual = segments[i]!
    if (expected.startsWith(':')) {
      if (actual === '') return null
      params[expected.slice(1)] = decodeSegment(actual)
    } else if (expected !== actual) {
      return null
    }
  }
  return params
}

function readQuery(route: Route, search: URLSearchParams): Record<string, string> {
  const query: Record<string, string> = {}
  for (const name of route.query) {
    const value = search.get(name)
    if (value !== null) query[name] = value
  }
  return query
}

/** The first route that matches the URL (a URL object, or a string resolved against `base`), or null. */
export function matchRoute(table: RouteTable, url: URL | string, base?: string): RouteMatch | null {
  let parsed: URL
  try {
    parsed = typeof url === 'string' ? new URL(url, base ?? 'http://localhost/') : url
  } catch {
    return null
  }
  for (const route of table.routes) {
    const params = matchPath(route, parsed.pathname)
    if (params === null) continue
    const query = readQuery(route, parsed.searchParams)
    return { route, params, query, url: buildUrl(route, params, query) }
  }
  return null
}

/**
 * The URL for a route: its path with the parameters encoded, plus the declared query parameters that
 * are set, in table order. Throws when a parameter is missing or empty.
 */
export function buildUrl(route: Route, params: Readonly<Record<string, unknown>> = {}, query: Readonly<Record<string, unknown>> = {}): string {
  const path = route.path === '/'
    ? '/'
    : '/' + route.path.slice(1).split('/').map((segment) => {
      if (!segment.startsWith(':')) return segment
      const name = segment.slice(1)
      const value = Object.hasOwn(params, name) ? params[name] : undefined
      if (value === undefined || value === null || String(value) === '') {
        throw new Error(`melzin: route '${route.name}' (${route.path}) needs the parameter '${name}'`)
      }
      return encodeURIComponent(String(value))
    }).join('/')
  const search = new URLSearchParams()
  for (const name of route.query) {
    const value = Object.hasOwn(query, name) ? query[name] : undefined
    if (value !== undefined && value !== null) search.set(name, String(value))
  }
  const text = search.toString()
  return text === '' ? path : `${path}?${text}`
}

export function findRoute(table: RouteTable, name: string): Route | undefined {
  return table.routes.find((route) => route.name === name)
}

/** The routes that show a view, in table order. */
export function routesForView(table: RouteTable, view: string): Route[] {
  return table.routes.filter((route) => route.view === view)
}

/** What a `route.*` path reads. */
export type RouteRef = { kind: 'name' } | { kind: 'param'; name: string } | { kind: 'query'; name: string }

/**
 * Reads a path that starts with `route`: `route.name`, `route.params.<name>` or `route.query.<name>`.
 * Undefined for paths that don't start with `route`.
 */
export function parseRouteRef(segments: readonly string[]): { ok: true; ref: RouteRef } | { ok: false; message: string } | undefined {
  if (segments[0] !== ROUTE_INPUT) return undefined
  const [, part, name, ...rest] = segments
  const usage = 'use route.name, route.params.<name> or route.query.<name>'
  if (part === undefined) return { ok: false, message: `'${ROUTE_INPUT}' is the URL input, an object; ${usage}` }
  if (part === 'name') {
    if (name !== undefined) return { ok: false, message: `'route.name' is a string and has no fields` }
    return { ok: true, ref: { kind: 'name' } }
  }
  if (part === 'params' || part === 'query') {
    if (name === undefined) return { ok: false, message: `'route.${part}' is an object; name one, such as route.${part}.${part === 'params' ? 'handle' : 'tab'}` }
    if (rest.length > 0) return { ok: false, message: `'route.${part}.${name}' is a string and has no fields` }
    return { ok: true, ref: part === 'params' ? { kind: 'param', name } : { kind: 'query', name } }
  }
  return { ok: false, message: `unknown field 'route.${part}'${suggest(part, ['name', 'params', 'query'], (best) => `route.${best}`)}; ${usage}` }
}

/** The string a route reference reads, or undefined when the input doesn't have it. */
export function routeValue(route: RouteInput | null | undefined, ref: RouteRef): string | undefined {
  if (route === null || route === undefined) return undefined
  const pick = (record: Record<string, string> | undefined, name: string): string | undefined => {
    if (!isPlainObject(record) || !Object.hasOwn(record, name)) return undefined
    const value = record[name]
    return typeof value === 'string' ? value : undefined
  }
  if (ref.kind === 'name') return typeof route.name === 'string' ? route.name : undefined
  return pick(ref.kind === 'param' ? route.params : route.query, ref.name)
}

/** `route.params.handle` and the like, for messages. */
export function describeRouteRef(ref: RouteRef): string {
  return ref.kind === 'name' ? 'route.name' : `route.${ref.kind === 'param' ? 'params' : 'query'}.${ref.name}`
}

/**
 * Checks a snapshot's `route` (`{ "params": { ... }, "query": { ... } }`, string values). Issue paths
 * are relative to `path`.
 */
export function validateRouteInput(value: unknown, path: string): { route: RouteInput | null; issues: Issue[] } {
  const issues: Issue[] = []
  if (!isPlainObject(value)) {
    issues.push({ message: `'route' must be an object such as { "params": { "handle": "ana" } }, got ${typeName(value)}`, path })
    return { route: null, issues }
  }
  const route: RouteInput = {}
  for (const [key, entry] of Object.entries(value)) {
    const entryPath = joinPath(path, key)
    if (key === 'name') {
      issues.push({ message: "a snapshot doesn't set the route's name; the shell takes it from the route it previews", path: entryPath })
      continue
    }
    if (key !== 'params' && key !== 'query') {
      issues.push({ message: `unknown key '${key}'${suggest(key, ['params', 'query'])}; a snapshot's route has 'params' and 'query'`, path: entryPath })
      continue
    }
    if (!isPlainObject(entry)) {
      issues.push({ message: `'${key}' must be an object of strings, got ${typeName(entry)}`, path: entryPath })
      continue
    }
    const record: Record<string, string> = {}
    for (const [name, item] of Object.entries(entry)) {
      if (typeof item !== 'string') {
        issues.push({ message: `expected a string, got ${typeName(item)} (URL values are always strings)`, path: joinPath(entryPath, name) })
        continue
      }
      Object.defineProperty(record, name, { value: item, enumerable: true, writable: true, configurable: true })
    }
    route[key] = record
  }
  return { route: issues.length === 0 ? route : null, issues }
}
