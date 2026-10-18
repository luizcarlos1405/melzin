// Schema v0: a strict subset of JSON Schema for `data`, plus declared events (POC.md §3), lists
// (SPEC D34) and event payloads (D35).

import { FOR_DIRECTIVE, ROUTE_INPUT, isIdent, positionMessage } from './constants.ts'
import { blockedLinkScheme } from './markup.ts'

export type LeafType = 'string' | 'number' | 'boolean'
/** `route` makes a string field a link to that route (SPEC D23): the source fills it with the route's URL. */
export type LeafSchema = { type: LeafType; default?: string | number | boolean; description?: string; route?: string }
export type ObjectSchema = {
  type: 'object'
  properties: Record<string, FieldSchema>
  required?: string[]
  description?: string
}
/** What a list holds: objects, or strings or numbers, which are their own keys. */
export type ItemSchema = ObjectSchema | LeafSchema
/**
 * A list (SPEC D34): zero or more items of one type. A list of objects names the items' field that
 * identifies each one (`key`, a required string or number field); a list of strings or numbers is keyed
 * by its values and says so with `uniqueItems: true`. `minItems` and `maxItems` are design limits.
 */
export type ListSchema = {
  type: 'array'
  items: ItemSchema
  key?: string
  uniqueItems?: boolean
  minItems?: number
  maxItems?: number
  description?: string
}
export type FieldSchema = LeafSchema | ObjectSchema | ListSchema
/** What an event carries (D35): an object of string, number and boolean fields, filled from paths. */
export type PayloadSchema = {
  type: 'object'
  properties: Record<string, LeafSchema>
  required?: string[]
  description?: string
}
export type EventSchema = { description?: string; payload?: PayloadSchema }
export type MelzinSchema = { data?: ObjectSchema; events?: Record<string, EventSchema> }

/** `path` is a JSON path into the checked value, such as `data.properties.user` or `user.name`. */
export type Issue = { message: string; path?: string }

export type ResolvedPath =
  | { ok: true; type: LeafType; default?: string | number | boolean }
  | { ok: false; message: string }

/**
 * `required` is true when every field along the path is required, so valid data always has it. A path
 * that ends in `.length` after a list (`members.length`) counts its items: `field` is a number and
 * `length` the list it counts. Only conditions may use a count (m-if, m-else-if, m-show).
 */
export type ResolvedField =
  | { ok: true; field: FieldSchema; required: boolean; length?: ListSchema }
  | { ok: false; message: string }

/**
 * What an m-for alias stands for in the rows its element repeats (D34): an item of `list`. Paths that
 * start with the alias read that item: `member.name` in the rows of `member in members`.
 */
export type ScopeEntry = {
  /** The list the alias goes over. */
  list: ListSchema
  /** The list's field path from the top of data (see LIST_ITEMS): ['members'], ['polls', '[]', 'options']. */
  path: readonly string[]
  /** The row's current item, for reading values: the runtime sets it per row as data changes. */
  item?: unknown
}
/** The aliases in scope at an element, innermost last. A Map, so an alias such as `constructor` is a plain key. */
export type Scope = ReadonlyMap<string, ScopeEntry>

/**
 * The segment that stands for a list's items in a field path: ['members', '[]', 'name'] is the name of
 * every member, `members[].name` in messages. Never a field name, which is an identifier.
 */
export const LIST_ITEMS = '[]'

const LEAF_TYPES: readonly string[] = ['string', 'number', 'boolean']
const LEAF_KEYS = new Set(['type', 'default', 'description', 'route'])
const OBJECT_KEYS = new Set(['type', 'properties', 'required', 'description'])
const LIST_KEYS = new Set(['type', 'items', 'key', 'uniqueItems', 'minItems', 'maxItems', 'description'])
const TOP_LEVEL_KEYS = new Set(['data', 'events', 'description'])
const EVENT_KEYS = new Set(['description', 'payload'])

const NAME_RULE = 'use letters, digits and _, not starting with a digit'
// Assigning it to a plain object would set the object's prototype instead of adding a key.
const RESERVED_NAME = '__proto__'
const TYPES = 'string, number, boolean, object or array'
const PAYLOAD_EXAMPLE = '{ "type": "object", "properties": { "optionId": { "type": "string" } } }'
const PAYLOAD_LEAVES = "payload fields are strings, numbers or booleans for now; send a key, such as optionId, and let the host look up the rest"
const NULL_FIELD_HINT = '; leave the field out to make it missing'
const EMPTY_OBJECT: ObjectSchema = { type: 'object', properties: {} }

export function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

/**
 * Whether `object` has `key` as its own property or through its prototype chain, stopping before
 * Object.prototype: getters on a class instance count, `toString` or `constructor` don't. A class's
 * prototype has `constructor` too (the class itself), so only an own `constructor` counts. The runtime
 * reads data and handlers with this rule, and validateData checks data with it.
 */
export function hasField(object: object, key: string): boolean {
  for (let node: object | null = object; node !== null && node !== Object.prototype; node = Object.getPrototypeOf(node)) {
    if (Object.hasOwn(node, key) && (key !== 'constructor' || node === object)) return true
  }
  return false
}

/** Appends a key to a JSON path: `a.b` for identifiers, `a["b c"]` otherwise. */
export function joinPath(base: string, key: string): string {
  if (isIdent(key)) return base === '' ? key : `${base}.${key}`
  return `${base}[${JSON.stringify(key)}]`
}

