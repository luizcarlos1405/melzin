// Schema v0: a strict subset of JSON Schema for `data`, plus declared events (POC.md §3).

import { isIdent } from './constants.ts'

export type LeafType = 'string' | 'number' | 'boolean'
export type LeafSchema = { type: LeafType; default?: string | number | boolean; description?: string }
export type ObjectSchema = {
  type: 'object'
  properties: Record<string, FieldSchema>
  required?: string[]
  description?: string
}
export type FieldSchema = LeafSchema | ObjectSchema
export type EventSchema = { description?: string }
export type MelzinSchema = { data?: ObjectSchema; events?: Record<string, EventSchema> }

/** `path` is a JSON path into the checked value, such as `data.properties.user` or `user.name`. */
export type Issue = { message: string; path?: string }

export type ResolvedPath =
  | { ok: true; type: LeafType; default?: string | number | boolean }
  | { ok: false; message: string }

const LEAF_TYPES: readonly string[] = ['string', 'number', 'boolean']
const LEAF_KEYS = new Set(['type', 'default', 'description'])
const OBJECT_KEYS = new Set(['type', 'properties', 'required', 'description'])
const TOP_LEVEL_KEYS = new Set(['data', 'events', 'description'])
const EVENT_KEYS = new Set(['description'])

const LISTS_MESSAGE = "lists aren't supported yet; use a fixed number of fields such as first, second, third"
const NAME_RULE = 'use letters, digits and _, not starting with a digit'
// Assigning it to a plain object would set the object's prototype instead of adding a key.
const RESERVED_NAME = '__proto__'

export function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

/**
 * Whether `object` has `key` as its own property or through its prototype chain, stopping before
 * Object.prototype: getters on a class instance count, `toString` or `constructor` don't. The runtime
 * reads data and handlers with this rule, and validateData checks data with it.
 */
export function hasField(object: object, key: string): boolean {
  for (let node: object | null = object; node !== null && node !== Object.prototype; node = Object.getPrototypeOf(node)) {
    if (Object.hasOwn(node, key)) return true
  }
  return false
}

/** Appends a key to a JSON path: `a.b` for identifiers, `a["b c"]` otherwise. */
export function joinPath(base: string, key: string): string {
  if (isIdent(key)) return base === '' ? key : `${base}.${key}`
  return `${base}[${JSON.stringify(key)}]`
}

function at(path: string): string | undefined {
  return path === '' ? undefined : path
}

function typeName(value: unknown): string {
  if (value === null) return 'null'
  if (Array.isArray(value)) return 'array'
  return typeof value
}

// Optimal string alignment distance: Levenshtein plus adjacent transpositions ('cuont' → 'count').
function editDistance(a: string, b: string): number {
  const d: number[][] = Array.from({ length: a.length + 1 }, (_, i) =>
    Array.from({ length: b.length + 1 }, (_, j) => (i === 0 ? j : j === 0 ? i : 0)),
  )
  const cell = (i: number, j: number): number => d[i]![j]!
  for (let i = 1; i <= a.length; i++) {
    for (let j = 1; j <= b.length; j++) {
      const cost = a[i - 1] === b[j - 1] ? 0 : 1
      let best = Math.min(cell(i - 1, j) + 1, cell(i, j - 1) + 1, cell(i - 1, j - 1) + cost)
      if (i > 1 && j > 1 && a[i - 1] === b[j - 2] && a[i - 2] === b[j - 1]) best = Math.min(best, cell(i - 2, j - 2) + 1)
      d[i]![j] = best
    }
  }
  return cell(a.length, b.length)
}

/** ` (did you mean 'name'?)` when a candidate is close enough, else ''. */
export function suggest(name: string, candidates: Iterable<string>, display: (best: string) => string = (best) => best): string {
  let best: string | undefined
  let bestDistance = Infinity
  for (const candidate of candidates) {
    const distance = editDistance(name.toLowerCase(), candidate.toLowerCase())
    if (distance < bestDistance) {
      best = candidate
      bestDistance = distance
    }
  }
  const limit = Math.max(1, Math.floor(name.length / 3))
  return best !== undefined && bestDistance <= limit ? ` (did you mean '${display(best)}'?)` : ''
}

