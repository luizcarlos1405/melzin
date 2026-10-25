// Attribute and class bindings (SPEC D37): which attributes a binding may set, how a value becomes
// attribute text, the ARIA value types the checker holds, and the class object's grammar. Shared by
// the runtime and the checker, so both apply the same rules.

import { BINDABLE_TARGETS, CLASS_DIRECTIVE } from './constants.ts'
import { type Condition, parseConditionDirective } from './expr.ts'

/** How WAI-ARIA types an attribute's value (ARIA 1.2), for the attributes a view may bind. */
export type AriaValueType =
  | { kind: 'boolean' } // true/false, and true/false/undefined
  | { kind: 'tristate' } // true/false/mixed
  | { kind: 'token'; tokens: readonly string[] }
  | { kind: 'integer' }
  | { kind: 'number' }
  | { kind: 'string' }

const BOOLEAN: AriaValueType = { kind: 'boolean' }
const TRISTATE: AriaValueType = { kind: 'tristate' }
const INTEGER: AriaValueType = { kind: 'integer' }
const NUMBER: AriaValueType = { kind: 'number' }
const STRING: AriaValueType = { kind: 'string' }
const token = (...tokens: string[]): AriaValueType => ({ kind: 'token', tokens })

/**
 * The value-carrying ARIA attributes a binding may set, with their types. ID references
 * (aria-labelledby, aria-controls...) aren't here: an id resolves against the whole host page.
 */
export const ARIA_ATTRIBUTES: Readonly<Record<string, AriaValueType>> = {
  'aria-atomic': BOOLEAN,
  'aria-autocomplete': token('inline', 'list', 'both', 'none'),
  'aria-braillelabel': STRING,
  'aria-brailleroledescription': STRING,
  'aria-busy': BOOLEAN,
  'aria-checked': TRISTATE,
  'aria-colcount': INTEGER,
  'aria-colindex': INTEGER,
  'aria-colindextext': STRING,
  'aria-colspan': INTEGER,
  'aria-current': token('page', 'step', 'location', 'date', 'time', 'true', 'false'),
  'aria-description': STRING,
  'aria-disabled': BOOLEAN,
  'aria-expanded': BOOLEAN,
  'aria-haspopup': token('false', 'true', 'menu', 'listbox', 'tree', 'grid', 'dialog'),
  'aria-hidden': BOOLEAN,
  'aria-invalid': token('grammar', 'false', 'spelling', 'true'),
  'aria-keyshortcuts': STRING,
  'aria-label': STRING,
  'aria-level': INTEGER,
  'aria-live': token('assertive', 'off', 'polite'),
  'aria-modal': BOOLEAN,
  'aria-multiline': BOOLEAN,
  'aria-multiselectable': BOOLEAN,
  'aria-orientation': token('horizontal', 'vertical'),
  'aria-placeholder': STRING,
  'aria-posinset': INTEGER,
  'aria-pressed': TRISTATE,
  'aria-readonly': BOOLEAN,
  'aria-relevant': STRING,
  'aria-required': BOOLEAN,
  'aria-roledescription': STRING,
  'aria-rowcount': INTEGER,
  'aria-rowindex': INTEGER,
  'aria-rowindextext': STRING,
  'aria-rowspan': INTEGER,
  'aria-selected': BOOLEAN,
  'aria-setsize': INTEGER,
  'aria-sort': token('ascending', 'descending', 'none', 'other'),
  'aria-valuemax': NUMBER,
  'aria-valuemin': NUMBER,
  'aria-valuenow': NUMBER,
  'aria-valuetext': STRING,
}

/** ARIA attributes that hold ids, which bindings can't set (and static ones point at the host page too). */
export const ARIA_ID_REFERENCES: ReadonlySet<string> = new Set([
  'aria-activedescendant', 'aria-controls', 'aria-describedby', 'aria-details', 'aria-errormessage',
  'aria-flowto', 'aria-labelledby', 'aria-owns',
])
/** Deprecated in ARIA 1.2. */
const ARIA_DEPRECATED: ReadonlySet<string> = new Set(['aria-grabbed', 'aria-dropeffect'])

/** Every ARIA attribute name the checker knows, for did-you-mean on static and bound names. */
export const ARIA_NAMES: readonly string[] = [...Object.keys(ARIA_ATTRIBUTES), ...ARIA_ID_REFERENCES, ...ARIA_DEPRECATED]

/** The prefix the runtime and the shell keep for their own attributes (data-melzin-ready...). */
export const RESERVED_DATA_PREFIX = 'data-melzin-'

