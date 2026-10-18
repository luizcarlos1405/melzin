// Event payloads (SPEC D35): objects of named fields an emit fills from paths into the row's item, the
// data or the URL. The checker matches each emit against its event's payload (D15) and the runtime
// builds the payload from current values, both with the rules here.

import { readPath } from './data.ts'
import type { EmitPayload } from './expr.ts'
import { type RouteInput, parseRouteRef } from './routes.ts'
import { type LeafType, type MelzinSchema, type Scope, lengthMessage, resolveField, suggest } from './schema.ts'

/** What a payload value's path reads: a leaf's type, and whether it's always there. A link field is a string. */
export type ResolvedValue = { ok: true; type: LeafType; required: boolean } | { ok: false; message: string }

/** A problem with an emit's payload. `offset` is into the m-on:click value. */
export type PayloadIssue = { message: string; offset: number }

/**
 * Resolves the path of a payload value: a string, number or boolean field (`option.id`, with the
 * alias in `scope`), or the URL input. A route's name and parameters are always there; query
 * parameters may be left out of the URL. A field with a default is always there too.
 */
export function resolvePayloadValue(schema: MelzinSchema | null | undefined, segments: readonly string[], scope?: Scope): ResolvedValue {
  const ref = parseRouteRef(segments)
  if (ref !== undefined) return ref.ok ? { ok: true, type: 'string', required: ref.ref.kind !== 'query' } : ref
  const resolved = resolveField(schema, segments, scope)
  if (!resolved.ok) return resolved
  const name = segments.join('.')
  if (resolved.length !== undefined) return { ok: false, message: lengthMessage(name) }
  const { field } = resolved
  if (field.type === 'object' || field.type === 'array') {
    const what = field.type === 'object' ? 'an object' : 'a list'
    return { ok: false, message: `'${name}' is ${what}; a payload field takes a string, number or boolean, such as its id` }
  }
  return { ok: true, type: field.type, required: resolved.required || field.default !== undefined }
}

/** `'a'`, `'a' and 'b'`, `'a', 'b' and 'c'`. */
function names(list: readonly string[]): string {
  const quoted = list.map((name) => `'${name}'`)
  return quoted.length <= 1 ? quoted.join('') : `${quoted.slice(0, -1).join(', ')} and ${quoted.at(-1)}`
}

/**
 * Checks an emit against its event's declared payload (D15): a payload is passed exactly when the event
 * declares one, every required field is set, no field is unknown, and each value reads a leaf of the
 * field's type that is always there when the field is required. `offset` is where the event name
 * starts, for a payload that's missing. An undeclared event has no issues here; it's reported alone.
 */
export function payloadIssues(
  schema: MelzinSchema | null | undefined,
  event: string,
  payload: EmitPayload | undefined,
  offset: number,
  scope?: Scope,
): PayloadIssue[] {
  const events = schema?.events ?? {}
  if (!Object.hasOwn(events, event)) return []
  const declared = events[event]!.payload
  if (declared === undefined) {
    if (payload === undefined) return []
    return [{ message: `event '${event}' has no payload; send emit('${event}'), or declare its payload in the schema's events`, offset: payload.start }]
  }
  const fields = Object.keys(declared.properties)
  const required = declared.required ?? []
  if (payload === undefined) {
    const shown = required.length > 0 ? required : fields.slice(0, 1)
    const example = shown.map((name) => `${name}: ...`).join(', ')
    return [{ message: `event '${event}' has a payload; send it: emit('${event}', { ${example} })`, offset }]
  }
  const issues: PayloadIssue[] = []
  for (const field of payload.fields) {
    const expected = Object.hasOwn(declared.properties, field.name) ? declared.properties[field.name]! : undefined
    if (expected === undefined) {
      issues.push({ message: `'${field.name}' isn't a field of the payload of '${event}'${suggest(field.name, fields)}`, offset: field.nameStart })
      continue
    }
    const value = resolvePayloadValue(schema, field.path, scope)
    const path = field.path.join('.')
    if (!value.ok) {
      issues.push({ message: value.message, offset: field.pathStart })
    } else if (value.type !== expected.type) {
      issues.push({ message: `'${path}' is a ${value.type}, but the payload's '${field.name}' is a ${expected.type}`, offset: field.pathStart })
    } else if (!value.required && required.includes(field.name)) {
      issues.push({ message: `'${path}' may be missing, but the payload requires '${field.name}'`, offset: field.pathStart })
    }
  }
  const missing = required.filter((name) => !payload.fields.some((field) => field.name === name))
  if (missing.length > 0) issues.push({ message: `the payload of '${event}' needs ${names(missing)}`, offset: payload.start })
  return issues
}

/**
 * The object an emit sends: each field's current value, read like m-text reads it (the row's item
 * through the alias in `scope`, defaults for missing values). Fields whose value is missing, or isn't a
 * string, number or boolean, are left out. Names are always own keys, whatever they are.
 */
export function buildPayload(
  schema: MelzinSchema | null | undefined,
  data: unknown,
  route: RouteInput | null | undefined,
  payload: EmitPayload,
  scope?: Scope,
): Record<string, string | number | boolean> {
  const result: Record<string, string | number | boolean> = {}
  for (const field of payload.fields) {
    const value = readPath(schema, data, route, field.path, scope)
    if (typeof value !== 'string' && typeof value !== 'number' && typeof value !== 'boolean') continue
    Object.defineProperty(result, field.name, { value, enumerable: true, writable: true, configurable: true })
  }
  return result
}
