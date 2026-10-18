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
/** The name views read the URL input under: `route.name`, `route.params.handle`, `route.query.tab` (D27). */
export const ROUTE_INPUT = 'route'

export const DIRECTIVE_PREFIX = 'm-'
export const TEXT_DIRECTIVE = 'm-text'
export const SHOW_DIRECTIVE = 'm-show'
export const IF_DIRECTIVE = 'm-if'
export const ELSE_IF_DIRECTIVE = 'm-else-if'
export const ELSE_DIRECTIVE = 'm-else'
export const CLICK_DIRECTIVE = 'm-on:click'
/** A link's URL, from a link field (SPEC D23). The only m-bind for now. */
export const HREF_DIRECTIVE = 'm-bind:href'
export const SUPPORTED_DIRECTIVES = [
  TEXT_DIRECTIVE,
  SHOW_DIRECTIVE,
  IF_DIRECTIVE,
  ELSE_IF_DIRECTIVE,
  ELSE_DIRECTIVE,
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

// `m-text, m-show, m-if, m-else-if, m-else, m-on:click and m-bind:href`, for messages.
const DIRECTIVE_LIST = SUPPORTED_DIRECTIVES.join(', ').replace(/, ([^,]+)$/, ' and $1')

export const FOREIGN_SYNTAX_MESSAGE = `Vue/Alpine syntax isn't supported; Melzin has ${DIRECTIVE_LIST}`
export const UNSUPPORTED_DIRECTIVE_MESSAGE = `not supported yet; Melzin supports only ${DIRECTIVE_LIST}`

// What to do instead, per unsupported directive (docs/authoring.md §7 has the same table).
const UNSUPPORTED_HINTS: readonly [RegExp, string][] = [
  [/^m-for$/, 'lists come later; use a fixed number of fields such as first, second, third, with m-if on the optional ones'],
  [/^m-(bind|class|style)(:|$)/, 'other attributes and classes are static for now (m-bind:href is the only binding, for links); to switch styles, show one of two elements with m-if and m-else'],
  [/^m-model$/, "forms and inputs aren't supported yet"],
  [/^m-html$/, 'only plain text, through m-text'],
  [/^m-on:/, 'only clicks for now: m-on:click'],
]

function unsupportedMessage(name: string): string {
  const hint = UNSUPPORTED_HINTS.find(([pattern]) => pattern.test(name))?.[1]
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
  const suggestion = FOREIGN_DIRECTIVE_HINTS[name]
  if (suggestion !== undefined) {
    return { kind: 'foreign', suggestion, message: `'${name}' is Vue/Alpine syntax; use ${suggestion}` }
  }
  if (name.startsWith('v-') || name.startsWith('x-') || name.startsWith('@') || name.startsWith(':')) {
    return { kind: 'foreign', message: `'${name}': ${FOREIGN_SYNTAX_MESSAGE}` }
  }
  if (name.startsWith(DIRECTIVE_PREFIX)) {
    return { kind: 'unsupported', message: unsupportedMessage(name) }
  }
  return { kind: 'plain' }
}