const DATA_NAME_RE = /^data-[a-z][a-z0-9]*(?:-[a-z0-9]+)*$/

const HOST_REACHING = new Set([
  'id', 'name', 'for', 'form', 'list', 'headers', 'target', 'formtarget', 'popovertarget', 'commandfor',
  'interestfor', 'anchor', 'itemref', 'slot', 'is', 'part', 'exportparts',
])
const URL_LIKE = new Set(['src', 'srcset', 'alt', 'poster', 'action', 'formaction', 'data', 'background', 'xlink:href', 'ping', 'cite'])
const FORM_STATE = new Set(['value', 'checked', 'selected', 'disabled', 'readonly', 'required', 'placeholder', 'min', 'max', 'step', 'open', 'hidden'])

/** A did-you-mean among the ARIA names: the closest name within two edits, or undefined. */
export function suggestAriaName(name: string): string | undefined {
  let best: string | undefined
  let bestDistance = 3
  for (const candidate of ARIA_NAMES) {
    const distance = editDistance(name, candidate)
    if (distance < bestDistance) {
      best = candidate
      bestDistance = distance
    }
  }
  return best
}

function editDistance(a: string, b: string): number {
  const row = Array.from({ length: b.length + 1 }, (_, i) => i)
  for (let i = 1; i <= a.length; i++) {
    let previous = row[0]!
    row[0] = i
    for (let j = 1; j <= b.length; j++) {
      const current = row[j]!
      row[j] = Math.min(row[j]! + 1, row[j - 1]! + 1, previous + (a[i - 1] === b[j - 1] ? 0 : 1))
      previous = current
    }
  }
  return row[b.length]!
}

/** Why a static aria-* attribute name is wrong (unknown or deprecated), or undefined. */
export function ariaNameProblem(name: string): string | undefined {
  if (!name.startsWith('aria-')) return undefined
  if (ARIA_DEPRECATED.has(name)) return `${name} is deprecated in WAI-ARIA 1.2`
  if (Object.hasOwn(ARIA_ATTRIBUTES, name) || ARIA_ID_REFERENCES.has(name)) return undefined
  const best = suggestAriaName(name)
  return `${name} isn't an ARIA attribute${best === undefined ? '' : `; did you mean ${best}?`}`
}

/**
 * Why `m-bind:<target>` can't be used on `<tag>`, or undefined when it can. `target` is the attribute
 * name after `m-bind:`, as written (lowercase, possibly with modifiers). m-bind:href and m-bind:class
 * have rules of their own and aren't checked here.
 */
export function bindTargetProblem(target: string, tag: string): string | undefined {
  if (target === '') return `a bare m-bind binds a component's props, which come later (D18); bind one attribute: m-bind:aria-label="path"`
  if (target.includes('.')) {
    return `binding modifiers aren't supported: write m-bind:${target.slice(0, target.indexOf('.'))}`
  }
  if (target.startsWith('[')) return `dynamic attribute names aren't supported; write the attribute's name: m-bind:aria-label`
  if (tag.includes('-')) return `attributes can't be bound on custom elements yet (<${tag}>); there, m-bind will mean a component's props (D18)`
  if (target.startsWith('on')) return `event handler attributes never take data; use m-on:click="emit('name')"`
  if (target === 'style') return `styles never come from data (D9): switch classes with m-bind:class="{ 'classes': condition }"`
  if (target.startsWith('aria-')) {
    if (Object.hasOwn(ARIA_ATTRIBUTES, target)) return undefined
    if (ARIA_ID_REFERENCES.has(target)) {
      return `${target} names ids, which resolve against the whole host page; bind aria-label or aria-description to the text instead`
    }
    const best = suggestAriaName(target)
    return `${target} isn't an ARIA attribute that holds a value${best !== undefined && best !== target ? `; did you mean m-bind:${best}?` : ''}`
  }
  if (target.startsWith('data-')) {
    if (target.startsWith(RESERVED_DATA_PREFIX)) return `${RESERVED_DATA_PREFIX}* attributes belong to Melzin's runtime and shell; pick another name`
    if (!DATA_NAME_RE.test(target)) return `'${target}' isn't a data-* name this binding can set: use lowercase letters, digits and dashes, such as data-state`
    return undefined
  }
  if (target === 'title') return undefined
  if (HOST_REACHING.has(target)) return `${target} names elements in the whole host page, so it can't come from data`
  if (URL_LIKE.has(target)) return `${target} waits for image and URL field types (#11); for now show initials or an emoji with m-text`
  if (FORM_STATE.has(target)) {
    return `${target} can't be bound yet; for a look, bind data-<name> or aria-* and style it with data-[…]: or aria-*: variants, or show one of two elements with m-if and m-else`
  }
  return `'${target}' can't be bound; m-bind sets ${BINDABLE_TARGETS} (and href from link fields)`
}

