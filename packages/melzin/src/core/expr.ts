// Tokenizer and recursive-descent parser for directive values. Values become syntax trees and are
// never evaluated (P1, #24). Grammar for now:
//
//   expr    := '!'? operand
//   operand := path | call
//   path    := ident ('.' ident)*
//   call    := ident '(' (string (',' arg)*)? ')'
//   arg     := string | object
//   object  := '{' (field (',' field)* ','?)? '}'       an event's payload (SPEC D35)
//   field   := ident ':' path
//   string  := '…' | "…"
//   loop    := ident 'in' path                         m-for only (D34)
//
// Growing the language (operators, more calls, formatters) means extending this file.

import {
  CLICK_DIRECTIVE,
  EMIT_FUNCTION,
  FOR_DIRECTIVE,
  HREF_DIRECTIVE,
  NAME_HINTS,
  TEXT_DIRECTIVE,
  isIdent,
  positionMessage,
} from './constants.ts'

export type StringLit = { kind: 'string'; value: string; start: number; end: number }
export type PathExpr = { kind: 'path'; segments: string[]; start: number; end: number }
/** A field of an object literal: `optionId: option.id`. `nameStart` is the offset of its name. */
export type ObjectField = { name: string; nameStart: number; value: PathExpr }
export type ObjectLit = { kind: 'object'; fields: ObjectField[]; start: number; end: number }
export type CallExpr = { kind: 'call'; callee: string; args: (StringLit | ObjectLit)[]; start: number; end: number }
export type NotExpr = { kind: 'not'; operand: PathExpr | CallExpr; start: number; end: number }
export type Expr = PathExpr | CallExpr | NotExpr
/** `member in members`: the alias each row reads its item through, and the list. */
export type LoopExpr = { kind: 'loop'; alias: string; aliasStart: number; source: PathExpr; start: number; end: number }

/** `offset` is 0-based, into the directive value. */
export type ParseError = { message: string; offset: number }

/** `fix` is there when the value is an emit whose payload is written in a form emit doesn't take. */
export type ParseResult = { ok: true; expr: Expr } | { ok: false; message: string; offset: number; fix?: PayloadFix }

export type TokenKind = 'word' | 'string' | '.' | '(' | ')' | ',' | '!' | '[' | ']' | '{' | '}' | ':' | 'eof'
export type Token = { kind: TokenKind; value: string; start: number; end: number }

class ExprSyntaxError extends Error {
  readonly offset: number
  readonly fix: PayloadFix | undefined
  constructor(message: string, offset: number, fix?: PayloadFix) {
    super(message)
    this.offset = offset
    this.fix = fix
  }
}

/** The error for a payload written in a form emit doesn't take: the fix from the value alone. */
function payloadFixError(fix: PayloadFix, offset: number): ExprSyntaxError {
  return new ExprSyntaxError(payloadFixText(fix, defaultPayloadFixFields(fix)), offset, fix)
}

const WHITESPACE = new Set([' ', '\t', '\n', '\r', '\f'])
const PUNCTUATION = new Set(['.', '(', ')', ',', '!', '[', ']', '{', '}', ':'])
// Assigning it to a plain object would set the object's prototype instead of adding a key.
const RESERVED_NAME = '__proto__'
// Words that read as literals in a payload, where only paths are allowed for now.
const LITERAL_WORDS = new Set(['true', 'false', 'null', 'undefined'])

// What m-for accepts (D34), and what to do instead of each form Vue allows that Melzin doesn't.
const LOOP_EXAMPLE = `${FOR_DIRECTIVE}="member in members"`
const LOOP_USAGE = `${FOR_DIRECTIVE} needs a name for each item and a list: ${LOOP_EXAMPLE}`
const NO_INDEX_MESSAGE =
  "there's no index: style rows by position with Tailwind's first:, last:, odd: and nth-* variants, and identify them by the list's key"
const DESTRUCTURING_MESSAGE = 'name the item and read its fields: member in members, then member.name'
const RANGE_MESSAGE = 'the number of rows comes from the data: put the items in snapshots'
const SHAPED_LIST_MESSAGE = 'the host sends the list as it should show: filtered, sorted and cut to length'
const PAYLOAD_LEAVES_MESSAGE = 'payload values are paths to strings, numbers or booleans for now; give each value a field of its own'
const CALL_VALUE_MESSAGE = 'payload values are paths, not calls; have the host send the value as data'

