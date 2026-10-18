// Names shared by the runtime, the checker and the shell.

export const SCHEMA_BLOCK_TYPE = 'melzin/schema'
export const SNAPSHOTS_BLOCK_TYPE = 'melzin/snapshots'
export const DATA_BLOCK_TYPES = [SCHEMA_BLOCK_TYPE, SNAPSHOTS_BLOCK_TYPE] as const
export type DataBlockType = (typeof DATA_BLOCK_TYPES)[number]

/** The data block a `<script type>` names, or undefined. Case and surrounding spaces don't matter. */
export function dataBlockType(type: string | null | undefined): DataBlockType | undefined {
  const normalized = (type ?? '').trim().toLowerCase()
  return DATA_BLOCK_TYPES.find((candidate) => candidate === normalized)
}

export const VIEW_FILE_SUFFIX = '.mel.html'

/** The route table's file, at the project root (SPEC D21). */
export const ROUTES_FILE = 'routes.json'
/** Design alternatives live in explore/<alternative>/ at the project root, next to views/ (SPEC D31). */
export const EXPLORE_DIR = 'explore'
/**
 * What the shell calls the version of a view in views/, as opposed to its alternatives (`?alt=current`),
 * so no alternative can take the name (SPEC D31).
 */
export const CURRENT_VERSION = 'current'
/** The name views read the URL input under: `route.name`, `route.params.handle`, `route.query.tab` (D27). */
export const ROUTE_INPUT = 'route'

export const DIRECTIVE_PREFIX = 'm-'
export const TEXT_DIRECTIVE = 'm-text'
export const SHOW_DIRECTIVE = 'm-show'
export const IF_DIRECTIVE = 'm-if'
export const ELSE_IF_DIRECTIVE = 'm-else-if'
export const ELSE_DIRECTIVE = 'm-else'
/** Repeats its element once per item of a list (SPEC D34): `m-for="member in members"`. */
export const FOR_DIRECTIVE = 'm-for'
export const CLICK_DIRECTIVE = 'm-on:click'
/** A link's URL, from a link field (SPEC D23). The only m-bind for now. */
export const HREF_DIRECTIVE = 'm-bind:href'
export const SUPPORTED_DIRECTIVES = [
  TEXT_DIRECTIVE,
  SHOW_DIRECTIVE,
  IF_DIRECTIVE,
  ELSE_IF_DIRECTIVE,
  ELSE_DIRECTIVE,
  FOR_DIRECTIVE,
  CLICK_DIRECTIVE,
  HREF_DIRECTIVE,
] as const
export type DirectiveName = (typeof SUPPORTED_DIRECTIVES)[number]

/** m-if, m-else-if and m-else: an element has at most one, and siblings with them form a chain. */
export const CHAIN_DIRECTIVES = [IF_DIRECTIVE, ELSE_IF_DIRECTIVE, ELSE_DIRECTIVE] as const
export type ChainDirective = (typeof CHAIN_DIRECTIVES)[number]

export function isChainDirective(name: string): name is ChainDirective {
  return (CHAIN_DIRECTIVES as readonly string[]).includes(name)
}

/** The only callee m-on:click accepts for now. */
export const EMIT_FUNCTION = 'emit'

export const IDENT_RE = /^[A-Za-z_][A-Za-z0-9_]*$/

export function isIdent(value: string): boolean {
  return IDENT_RE.test(value)
}

/** Vue/Alpine spellings that map one-to-one to a Melzin directive. */
export const FOREIGN_DIRECTIVE_HINTS: Readonly<Record<string, DirectiveName>> = {
  'v-text': TEXT_DIRECTIVE,
  'x-text': TEXT_DIRECTIVE,
  'v-show': SHOW_DIRECTIVE,
  'x-show': SHOW_DIRECTIVE,
  'v-if': IF_DIRECTIVE,
  'x-if': IF_DIRECTIVE,
  'v-else-if': ELSE_IF_DIRECTIVE,
  'v-else': ELSE_DIRECTIVE,
  'v-for': FOR_DIRECTIVE,
  'x-for': FOR_DIRECTIVE,
  'v-on:click': CLICK_DIRECTIVE,
  '@click': CLICK_DIRECTIVE,
  'x-on:click': CLICK_DIRECTIVE,
  'v-bind:href': HREF_DIRECTIVE,
  ':href': HREF_DIRECTIVE,
  'x-bind:href': HREF_DIRECTIVE,
}

/** Names inside expressions that deserve a hint instead of a generic error. */
export const NAME_HINTS: Readonly<Record<string, string>> = {
  $emit: "use emit('name') instead of Vue's $emit",
}

// `m-text, m-show, m-if, m-else-if, m-else, m-for, m-on:click and m-bind:href`, for messages.
const DIRECTIVE_LIST = SUPPORTED_DIRECTIVES.join(', ').replace(/, ([^,]+)$/, ' and $1')

export const FOREIGN_SYNTAX_MESSAGE = `Vue/Alpine syntax isn't supported; Melzin has ${DIRECTIVE_LIST}`
export const UNSUPPORTED_DIRECTIVE_MESSAGE = `not supported yet; Melzin supports only ${DIRECTIVE_LIST}`

/** For a <template> with m-for, v-for or x-for (core/markup.ts): where an m-for goes instead. */
export const TEMPLATE_FOR_MESSAGE = "put m-for on the element to repeat; <template> isn't supported"

