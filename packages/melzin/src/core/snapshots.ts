// Snapshots: named states inside the view file (P4). A snapshot can extend another one and list only
// what differs (SPEC D30), merged the way JSON Merge Patch (RFC 7396) merges a patch into a document.

import { type RouteInput, validateRouteInput } from './routes.ts'
import { type Issue, type MelzinSchema, isPlainObject, joinPath, suggest, validateData } from './schema.ts'

/**
 * `route` is the URL input the snapshot shows the view with (SPEC D27): its params and query.
 * `extends` names the snapshot it builds on (D30), when the block has one by that name.
 */
export type Snapshot = { name: string; data: Record<string, unknown>; route?: RouteInput; extends?: string }

export type ParseSnapshotsOptions = {
  /** Check each snapshot's data against the schema (default true). Turn off when the schema is invalid. */
  validateData?: boolean
}

/** The keys of a snapshot. */
const SNAPSHOT_KEYS: readonly string[] = ['data', 'route', 'extends']

/** Sets an own property, even one named `__proto__`, which plain assignment would treat as the prototype. */
function define(object: Record<string, unknown>, key: string, value: unknown): void {
  Object.defineProperty(object, key, { value, enumerable: true, writable: true, configurable: true })
}

/** A deep copy of a JSON value. */
function clone(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(clone)
  if (!isPlainObject(value)) return value
  const copy: Record<string, unknown> = {}
  for (const [key, child] of Object.entries(value)) define(copy, key, clone(child))
  return copy
}

/**
 * JSON Merge Patch (RFC 7396): an object patch merges into the target key by key, `null` removes a
 * key, and any other value (a string, a number, a list) replaces the target whole. Returns a new value;
 * neither argument changes.
 */
export function mergePatch(target: unknown, patch: unknown): unknown {
  if (!isPlainObject(patch)) return clone(patch)
  const result: Record<string, unknown> = {}
  if (isPlainObject(target)) for (const [key, value] of Object.entries(target)) define(result, key, clone(value))
  for (const [key, value] of Object.entries(patch)) {
    if (value === null) delete result[key]
    else define(result, key, mergePatch(Object.hasOwn(result, key) ? result[key] : undefined, value))
  }
  return result
}

/**
 * What a snapshot sets itself, as opposed to what it inherits from the snapshot it extends (D30), for
 * paths into it in joinPath form, such as `data.user.name` or `route.params.handle`.
 */
export type SnapshotOwnPaths = {
  /** The snapshot has a value at the path, or replaces or removes one on the way to it. */
  sets(path: string): boolean
  /** The snapshot's value at the path is `null`: it removes what it would inherit. */
  removes(path: string): boolean
}

export function snapshotOwnPaths(entry: unknown): SnapshotOwnPaths {
  const present = new Set<string>()
  const nulls = new Set<string>()
  // Values that replace or remove whatever the base had below them.
  const whole: string[] = []
  const walk = (value: Record<string, unknown>, path: string): void => {
    for (const [key, child] of Object.entries(value)) {
      if (path === '' && key === 'extends') continue
      const childPath = joinPath(path, key)
      present.add(childPath)
      if (isPlainObject(child)) {
        walk(child, childPath)
        continue
      }
      whole.push(childPath)
      if (child === null) nulls.add(childPath)
    }
  }
  if (isPlainObject(entry)) walk(entry, '')
  return {
    sets: (path) => present.has(path) || whole.some((prefix) => path.startsWith(`${prefix}.`) || path.startsWith(`${prefix}[`)),
    removes: (path) => nulls.has(path),
  }
}

/** `snapshots["a few clicks"]`, the start of every issue path about that snapshot. */
function snapshotPath(name: string): string {
  return `snapshots[${JSON.stringify(name)}]`
}

/** A snapshot with what it extends merged in (D30). `complete` is false when its chain is broken. */
type Resolved = { body: Record<string, unknown>; base?: string; complete: boolean }

/**
 * Reads a parsed snapshots block: `{ "<name>": { "data": { ... } } }`, order preserved. A missing
 * `data` means `{}`. A snapshot with `"extends": "<name>"` starts from that snapshot (resolved first)
 * and merges its own `data` and `route` into it (D30, see mergePatch). Each snapshot is checked once
 * resolved; a problem it shares with its base, in a value it inherits, is only reported at the base.
 *
 * Snapshots whose data has issues are still returned, so a preview can show them; entries that aren't
 * objects are dropped. Issue paths look like `snapshots["a few clicks"].data.count`. `schema` null means
 * a view without a schema block (only `{}` is valid data).
 */