/**
 * A payload written in a form emit doesn't take (D35), with what the value says about the fix, so a
 * caller that knows the event's declared payload and the rows in scope can write the fix with their
 * names (payloadFixMessage in payload.ts). The parse error's own message is the fix written from the
 * value alone: payloadFixText with defaultPayloadFixFields.
 *
 * - `positional`: a value where the payload object goes, `emit('pick', member.handle)`; `path` is the
 *   value's path when it is one.
 * - `shorthand`: a field written without its value, `{ filter }`; `name` is the field.
 * - `quoted`: a quoted field name, `{ 'id': x }`; `name` is what the quotes hold, and `path` the value's
 *   path when one follows.
 */
export type PayloadFix = {
  kind: 'positional' | 'shorthand' | 'quoted'
  /** The function called (emit) and the event it names. */
  callee: string
  event: string
  name?: string
  path?: string[]
}

/** What examples show where the value names no field or no path. */
export const FIELD_PLACEHOLDER = '<field>'
export const PATH_PLACEHOLDER = '<path>'

/** `{ a: x, b: y }`, or `{}`. */
function formatObject(fields: readonly (readonly [string, string])[]): string {
  return fields.length === 0 ? '{}' : `{ ${fields.map(([name, path]) => `${name}: ${path}`).join(', ')} }`
}

/** The message for a payload written in a form emit doesn't take, with the fields its fix shows: [name, path]. */
export function payloadFixText(fix: PayloadFix, fields: readonly (readonly [string, string])[]): string {
  const object = formatObject(fields)
  if (fix.kind === 'positional') return `a payload is an object of named fields: ${fix.callee}('${fix.event}', ${object})`
  if (fix.kind === 'shorthand') return `write the value's path too: ${object}`
  return `write field names without quotes: ${object}`
}

function capitalize(name: string): string {
  return `${name.charAt(0).toUpperCase()}${name.slice(1)}`
}

/** A field name for a value's path, for examples: `member.handle` → `memberHandle`, `id` → `id`. */
export function fieldNameFor(segments: readonly string[]): string {
  return segments.length >= 2 ? `${segments.at(-2)}${capitalize(segments.at(-1)!)}` : (segments[0] ?? FIELD_PLACEHOLDER)
}

/** A field name from quoted text: `'optionId'` → `optionId`, `'option id'` → `optionId`; undefined when none comes out. */
export function fieldNameFromText(text: string): string | undefined {
  const name = text.split(/[^A-Za-z0-9_]+/).filter((word) => word !== '').map((word, i) => (i === 0 ? word : capitalize(word))).join('')
  return isIdent(name) && name !== RESERVED_NAME ? name : undefined
}

/** The fields a PayloadFix's message shows from the value alone, with placeholders where it says nothing. */
export function defaultPayloadFixFields(fix: PayloadFix): [string, string][] {
  const path = fix.path === undefined || fix.path.length === 0 ? undefined : fix.path
  if (fix.kind === 'positional') return [[path === undefined ? FIELD_PLACEHOLDER : fieldNameFor(path), path?.join('.') ?? PATH_PLACEHOLDER]]
  // `{ filter }` means `{ filter: filter }` in JavaScript.
  if (fix.kind === 'shorthand') return [[fix.name ?? FIELD_PLACEHOLDER, fix.name ?? PATH_PLACEHOLDER]]
  return [[fieldNameFromText(fix.name ?? '') ?? FIELD_PLACEHOLDER, path?.join('.') ?? PATH_PLACEHOLDER]]
}

/** An argument as written, for examples: `'vote'`, `{ optionId: option.id }`. */
function formatArgument(arg: StringLit | ObjectLit): string {
  if (arg.kind === 'string') return arg.value.includes("'") ? JSON.stringify(arg.value) : `'${arg.value}'`
  return formatObject(arg.fields.map((field) => [field.name, field.value.segments.join('.')] as const))
}

/** emit with more than one payload: the fix puts the fields of every payload object in one. */
function extraArgumentMessage(callee: string, event: string, payloads: readonly (StringLit | ObjectLit)[]): string {
  const fields = payloads.flatMap((arg) => (arg.kind === 'object' ? arg.fields.map((field) => [field.name, field.value.segments.join('.')] as const) : []))
  return `${callee} takes the event name and one payload object: ${callee}('${event}', ${formatObject(fields)})`
}

// Words are lexed loosely (letters, digits, _ and $) so the parser can say "'1x' isn't a valid name"
// or give a hint for `$emit` instead of complaining about a single character.
function isWordChar(ch: string): boolean {
  return /^[A-Za-z0-9_$]$/.test(ch)
}

