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

export const VIEW_FILE_SUFFIX = '.melzin.html'

export const DIRECTIVE_PREFIX = 'm-'
export const TEXT_DIRECTIVE = 'm-text'
export const CLICK_DIRECTIVE = 'm-on:click'
export const SUPPORTED_DIRECTIVES = [TEXT_DIRECTIVE, CLICK_DIRECTIVE] as const
export type DirectiveName = (typeof SUPPORTED_DIRECTIVES)[number]

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
  'v-on:click': CLICK_DIRECTIVE,
  '@click': CLICK_DIRECTIVE,
  'x-on:click': CLICK_DIRECTIVE,
}

/** Names inside expressions that deserve a hint instead of a generic error. */
export const NAME_HINTS: Readonly<Record<string, string>> = {
  $emit: "use emit('name') instead of Vue's $emit",
}

export const FOREIGN_SYNTAX_MESSAGE = "Vue/Alpine syntax isn't supported; this POC has m-text and m-on:click"
export const UNSUPPORTED_DIRECTIVE_MESSAGE = 'not supported yet; the POC supports only m-text and m-on:click'

// What to do instead, per unsupported directive (docs/authoring.md §7 has the same table).
const UNSUPPORTED_HINTS: readonly [RegExp, string][] = [
  [/^m-(if|else|else-if|show)$/, 'to hide an element, bind it to a value that may be "" and add the class empty:hidden'],
  [/^m-for$/, 'lists come later; use a fixed number of fields such as first, second, third'],
  [/^m-(bind|class|style)(:|$)/, 'attributes and classes are static for now'],
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
  if (name === TEXT_DIRECTIVE || name === CLICK_DIRECTIVE) return { kind: 'directive', name }
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