function checkDescription(node: Record<string, unknown>, path: string, issues: Issue[]): void {
  if ('description' in node && typeof node.description !== 'string') {
    issues.push({ message: "'description' must be a string", path: joinPath(path, 'description') })
  }
}

function checkUnknownKeys(
  node: Record<string, unknown>,
  allowed: Set<string>,
  path: string,
  issues: Issue[],
  special: (key: string) => string | undefined = () => undefined,
): void {
  for (const key of Object.keys(node)) {
    if (allowed.has(key)) continue
    issues.push({
      message: special(key) ?? `unknown keyword '${key}'${suggest(key, allowed)}`,
      path: joinPath(path, key),
    })
  }
}

function validateField(value: unknown, path: string, issues: Issue[]): FieldSchema | null {
  if (!isPlainObject(value)) {
    issues.push({ message: `a field schema must be an object, got ${typeName(value)}`, path: at(path) })
    return null
  }
  const type = value.type
  if (type === undefined) {
    issues.push({ message: "missing 'type' (string, number, boolean or object)", path: at(path) })
    return null
  }
  if (type === 'array' || 'items' in value) {
    issues.push({ message: LISTS_MESSAGE, path: at(path) })
    return null
  }
  if (type === 'object') return validateObject(value, path, issues)
  if (typeof type !== 'string' || !LEAF_TYPES.includes(type)) {
    const hint = type === 'integer' ? " (use 'number')" : ''
    issues.push({
      message: `unsupported type ${JSON.stringify(type)}${hint}; use string, number, boolean or object`,
      path: joinPath(path, 'type'),
    })
    return null
  }
  const before = issues.length
  checkUnknownKeys(value, LEAF_KEYS, path, issues)
  checkDescription(value, path, issues)
  const leaf: LeafSchema = { type: type as LeafType }
  if ('default' in value) {
    const fallback = value.default
    const matches = typeof fallback === type && (type !== 'number' || Number.isFinite(fallback))
    if (!matches) {
      issues.push({ message: `default must be a ${type}, got ${typeName(fallback)}`, path: joinPath(path, 'default') })
    } else {
      leaf.default = fallback as string | number | boolean
    }
  }
  if (typeof value.description === 'string') leaf.description = value.description
  return issues.length === before ? leaf : null
}

function validateObject(value: Record<string, unknown>, path: string, issues: Issue[]): ObjectSchema | null {
  const before = issues.length
  checkUnknownKeys(value, OBJECT_KEYS, path, issues, (key) =>
    key === 'default' ? "'default' is only allowed on string, number and boolean fields" : undefined,
  )
  checkDescription(value, path, issues)
  const properties: Record<string, FieldSchema> = {}
  const rawProperties = value.properties
  if (rawProperties === undefined) {
    issues.push({ message: "an object schema needs 'properties' (use {} for none)", path: at(path) })
  } else if (!isPlainObject(rawProperties)) {
    issues.push({ message: `'properties' must be an object, got ${typeName(rawProperties)}`, path: joinPath(path, 'properties') })
  } else {
    for (const [name, field] of Object.entries(rawProperties)) {
      const fieldPath = joinPath(joinPath(path, 'properties'), name)
      if (!isIdent(name) || name === RESERVED_NAME) {
        const rule = name === RESERVED_NAME ? "it's reserved" : NAME_RULE
        issues.push({ message: `'${name}' isn't a valid field name (${rule})`, path: fieldPath })
        continue
      }
      const schema = validateField(field, fieldPath, issues)
      if (schema !== null) properties[name] = schema
    }
  }
  const result: ObjectSchema = { type: 'object', properties }
  if ('required' in value) {
    const required = value.required
    const requiredPath = joinPath(path, 'required')
    if (!Array.isArray(required) || !required.every((entry) => typeof entry === 'string')) {
      issues.push({ message: "'required' must be an array of field names", path: requiredPath })
    } else {
      const seen = new Set<string>()
      required.forEach((name, index) => {
        const entryPath = `${requiredPath}[${index}]`
        if (seen.has(name)) issues.push({ message: `'${name}' is listed twice in required`, path: entryPath })
        seen.add(name)
        if (isPlainObject(rawProperties) && !Object.hasOwn(rawProperties, name)) {
          const hint = suggest(name, Object.keys(rawProperties))
          issues.push({ message: `required field '${name}' isn't in properties${hint}`, path: entryPath })
        }
      })
      result.required = [...seen]
    }
  }
  if (typeof value.description === 'string') result.description = value.description
  return issues.length === before ? result : null
}