// Characters that look like nothing (or like a plain space) get named, so the message is readable.
const CHARACTER_NAMES: Readonly<Record<number, string>> = {
  0x00a0: 'no-break space',
  0x2007: 'figure space',
  0x200b: 'zero-width space',
  0x200c: 'zero-width non-joiner',
  0x200d: 'zero-width joiner',
  0x2028: 'line separator',
  0x2029: 'paragraph separator',
  0x202f: 'narrow no-break space',
  0x2060: 'word joiner',
  0x3000: 'ideographic space',
  0xfeff: 'byte order mark',
}

/** `'+'`, or `U+00A0 (no-break space)` for invisible and space-like characters. */
export function describeCharacter(source: string, offset: number): string {
  const code = source.codePointAt(offset) ?? 0
  const ch = String.fromCodePoint(code)
  if (/^[\p{L}\p{N}\p{P}\p{S}]$/u.test(ch) && CHARACTER_NAMES[code] === undefined) return `'${ch}'`
  const hex = `U+${code.toString(16).toUpperCase().padStart(4, '0')}`
  const name = CHARACTER_NAMES[code]
  return name === undefined ? hex : `${hex} (${name})`
}

export function tokenize(source: string): Token[] {
  return lex(source, false)
}

/** The tokens before the first lexing error (for hints about values that don't parse). */
function lexPrefix(source: string): Token[] {
  return lex(source, true)
}

function lex(source: string, stopAtError: boolean): Token[] {
  const tokens: Token[] = []
  const fail = (message: string, offset: number): Token[] => {
    if (stopAtError) return tokens
    throw new ExprSyntaxError(message, offset)
  }
  let i = 0
  while (i < source.length) {
    const ch = source.charAt(i)
    if (WHITESPACE.has(ch)) {
      i++
      continue
    }
    if (PUNCTUATION.has(ch)) {
      tokens.push({ kind: ch as TokenKind, value: ch, start: i, end: i + 1 })
      i++
      continue
    }
    if (ch === "'" || ch === '"') {
      const start = i
      i++
      let value = ''
      for (;;) {
        if (i >= source.length) return fail('unterminated string', start)
        const c = source.charAt(i)
        if (c === ch) break
        if (c === '\n' || c === '\r') return fail("strings can't contain line breaks", i)
        if (c === '\\') return fail("escape sequences aren't supported in strings", i)
        value += c
        i++
      }
      i++
      tokens.push({ kind: 'string', value, start, end: i })
      continue
    }
    if (isWordChar(ch)) {
      const start = i
      while (i < source.length && isWordChar(source.charAt(i))) i++
      tokens.push({ kind: 'word', value: source.slice(start, i), start, end: i })
      continue
    }
    return fail(`unexpected character ${describeCharacter(source, i)}`, i)
  }
  tokens.push({ kind: 'eof', value: '', start: source.length, end: source.length })
  return tokens
}

function describe(token: Token): string {
  if (token.kind === 'eof') return 'end of value'
  if (token.kind === 'string') return `string ${JSON.stringify(token.value)}`
  return `'${token.value}'`
}

class Parser {
  private readonly tokens: Token[]
  private pos = 0

  constructor(tokens: Token[]) {
    this.tokens = tokens
  }

  private peek(ahead = 0): Token {
    // tokenize() always ends with an eof token, so clamping keeps this total.
    return this.tokens[Math.min(this.pos + ahead, this.tokens.length - 1)]!
  }

  private next(): Token {
    const token = this.peek()
    if (token.kind !== 'eof') this.pos++
    return token
  }

  private ident(what: string): Token {
    const token = this.peek()
    if (token.kind !== 'word') {
      throw new ExprSyntaxError(`expected ${what}, found ${describe(token)}`, token.start)
    }
    if (!isIdent(token.value)) {
      const hint = NAME_HINTS[token.value]
      throw new ExprSyntaxError(
        hint ?? `'${token.value}' isn't a valid name (use letters, digits and _, not starting with a digit)`,
        token.start,
      )
    }
    return this.next()
  }

  parse(): Expr {
    if (this.peek().kind === 'eof') throw new ExprSyntaxError('expected a path or a call, found an empty value', 0)
    const expr = this.expr()
    const rest = this.peek()
    if (rest.kind !== 'eof') throw new ExprSyntaxError(`unexpected ${describe(rest)}`, rest.start)
    return expr
  }