/** The JSON Schema leaf types a bound attribute may read, with what to say when the field has another. */
export function bindTypeProblem(target: string, type: 'string' | 'number' | 'boolean'): string | undefined {
  if (target === 'title') return type === 'boolean' ? `title needs text; a boolean would show "true"; bind a string field` : undefined
  if (!target.startsWith('aria-')) return undefined
  const aria = Object.hasOwn(ARIA_ATTRIBUTES, target) ? ARIA_ATTRIBUTES[target]! : undefined
  if (aria === undefined) return undefined
  switch (aria.kind) {
    case 'boolean':
      return type === 'boolean' ? undefined : `${target} takes true or false: bind a boolean field`
    case 'tristate':
      return type === 'number' ? `${target} takes true, false or mixed: bind a boolean field (or a string one for mixed)` : undefined
    case 'integer':
    case 'number':
      return type === 'number' ? undefined : `${target} takes a number: bind a number field`
    case 'token': {
      const booleans = aria.tokens.includes('true') && aria.tokens.includes('false')
      if (type === 'string' || (type === 'boolean' && booleans)) return undefined
      return `${target} takes one of ${aria.tokens.join(', ')}: bind a string field`
    }
    case 'string':
      return type === 'boolean' ? `${target} takes text: bind a string field` : undefined
  }
}

/** Why a value can't go into a bound ARIA attribute (a token it doesn't take, a fraction for an integer). */
export function ariaValueProblem(target: string, value: unknown): string | undefined {
  const aria = Object.hasOwn(ARIA_ATTRIBUTES, target) ? ARIA_ATTRIBUTES[target]! : undefined
  if (aria === undefined || value === undefined || value === null) return undefined
  if (aria.kind === 'token' && typeof value === 'string' && !aria.tokens.includes(value)) {
    return `${target} takes ${aria.tokens.join(', ')}, not '${value}'`
  }
  if (aria.kind === 'tristate' && typeof value === 'string' && !['true', 'false', 'mixed'].includes(value)) {
    return `${target} takes true, false or mixed, not '${value}'`
  }
  if (aria.kind === 'integer' && typeof value === 'number' && !Number.isInteger(value)) {
    return `${target} takes a whole number, not ${value}`
  }
  return undefined
}

/**
 * The text a bound attribute gets for a value, or null to remove the attribute (D37): a boolean writes
 * "true" or removes the attribute, except on aria-*, which keeps "false"; strings and numbers are
 * written as text; a missing value (or anything else, which the data warnings cover) removes it.
 */
export function attributeText(target: string, value: unknown): string | null {
  if (typeof value === 'boolean') return value ? 'true' : target.startsWith('aria-') ? 'false' : null
  if (typeof value === 'string') return value
  if (typeof value === 'number') return Number.isFinite(value) ? String(value) : null
  return null
}

// --- m-bind:class

/** One key of a class object: its class tokens, and the condition that adds them. */
export type ClassEntry = { classes: string[]; keyStart: number; keyEnd: number; condition: Condition; pathStart: number }
export type ClassDirectiveResult = { ok: true; entries: ClassEntry[] } | { ok: false; message: string; offset: number }

const CLASS_EXAMPLE = `${CLASS_DIRECTIVE}="{ 'line-through text-zinc-400': task.done, 'text-zinc-900': !task.done }"`
const CLASS_USAGE = `${CLASS_DIRECTIVE} takes Vue's object syntax: ${CLASS_EXAMPLE}`
const CLASS_LITERAL_MESSAGE = `class names are written in the file (literal keys), never built from data; ${CLASS_USAGE}`

/**
 * `m-bind:class="{ 'a b': x, c: !y.length }"`: each key's class tokens (split on whitespace) and its
 * condition, parsed as m-if's. Keys are quoted strings or plain names; values are conditions.
 */