function validateEvents(value: unknown, issues: Issue[]): Record<string, EventSchema> | null {
  if (!isPlainObject(value)) {
    issues.push({ message: `'events' must be an object mapping event names to {}, got ${typeName(value)}`, path: 'events' })
    return null
  }
  const before = issues.length
  const events: Record<string, EventSchema> = {}
  for (const [name, event] of Object.entries(value)) {
    const path = joinPath('events', name)
    if (!isIdent(name) || name === RESERVED_NAME) {
      const rule = name === RESERVED_NAME ? "it's reserved" : NAME_RULE
      issues.push({ message: `'${name}' isn't a valid event name (${rule})`, path })
      continue
    }
    if (!isPlainObject(event)) {
      issues.push({ message: `an event must be an object such as {}, got ${typeName(event)}`, path })
      continue
    }
    checkUnknownKeys(event, EVENT_KEYS, path, issues, (key) =>
      key === 'payload' ? "event payloads aren't supported yet; declare one event per action, such as votePizza and voteTacos" : undefined,
    )
    checkDescription(event, path, issues)
    events[name] = typeof event.description === 'string' ? { description: event.description } : {}
  }
  return issues.length === before ? events : null
}

/**
 * Checks a parsed schema block. `schema` is null when there are issues: callers shouldn't check
 * paths or data against a schema that is only partly understood.
 */
export function validateSchema(value: unknown): { schema: MelzinSchema | null; issues: Issue[] } {
  const issues: Issue[] = []
  if (!isPlainObject(value)) {
    issues.push({ message: `the schema must be a JSON object with 'data' and/or 'events', got ${typeName(value)}` })
    return { schema: null, issues }
  }
  checkUnknownKeys(value, TOP_LEVEL_KEYS, '', issues, (key) =>
    key === 'ui' ? "internal state (ui) isn't supported yet; let the host send that state as data" : undefined,
  )
  checkDescription(value, '', issues)
  const schema: MelzinSchema = {}
  if ('data' in value) {
    const data = value.data
    if (isPlainObject(data) && data.type === 'object') {
      const object = validateObject(data, 'data', issues)
      if (object !== null) schema.data = object
    } else if (isPlainObject(data) && (data.type === 'array' || 'items' in data)) {
      issues.push({ message: LISTS_MESSAGE, path: 'data' })
    } else {
      issues.push({ message: `'data' must be an object schema: { "type": "object", "properties": { ... } }`, path: 'data' })
    }
  }
  if ('events' in value) {
    const events = validateEvents(value.events, issues)
    if (events !== null) schema.events = events
  }
  return { schema: issues.length === 0 ? schema : null, issues }
}

/** ` (did you mean 'post.title'?)` for a field written one level too high, else ''. */
function suggestNested(key: string, schema: ObjectSchema, prefix = ''): string {
  for (const [name, field] of Object.entries(schema.properties)) {
    if (field.type === 'object' && Object.hasOwn(field.properties, key)) return ` (did you mean '${prefix}${name}.${key}'?)`
  }
  return ''
}

function checkValue(field: FieldSchema, value: unknown, path: string, issues: Issue[]): void {
  if (field.type === 'object') {
    if (isPlainObject(value)) validateObjectData(field, value, path, issues)
    else issues.push({ message: `expected an object, got ${typeName(value)}`, path })
  } else if (typeof value !== field.type) {
    issues.push({ message: `expected ${field.type}, got ${typeName(value)}`, path })
  } else if (typeof value === 'number' && !Number.isFinite(value)) {
    issues.push({ message: `expected a finite number, got ${value}`, path })
  }
}