/** Vue's `:key` and its spellings: rows are keyed by the list's key, which the schema declares (D34). */
export const KEY_BINDING_MESSAGE = 'keys live in the schema: add "key": "<field>" to the list, such as "key": "id"'
const KEY_BINDINGS = new Set(['m-bind:key', 'm-key', ':key', 'v-bind:key', 'x-bind:key'])

/** Why m-if, m-else-if and m-else can't go on an m-for element (`directive` names the one used). */
export function forChainMessage(directive: string): string {
  return `${directive} can't go on an element with ${FOR_DIRECTIVE}: wrap the list in an element with ${directive}, or put the condition inside the row; to show only some items, have the host filter the list`
}

/** For a path that picks a list item by position, such as `members.0.name` or `members[0].name`. */
export function positionMessage(path: string): string {
  return `'${path}' picks an item by position: a list's items are shown with ${FOR_DIRECTIVE}; for one particular item, have the host send it as its own field, such as featured`
}

// What to do instead, per unsupported directive (docs/authoring.md §7 has the same table).

/** The attribute a binding sets: `class` for m-bind:class or m-class, '' for a bare m-bind; undefined for other names. */
function bindingTarget(name: string): string | undefined {
  if (name === 'm-bind') return ''
  if (name.startsWith('m-bind:')) return name.slice('m-bind:'.length).split('.')[0]
  return /^m-(class|style)(:|$)/.exec(name)?.[1]
}

function bindingHint(target: string): string {
  const only = '(m-bind:href is the only binding, for links)'
  if (target === 'class' || target === 'style') {
    return `classes and styles are static for now ${only}; to switch styles, show one of two elements with m-if and m-else`
  }
  if (target === 'title' || target.startsWith('aria-')) {
    return `attributes are static for now ${only}; for an accessible name from data, put sr-only text with m-text inside the element`
  }
  return `attributes are static for now ${only}; to switch one, show one of two elements with m-if and m-else`
}

const OTHER_HINTS: readonly [RegExp, string][] = [
  [/^m-model$/, "forms and inputs aren't supported yet"],
  [/^m-html$/, 'only plain text, through m-text'],
  [/^m-on:/, 'only clicks for now: m-on:click'],
]

/** What to write instead of an m-* directive Melzin doesn't have, if there's something to say. */
function unsupportedHint(name: string): string | undefined {
  const target = bindingTarget(name)
  return target === undefined ? OTHER_HINTS.find(([pattern]) => pattern.test(name))?.[1] : bindingHint(target)
}

/** The m-* spelling of a Vue or Alpine attribute, to find its hint: `:class` → `m-bind:class`, `@submit` → `m-on:submit`. */
function melzinSpelling(name: string): string {
  if (name.startsWith(':')) return `m-bind${name}`
  if (name.startsWith('@')) return `m-on:${name.slice(1)}`
  return `${DIRECTIVE_PREFIX}${name.slice(2)}`
}

function unsupportedMessage(name: string): string {
  const hint = unsupportedHint(name)
  return `'${name}' is ${UNSUPPORTED_DIRECTIVE_MESSAGE}${hint === undefined ? '' : `; ${hint}`} (docs/authoring.md §7)`
}

export type AttributeKind =
  | { kind: 'plain' }
  | { kind: 'directive'; name: DirectiveName }
  | { kind: 'foreign'; message: string; suggestion?: DirectiveName }
  | { kind: 'unsupported'; message: string }

/**
 * Classifies an (already lowercased) attribute name: a supported directive, Vue/Alpine syntax
 * (with a hint when there is a direct equivalent), an `m-*` directive we don't support yet, or a plain
 * HTML attribute.
 */
export function classifyAttribute(name: string): AttributeKind {
  if ((SUPPORTED_DIRECTIVES as readonly string[]).includes(name)) return { kind: 'directive', name: name as DirectiveName }
  if (KEY_BINDINGS.has(name)) {
    return name.startsWith(DIRECTIVE_PREFIX)
      ? { kind: 'unsupported', message: `'${name}': ${KEY_BINDING_MESSAGE}` }
      : { kind: 'foreign', message: `'${name}' is Vue/Alpine syntax; ${KEY_BINDING_MESSAGE}` }
  }
  const suggestion = Object.hasOwn(FOREIGN_DIRECTIVE_HINTS, name) ? FOREIGN_DIRECTIVE_HINTS[name] : undefined
  if (suggestion !== undefined) {
    // Alpine's x-for only works on a <template>, which views don't have.
    const use = name === 'x-for' ? `${suggestion} on the element to repeat (<template> isn't supported)` : suggestion
    return { kind: 'foreign', suggestion, message: `'${name}' is Vue/Alpine syntax; use ${use}` }
  }
  if (name.startsWith('v-') || name.startsWith('x-') || name.startsWith('@') || name.startsWith(':')) {
    // `:class`, `v-bind:title`, `@submit`, `v-model`: the hint for the m-* spelling, which isn't supported either.
    const hint = unsupportedHint(melzinSpelling(name))
    return hint === undefined
      ? { kind: 'foreign', message: `'${name}': ${FOREIGN_SYNTAX_MESSAGE}` }
      : { kind: 'foreign', message: `'${name}' is Vue/Alpine syntax; ${hint} (docs/authoring.md §7)` }
  }
  if (name.startsWith(DIRECTIVE_PREFIX)) {
    return { kind: 'unsupported', message: unsupportedMessage(name) }
  }
  return { kind: 'plain' }
}
