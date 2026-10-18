// Event payloads (SPEC D35): objects of named fields an emit fills from paths into the row's item, the
// data or the URL. The checker matches each emit against its event's payload (D15) and the runtime
// builds the payload from current values, both with the rules here.

import { isIdent } from './constants.ts'
import { readPath } from './data.ts'
import {
  type EmitPayload,
  FIELD_PLACEHOLDER,
  PATH_PLACEHOLDER,
  type PayloadFix,
  defaultPayloadFixFields,
  fieldNameFor,
  fieldNameFromText,
  payloadFixText,
} from './expr.ts'
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

/** For a payload sent with an event that declares none. */
function noPayloadMessage(event: string): string {
  return `event '${event}' has no payload; send emit('${event}'), or declare its payload in the schema's events`
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
  if (declared === undefined) return payload === undefined ? [] : [{ message: noPayloadMessage(event), offset: payload.start }]
  const fields = Object.keys(declared.properties)
  const required = declared.required ?? []
  if (payload === undefined) {
    const shown = required.length > 0 ? required : fields.slice(0, 1)
    const example = shown.length === 0 ? '{}' : `{ ${shown.map((name) => `${name}: ...`).join(', ')} }`
    return [{ message: `event '${event}' has a payload; send it: emit('${event}', ${example})`, offset }]
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

/**
 * A path that could fill the payload field `name` (of `type`, when declared), for the fix of a payload
 * that doesn't parse: an item field of that name in the rows in scope (innermost first), a string or
 * number item named like it, a data field of that name, or else the innermost row's key (`option.id`)
 * or item. Only paths that resolve to a leaf of the field's type count; undefined when none does.
 */
function pathFor(schema: MelzinSchema | null | undefined, name: string, type: LeafType | undefined, scope: Scope | undefined): string | undefined {
  const rows = [...(scope ?? [])].reverse()
  const candidates: string[][] = []
  for (const [alias, entry] of rows) {
    const { items } = entry.list
    if (items.type === 'object' ? Object.hasOwn(items.properties, name) : alias === name) candidates.push(items.type === 'object' ? [alias, name] : [alias])
  }
  candidates.push([name])
  const innermost = rows[0]
  if (innermost !== undefined) {
    const [alias, entry] = innermost
    if (entry.list.items.type !== 'object') candidates.push([alias])
    else if (entry.list.key !== undefined) candidates.push([alias, entry.list.key])
  }
  const fits = candidates.find((path) => {
    const value = resolvePayloadValue(schema, path, scope)
    return value.ok && (type === undefined || value.type === type)
  })
  return fits?.join('.')
}

/**
 * The message for a payload written in a form emit doesn't take (see PayloadFix), with the fix in the
 * event's own terms: its declared fields, filled from the rows in scope. In a row of `notification in
 * notifications`, `emit('markRead', $event)` gets `emit('markRead', { notificationId: notification.id })`.
 * The checker and the runtime both write the message with this; without a declared payload to go by,
 * it's the parse error's own message.
 */
export function payloadFixMessage(schema: MelzinSchema | null | undefined, fix: PayloadFix, scope?: Scope): string {
  const events = schema?.events ?? {}
  const event = Object.hasOwn(events, fix.event) ? events[fix.event]! : undefined
  if (event !== undefined && event.payload === undefined) return noPayloadMessage(fix.event)
  const declared = event?.payload
  if (declared === undefined) return payloadFixText(fix, defaultPayloadFixFields(fix))
  const fields = Object.keys(declared.properties)
  const required = declared.required ?? []
  const typeOf = (name: string): LeafType | undefined => (Object.hasOwn(declared.properties, name) ? declared.properties[name]!.type : undefined)
  const fill = (name: string): string => pathFor(schema, name, typeOf(name), scope) ?? PATH_PLACEHOLDER
  // The one field a single value goes in: the only field, the only required one, or the one it's named after.
  const only = fields.length === 1 ? fields[0] : required.length === 1 ? required[0] : undefined
  if (fix.kind === 'positional') {
    if (fix.path === undefined || fix.path.length === 0) {
      const shown = required.length > 0 ? required : fields.slice(0, 1)
      return payloadFixText(fix, shown.map((name) => [name, fill(name)]))
    }
    const guess = fieldNameFor(fix.path)
    const named = [fix.path.at(-1)!, guess].find((name) => fields.includes(name))
    return payloadFixText(fix, [[only ?? named ?? guess, fix.path.join('.')]])
  }
  if (fix.kind === 'shorthand') {
    const name = fix.name ?? only ?? FIELD_PLACEHOLDER
    // `{ filter }` is `{ filter: filter }` when there's a filter to read.
    const itself = isIdent(name) && resolvePayloadValue(schema, [name], scope).ok
    return payloadFixText(fix, [[name, itself ? name : fill(name)]])
  }
  const name = fieldNameFromText(fix.name ?? '') ?? only ?? FIELD_PLACEHOLDER
  return payloadFixText(fix, [[name, fix.path?.join('.') ?? (name === FIELD_PLACEHOLDER ? PATH_PLACEHOLDER : fill(name))]])
}