export function parseClassDirective(value: string): ClassDirectiveResult {
  const first = value.search(/\S/)
  if (first < 0) return { ok: false, message: CLASS_USAGE, offset: 0 }
  const lead = value.charAt(first)
  if (lead === '[') return { ok: false, message: `the array form isn't supported; classes that are always on go in class, and ${CLASS_USAGE}`, offset: first }
  if (lead === '`') return { ok: false, message: CLASS_LITERAL_MESSAGE, offset: first }
  if (lead !== '{') return { ok: false, message: CLASS_LITERAL_MESSAGE, offset: first }
  const close = findClose(value, first)
  if (close < 0) return { ok: false, message: `missing '}' to end the class object; ${CLASS_USAGE}`, offset: value.length }
  const rest = value.slice(close + 1)
  if (rest.trim() !== '') return { ok: false, message: `unexpected text after the class object; ${CLASS_USAGE}`, offset: close + 1 + rest.search(/\S/) }

  const entries: ClassEntry[] = []
  const seen = new Set<string>()
  let i = first + 1
  for (;;) {
    i = skipSpace(value, i)
    if (i >= close) break
    // The key: a quoted string, or a plain name like Vue's { hidden: x }.
    const keyStart = i
    let key: string
    const quote = value.charAt(i)
    if (quote === "'" || quote === '"') {
      const end = value.indexOf(quote, i + 1)
      if (end < 0 || end > close) return { ok: false, message: 'unterminated string', offset: i }
      key = value.slice(i + 1, end)
      i = end + 1
    } else if (quote === '[') {
      return { ok: false, message: `computed keys aren't supported; ${CLASS_LITERAL_MESSAGE}`, offset: i }
    } else {
      const match = /^[A-Za-z_$][\w$-]*/.exec(value.slice(i))
      if (match === null) return { ok: false, message: `expected a class name in quotes, as in ${CLASS_EXAMPLE}`, offset: i }
      key = match[0]
      i += key.length
    }
    const keyEnd = i
    if (key.includes('${') || key.includes('{{')) return { ok: false, message: CLASS_LITERAL_MESSAGE, offset: keyStart }
    if (/&(?:#\d+|#x[0-9a-f]+|[a-z]+);/i.test(key)) {
      return { ok: false, message: `class names can't hold HTML entities (Tailwind can't see them); use the other kind of quote around the attribute`, offset: keyStart }
    }
    const classes = key.split(/[ \t\n\f\r]+/).filter((token) => token !== '')
    if (classes.length === 0) return { ok: false, message: 'a key needs at least one class name', offset: keyStart }
    const normalized = classes.join(' ')
    if (seen.has(normalized)) return { ok: false, message: `'${normalized}' appears twice; give each key once`, offset: keyStart }
    seen.add(normalized)
    i = skipSpace(value, i)
    if (value.charAt(i) !== ':') return { ok: false, message: `expected ':' and a condition after '${key}', as in ${CLASS_EXAMPLE}`, offset: i }
    i++
    // The value runs to the next top-level comma (strings can't hold one here: values are conditions).
    let end = i
    while (end < close && value.charAt(end) !== ',') end++
    const source = value.slice(i, end)
    const valueStart = i + (source.search(/\S/) < 0 ? 0 : source.search(/\S/))
    if (/^\s*(true|false)\s*$/.test(source)) {
      return { ok: false, message: `a key's value is a condition from data; a class that's always on goes in class, and one that's never on is left out`, offset: valueStart }
    }
    const parsed = parseConditionDirective(CLASS_DIRECTIVE, source)
    if (!parsed.ok) {
      const message = parsed.message.replace(`${CLASS_DIRECTIVE}="`, `{ '${normalized}': `).replace(/"( |$|;)/, ' }$1')
      return { ok: false, message, offset: i + parsed.offset }
    }
    entries.push({ classes, keyStart, keyEnd, condition: parsed.condition, pathStart: i + parsed.pathStart })
    i = end
    if (value.charAt(i) === ',') i++
  }
  if (entries.length === 0) return { ok: false, message: `the class object is empty; ${CLASS_USAGE}`, offset: first }
  return { ok: true, entries }
}

function skipSpace(value: string, i: number): number {
  while (i < value.length && /[ \t\n\f\r]/.test(value.charAt(i))) i++
  return i
}

/** The '}' that closes the object at `open`, skipping quoted strings, or -1. */
function findClose(value: string, open: number): number {
  for (let i = open + 1; i < value.length; i++) {
    const ch = value.charAt(i)
    if (ch === "'" || ch === '"') {
      const end = value.indexOf(ch, i + 1)
      if (end < 0) return -1
      i = end
    } else if (ch === '}') return i
    else if (ch === '{') return -1
  }
  return -1
}

/** The classes of a class attribute, as tokens. */
export function classTokens(value: string | null | undefined): string[] {
  return (value ?? '').split(/[ \t\n\f\r]+/).filter((token) => token !== '')
}