  private expr(): Expr {
    const bang = this.peek()
    if (bang.kind !== '!') return this.operand()
    this.next()
    const operand = this.operand()
    return { kind: 'not', operand, start: bang.start, end: operand.end }
  }

  private operand(): PathExpr | CallExpr {
    const first = this.ident('a name')
    if (this.peek().kind === '(') return this.call(first)
    return this.path(first)
  }

  // Paths name fields; a list's items are only reached through m-for, so a position gets a hint.
  private path(first: Token): PathExpr {
    const segments = [first.value]
    let end = first.end
    for (;;) {
      const next = this.peek()
      if (next.kind === '[') {
        const inside = this.peek(1)
        const message = inside.kind === 'word' && /^[0-9]+$/.test(inside.value)
          ? positionMessage(`${segments.join('.')}[${inside.value}]`)
          : `'[' isn't part of a path; paths join names with dots, such as user.name`
        throw new ExprSyntaxError(message, next.start)
      }
      if (next.kind !== '.') break
      this.next()
      const after = this.peek()
      if (after.kind === 'word' && /^[0-9]+$/.test(after.value)) {
        throw new ExprSyntaxError(positionMessage(`${segments.join('.')}.${after.value}`), after.start)
      }
      const segment = this.ident("a name after '.'")
      segments.push(segment.value)
      end = segment.end
    }
    return { kind: 'path', segments, start: first.start, end }
  }

  private call(callee: Token): CallExpr {
    this.next() // (
    const args: (StringLit | ObjectLit)[] = []
    const opening = this.peek()
    if (opening.kind === '{') throw new ExprSyntaxError(`the name comes first: ${callee.value}('name', { ... })`, opening.start)
    if (opening.kind !== ')') {
      for (;;) {
        args.push(args.length === 0 ? this.string() : this.argument(callee.value, args))
        const comma = this.peek()
        if (comma.kind !== ',') break
        this.next()
        if (this.peek().kind === ')') {
          const written = `${callee.value}(${args.map(formatArgument).join(', ')})`
          // After the event name alone, the comma may also mean a payload is missing.
          const orPayload = callee.value === EMIT_FUNCTION && args.length === 1
            ? `, or put the payload after it: ${callee.value}(${formatArgument(args[0]!)}, { <field>: <path> })`
            : ''
          throw new ExprSyntaxError(`remove the trailing comma: ${written}${orPayload}`, comma.start)
        }
      }
    }
    const close = this.peek()
    if (close.kind !== ')') throw new ExprSyntaxError(`expected ',' or ')', found ${describe(close)}`, close.start)
    this.next()
    return { kind: 'call', callee: callee.value, args, start: callee.start, end: close.end }
  }

  // An argument after the first: a string, or an object of named paths (an event's payload, D35). A
  // bare path, literal or list second is a positional payload, which gets the named form as the fix.
  private argument(callee: string, args: readonly (StringLit | ObjectLit)[]): StringLit | ObjectLit {
    const token = this.peek()
    const first = args[0]!
    const event = first.kind === 'string' ? first.value : 'name'
    if (token.kind === '{') return this.object(callee, event)
    if (token.kind === 'string') return this.string()
    const payload = args[1]
    if (payload?.kind === 'object') throw new ExprSyntaxError(extraArgumentMessage(callee, event, args.slice(1)), token.start)
    if (payload !== undefined || token.kind === 'word' || token.kind === '!' || token.kind === '[') {
      const path = payload === undefined ? this.pathAt(0) : []
      throw payloadFixError({ kind: 'positional', callee, event, ...(path.length > 0 ? { path } : {}) }, (payload ?? token).start)
    }
    throw new ExprSyntaxError(`expected a payload object, found ${describe(token)}`, token.start)
  }

  /** The path that starts `ahead` tokens on (`member.handle`), without consuming it; [] when none does. */
  private pathAt(ahead: number): string[] {
    const first = this.peek(ahead)
    if (first.kind !== 'word' || !isIdent(first.value) || LITERAL_WORDS.has(first.value)) return []
    const segments = [first.value]
    for (let i = ahead + 1; this.peek(i).kind === '.' && this.peek(i + 1).kind === 'word' && isIdent(this.peek(i + 1).value); i += 2) {
      segments.push(this.peek(i + 1).value)
    }
    return segments
  }

