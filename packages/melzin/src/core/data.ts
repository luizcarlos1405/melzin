// Reading data the way the runtime renders it. The checker uses the same functions to work out what
// each snapshot shows, so both agree on paths, defaults and conditions.

import type { Condition } from './expr.ts'
import { type RouteInput, parseRouteRef, routeValue } from './routes.ts'
import { type MelzinSchema, defaultAt, hasField, isPlainObject } from './schema.ts'

/** Reads a path with hasField: getters and prototypes count, Object.prototype members (`constructor`) don't. */
export function valueAt(data: unknown, segments: readonly string[]): unknown {
  let node: unknown = data
  for (const segment of segments) {
    if (!isPlainObject(node) || !hasField(node, segment)) return undefined
    node = node[segment]
  }
  return node
}

/** The value at a path, or the field's schema default when the value is missing (undefined or null). */
export function valueOrDefault(schema: MelzinSchema | null | undefined, data: unknown, segments: readonly string[]): unknown {
  const value = valueAt(data, segments)
  return value === undefined || value === null ? defaultAt(schema, segments) : value
}

/**
 * What a path reads: `route.*` paths read the URL input (SPEC D27), every other path reads the data,
 * with the field's default when the value is missing.
 */
export function readPath(
  schema: MelzinSchema | null | undefined,
  data: unknown,
  route: RouteInput | null | undefined,
  segments: readonly string[],
): unknown {
  const ref = parseRouteRef(segments)
  if (ref !== undefined) return ref.ok ? routeValue(route, ref.ref) : undefined
  return valueOrDefault(schema, data, segments)
}

/**
 * Whether a condition holds: its value (or the default) is truthy, as in JavaScript. `false`, `""`,
 * `0` and missing values are false; `true`, other strings and numbers, and objects are true. A `!`
 * flips the result. Conditions on `route.*` test the URL input.
 */
export function conditionHolds(
  schema: MelzinSchema | null | undefined,
  data: unknown,
  condition: Condition,
  route?: RouteInput | null,
): boolean {
  return Boolean(readPath(schema, data, route, condition.path)) !== condition.negated
}