/** Appends a list index to a JSON path: `members[2]`, then `members[2].name` with joinPath. */
export function indexPath(base: string, index: number): string {
  return `${base}[${index}]`
}

/** A field path for messages: ['members', '[]', 'name'] → `members[].name`, ['tags', '[]'] → `tags[]`. */
export function formatFieldPath(path: readonly string[]): string {
  let text = ''
  for (const segment of path) text = segment === LIST_ITEMS ? `${text}[]` : text === '' ? segment : `${text}.${segment}`
  return text
}

/** ['members', '[]', 'url'] → `data.properties.members.items.properties.url`, the field in the schema block. */
export function schemaPathOf(path: readonly string[]): string {
  return path.reduce(
    (result, segment) => (segment === LIST_ITEMS ? joinPath(result, 'items') : joinPath(joinPath(result, 'properties'), segment)),
    'data',
  )
}

/** A scope with one more alias, an m-for's, leaving `scope` as it is. */
export function withAlias(scope: Scope | undefined, alias: string, entry: ScopeEntry): Scope {
  return new Map(scope ?? []).set(alias, entry)
}

/** The alias entry a path starts with, if any. */
function aliasOf(segments: readonly string[], scope: Scope | undefined): ScopeEntry | undefined {
  return segments.length === 0 || scope === undefined ? undefined : scope.get(segments[0]!)
}

/** The field path a path names, aliases expanded: `member.name` in `member in members` is ['members', '[]', 'name']. */
export function fieldPathOf(segments: readonly string[], scope?: Scope): string[] {
  const entry = aliasOf(segments, scope)
  return entry === undefined ? [...segments] : [...entry.path, LIST_ITEMS, ...segments.slice(1)]
}

function at(path: string): string | undefined {
  return path === '' ? undefined : path
}

function typeName(value: unknown): string {
  if (value === null) return 'null'
  if (Array.isArray(value)) return 'array'
  return typeof value
}

/** `a string`, `an object`, `a list`: what a field holds, for messages. */
function describeField(field: FieldSchema): string {
  if (field.type === 'array') return field.items.type === 'object' ? 'a list' : `a list of ${field.items.type}s`
  return field.type === 'object' ? 'an object' : `a ${field.type}`
}

/**
 * A name for one item of a list, for examples in messages: `members` → `member`, `categories` →
 * `category`, `boxes` → `box`; `item` when no plural shows.
 */
