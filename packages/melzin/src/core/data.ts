// Reading data the way the runtime renders it. The checker uses the same functions to work out what
// each snapshot shows, so both agree on paths, defaults, conditions and the rows of lists.

import type { Condition } from './expr.ts'
import { type RouteInput, parseRouteRef, routeValue } from './routes.ts'
import { LIST_ITEMS, type MelzinSchema, type Scope, defaultAt, hasField, indexPath, isPlainObject, joinPath } from './schema.ts'

/**
 * Reads a path with hasField: getters and prototypes count, Object.prototype members (`constructor`)
 * don't. With a scope, a path that starts with an m-for alias reads that row's item (`member.name`). A
 * list's `length` is its number of items (`members.length`), for conditions.
 */
export function valueAt(data: unknown, segments: readonly string[], scope?: Scope): unknown {
  const entry = segments.length === 0 || scope === undefined ? undefined : scope.get(segments[0]!)
  let node: unknown = entry === undefined ? data : entry.item
  for (let i = entry === undefined ? 0 : 1; i < segments.length; i++) {
    const segment = segments[i]!
    if (Array.isArray(node) && segment === 'length') {
      node = node.length
      continue
    }
    if (!isPlainObject(node) || !hasField(node, segment)) return undefined
    node = node[segment]
  }
  return node
}

/** The value at a path, or the field's schema default when the value is missing (undefined or null). */
export function valueOrDefault(
  schema: MelzinSchema | null | undefined,
  data: unknown,
  segments: readonly string[],
  scope?: Scope,
): unknown {
  const value = valueAt(data, segments, scope)
  return value === undefined || value === null ? defaultAt(schema, segments, scope) : value
}

/**
 * What a path reads: `route.*` paths read the URL input (SPEC D27), paths that start with an m-for
 * alias read the row's item, and every other path reads the data, with the field's default when the
 * value is missing.
 */
export function readPath(
  schema: MelzinSchema | null | undefined,
  data: unknown,
  route: RouteInput | null | undefined,
  segments: readonly string[],
  scope?: Scope,
): unknown {
  const ref = parseRouteRef(segments)
  if (ref !== undefined) return ref.ok ? routeValue(route, ref.ref) : undefined
  return valueOrDefault(schema, data, segments, scope)
}

/**
 * Whether a condition holds: its value (or the default) is truthy, as in JavaScript. `false`, `""`,
 * `0` and missing values are false; `true`, other strings and numbers, objects and lists (even empty
 * ones: test `members.length`) are true. A `!` flips the result. Conditions on `route.*` test the URL
 * input, and those in a row can test its item through the alias in `scope`.
 */
export function conditionHolds(
  schema: MelzinSchema | null | undefined,
  data: unknown,
  condition: Condition,
  route?: RouteInput | null,
  scope?: Scope,
): boolean {
  return Boolean(readPath(schema, data, route, condition.path, scope)) !== condition.negated
}

/** A value found by valuesAt, with its path into the data such as `members[1].url`. */
export type FoundValue = { path: string; value: unknown }

/**
 * Every value a field path (see LIST_ITEMS) reaches in the data, one per item of each list on the way:
 * ['members', '[]', 'url'] finds each member's url, at `members[0].url`, `members[1].url`... Fields the
 * data doesn't have are left out; values that aren't lists where the path expects one have no items.
 */
export function valuesAt(data: unknown, path: readonly string[]): FoundValue[] {
  let found: FoundValue[] = [{ path: '', value: data }]
  for (const segment of path) {
    const next: FoundValue[] = []
    for (const { path: at, value } of found) {
      if (segment === LIST_ITEMS) {
        if (Array.isArray(value)) for (let i = 0; i < value.length; i++) next.push({ path: indexPath(at, i), value: value[i] })
      } else if (isPlainObject(value) && hasField(value, segment)) {
        next.push({ path: joinPath(at, segment), value: value[segment] })
      }
    }
    found = next
  }
  return found
}
