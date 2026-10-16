// Tokenizer and recursive-descent parser for directive values. Values become syntax trees and are
// never evaluated (P1, #24). Grammar for now:
//
//   expr   := path | call
//   path   := ident ('.' ident)*
//   call   := ident '(' (string (',' string)*)? ')'
//   string := '…' | "…"
//
// Growing the language (operators, more calls, formatters) means extending this file.

import { CLICK_DIRECTIVE, EMIT_FUNCTION, NAME_HINTS, TEXT_DIRECTIVE, isIdent } from './constants.ts'

export type StringLit = { kind: 'string'; value: string; start: number; end: number }
export type PathExpr = { kind: 'path'; segments: string[]; start: number; end: number }
export type CallExpr = { kind: 'call'; callee: string; args: StringLit[]; start: number; end: number }
export type Expr = PathExpr | CallExpr

/** `offset` is 0-based, into the directive value. */
export type ParseError = { message: string; offset: number }

export type ParseResult = { ok: true; expr: Expr } | { ok: false; message: string; offset: number }

export type TokenKind = 'word' | 'string' | '.' | '(' | ')' | ',' | 'eof'
export type Token = { kind: TokenKind; value: string; start: number; end: number }

class ExprSyntaxError extends Error {
  readonly offset: number
  constructor(message: string, offset: number) {
    super(message)
    this.offset = offset
  }
}

const WHITESPACE = new Set([' ', '\t', '\n', '\r', '\f'])
const PUNCTUATION = new Set(['.', '(', ')', ','])

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
    const first = this.ident('a name')
    if (this.peek().kind === '(') return this.call(first)
    return this.path(first)
  }

  private path(first: Token): PathExpr {
    const segments = [first.value]
    let end = first.end
    while (this.peek().kind === '.') {
      this.next()
      const segment = this.ident("a name after '.'")
      segments.push(segment.value)
      end = segment.end
    }
    return { kind: 'path', segments, start: first.start, end }
  }

  private call(callee: Token): CallExpr {
    this.next() // (
    const args: StringLit[] = []
    if (this.peek().kind !== ')') {
      for (;;) {
        args.push(this.string())
        if (this.peek().kind !== ',') break
        this.next()
      }
    }
    const close = this.peek()
    if (close.kind !== ')') throw new ExprSyntaxError(`expected ',' or ')', found ${describe(close)}`, close.start)
    this.next()
    return { kind: 'call', callee: callee.value, args, start: callee.start, end: close.end }
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
    if (error instanceof ExprSyntaxError) return { ok: false, message: error.message, offset: error.offset }
    throw error
  }
}

export type TextDirectiveResult = { ok: true; path: string[] } | { ok: false; message: string; offset: number }
export type ClickDirectiveResult = { ok: true; event: string } | { ok: false; message: string; offset: number }

/** `m-text="user.name"` → `['user', 'name']`. */
export function parseTextDirective(value: string): TextDirectiveResult {
  const result = parseExpression(value)
  if (!result.ok) return result
  const { expr } = result
  if (expr.kind !== 'path') {
    return { ok: false, message: `${TEXT_DIRECTIVE} needs a path such as user.name, not a call`, offset: expr.start }
  }
  return { ok: true, path: expr.segments }
}

const EXTRA_ARGUMENT_MESSAGE =
  "emit takes exactly one argument, the event name; event payloads aren't supported yet, so declare one event per action"

/** `m-on:click="emit('increment')"` → `'increment'`. */
export function parseClickDirective(value: string): ClickDirectiveResult {
  const result = parseExpression(value)
  if (!result.ok) {
    // `emit('like', 1)`: the parser stops at the 1 (call arguments are strings), but the real problem
    // is the extra argument.
    const [callee, open, first, comma, extra] = lexPrefix(value)
    if (callee?.value === EMIT_FUNCTION && open?.kind === '(' && first?.kind === 'string' && comma?.kind === ',') {
      let offset = extra?.start ?? comma.end
      while (WHITESPACE.has(value.charAt(offset))) offset++
      return { ok: false, message: EXTRA_ARGUMENT_MESSAGE, offset }
    }
    return result
  }
  const { expr } = result
  if (expr.kind !== 'call') {
    return { ok: false, message: `${CLICK_DIRECTIVE} needs emit('name'), for example emit('save')`, offset: expr.start }
  }
  if (expr.callee !== EMIT_FUNCTION) {
    const hint = expr.args.length === 0 ? `; did you mean emit('${expr.callee}')?` : ''
    return { ok: false, message: `only emit('name') is supported for now${hint}`, offset: expr.start }
  }
  const [arg, extra] = expr.args
  if (arg === undefined) {
    return { ok: false, message: "emit needs an event name, for example emit('save')", offset: expr.end - 1 }
  }
  if (extra !== undefined) return { ok: false, message: EXTRA_ARGUMENT_MESSAGE, offset: extra.start }
  if (!isIdent(arg.value)) {
    return {
      ok: false,
      message: `'${arg.value}' isn't a valid event name (use letters, digits and _, not starting with a digit)`,
      offset: arg.start + 1,
    }
  }
  return { ok: true, event: arg.value }
}