export function itemName(list: string): string {
  const singular = /(x|ch|sh|ss)es$/.test(list)
    ? list.slice(0, -2)
    : list.endsWith('ies')
      ? `${list.slice(0, -3)}y`
      : /[^siu]s$/.test(list)
        ? list.slice(0, -1)
        : ''
  return singular !== '' && isIdent(singular) ? singular : 'item'
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

// List keywords on a field that isn't a list: what to write instead.
function listKeyword(key: string): string | undefined {
  if (key === 'items' || key === 'key' || key === 'uniqueItems' || key === 'minItems' || key === 'maxItems') {
    return `'${key}' is for lists, which have "type": "array"`
  }
  return undefined
}

// Keywords in a list's items' schema that belong to the list, or that an item can't have.
function itemKeyword(key: string): string | undefined {
  if (key === 'key' || key === 'uniqueItems' || key === 'minItems' || key === 'maxItems') return `put "${key}" on the list, next to "items"`
  if (key === 'default') return "a list item is never missing, so it takes no 'default'"
  return listKeyword(key)
}

/**
 * Where a field schema sits, so messages offer only what fits there: the types it may have, the type
 * to use for a name from elsewhere ("integer"), and what to say about keywords that belong elsewhere.
 */
type FieldPlace = { types: string; renamed: Readonly<Record<string, string>>; keyword: (key: string) => string | undefined }
/** A field of data or of an object. */
const DATA_FIELD: FieldPlace = { types: TYPES, renamed: { integer: 'number', list: 'array' }, keyword: listKeyword }
/** A list's items: objects, strings or numbers (SPEC D34). */
const LIST_ITEM: FieldPlace = { types: 'object, string or number', renamed: { integer: 'number' }, keyword: itemKeyword }
/** A field of an event's payload: a string, number or boolean (D35). */
const PAYLOAD_FIELD: FieldPlace = { types: 'string, number or boolean', renamed: { integer: 'number' }, keyword: () => undefined }

function validateField(value: unknown, path: string, issues: Issue[], place: FieldPlace = DATA_FIELD): FieldSchema | null {
  if (!isPlainObject(value)) {
    issues.push({ message: `a field schema must be an object, got ${typeName(value)}`, path: at(path) })
    return null
  }
  const type = value.type
  if (type === undefined) {
    const hint = 'items' in value ? ': a list needs "type": "array"' : ` (${place.types})`
    issues.push({ message: `missing 'type'${hint}`, path: at(path) })
    return null
  }
  if (type === 'array') return validateList(value, path, issues)
  if (type === 'object') return validateObject(value, path, issues)
  if (typeof type !== 'string' || !LEAF_TYPES.includes(type)) {
    const use = typeof type === 'string' && Object.hasOwn(place.renamed, type) ? place.renamed[type] : undefined
    issues.push({
      message: `unsupported type ${JSON.stringify(type)}${use === undefined ? '' : ` (use '${use}')`}; use ${place.types}`,
      path: joinPath(path, 'type'),
    })
    return null
  }
  const before = issues.length
  checkUnknownKeys(value, LEAF_KEYS, path, issues, place.keyword)
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
  if ('route' in value) {
    const route = value.route
    const routePath = joinPath(path, 'route')
    if (type !== 'string') {
      issues.push({ message: "'route' is only allowed on string fields: a link field holds a URL", path: routePath })
    } else if (typeof route !== 'string' || !isIdent(route)) {
      issues.push({ message: `'route' must be the name of a route in routes.json, such as "profile"`, path: routePath })
    } else if ('default' in value) {
      issues.push({ message: "a link field can't have a default: views never build URLs, the source sends them (leave the field out to show no link)", path: joinPath(path, 'default') })
    } else {
      leaf.route = route
    }
  }
  return issues.length === before ? leaf : null
}

/** A field name's problem (not an identifier, or `__proto__`), or undefined. `what` is `field` or `event`. */
function nameProblem(name: string, what: string): string | undefined {
  if (isIdent(name) && name !== RESERVED_NAME) return undefined
  return `'${name}' isn't a valid ${what} name (${name === RESERVED_NAME ? "it's reserved" : NAME_RULE})`
}

/** Checks `required` against the properties; the names, or undefined when it's missing or broken. */
function validateRequired(value: Record<string, unknown>, path: string, issues: Issue[]): string[] | undefined {
  if (!('required' in value)) return undefined
  const required = value.required
  const rawProperties = value.properties
  const requiredPath = joinPath(path, 'required')
  if (!Array.isArray(required) || !required.every((entry) => typeof entry === 'string')) {
    issues.push({ message: "'required' must be an array of field names", path: requiredPath })
    return undefined
  }
  const seen = new Set<string>()
  required.forEach((name, index) => {
    const entryPath = indexPath(requiredPath, index)
    if (seen.has(name)) issues.push({ message: `'${name}' is listed twice in required`, path: entryPath })
    seen.add(name)
    if (isPlainObject(rawProperties) && !Object.hasOwn(rawProperties, name)) {
      const hint = suggest(name, Object.keys(rawProperties))
      issues.push({ message: `required field '${name}' isn't in properties${hint}`, path: entryPath })
    }
  })
  return [...seen]
}

/** `keyword` says what to write instead of a keyword that belongs elsewhere (see FieldPlace). */
function validateObject(
  value: Record<string, unknown>,
  path: string,
  issues: Issue[],
  keyword: (key: string) => string | undefined = (key) => (key === 'default' ? "'default' is only allowed on string, number and boolean fields" : listKeyword(key)),
): ObjectSchema | null {
  const before = issues.length
  checkUnknownKeys(value, OBJECT_KEYS, path, issues, keyword)
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
      const problem = nameProblem(name, 'field')
      if (problem !== undefined) {
        issues.push({ message: problem, path: fieldPath })
        continue
      }
      const schema = validateField(field, fieldPath, issues)
      if (schema !== null) properties[name] = schema
    }
  }
  const result: ObjectSchema = { type: 'object', properties }
  const required = validateRequired(value, path, issues)
  if (required !== undefined) result.required = required
  if (typeof value.description === 'string') result.description = value.description
  return issues.length === before ? result : null
}

/** A list's `items`: an object schema, or a string or number leaf without a default. */
function validateItems(value: Record<string, unknown>, path: string, issues: Issue[]): ItemSchema | null {
  const itemsPath = joinPath(path, 'items')
  if (!('items' in value)) {
    issues.push({ message: `a list needs 'items', the schema every item matches, such as "items": { "type": "string" }`, path: at(path) })
    return null
  }
  const items = value.items
  if (Array.isArray(items)) {
    issues.push({ message: "'items' is one schema that every item matches; lists of mixed items (tuples) aren't supported", path: itemsPath })
    return null
  }
  if (!isPlainObject(items)) {
    issues.push({ message: `'items' must be a schema such as { "type": "string" }, got ${typeName(items)}`, path: itemsPath })
    return null
  }
  if (items.type === 'array' || (items.type === undefined && 'items' in items)) {
    issues.push({ message: `a list's items can't be lists; a list of lists needs object items with a key, such as { "id", "rows" }`, path: itemsPath })
    return null
  }
  if (items.type === undefined) {
    issues.push({ message: "missing 'type': list items are objects, strings or numbers", path: itemsPath })
    return null
  }
  if (items.type === 'boolean') {
    issues.push({
      message: `a list of booleans can't be keyed, since its values repeat; use object items with a key, such as { "id", "done" }`,
      path: joinPath(itemsPath, 'type'),
    })
    return null
  }
  if (items.type === 'object') return validateObject(items, itemsPath, issues, itemKeyword)
  const before = issues.length
  if ('default' in items) {
    issues.push({ message: "a list item is never missing, so it takes no 'default'", path: joinPath(itemsPath, 'default') })
  }
  const leaf = validateField(items, itemsPath, issues, LIST_ITEM)
  return issues.length === before && leaf !== null ? (leaf as LeafSchema) : null
}

/** `user.id` → `userId`: a field name for a key written as a path. */
function camelJoin(path: string): string {
  return path.split('.').map((part, i) => (i === 0 ? part : part.charAt(0).toUpperCase() + part.slice(1))).join('')
}