  private object(callee: string, event: string): ObjectLit {
    const open = this.next() // {
    const fields: ObjectField[] = []
    for (;;) {
      const token = this.peek()
      if (token.kind === '}') break
      if (token.kind === 'eof') throw new ExprSyntaxError("expected '}' to close the payload, found end of value", token.start)
      if (token.kind === 'string') {
        const path = this.peek(1).kind === ':' ? this.pathAt(2) : []
        throw payloadFixError({ kind: 'quoted', callee, event, name: token.value, ...(path.length > 0 ? { path } : {}) }, token.start)
      }
      const name = this.ident('a field name')
      if (name.value === RESERVED_NAME) throw new ExprSyntaxError(`'${RESERVED_NAME}' isn't a valid field name (it's reserved)`, name.start)
      if (fields.some((field) => field.name === name.value)) {
        throw new ExprSyntaxError(`'${name.value}' appears twice in the payload; keep one`, name.start)
      }
      const colon = this.peek()
      if (colon.kind === ',' || colon.kind === '}') throw payloadFixError({ kind: 'shorthand', callee, event, name: name.value }, colon.start)
      if (colon.kind !== ':') throw new ExprSyntaxError(`expected ':' after '${name.value}', found ${describe(colon)}`, colon.start)
      this.next()
      fields.push({ name: name.value, nameStart: name.start, value: this.payloadValue() })
      const after = this.peek()
      if (after.kind === ',') {
        this.next()
        continue
      }
      if (after.kind !== '}') throw new ExprSyntaxError(`expected ',' or '}', found ${describe(after)}`, after.start)
    }
    const close = this.next()
    return { kind: 'object', fields, start: open.start, end: close.end }
  }

  // Payload values are paths into the row's item, data or route (D35); literals and the rest wait for
  // the binding language.
  private payloadValue(): PathExpr {
    const token = this.peek()
    const literal = token.kind === 'string' || (token.kind === 'word' && (/^[0-9]/.test(token.value) || LITERAL_WORDS.has(token.value)))
    if (literal) throw new ExprSyntaxError('payload values are paths for now; have the host send the value as data', token.start)
    if (token.kind === '!') throw new ExprSyntaxError("payload values are paths; '!' only works in conditions (m-if, m-show)", token.start)
    if (token.kind === '{' || token.kind === '[') throw new ExprSyntaxError(PAYLOAD_LEAVES_MESSAGE, token.start)
    // A call after a path too: option.label.trim().
    const path = this.path(this.ident("the value's path"))
    if (this.peek().kind === '(') throw new ExprSyntaxError(CALL_VALUE_MESSAGE, this.peek().start)
    return path
  }

  /** `member in members`, the value of m-for; every other form gets the message that names its fix. */
  loop(): LoopExpr {
    const first = this.peek()
    if (first.kind === 'eof') throw new ExprSyntaxError(LOOP_USAGE, 0)
    if (first.kind === '(') {
      let indexed = false
      for (let i = 1; this.peek(i).kind !== 'eof' && this.peek(i).kind !== ')'; i++) if (this.peek(i).kind === ',') indexed = true
      throw new ExprSyntaxError(indexed ? NO_INDEX_MESSAGE : `write it without parentheses: ${LOOP_EXAMPLE}`, first.start)
    }
    if (first.kind === '{' || first.kind === '[') throw new ExprSyntaxError(DESTRUCTURING_MESSAGE, first.start)
    if (first.kind === 'word' && first.value === 'in') throw new ExprSyntaxError(`name the item before 'in': ${LOOP_EXAMPLE}`, first.start)
    const alias = this.ident(`a name for each item, as in ${LOOP_EXAMPLE}`)
    if (alias.value === RESERVED_NAME) throw new ExprSyntaxError(`'${RESERVED_NAME}' isn't a valid name (it's reserved)`, alias.start)
    const keyword = this.peek()
    if (keyword.kind === ',') throw new ExprSyntaxError(NO_INDEX_MESSAGE, keyword.start)
    if (keyword.kind === 'word' && keyword.value === 'of') {
      throw new ExprSyntaxError(`use 'in': ${FOR_DIRECTIVE}="${alias.value} in ${this.sourceText(1) || 'members'}"`, keyword.start)
    }
    if (keyword.kind !== 'word' || keyword.value !== 'in') {
      throw new ExprSyntaxError(`expected 'in' after '${alias.value}', found ${describe(keyword)}; ${LOOP_EXAMPLE}`, keyword.start)
    }
    this.next()
    const source = this.peek()
    if (source.kind === 'eof') throw new ExprSyntaxError(`expected a list after 'in', as in ${LOOP_EXAMPLE}`, source.start)
    if (source.kind === 'word' && /^[0-9]/.test(source.value)) throw new ExprSyntaxError(RANGE_MESSAGE, source.start)
    const path = this.path(this.ident(`a list after 'in', as in ${LOOP_EXAMPLE}`))
    const rest = this.peek()
    if (rest.kind !== 'eof') throw new ExprSyntaxError(SHAPED_LIST_MESSAGE, rest.start)
    return { kind: 'loop', alias: alias.value, aliasStart: alias.start, source: path, start: alias.start, end: path.end }
  }