// Fields are read like the runtime reads them (hasField), so values from getters or a prototype count;
// unknown fields are own keys the schema doesn't declare. Issues follow the data's key order.
function validateObjectData(schema: ObjectSchema, data: Record<string, unknown>, path: string, issues: Issue[]): void {
  const seen = new Set<string>()
  for (const [key, value] of Object.entries(data)) {
    seen.add(key)
    const field = Object.hasOwn(schema.properties, key) ? schema.properties[key] : undefined
    if (field === undefined) {
      const hint = suggest(key, Object.keys(schema.properties)) || suggestNested(key, schema)
      issues.push({ message: `unknown field '${key}'${hint}`, path: joinPath(path, key) })
    } else if (value !== undefined) {
      checkValue(field, value, joinPath(path, key), issues)
    }
  }
  const required = new Set(schema.required ?? [])
  for (const [name, field] of Object.entries(schema.properties)) {
    const value = seen.has(name) ? data[name] : hasField(data, name) ? data[name] : undefined
    if (value === undefined) {
      if (required.has(name)) issues.push({ message: `missing required field '${name}'`, path: joinPath(path, name) })
    } else if (!seen.has(name)) {
      checkValue(field, value, joinPath(path, name), issues)
    }
  }
}

/**
 * Checks data against the schema's `data`. Unknown fields, missing required fields and type
 * mismatches are issues, with dotted paths. Without a schema `data`, only `{}` is valid.
 */
export function validateData(schema: MelzinSchema | null | undefined, data: unknown): Issue[] {
  const issues: Issue[] = []
  if (!isPlainObject(data)) {
    issues.push({ message: `data must be an object, got ${typeName(data)}` })
    return issues
  }
  validateObjectData(schema?.data ?? { type: 'object', properties: {} }, data, '', issues)
  return issues
}

/** Finds the leaf a path such as `['user', 'name']` points at. */
export function resolvePath(schema: MelzinSchema | null | undefined, segments: readonly string[]): ResolvedPath {
  let node: FieldSchema = schema?.data ?? { type: 'object', properties: {} }
  for (let i = 0; i < segments.length; i++) {
    const segment = segments[i]!
    const sofar = segments.slice(0, i + 1).join('.')
    if (node.type !== 'object') {
      return { ok: false, message: `'${segments.slice(0, i).join('.')}' is a ${node.type} and has no fields` }
    }
    const child: FieldSchema | undefined = Object.hasOwn(node.properties, segment) ? node.properties[segment] : undefined
    if (child === undefined) {
      const prefix = segments.slice(0, i).map((s) => `${s}.`).join('')
      let hint = suggest(segment, Object.keys(node.properties), (best) => prefix + best) || suggestNested(segment, node, prefix)
      if (i === 0 && segment === 'data' && segments.length > 1 && resolvePath(schema, segments.slice(1)).ok) {
        hint = ` (paths start inside data: use '${segments.slice(1).join('.')}')`
      }
      return { ok: false, message: `unknown field '${sofar}'${hint}` }
    }
    node = child
  }
  if (node.type === 'object') {
    const name = segments.length === 0 ? 'data' : segments.join('.')
    return { ok: false, message: `'${name}' is an object; m-text needs a string, number or boolean` }
  }
  return node.default === undefined ? { ok: true, type: node.type } : { ok: true, type: node.type, default: node.default }
}

/** Dotted paths of every leaf field, in declaration order. */
export function leafPaths(schema: MelzinSchema | null | undefined): string[] {
  const paths: string[] = []
  const walk = (object: ObjectSchema, prefix: string): void => {
    for (const [name, field] of Object.entries(object.properties)) {
      const path = prefix === '' ? name : `${prefix}.${name}`
      if (field.type === 'object') walk(field, path)
      else paths.push(path)
    }
  }
  if (schema?.data) walk(schema.data, '')
  return paths
}

/** The schema default for a leaf path, if any. */
export function defaultAt(
  schema: MelzinSchema | null | undefined,
  segments: readonly string[],
): string | number | boolean | undefined {
  const resolved = resolvePath(schema, segments)
  return resolved.ok ? resolved.default : undefined
}