function validateList(value: Record<string, unknown>, path: string, issues: Issue[]): ListSchema | null {
  const before = issues.length
  checkUnknownKeys(value, LIST_KEYS, path, issues, (key) => {
    if (key === 'default') return "a list has no default: a missing optional list shows like an empty one, so leave 'default' out"
    if (key === 'properties' || key === 'required') {
      return `'${key}' belongs in the items' schema: "items": { "type": "object", "properties": { ... }, "required": [ ... ] }`
    }
    return undefined
  })
  checkDescription(value, path, issues)
  const items = validateItems(value, path, issues)
  // What the items are, even when their schema has problems, so the key rules still apply.
  const raw = isPlainObject(value.items) ? value.items : undefined
  const kind = raw?.type === 'object' ? 'object' : raw?.type === 'string' || raw?.type === 'number' ? raw.type : undefined
  const keyPath = joinPath(path, 'key')
  const uniquePath = joinPath(path, 'uniqueItems')
  let key: string | undefined

  if (kind === 'object') {
    if ('uniqueItems' in value) {
      issues.push({ message: `"uniqueItems" is for lists of strings or numbers; the key already makes items unique`, path: uniquePath })
    }
    const name = value.key
    const objectItems = items?.type === 'object' ? items : undefined
    if (name === undefined) {
      const candidate = objectItems === undefined
        ? undefined
        : Object.entries(objectItems.properties).find(([name, field]) =>
          (field.type === 'string' || field.type === 'number') && (objectItems.required ?? []).includes(name))?.[0]
      issues.push({
        message: `a list of objects needs a "key": the field of its items that identifies each one, such as "key": "${candidate ?? 'id'}"`,
        path: at(path),
      })
    } else if (typeof name !== 'string' || name === '') {
      issues.push({ message: `'key' must be the name of a field of the items, such as "id"`, path: keyPath })
    } else if (name.includes('.')) {
      issues.push({ message: `the key is a field of the items, not a path: give the items a field such as "${camelJoin(name)}"`, path: keyPath })
    } else if (objectItems !== undefined) {
      const field = Object.hasOwn(objectItems.properties, name) ? objectItems.properties[name] : undefined
      if (field === undefined) {
        issues.push({ message: `key '${name}' isn't a field of the items${suggest(name, Object.keys(objectItems.properties))}`, path: keyPath })
      } else if (field.type !== 'string' && field.type !== 'number') {
        issues.push({ message: `key '${name}' must be a string or number field; it's ${describeField(field)}`, path: keyPath })
      } else if (!(objectItems.required ?? []).includes(name)) {
        issues.push({ message: `key '${name}' must be required: add it to the items' "required", since every item needs its key`, path: keyPath })
      } else {
        key = name
      }
    }
  } else if (kind !== undefined) {
    const keyed = `a list of ${kind}s is keyed by its values`
    if ('key' in value) {
      issues.push({ message: `${keyed}: use "uniqueItems": true instead of "key"`, path: keyPath })
    } else if (value.uniqueItems !== true) {
      issues.push({ message: `${keyed}: add "uniqueItems": true`, path: 'uniqueItems' in value ? uniquePath : at(path) })
    }
  }

  const counts: Partial<Record<'minItems' | 'maxItems', number>> = {}
  for (const name of ['minItems', 'maxItems'] as const) {
    if (!(name in value)) continue
    const count = value[name]
    if (typeof count === 'number' && Number.isInteger(count) && count >= 0) counts[name] = count
    else issues.push({ message: `'${name}' must be a whole number, 0 or more`, path: joinPath(path, name) })
  }
  if (counts.minItems !== undefined && counts.maxItems !== undefined && counts.minItems > counts.maxItems) {
    issues.push({ message: `'minItems' (${counts.minItems}) is more than 'maxItems' (${counts.maxItems})`, path: joinPath(path, 'minItems') })
  }
  if (issues.length > before || items === null) return null
  // With no issues, a list of objects has its key, and a list of strings or numbers "uniqueItems": true.
  const result: ListSchema = { type: 'array', items }
  if (key !== undefined) result.key = key
  if (items.type !== 'object') result.uniqueItems = true
  if (counts.minItems !== undefined) result.minItems = counts.minItems
  if (counts.maxItems !== undefined) result.maxItems = counts.maxItems
  if (typeof value.description === 'string') result.description = value.description
  return result
}