  /** The source text of the tokens from `ahead` on, for examples in messages. */
  private sourceText(ahead: number): string {
    const parts: string[] = []
    for (let i = ahead; this.peek(i).kind !== 'eof'; i++) parts.push(this.peek(i).kind === 'string' ? JSON.stringify(this.peek(i).value) : this.peek(i).value)
    return parts.join('').replace(/,/g, ', ')
  }

  private string(): StringLit {
    const token = this.peek()
    if (token.kind !== 'string') {
      const quoted = token.kind === 'word' ? ` (quote it: '${token.value}')` : ''
      throw new ExprSyntaxError(`expected a string, found ${describe(token)}${quoted}`, token.start)
    }
    this.next()
    return { kind: 'string', value: token.value, start: token.start, end: token.end }
  }
}

/** Parses a directive value into a syntax tree. */
export function parseExpression(source: string): ParseResult {
  try {
    return { ok: true, expr: new Parser(tokenize(source)).parse() }
  } catch (error) {
    if (!(error instanceof ExprSyntaxError)) throw error
    const failure = { ok: false as const, message: error.message, offset: error.offset }
    return error.fix === undefined ? failure : { ...failure, fix: error.fix }
  }
}

export type TextDirectiveResult = { ok: true; path: string[] } | { ok: false; message: string; offset: number }
/**
 * A field of an emit's payload (D35), `optionId: option.id`: its name and the path that fills it, with
 * the offsets of both in the directive value.
 */
export type PayloadField = { name: string; nameStart: number; path: string[]; pathStart: number; pathEnd: number }
/** An emit's payload object: its fields in order, and where the object starts and ends. */
export type EmitPayload = { fields: PayloadField[]; start: number; end: number }
/**
 * `payload` is there only when the emit passes one: `emit('vote', { optionId: option.id })`. A failure
 * has `fix` when the payload is written in a form emit doesn't take (see PayloadFix).
 */
export type ClickDirectiveResult =
  | { ok: true; event: string; payload?: EmitPayload }
  | { ok: false; message: string; offset: number; fix?: PayloadFix }
/** `m-for="member in members"`: the alias, the list's path, and the offset of each in the value. */
export type ForDirectiveResult =
  | { ok: true; alias: string; aliasStart: number; path: string[]; pathStart: number }
  | { ok: false; message: string; offset: number }

/** What m-show, m-if and m-else-if test: the value at `path`, negated when written with `!`. */
export type Condition = { path: string[]; negated: boolean }
/** `pathStart` is the offset of the path, after any `!`. */
export type ConditionDirectiveResult =
  | { ok: true; condition: Condition; pathStart: number }
  | { ok: false; message: string; offset: number }

function parsePathDirective(directive: string, example: string, value: string): TextDirectiveResult {
  const result = parseExpression(value)
  if (!result.ok) return result
  const { expr } = result
  if (expr.kind === 'not') {
    return { ok: false, message: `${directive} needs a path such as ${example}; '!' only works in conditions (m-if, m-show)`, offset: expr.start }
  }
  if (expr.kind !== 'path') {
    return { ok: false, message: `${directive} needs a path such as ${example}, not a call`, offset: expr.start }
  }
  return { ok: true, path: expr.segments }
}

/** `m-text="user.name"` → `['user', 'name']`. */
export function parseTextDirective(value: string): TextDirectiveResult {
  return parsePathDirective(TEXT_DIRECTIVE, 'user.name', value)
}

/** What to do instead of building a URL in m-bind:href (`'/u/' + member.handle`, a template literal, a call). */
const URL_BUILDING_HINT =
  'views never build URLs: bind a link field (a string field with "route": "<route name>" in the schema), which the source fills with href() (docs/authoring.md §3)'