export function parseSnapshots(
  value: unknown,
  schema: MelzinSchema | null | undefined,
  options: ParseSnapshotsOptions = {},
): { snapshots: Snapshot[]; issues: Issue[] } {
  const snapshots: Snapshot[] = []
  if (!isPlainObject(value)) {
    return {
      snapshots,
      issues: [{ message: 'snapshots must be a JSON object mapping names to { "data": { ... } }', path: 'snapshots' }],
    }
  }
  // Issues are reported snapshot by snapshot, in the block's order.
  const byName = new Map<string, Issue[]>()
  const report = (name: string, issue: Issue): void => {
    const list = byName.get(name)
    if (list === undefined) byName.set(name, [issue])
    else list.push(issue)
  }

  const entries = new Map<string, Record<string, unknown>>()
  for (const [name, entry] of Object.entries(value)) {
    const path = snapshotPath(name)
    if (name.trim() === '') report(name, { message: "a snapshot name can't be empty", path })
    if (!isPlainObject(entry)) {
      report(name, { message: 'a snapshot must be an object such as { "data": { ... } }', path })
      continue
    }
    for (const key of Object.keys(entry)) {
      if (SNAPSHOT_KEYS.includes(key)) continue
      report(name, {
        message:
          key === 'ui'
            ? "internal state (ui) isn't supported yet; put the whole state in 'data'"
            : `unknown key '${key}'; a snapshot has 'data', 'route' for the URL and 'extends' for the snapshot it builds on`,
        path: joinPath(path, key),
      })
    }
    entries.set(name, entry)
  }

  const resolved = new Map<string, Resolved>()
  // The snapshots being resolved, innermost last, to catch a chain that comes back on itself.
  const chain: string[] = []
  const resolve = (name: string): Resolved => {
    const done = resolved.get(name)
    if (done !== undefined) return done
    const entry = entries.get(name)!
    const own: Record<string, unknown> = {}
    for (const [key, item] of Object.entries(entry)) if (key !== 'extends') define(own, key, item)
    const base = entry.extends
    const at = joinPath(snapshotPath(name), 'extends')
    const alone = (): Resolved => ({ body: mergePatch({}, own) as Record<string, unknown>, complete: false })
    let result: Resolved
    if (base === undefined) {
      result = { body: mergePatch({}, own) as Record<string, unknown>, complete: true }
    } else if (typeof base !== 'string' || base.trim() === '') {
      report(name, { message: `'extends' names the snapshot this one builds on, such as "extends": "typical"`, path: at })
      result = alone()
    } else if (base === name) {
      report(name, { message: "a snapshot can't extend itself", path: at })
      result = alone()
    } else if (!entries.has(base)) {
      const others = [...entries.keys()].filter((other) => other !== name)
      report(name, { message: `there's no snapshot named '${base}' to extend${suggest(base, others)}`, path: at })
      result = alone()
    } else if (chain.includes(base)) {
      const cycle = [...chain.slice(chain.indexOf(base)), name, base].map((item) => `'${item}'`).join(' → ')
      report(name, { message: `these snapshots extend each other in a cycle: ${cycle}`, path: at })
      result = alone()
    } else {
      chain.push(name)
      const parent = resolve(base)
      chain.pop()
      result = { body: mergePatch(parent.body, own) as Record<string, unknown>, base, complete: parent.complete }
    }
    resolved.set(name, result)
    return result
  }

  // Each resolved snapshot checked on its own, with issue paths relative to it (`data.count`).
  type Checked = { data: Record<string, unknown> | null; route?: RouteInput; issues: Issue[] }
  const checked = new Map<string, Checked>()
  const check = (name: string): Checked => {
    const done = checked.get(name)
    if (done !== undefined) return done
    const { body, complete } = resolve(name)
    const result: Checked = { data: null, issues: [] }
    if (body.route !== undefined) {
      const route = validateRouteInput(body.route, 'route')
      result.issues.push(...route.issues)
      if (route.route !== null) result.route = route.route
    }
    const data = body.data === undefined ? {} : body.data
    if (!isPlainObject(data)) {
      result.issues.push({ message: "a snapshot's 'data' must be an object", path: 'data' })
    } else {
      result.data = data
      // A broken chain leaves the data incomplete; the chain's own error says why.
      if (options.validateData !== false && complete) {
        for (const issue of validateData(schema, data)) {
          result.issues.push({ message: issue.message, path: issue.path === undefined ? 'data' : `data${issue.path.startsWith('[') ? '' : '.'}${issue.path}` })
        }
      }
    }
    checked.set(name, result)
    return result
  }

  for (const [name, entry] of entries) {
    const { base } = resolve(name)
    const { data, route, issues } = check(name)
    const path = snapshotPath(name)
    const own = snapshotOwnPaths(entry)
    // A problem the base has too, in a value this snapshot inherits, is the base's to report.
    const inherited = base === undefined ? [] : check(base).issues
    for (const issue of issues) {
      const relative = issue.path ?? ''
      if (!own.sets(relative) && inherited.some((other) => other.path === issue.path && other.message === issue.message)) continue
      const message = own.removes(relative) ? "the schema requires this field, so null can't remove it" : issue.message
      report(name, { message, path: relative === '' ? path : `${path}.${relative}` })
    }
    if (data === null) continue
    const snapshot: Snapshot = { name, data }
    if (route !== undefined) snapshot.route = route
    if (base !== undefined) snapshot.extends = base
    snapshots.push(snapshot)
  }
  const issues = Object.keys(value).flatMap((name) => byName.get(name) ?? [])
  return { snapshots, issues }
}