/** An event's payload (D35): an object schema whose fields are leaves, with no default and no route. */
function validatePayload(value: unknown, path: string, issues: Issue[]): PayloadSchema | null {
  if (!isPlainObject(value) || value.type !== 'object') {
    const typePath = isPlainObject(value) && value.type !== undefined ? joinPath(path, 'type') : path
    issues.push({ message: `a payload is an object schema of named fields: ${PAYLOAD_EXAMPLE}`, path: typePath })
    return null
  }
  const before = issues.length
  checkUnknownKeys(value, OBJECT_KEYS, path, issues)
  checkDescription(value, path, issues)
  const properties: Record<string, LeafSchema> = {}
  const rawProperties = value.properties
  if (rawProperties === undefined) {
    issues.push({ message: `a payload needs 'properties', its fields: ${PAYLOAD_EXAMPLE}`, path })
  } else if (!isPlainObject(rawProperties)) {
    issues.push({ message: `'properties' must be an object, got ${typeName(rawProperties)}`, path: joinPath(path, 'properties') })
  } else {
    for (const [name, field] of Object.entries(rawProperties)) {
      const fieldPath = joinPath(joinPath(path, 'properties'), name)
      const problem = nameProblem(name, 'field')
      if (problem !== undefined) {
        issues.push({ message: problem, path: fieldPath })
        continue
      }
      if (isPlainObject(field) && (field.type === 'object' || field.type === 'array' || 'properties' in field || 'items' in field)) {
        issues.push({ message: PAYLOAD_LEAVES, path: fieldPath })
        continue
      }
      // A leaf as validateField reads it, minus what a payload field can't have. Object.fromEntries keeps
      // every key its own, `__proto__` included, so validateField reports it like any unknown keyword.
      let leaf: unknown = field
      if (isPlainObject(field)) {
        if (Object.hasOwn(field, 'default')) {
          issues.push({ message: "a payload field has no default: the view sends the value it has, or leaves an optional field out", path: joinPath(fieldPath, 'default') })
        }
        if (Object.hasOwn(field, 'route')) {
          issues.push({ message: "a payload field isn't a link: send a key, such as the item's id, and let the host find the URL", path: joinPath(fieldPath, 'route') })
        }
        leaf = Object.fromEntries(Object.entries(field).filter(([key]) => key !== 'default' && key !== 'route'))
      }
      const schema = validateField(leaf, fieldPath, issues, PAYLOAD_FIELD)
      if (schema !== null) properties[name] = schema as LeafSchema
    }
  }
  const result: PayloadSchema = { type: 'object', properties }
  const required = validateRequired(value, path, issues)
  if (required !== undefined) result.required = required
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
    const problem = nameProblem(name, 'event')
    if (problem !== undefined) {
      issues.push({ message: problem, path })
      continue
    }
    if (!isPlainObject(event)) {
      issues.push({ message: `an event must be an object such as {}, got ${typeName(event)}`, path })
      continue
    }
    checkUnknownKeys(event, EVENT_KEYS, path, issues)
    checkDescription(event, path, issues)
    const schema: EventSchema = {}
    if (typeof event.description === 'string') schema.description = event.description
    if ('payload' in event) {
      const payload = validatePayload(event.payload, joinPath(path, 'payload'), issues)
      if (payload !== null) schema.payload = payload
    }
    events[name] = schema
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
      if (isPlainObject(data.properties) && Object.hasOwn(data.properties, ROUTE_INPUT)) {
        issues.push({
          message: `'${ROUTE_INPUT}' is reserved for the URL input (${ROUTE_INPUT}.params, ${ROUTE_INPUT}.query); rename the field`,
          path: joinPath(joinPath('data', 'properties'), ROUTE_INPUT),
        })
      }
      const object = validateObject(data, 'data', issues)
      if (object !== null) schema.data = object
    } else if (isPlainObject(data) && (data.type === 'array' || 'items' in data)) {
      issues.push({
        message: `'data' must be an object schema; put the list in a field: { "type": "object", "properties": { "items": { "type": "array", ... } } }`,
        path: 'data',
      })
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

/**
 * An item's key (D34): its key field for a list of objects, the item itself for a list of strings or
 * numbers. Undefined when it's missing or of the wrong type. Keys compare by value and type, as Map keys
 * do: 1 and "1" are different keys, and "__proto__" is an ordinary one.
 */
export function itemKey(list: ListSchema, item: unknown): string | number | undefined {
  const { items } = list
  let value: unknown = item
  let type: LeafType = items.type === 'object' ? 'string' : items.type
  if (items.type === 'object') {
    const key = list.key
    if (key === undefined || !isPlainObject(item) || !hasField(item, key)) return undefined
    const field = Object.hasOwn(items.properties, key) ? items.properties[key] : undefined
    if (field === undefined || (field.type !== 'string' && field.type !== 'number')) return undefined
    value = item[key]
    type = field.type
  }
  if (typeof value !== type) return undefined
  if (typeof value === 'number') return Number.isFinite(value) ? value : undefined
  return value as string
}

function plural(count: number, noun: string): string {
  return `${count} ${noun}${count === 1 ? '' : 's'}`
}

/** `hint` follows type mismatches: why a null field inside a list item is wrong. */
function checkValue(field: FieldSchema, value: unknown, path: string, issues: Issue[], inItem: boolean, hint = ''): void {
  if (field.type === 'object') {
    if (isPlainObject(value)) validateObjectData(field, value, path, issues, inItem)
    else issues.push({ message: `expected an object, got ${typeName(value)}${hint}`, path })
  } else if (field.type === 'array') {
    if (Array.isArray(value)) validateListData(field, value, path, issues)
    else issues.push({ message: `expected a list, got ${typeName(value)}${hint}`, path })
  } else if (typeof value !== field.type) {
    issues.push({ message: `expected ${field.type}, got ${typeName(value)}${hint}`, path })
  } else if (typeof value === 'number' && !Number.isFinite(value)) {
    issues.push({ message: `expected a finite number, got ${value}`, path })
  } else if (typeof value === 'string' && field.route !== undefined) {
    const scheme = blockedLinkScheme(value)
    if (scheme !== undefined) issues.push({ message: `${scheme}: URLs aren't allowed in links; the link has no href`, path })
  }
}

// Each item against the items' schema, then the list's own rules: its length, and keys that are unique
// among the items of this one list (a nested list's keys are unique per instance).
function validateListData(list: ListSchema, items: readonly unknown[], path: string, issues: Issue[]): void {
  const count = items.length
  if (list.minItems !== undefined && count < list.minItems) {
    issues.push({ message: `has ${plural(count, 'item')}; the schema allows at least ${list.minItems}`, path })
  }
  if (list.maxItems !== undefined && count > list.maxItems) {
    issues.push({ message: `has ${plural(count, 'item')}; the schema allows at most ${list.maxItems}`, path })
  }
  const what = list.items.type === 'object' ? 'key' : 'value'
  const firsts = new Map<string | number, number>()
  for (let i = 0; i < count; i++) {
    const item = items[i]
    const itemPath = indexPath(path, i)
    if (item === null || item === undefined) {
      issues.push({ message: `a list item can't be ${typeName(item)}; leave it out of the list`, path: itemPath })
      continue
    }
    checkValue(list.items, item, itemPath, issues, true)
    const key = itemKey(list, item)
    if (key === undefined) continue
    const first = firsts.get(key)
    if (first === undefined) {
      firsts.set(key, i)
      continue
    }
    issues.push({
      message: `duplicate ${what} ${JSON.stringify(key)}: ${indexPath(path, first)} has it too; ${what}s must be unique in a list`,
      path: list.items.type === 'object' && list.key !== undefined ? joinPath(itemPath, list.key) : itemPath,
    })
  }
}

// Fields are read like the runtime reads them (hasField), so values from getters or a prototype count;
// unknown fields are own keys the schema doesn't declare. Issues follow the data's key order. Inside a
// list item, a null is never a removal (lists replace whole, D36), so it gets a hint.
function validateObjectData(schema: ObjectSchema, data: Record<string, unknown>, path: string, issues: Issue[], inItem = false): void {
  const seen = new Set<string>()
  const required = new Set(schema.required ?? [])
  const check = (field: FieldSchema, name: string, value: unknown): void => {
    const hint = value === null && inItem && !required.has(name) ? NULL_FIELD_HINT : ''
    checkValue(field, value, joinPath(path, name), issues, inItem, hint)
  }
  for (const [key, value] of Object.entries(data)) {
    seen.add(key)
    const field = Object.hasOwn(schema.properties, key) ? schema.properties[key] : undefined
    if (field === undefined) {
      const hint = suggest(key, Object.keys(schema.properties)) || suggestNested(key, schema)
      issues.push({ message: `unknown field '${key}'${hint}`, path: joinPath(path, key) })
    } else if (value !== undefined) {
      check(field, key, value)
    }
  }
  for (const [name, field] of Object.entries(schema.properties)) {
    const value = seen.has(name) ? data[name] : hasField(data, name) ? data[name] : undefined
    if (value === undefined) {
      if (required.has(name)) issues.push({ message: `missing required field '${name}'`, path: joinPath(path, name) })
    } else if (!seen.has(name)) {
      check(field, name, value)
    }
  }
}

/**
 * Checks data against the schema's `data`. Unknown fields, missing required fields, type mismatches,
 * the rules of lists (null items, duplicate keys, minItems and maxItems) and link fields whose URL runs
 * code (blockedLinkScheme) are issues, with paths such as `user.name` and `members[2].handle`. Without
 * a schema `data`, only `{}` is valid.
 */
export function validateData(schema: MelzinSchema | null | undefined, data: unknown): Issue[] {
  const issues: Issue[] = []
  if (!isPlainObject(data)) {
    issues.push({ message: `data must be an object, got ${typeName(data)}` })
    return issues
  }
  validateObjectData(schema?.data ?? EMPTY_OBJECT, data, '', issues)
  return issues
}

/**
 * A name for one item of the list at `list` that is free where its m-for goes: not `taken` (the name
 * the author picked), `route`, a top-level data field or an alias in scope. Undefined when none is.
 */
function freeAlias(schema: MelzinSchema | null | undefined, list: string, scope: Scope | undefined, taken = ''): string | undefined {
  const candidates = [itemName(list), 'item', 'entry', ...(taken === '' ? [] : [`${taken}Item`])]
  return candidates.find((name) =>
    name !== taken && name !== ROUTE_INPUT && !(schema?.data !== undefined && Object.hasOwn(schema.data.properties, name)) && !scope?.has(name))
}

/** The alias in scope (innermost first) whose rows go over the list at `path`, a field path. */
function aliasOver(path: readonly string[], scope: Scope | undefined): string | undefined {
  const entries = [...(scope ?? [])].reverse()
  return entries.find(([, entry]) => entry.path.length === path.length && entry.path.every((segment, i) => segment === path[i]))?.[0]
}

// Other words for a list's count, which is `length` (D34).
const COUNT_WORDS = new Set(['size', 'count'])

/**
 * Why a path can't go on past a list (`segments[i]` comes after it): it reads the list's items' fields
 * without a row to read them in, or misspells `length`.
 */
function throughList(schema: MelzinSchema | null | undefined, segments: readonly string[], i: number, list: ListSchema, scope: Scope | undefined): string {
  const prefix = segments.slice(0, i).join('.')
  const segment = segments[i]!
  if (/^[0-9]+$/.test(segment)) return positionMessage(`${prefix}.${segment}`)
  const properties = list.items.type === 'object' ? Object.keys(list.items.properties) : []
  const exact = properties.includes(segment)
  if (!exact && (COUNT_WORDS.has(segment) || suggest(segment, ['length']) !== '')) {
    return `unknown field '${prefix}.${segment}' (did you mean '${prefix}.length'?)`
  }
  const last = prefix.slice(prefix.lastIndexOf('.') + 1)
  const inRow = aliasOver(fieldPathOf(segments.slice(0, i), scope), scope)
  const alias = inRow ?? freeAlias(schema, last, scope) ?? itemName(last)
  const loop = `${FOR_DIRECTIVE}="${alias} in ${prefix}"`
  if (list.items.type !== 'object') {
    const what = describeField(list)
    return inRow === undefined
      ? `'${prefix}' is ${what}; show each one in a row: ${loop}, then m-text="${alias}"`
      : `'${prefix}' is ${what}, and this row reads one of them as '${alias}'`
  }
  // The item's field the path meant: the one it names, or the closest one.
  let field = exact ? segment : undefined
  if (field === undefined) suggest(segment, properties, (best) => (field = best))
  if (field === undefined) {
    const where = inRow === undefined ? `read their fields in a row: ${loop}` : `this row reads one of them as '${alias}'`
    return `'${prefix}' is a list, and its items have no field '${segment}'; ${where}`
  }
  return inRow === undefined
    ? `'${prefix}' is a list; read its items' fields in a row: ${loop}, then ${alias}.${field}`
    : `'${prefix}' is a list, and this row reads one of its items as '${alias}': ${alias}.${field}`
}

/** ` (did you mean 'member.name'?)` for a field of a row's item written without the row's alias, innermost row first. */
function suggestItemField(segment: string, scope: Scope, exact: boolean): string {
  for (const [alias, entry] of [...scope].reverse()) {
    const { items } = entry.list
    if (items.type !== 'object') continue
    if (exact) {
      if (Object.hasOwn(items.properties, segment)) return ` (did you mean '${alias}.${segment}'?)`
      continue
    }
    const hint = suggest(segment, Object.keys(items.properties), (best) => `${alias}.${best}`)
    if (hint !== '') return hint
  }
  return ''
}

/**
 * Finds the field, leaf, object or list, that a path such as `['user', 'name']` points at. With a scope,
 * a path may start with an m-for alias, which stands for an item of its list (`['member', 'name']`); a
 * row's item always exists, so `required` starts true there. `['members', 'length']` counts a list's
 * items (see ResolvedField); a real field named `length` on an object is still that field.
 */
export function resolveField(schema: MelzinSchema | null | undefined, segments: readonly string[], scope?: Scope): ResolvedField {
  const entry = aliasOf(segments, scope)
  let node: FieldSchema = entry?.list.items ?? schema?.data ?? EMPTY_OBJECT
  let required = true
  for (let i = entry === undefined ? 0 : 1; i < segments.length; i++) {
    const segment = segments[i]!
    const sofar = segments.slice(0, i + 1).join('.')
    const before = segments.slice(0, i).join('.')
    if (node.type === 'array') {
      if (segment !== 'length') return { ok: false, message: throughList(schema, segments, i, node, scope) }
      if (i < segments.length - 1) return { ok: false, message: `'${sofar}' is a number and has no fields` }
      return { ok: true, field: { type: 'number' }, required, length: node }
    }
    if (node.type !== 'object') {
      // `title.length` in a condition: the string alone already says whether it's empty.
      if (node.type === 'string' && segment === 'length' && i === segments.length - 1) {
        return { ok: false, message: `'${before}' is a string and has no length; a condition on '${before}' itself holds when it isn't empty` }
      }
      return { ok: false, message: `'${before}' is a ${node.type} and has no fields` }
    }
    const child: FieldSchema | undefined = Object.hasOwn(node.properties, segment) ? node.properties[segment] : undefined
    if (child === undefined) {
      const prefix = segments.slice(0, i).map((s) => `${s}.`).join('')
      // At the start of a path, the aliases in scope are names too, and a row's item has fields.
      const start = i === 0 && scope !== undefined ? scope : undefined
      const names = start === undefined ? Object.keys(node.properties) : [...Object.keys(node.properties), ...start.keys()]
      let hint = (start === undefined ? '' : suggestItemField(segment, start, true)) ||
        suggest(segment, names, (best) => prefix + best) ||
        suggestNested(segment, node, prefix) ||
        (start === undefined ? '' : suggestItemField(segment, start, false))
      if (i === 0 && segment === 'data' && segments.length > 1 && resolveField(schema, segments.slice(1), scope).ok) {
        hint = ` (paths start inside data: use '${segments.slice(1).join('.')}')`
      }
      return { ok: false, message: `unknown field '${sofar}'${hint}` }
    }
    required &&= (node.required ?? []).includes(segment)
    node = child
  }
  return { ok: true, field: node, required }
}

/** Why a count can't go where a value shows: `.length` only works in conditions. */
export function lengthMessage(path: string): string {
  const list = path.replace(/\.length$/, '')
  const name = itemName(list.slice(list.lastIndexOf('.') + 1))
  return `'${path}' counts the items, which only conditions can use (m-if, m-else-if, m-show); to show a count, have the host send it as its own field, such as ${name}Count`
}

/**
 * Finds the leaf a path such as `['user', 'name']` points at: what m-text shows. Objects, lists and
 * counts (`members.length`) aren't leaves. `scope` is as in resolveField.
 */
export function resolvePath(schema: MelzinSchema | null | undefined, segments: readonly string[], scope?: Scope): ResolvedPath {
  const resolved = resolveField(schema, segments, scope)
  if (!resolved.ok) return resolved
  const { field } = resolved
  const name = segments.length === 0 ? 'data' : segments.join('.')
  if (resolved.length !== undefined) return { ok: false, message: lengthMessage(name) }
  if (field.type === 'object') {
    return { ok: false, message: `'${name}' is an object; m-text needs a string, number or boolean` }
  }
  if (field.type === 'array') return { ok: false, message: `'${name}' is a list; show its items with ${FOR_DIRECTIVE}` }
  return field.default === undefined ? { ok: true, type: field.type } : { ok: true, type: field.type, default: field.default }
}

/**
 * An m-for checked against the schema. `path` is the list's field path, `required` whether valid data
 * always has the list, and `scope` the rows' scope: the one given plus the alias, for an item of `list`
 * (no `item`: the runtime adds one per row, with withAlias). `at` says which part a problem is in.
 */
export type ResolvedList =
  | { ok: true; list: ListSchema; path: string[]; required: boolean; scope: Scope }
  | { ok: false; message: string; at: 'alias' | 'path' }

/**
 * Checks an m-for (`member in members`): the alias must be a new name (not `route`, a top-level data
 * field or an alias already in scope), and the path must lead to a list, from data or from an outer
 * alias (`option in poll.options`).
 */
export function resolveList(schema: MelzinSchema | null | undefined, alias: string, segments: readonly string[], scope?: Scope): ResolvedList {
  const name = segments.join('.')
  const free = freeAlias(schema, segments.at(-1) ?? '', scope, alias)
  const pick = `pick another name${free === undefined ? '' : `, such as ${free}`}`
  if (alias === ROUTE_INPUT) {
    return { ok: false, at: 'alias', message: `'${alias}' is already the URL input; ${pick}` }
  }
  const outer = scope?.get(alias)
  if (outer !== undefined) {
    return { ok: false, at: 'alias', message: `'${alias}' is already the item of the ${FOR_DIRECTIVE} over '${formatFieldPath(outer.path)}' around this one; ${pick}` }
  }
  if (schema?.data !== undefined && Object.hasOwn(schema.data.properties, alias)) {
    return { ok: false, at: 'alias', message: `'${alias}' is already a data field; ${pick}` }
  }
  if (segments[0] === ROUTE_INPUT) {
    return { ok: false, at: 'path', message: `'${name}' is the URL input, which has no lists; ${FOR_DIRECTIVE} goes over a list field ("type": "array")` }
  }
  const resolved = resolveField(schema, segments, scope)
  if (!resolved.ok) return { ok: false, at: 'path', message: resolved.message }
  if (resolved.length !== undefined) {
    return { ok: false, at: 'path', message: `'${name}' is a count; ${FOR_DIRECTIVE} goes over the list itself: ${alias} in ${segments.slice(0, -1).join('.')}` }
  }
  const { field } = resolved
  if (field.type !== 'array') {
    return { ok: false, at: 'path', message: `'${name}' is ${describeField(field)}, not a list; ${FOR_DIRECTIVE} goes over a list field ("type": "array")` }
  }
  const path = fieldPathOf(segments, scope)
  return { ok: true, list: field, path, required: resolved.required, scope: withAlias(scope, alias, { list: field, path }) }
}

/** A field found by schemaFields: its field path (LIST_ITEMS for a list's items) and its schema. */
export type SchemaField = { path: string[]; field: FieldSchema }

/**
 * Every field of a schema's data in declaration order, each one before the fields inside it: an
 * object's properties, and a list's items (path [..., LIST_ITEMS]) followed by the items' fields.
 */
export function schemaFields(schema: MelzinSchema | null | undefined): SchemaField[] {
  const fields: SchemaField[] = []
  const walk = (field: FieldSchema, path: string[]): void => {
    if (field.type === 'object') {
      for (const [name, child] of Object.entries(field.properties)) {
        fields.push({ path: [...path, name], field: child })
        walk(child, [...path, name])
      }
    } else if (field.type === 'array') {
      fields.push({ path: [...path, LIST_ITEMS], field: field.items })
      walk(field.items, [...path, LIST_ITEMS])
    }
  }
  if (schema?.data) walk(schema.data, [])
  return fields
}

/**
 * Paths of every leaf field, in declaration order: `user.name`, and inside lists `members[].name`, or
 * `tags[]` for a list of strings or numbers (see formatFieldPath).
 */
export function leafPaths(schema: MelzinSchema | null | undefined): string[] {
  return schemaFields(schema).flatMap(({ path, field }) => (field.type === 'object' || field.type === 'array' ? [] : [formatFieldPath(path)]))
}

/**
 * Every link field of a schema (SPEC D23): its field path and the route it names. Link fields inside a
 * list's items count, with paths such as ['members', '[]', 'url'].
 */
export function linkFields(schema: MelzinSchema | null | undefined): { path: string[]; route: string }[] {
  return schemaFields(schema).flatMap(({ path, field }) =>
    field.type !== 'object' && field.type !== 'array' && field.route !== undefined ? [{ path, route: field.route }] : [],
  )
}

/** The schema default for a leaf path, if any. `scope` is as in resolveField. */
export function defaultAt(
  schema: MelzinSchema | null | undefined,
  segments: readonly string[],
  scope?: Scope,
): string | number | boolean | undefined {
  const resolved = resolvePath(schema, segments, scope)
  return resolved.ok ? resolved.default : undefined
}