/** `m-bind:href="links.profile"` → `['links', 'profile']`: the path of a link field (SPEC D23). */
export function parseHrefDirective(value: string): TextDirectiveResult {
  const result = parsePathDirective(HREF_DIRECTIVE, 'author.profileUrl', value)
  if (result.ok) return result
  // A call (href('profile', ...), whatever its arguments), joined strings or a template literal: the URL
  // is being built.
  const call = /^\s*[A-Za-z_$][\w$]*\s*\(/.exec(value)
  if (call !== null) {
    return { ok: false, message: `${HREF_DIRECTIVE} needs a path such as author.profileUrl, not a call; ${URL_BUILDING_HINT}`, offset: value.search(/\S/) }
  }
  const { message, offset } = result
  return { ok: false, message: ['+', '`'].includes(value.charAt(offset)) ? `${message}; ${URL_BUILDING_HINT}` : message, offset }
}

// Characters that start the operators a condition might reach for: comparisons, && and ||, arithmetic
// and ternaries. Conditions are paths for now, so these all get one message that names the workaround.
const OPERATOR_CHARACTERS = new Set(['=', '<', '>', '&', '|', '+', '-', '*', '/', '%', '?', ':'])

/** The operator that starts at `offset` (`>=`, `&&`, `!==`...), or undefined. */
function operatorAt(source: string, offset: number): { text: string; start: number } | undefined {
  if (!OPERATOR_CHARACTERS.has(source.charAt(offset))) return undefined
  // The lexer reads the '!' of != and !== as a token of its own and stops at the '='.
  const start = source.charAt(offset - 1) === '!' ? offset - 1 : offset
  let end = offset
  while (OPERATOR_CHARACTERS.has(source.charAt(end))) end++
  return { text: source.slice(start, end), start }
}

/** The path a source is, optionally negated (`!members.length`), or undefined when it's anything else. */
function wholePath(source: string): { segments: string[]; negated: boolean } | undefined {
  const tokens = lexPrefix(source)
  if (tokens.at(-1)?.kind !== 'eof') return undefined
  const negated = tokens[0]?.kind === '!'
  const segments: string[] = []
  for (let i = negated ? 1 : 0; ; i += 2) {
    const token = tokens[i]!
    if (token.kind !== 'word' || !isIdent(token.value)) return undefined
    segments.push(token.value)
    if (tokens[i + 1]?.kind === 'eof') return { segments, negated }
    if (tokens[i + 1]?.kind !== '.') return undefined
  }
}

// Comparisons of a count that a count alone already says (D34): it holds while the list has items, and
// with ! while the list is empty.
const COUNT_HAS_ITEMS = new Set(['> 0', '!= 0', '!== 0', '>= 1'])
const COUNT_EMPTY = new Set(['== 0', '=== 0', '< 1', '<= 0'])

/** Why a condition can't use an operator, with the condition to write instead when there's one. */
function operatorMessage(directive: string, value: string, operator: { text: string; start: number }): string {
  const unsupported = `'${operator.text}' isn't supported yet`
  const left = wholePath(value.slice(0, operator.start))
  const right = value.slice(operator.start + operator.text.length).trim()
  const comparison = /^[=!<>]+$/.test(operator.text)
  if (comparison && left !== undefined && !left.negated && left.segments.length >= 2 && left.segments.at(-1) === 'length') {
    const count = left.segments.join('.')
    const compared = `${operator.text} ${right}`
    if (COUNT_HAS_ITEMS.has(compared)) return `${unsupported}, and a count already holds while the list has items: write ${directive}="${count}"`
    if (COUNT_EMPTY.has(compared)) return `${unsupported}, and !${count} holds while the list is empty: write ${directive}="!${count}"`
  }
  // A name for the boolean, from what the condition compares: `isPaid` for status === 'paid', `hasUnread`
  // for unread > 0, `hasMembers` for members.length > 3.
  let name: string | undefined
  if (comparison && left !== undefined) {
    const literal = /^(?:'([A-Za-z_]\w*)'|"([A-Za-z_]\w*)")$/.exec(right)
    const segments = left.segments.at(-1) === 'length' && left.segments.length >= 2 ? left.segments.slice(0, -1) : left.segments
    name = literal !== null && operator.text.includes('=') ? `is${capitalize(literal[1] ?? literal[2]!)}` : `has${capitalize(segments.at(-1)!)}`
  }
  return `${unsupported}: a condition is a path, optionally negated with !, so have the host send a boolean field${name === undefined ? '' : ` such as ${name}`}`
}

/**
 * `m-if="!user.bio"` → `{ path: ['user', 'bio'], negated: true }`. `directive` names the attribute in
 * messages (m-show, m-if or m-else-if).
 */
export function parseConditionDirective(directive: string, value: string): ConditionDirectiveResult {
  const result = parseExpression(value)
  if (!result.ok) {
    const operator = operatorAt(value, result.offset)
    if (operator === undefined) return result
    return { ok: false, message: operatorMessage(directive, value, operator), offset: operator.start }
  }
  const { expr } = result
  const operand = expr.kind === 'not' ? expr.operand : expr
  if (operand.kind !== 'path') {
    return { ok: false, message: `${directive} needs a condition such as user.verified or !user.verified, not a call`, offset: operand.start }
  }
  return { ok: true, condition: { path: operand.segments, negated: expr.kind === 'not' }, pathStart: operand.start }
}

/**
 * `m-on:click="emit('increment')"` → `'increment'`; `emit('vote', { optionId: option.id })` also gives
 * the payload's fields (D35).
 */
export function parseClickDirective(value: string): ClickDirectiveResult {
  const result = parseExpression(value)
  if (!result.ok) return result
  const { expr } = result
  if (expr.kind !== 'call') {
    return { ok: false, message: `${CLICK_DIRECTIVE} needs emit('name'), for example emit('save')`, offset: expr.start }
  }
  if (expr.callee !== EMIT_FUNCTION) {
    const hint = expr.args.length === 0 ? `; did you mean emit('${expr.callee}')?` : ''
    return { ok: false, message: `only emit('name') is supported for now${hint}`, offset: expr.start }
  }
  const [arg, payload, extra] = expr.args
  if (arg === undefined || arg.kind !== 'string') {
    return { ok: false, message: "emit needs an event name, for example emit('save')", offset: arg?.start ?? expr.end - 1 }
  }
  if (!isIdent(arg.value)) {
    return {
      ok: false,
      message: `'${arg.value}' isn't a valid event name (use letters, digits and _, not starting with a digit)`,
      offset: arg.start + 1,
    }
  }
  if (payload?.kind === 'string') {
    const fix: PayloadFix = { kind: 'positional', callee: EMIT_FUNCTION, event: arg.value }
    return { ok: false, message: payloadFixText(fix, defaultPayloadFixFields(fix)), offset: payload.start, fix }
  }
  if (extra !== undefined) return { ok: false, message: extraArgumentMessage(EMIT_FUNCTION, arg.value, expr.args.slice(1)), offset: extra.start }
  if (payload === undefined) return { ok: true, event: arg.value }
  const fields = payload.fields.map(({ name, nameStart, value: path }) => ({
    name,
    nameStart,
    path: path.segments,
    pathStart: path.start,
    pathEnd: path.end,
  }))
  return { ok: true, event: arg.value, payload: { fields, start: payload.start, end: payload.end } }
}

/**
 * `m-for="member in members"` → the alias `member` and the path `['members']`. The list may be a field
 * of an outer row's item (`option in poll.options`); whether it's a list is resolveList's to say.
 */
export function parseForDirective(value: string): ForDirectiveResult {
  // An operator the tokenizer stops at ('|', '=>') after a whole loop starts a filter or an expression
  // after the list: the tokens before it are parsed first, so that case gets the message for it.
  let tokens: Token[]
  let lexError: ExprSyntaxError | undefined
  try {
    tokens = tokenize(value)
  } catch (error) {
    if (!(error instanceof ExprSyntaxError)) throw error
    lexError = error
    tokens = [...lexPrefix(value), { kind: 'eof', value: '', start: error.offset, end: error.offset }]
  }
  try {
    const loop = new Parser(tokens).loop()
    // Only an operator starts a filter or an expression; any other character is a stray one to name.
    if (lexError !== undefined) {
      const message = operatorAt(value, lexError.offset) === undefined ? lexError.message : SHAPED_LIST_MESSAGE
      return { ok: false, message, offset: lexError.offset }
    }
    return { ok: true, alias: loop.alias, aliasStart: loop.aliasStart, path: loop.source.segments, pathStart: loop.source.start }
  } catch (error) {
    if (!(error instanceof ExprSyntaxError)) throw error
    // The parser ran out of tokens where the bad character was: that character is the problem.
    if (lexError !== undefined && error.offset >= lexError.offset) return { ok: false, message: lexError.message, offset: lexError.offset }
    return { ok: false, message: error.message, offset: error.offset }
  }
}
