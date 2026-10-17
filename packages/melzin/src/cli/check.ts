// `melzin check`, checkFiles and loadViewFile. Views are parsed with parse5 (with source locations) so
// every diagnostic points at a line and column: the attribute or the exact character inside its value,
// and the exact JSON position inside data blocks.

import { existsSync, readFileSync } from 'node:fs'
import { readFile } from 'node:fs/promises'
import { basename, relative, resolve } from 'node:path'
import { parseArgs } from 'node:util'
import { parse, type DefaultTreeAdapterTypes } from 'parse5'
import {
  CLICK_DIRECTIVE,
  type DataBlockType,
  type Issue,
  type MelzinSchema,
  SCHEMA_BLOCK_TYPE,
  SNAPSHOTS_BLOCK_TYPE,
  type Snapshot,
  TEXT_DIRECTIVE,
  VIEW_FILE_SUFFIX,
  VOID_ELEMENTS,
  attributeProblem,
  classifyAttribute,
  dataBlockType,
  elementProblem,
  joinPath,
  leafPaths,
  parseClickDirective,
  parseExpression,
  parseSnapshots,
  parseTextDirective,
  resolvePath,
  suggest,
  validateSchema,
} from '../core/index.ts'
import { UsageError, resolveProject } from './project.ts'
import { generateTypes, typesPathFor } from './typegen.ts'

type Element = DefaultTreeAdapterTypes.Element
type ChildNode = DefaultTreeAdapterTypes.ChildNode
type TextNode = DefaultTreeAdapterTypes.TextNode

export type Severity = 'error' | 'warning'

/** `line` and `col` are 1-based. */
export type Diagnostic = { line: number; col: number; severity: Severity; message: string }

/** `file` is the checked path relative to the cwd option (as printed by the CLI). */
export type FileCheckResult = { file: string; diagnostics: Diagnostic[] }

export type CheckResult = { files: FileCheckResult[]; errorCount: number; warningCount: number }

export type CheckOptions = {
  /** Base for relative paths in input and output; defaults to process.cwd(). */
  cwd?: string
}

export type LoadedView = {
  /** Text of `<title>` with whitespace collapsed (as in parseViewHtml), '' when missing. */
  title: string
  /** Null when there is no schema block or it is invalid (see `issues`). */
  schema: MelzinSchema | null
  snapshots: Snapshot[]
  issues: Issue[]
}

// ---------------------------------------------------------------------------------------------------
// JSON with locations

export type JsonParseResult =
  | { ok: true; value: unknown; locations: Map<string, number> }
  | { ok: false; message: string; offset: number }

export type JsonParseOptions = {
  /** Path of the root value (`snapshots` for the snapshots block). */
  rootPath?: string
  /** Write the root object's keys as `root["key"]` (how snapshot names appear in issue paths). */
  bracketTopLevel?: boolean
}

class JsonSyntaxError extends Error {
  readonly offset: number
  constructor(message: string, offset: number) {
    super(message)
    this.offset = offset
  }
}

const JSON_WHITESPACE = new Set([' ', '\t', '\n', '\r'])
const JSON_ESCAPES: Readonly<Record<string, string>> = {
  '"': '"',
  '\\': '\\',
  '/': '/',
  b: '\b',
  f: '\f',
  n: '\n',
  r: '\r',
  t: '\t',
}
const NUMBER_RE = /-?(?:0|[1-9][0-9]*)(?:\.[0-9]+)?(?:[eE][+-]?[0-9]+)?/y
const WORD_RE = /[A-Za-z0-9_$.+-]+/y

class JsonParser {
  private readonly text: string
  private readonly bracketTopLevel: boolean
  private pos = 0
  readonly locations = new Map<string, number>()

  constructor(text: string, bracketTopLevel: boolean) {
    this.text = text
    this.bracketTopLevel = bracketTopLevel
  }

  parse(rootPath: string): unknown {
    this.skipWhitespace()
    if (this.pos >= this.text.length) throw new JsonSyntaxError('the block is empty; it needs a JSON object', 0)
    this.locations.set(rootPath, this.pos)
    const value = this.value(rootPath, 0)
    this.skipWhitespace()
    if (this.pos < this.text.length) {
      throw new JsonSyntaxError('unexpected content after the JSON value', this.pos)
    }
    return value
  }

  private skipWhitespace(): void {
    while (this.pos < this.text.length && JSON_WHITESPACE.has(this.text.charAt(this.pos))) this.pos++
  }

  private word(): string {
    WORD_RE.lastIndex = this.pos
    return WORD_RE.exec(this.text)?.[0] ?? this.text.charAt(this.pos)
  }

  private unexpected(what: string): JsonSyntaxError {
    const ch = this.text.charAt(this.pos)
    if (this.pos >= this.text.length) return new JsonSyntaxError(`unexpected end of JSON; expected ${what}`, this.pos)
    if (ch === "'") return new JsonSyntaxError('JSON strings need double quotes', this.pos)
    if (ch === '/') return new JsonSyntaxError("comments aren't allowed in JSON", this.pos)
    return new JsonSyntaxError(`expected ${what}, found '${this.word()}'`, this.pos)
  }

  private value(path: string, depth: number): unknown {
    this.skipWhitespace()
    const ch = this.text.charAt(this.pos)
    if (ch === '{') return this.object(path, depth)
    if (ch === '[') return this.array(path, depth)
    if (ch === '"') return this.string()
    if (ch === '-' || (ch >= '0' && ch <= '9')) return this.number()
    for (const [literal, value] of [['true', true], ['false', false], ['null', null]] as const) {
      if (this.text.startsWith(literal, this.pos)) {
        this.pos += literal.length
        return value
      }
    }
    if (/[A-Za-z_]/.test(ch)) {
      throw new JsonSyntaxError(`unexpected '${this.word()}'; strings need double quotes`, this.pos)
    }
    throw this.unexpected('a value')
  }

  private keyPath(path: string, key: string, depth: number): string {
    if (depth === 0 && this.bracketTopLevel) return `${path}[${JSON.stringify(key)}]`
    return joinPath(path, key)
  }

  private object(path: string, depth: number): Record<string, unknown> {
    const result: Record<string, unknown> = {}
    this.pos++ // {
    this.skipWhitespace()
    if (this.text.charAt(this.pos) === '}') {
      this.pos++
      return result
    }
    for (;;) {
      this.skipWhitespace()
      const ch = this.text.charAt(this.pos)
      if (ch !== '"') {
        if (ch === '}') throw new JsonSyntaxError("trailing commas aren't allowed in JSON", this.pos)
        if (/[A-Za-z_$]/.test(ch)) {
          throw new JsonSyntaxError(`property names need double quotes: "${this.word()}"`, this.pos)
        }
        throw this.unexpected('a property name in double quotes')
      }
      const keyStart = this.pos
      const key = this.string()
      const childPath = this.keyPath(path, key, depth)
      this.locations.set(childPath, keyStart)
      this.skipWhitespace()
      if (this.text.charAt(this.pos) !== ':') throw this.unexpected("':' after the property name")
      this.pos++
      // Own property even for "__proto__", like JSON.parse; the last duplicate wins, like JSON.parse.
      Object.defineProperty(result, key, {
        value: this.value(childPath, depth + 1),
        enumerable: true,
        writable: true,
        configurable: true,
      })
      this.skipWhitespace()
      const next = this.text.charAt(this.pos)
      if (next === ',') {
        this.pos++
        continue
      }
      if (next === '}') {
        this.pos++
        return result
      }
      if (next === '"') throw new JsonSyntaxError("expected ',' between properties", this.pos)
      throw this.unexpected("',' or '}'")
    }
  }

  private array(path: string, depth: number): unknown[] {
    const result: unknown[] = []
    this.pos++ // [
    this.skipWhitespace()
    if (this.text.charAt(this.pos) === ']') {
      this.pos++
      return result
    }
    for (;;) {
      this.skipWhitespace()
      if (this.text.charAt(this.pos) === ']') throw new JsonSyntaxError("trailing commas aren't allowed in JSON", this.pos)
      const itemPath = `${path}[${result.length}]`
      this.locations.set(itemPath, this.pos)
      result.push(this.value(itemPath, depth + 1))
      this.skipWhitespace()
      const next = this.text.charAt(this.pos)
      if (next === ',') {
        this.pos++
        continue
      }
      if (next === ']') {
        this.pos++
        return result
      }
      throw this.unexpected("',' or ']'")
    }
  }

  private string(): string {
    const start = this.pos
    this.pos++ // "
    let value = ''
    for (;;) {
      if (this.pos >= this.text.length) throw new JsonSyntaxError('unterminated string', start)
      const ch = this.text.charAt(this.pos)
      if (ch === '"') {
        this.pos++
        return value
      }
      if (ch.charCodeAt(0) < 0x20) {
        throw new JsonSyntaxError("strings can't contain line breaks or control characters (use \\n)", this.pos)
      }
      if (ch === '\\') {
        const escape = this.text.charAt(this.pos + 1)
        const simple = JSON_ESCAPES[escape]
        if (simple !== undefined) {
          value += simple
          this.pos += 2
          continue
        }
        const hex = this.text.slice(this.pos + 2, this.pos + 6)
        if (escape === 'u' && /^[0-9A-Fa-f]{4}$/.test(hex)) {
          value += String.fromCharCode(Number.parseInt(hex, 16))
          this.pos += 6
          continue
        }
        throw new JsonSyntaxError(`invalid escape '\\${escape}'`, this.pos)
      }
      value += ch
      this.pos++
    }
  }

  private number(): number {
    NUMBER_RE.lastIndex = this.pos
    const match = NUMBER_RE.exec(this.text)
    if (match === null) throw new JsonSyntaxError(`invalid number '${this.word()}'`, this.pos)
    const end = this.pos + match[0].length
    if (/[0-9.eE]/.test(this.text.charAt(end))) throw new JsonSyntaxError(`invalid number '${this.word()}'`, this.pos)
    this.pos = end
    return Number(match[0])
  }
}

/**
 * Strict JSON (RFC 8259) that also records where each value sits: a map from JSON path (the same
 * format as core issue paths, e.g. `data.properties.count` or `required[0]`) to the 0-based offset of
 * the property name, or of the value for array items and the root.
 */
export function parseJsonWithLocations(text: string, options: JsonParseOptions = {}): JsonParseResult {
  const parser = new JsonParser(text, options.bracketTopLevel ?? false)
  try {
    const value = parser.parse(options.rootPath ?? '')
    return { ok: true, value, locations: parser.locations }
  } catch (error) {
    if (error instanceof JsonSyntaxError) return { ok: false, message: error.message, offset: error.offset }
    throw error
  }
}

/** `a.b["c d"][0]` → `['a.b["c d"][0]', 'a.b["c d"]', 'a.b', 'a', '']`: the path and its ancestors. */
export function pathAncestors(path: string): string[] {
  const cuts: number[] = []
  let inString = false
  for (let i = 0; i < path.length; i++) {
    const ch = path.charAt(i)
    if (inString) {
      if (ch === '\\') i++
      else if (ch === '"') inString = false
    } else if (ch === '"') {
      inString = true
    } else if ((ch === '.' || ch === '[') && i > 0) {
      cuts.push(i)
    }
  }
  const result = [path]
  for (const cut of cuts.reverse()) result.push(path.slice(0, cut))
  if (path !== '') result.push('')
  return result
}

/** Offset of the closest located ancestor of `path` (missing fields point at their parent). */
function locate(locations: Map<string, number>, path: string | undefined, fallback: number): number {
  for (const candidate of pathAncestors(path ?? '')) {
    const offset = locations.get(candidate)
    if (offset !== undefined) return offset
  }
  return fallback
}

// ---------------------------------------------------------------------------------------------------
// Analysis

type DataBlock = {
  type: DataBlockType
  element: Element
  /** Raw block text (from the source, so offsets map 1:1). */
  text: string
  /** Offset of `text` in the source. */
  textStart: number
}

type Analysis = { diagnostics: Diagnostic[]; view: LoadedView }

const HEAD_RULE = 'it may only hold <title>, <meta> and the melzin/schema and melzin/snapshots blocks'

function lineStarts(source: string): number[] {
  const starts = [0]
  for (let i = 0; i < source.length; i++) {
    const ch = source.charAt(i)
    if (ch === '\r' && source.charAt(i + 1) === '\n') continue
    if (ch === '\n' || ch === '\r') starts.push(i + 1)
  }
  return starts
}

function isElement(node: ChildNode): node is Element {
  return 'tagName' in node
}

function isText(node: ChildNode): node is TextNode {
  return node.nodeName === '#text'
}

function getAttr(element: Element, name: string): string | undefined {
  return element.attrs.find((attr) => attr.name === name)?.value
}

function textContent(node: ChildNode): string {
  if (isText(node)) return node.value
  if (isElement(node)) return node.childNodes.map(textContent).join('')
  return ''
}

function startOf(node: ChildNode | Element): number | undefined {
  return node.sourceCodeLocation?.startOffset
}

const RAW_TEXT_ELEMENTS = new Set(['script', 'style', 'title', 'textarea', 'xmp', 'noembed', 'noframes', 'iframe'])

// Offset of the source's first `<body` (or `</head`) tag when parse5 recorded none (it had already
// created the body implicitly, e.g. for a <div> or text written inside <head>). Matches inside comments
// and raw-text elements don't count, since only there can such text appear without being a tag.
function tagOffset(source: string, document: DefaultTreeAdapterTypes.Document, tag: RegExp): number | undefined {
  const skipped: [number, number][] = []
  const collect = (nodes: ChildNode[], rawText: boolean): void => {
    for (const node of nodes) {
      const location = node.sourceCodeLocation
      if (node.nodeName === '#comment' || (rawText && isText(node))) {
        if (location) skipped.push([location.startOffset, location.endOffset])
      } else if (isElement(node)) {
        collect(node.childNodes, RAW_TEXT_ELEMENTS.has(node.tagName))
      }
    }
  }
  collect(document.childNodes, false)
  for (const match of source.matchAll(tag)) {
    if (!skipped.some(([start, end]) => match.index >= start && match.index < end)) return match.index
  }
  return undefined
}

// Literal `{{ ... }}` in text: Vue/Alpine interpolation, which Melzin shows as is.
const MUSTACHE_RE = /\{\{[\s\S]*?\}\}/

// Names JavaScript orders before every other key ("0", "10"), whatever the order in the file.
const INDEX_NAME_RE = /^(0|[1-9][0-9]{0,8})$/

function analyze(input: string, fileName: string | undefined): Analysis {
  // Editors don't show a byte order mark as a character, so columns must not count it.
  const source = input.startsWith('\uFEFF') ? input.slice(1) : input
  const starts = lineStarts(source)
  const diagnostics: Diagnostic[] = []
  const issues: Issue[] = []

  const report = (offset: number, severity: Severity, message: string): void => {
    let low = 0
    let high = starts.length - 1
    while (low < high) {
      const mid = (low + high + 1) >> 1
      if (starts[mid]! <= offset) low = mid
      else high = mid - 1
    }
    diagnostics.push({ line: low + 1, col: offset - starts[low]! + 1, severity, message })
  }
  const error = (offset: number, message: string): void => report(offset, 'error', message)
  const warning = (offset: number, message: string): void => report(offset, 'warning', message)

  if (fileName !== undefined && !fileName.endsWith(VIEW_FILE_SUFFIX)) {
    // Possibly not a view at all, so the other rules would only add noise.
    error(0, `view files must be named *${VIEW_FILE_SUFFIX} (got '${basename(fileName)}')`)
    return { diagnostics, view: { title: '', schema: null, snapshots: [], issues: [] } }
  }

  // Scripting off, like the runtime's DOMParser document: <noscript> content is parsed as elements.
  const document = parse(source, { sourceCodeLocationInfo: true, scriptingEnabled: false })
  const html = document.childNodes.find((node): node is Element => isElement(node) && node.tagName === 'html')
  const head = html?.childNodes.find((node): node is Element => isElement(node) && node.tagName === 'head')
  const body = html?.childNodes.find((node): node is Element => isElement(node) && node.tagName === 'body')
  // parse5 always creates html, head and body.
  if (html === undefined || head === undefined || body === undefined) throw new Error('parse5 returned no html/head/body')

  // Content the author wrote before <body> that HTML parsing moved into the body (e.g. a <div> in
  // <head>, and everything after it) still belongs to the head as far as the author is concerned.
  const boundary =
    body.sourceCodeLocation?.startTag?.startOffset ??
    head.sourceCodeLocation?.endTag?.startOffset ??
    tagOffset(source, document, /<body(?=[\s/>])/gi) ??
    tagOffset(source, document, /<\/head(?=[\s/>])/gi)
  const beforeBody = (node: ChildNode): boolean => {
    const start = startOf(node)
    return boundary !== undefined && start !== undefined && start < boundary
  }
  const headNodes = [...head.childNodes, ...body.childNodes.filter(beforeBody)]
  const bodyNodes = body.childNodes.filter((node) => !beforeBody(node))

  // --- head
  let title: string | undefined
  const blocks = new Map<DataBlockType, DataBlock>()
  for (const node of headNodes) {
    const offset = startOf(node) ?? 0
    if (isText(node)) {
      const lead = node.value.search(/\S/)
      if (lead >= 0) error(offset + lead, `text isn't allowed in <head>; ${HEAD_RULE}`)
      continue
    }
    if (!isElement(node)) continue
    const tag = node.tagName
    if (tag === 'title') {
      if (title !== undefined) error(offset, 'a view has only one <title>')
      else title = textContent(node).replace(/\s+/g, ' ').trim()
      continue
    }
    if (tag === 'meta') continue
    if (tag === 'script') {
      const blockType = dataBlockType(getAttr(node, 'type'))
      if (blockType === undefined) {
        error(offset, `<script> isn't allowed in <head>; views have no scripts, only the melzin/schema and melzin/snapshots data blocks`)
        continue
      }
      if (blocks.has(blockType)) {
        error(offset, `duplicate ${blockType} block; a view has at most one`)
        issues.push({ message: `duplicate ${blockType} block; a view has at most one` })
        continue
      }
      const content = node.childNodes.find(isText)?.sourceCodeLocation
      const textStart = content?.startOffset ?? node.sourceCodeLocation?.startTag?.endOffset ?? offset
      const text = content ? source.slice(content.startOffset, content.endOffset) : ''
      blocks.set(blockType, { type: blockType, element: node, text, textStart })
      continue
    }
    const styling = tag === 'link' || tag === 'style' ? ' (styling is Tailwind classes only)' : ''
    error(offset, `<${tag}> isn't allowed in <head>; ${HEAD_RULE}${styling}`)
  }
  if (title === undefined) {
    warning(head.sourceCodeLocation?.startOffset ?? 0, 'missing <title>; the title names the view in the shell')
  } else if (title === '') {
    warning(head.sourceCodeLocation?.startOffset ?? 0, '<title> is empty; the title names the view in the shell')
  }

  // --- data blocks
  const parseBlock = (block: DataBlock, options: JsonParseOptions): JsonParseResult => {
    const result = parseJsonWithLocations(block.text, options)
    if (!result.ok) {
      const message = `invalid JSON in the ${block.type} block: ${result.message}`
      error(block.textStart + result.offset, message)
      issues.push({ message })
    }
    return result
  }

  // 'none': no schema block (no data, no events); 'invalid': skip checks that need the schema.
  let schemaState: 'none' | 'valid' | 'invalid' = 'none'
  let schema: MelzinSchema | null = null
  let schemaLocations = new Map<string, number>()
  const schemaBlock = blocks.get(SCHEMA_BLOCK_TYPE)
  if (schemaBlock !== undefined) {
    schemaState = 'invalid'
    const parsed = parseBlock(schemaBlock, {})
    if (parsed.ok) {
      schemaLocations = parsed.locations
      const validated = validateSchema(parsed.value)
      for (const issue of validated.issues) {
        const where = issue.path === undefined ? '' : ` ${issue.path}`
        error(schemaBlock.textStart + locate(parsed.locations, issue.path, 0), `schema${where}: ${issue.message}`)
        issues.push(issue)
      }
      if (validated.schema !== null) {
        schema = validated.schema
        schemaState = 'valid'
      }
    }
  }

  let snapshots: Snapshot[] = []
  const snapshotsBlock = blocks.get(SNAPSHOTS_BLOCK_TYPE)
  let snapshotsUnreadable = false
  if (snapshotsBlock !== undefined) {
    const parsed = parseBlock(snapshotsBlock, { rootPath: 'snapshots', bracketTopLevel: true })
    if (parsed.ok) {
      const result = parseSnapshots(parsed.value, schema, { validateData: schemaState !== 'invalid' })
      snapshots = result.snapshots
      for (const { name } of snapshots) {
        if (!INDEX_NAME_RE.test(name)) continue
        const path = `snapshots[${JSON.stringify(name)}]`
        warning(
          snapshotsBlock.textStart + locate(parsed.locations, path, 0),
          `${path}: names that are whole numbers are listed before all the others, whatever their order in the file; use words, such as "${name === '1' ? 'one item' : `${name} items`}"`,
        )
      }
      for (const issue of result.issues) {
        const where = issue.path ?? 'snapshots'
        error(snapshotsBlock.textStart + locate(parsed.locations, issue.path, 0), `${where}: ${issue.message}`)
        issues.push(issue)
      }
    } else {
      snapshotsUnreadable = true
    }
  }

  // --- body
  for (const attr of body.attrs) {
    const offset = body.sourceCodeLocation?.attrs?.[attr.name]?.startOffset ?? startOf(body) ?? 0
    warning(offset, `<body> takes no attributes ('${attr.name}'); put classes on an element inside it`)
  }

  const checked: MelzinSchema | null = schemaState === 'valid' ? schema : schemaState === 'none' ? {} : null
  const noSchemaHint = schemaState === 'none' ? ` (the view has no ${SCHEMA_BLOCK_TYPE} block)` : ''
  const displayed = new Set<string>()
  const emitted = new Set<string>()
  // A broken binding would also show up as "never displayed" or "nothing emits it"; skip those then.
  const broken = { text: false, click: false }

  // Where an attribute's value starts, and whether value offsets map 1:1 onto the source (they don't
  // when the value uses character references such as &quot;).
  const valueStart = (element: Element, name: string, value: string): { start: number; exact: boolean } => {
    const location = element.sourceCodeLocation?.attrs?.[name]
    if (location === undefined) return { start: startOf(element) ?? 0, exact: false }
    const raw = source.slice(location.startOffset, location.endOffset)
    let i = name.length
    while (/\s/.test(raw.charAt(i))) i++
    if (raw.charAt(i) !== '=') return { start: location.endOffset, exact: value === '' }
    i++
    while (/\s/.test(raw.charAt(i))) i++
    const quote = raw.charAt(i)
    const quoted = quote === '"' || quote === "'"
    if (quoted) i++
    const rawValue = quoted ? raw.slice(i, raw.length - 1) : raw.slice(i)
    return { start: location.startOffset + i, exact: rawValue === value }
  }

  const checkTextDirective = (element: Element, value: string): void => {
    const { start, exact } = valueStart(element, TEXT_DIRECTIVE, value)
    const at = (offset: number): number => (exact ? start + offset : start)
    const parsed = parseTextDirective(value)
    if (!parsed.ok) {
      broken.text = true
      error(at(parsed.offset), `${TEXT_DIRECTIVE}: ${parsed.message}`)
    } else if (checked !== null) {
      const resolved = resolvePath(checked, parsed.path)
      const expr = parseExpression(value)
      const pathStart = expr.ok ? expr.expr.start : 0
      if (resolved.ok) {
        displayed.add(parsed.path.join('.'))
      } else {
        broken.text = true
        error(at(pathStart), `${TEXT_DIRECTIVE}: ${resolved.message}${noSchemaHint}`)
      }
    }
    if (VOID_ELEMENTS.has(element.tagName)) {
      error(startOf(element) ?? 0, `${TEXT_DIRECTIVE} can't go on <${element.tagName}>: it has no content to set; use an element such as <span>`)
    }
    const child = element.childNodes.find(isElement)
    if (child !== undefined) {
      error(startOf(child) ?? startOf(element) ?? 0, `an ${TEXT_DIRECTIVE} element can't contain elements; the runtime replaces its content`)
    }
    for (const node of element.childNodes) {
      if (!isText(node)) continue
      const location = node.sourceCodeLocation
      const raw = location ? source.slice(location.startOffset, location.endOffset) : node.value
      const lead = raw.search(/\S/)
      if (lead < 0) continue
      warning((location?.startOffset ?? startOf(element) ?? 0) + lead, `${TEXT_DIRECTIVE} elements should be empty; sample text belongs in snapshots`)
      break
    }
  }

  const checkClickDirective = (element: Element, value: string): void => {
    const { start, exact } = valueStart(element, CLICK_DIRECTIVE, value)
    const at = (offset: number): number => (exact ? start + offset : start)
    const parsed = parseClickDirective(value)
    if (!parsed.ok) {
      broken.click = true
      error(at(parsed.offset), `${CLICK_DIRECTIVE}: ${parsed.message}`)
      return
    }
    emitted.add(parsed.event)
    if (checked === null) return
    const events = checked.events ?? {}
    if (Object.hasOwn(events, parsed.event)) return
    const expr = parseExpression(value)
    const arg = expr.ok && expr.expr.kind === 'call' ? expr.expr.args[0] : undefined
    const hint = suggest(parsed.event, Object.keys(events)) || (schemaState === 'valid' ? ` (add "${parsed.event}": {} to the schema's events)` : '')
    error(
      at(arg === undefined ? 0 : arg.start + 1),
      `${CLICK_DIRECTIVE}: event '${parsed.event}' isn't declared in the schema's events${hint}${noSchemaHint}`,
    )
  }

  // The same element and attribute rules the runtime applies (core/markup.ts), as errors.
  const walk = (node: ChildNode): void => {
    if (isText(node)) {
      const match = MUSTACHE_RE.exec(node.value)
      const location = node.sourceCodeLocation
      if (match !== null) {
        const raw = location ? source.slice(location.startOffset, location.endOffset) : node.value
        const at = (location?.startOffset ?? 0) + Math.max(0, raw.indexOf('{{'))
        warning(at, `'${match[0]}' isn't Melzin syntax and would show as is; bind an empty element instead: <span ${TEXT_DIRECTIVE}="name"></span>`)
      }
      return
    }
    if (!isElement(node)) return
    const offset = startOf(node) ?? 0
    const blockType = node.tagName === 'script' ? dataBlockType(getAttr(node, 'type')) : undefined
    const problem = blockType === undefined
      ? elementProblem(node.tagName, node.namespaceURI, (name) => getAttr(node, name) ?? null)
      : { message: `the ${blockType} block belongs in <head>`, drop: true }
    if (problem !== undefined) {
      error(offset, problem.message)
      if (problem.drop) return // the runtime drops it, content included
    }
    for (const attr of node.attrs) {
      const name = attr.prefix ? `${attr.prefix}:${attr.name}` : attr.name
      const at = node.sourceCodeLocation?.attrs?.[name]?.startOffset ?? offset
      const kind = classifyAttribute(name)
      if (kind.kind === 'plain') {
        const attribute = attributeProblem(name, attr.value)
        if (attribute !== undefined) error(at, attribute.message)
      } else if (kind.kind === 'foreign' || kind.kind === 'unsupported') {
        error(at, kind.message)
      } else if (kind.name === TEXT_DIRECTIVE) {
        checkTextDirective(node, attr.value)
      } else {
        checkClickDirective(node, attr.value)
      }
    }
    node.childNodes.forEach(walk)
  }
  bodyNodes.forEach(walk)

  // --- contract warnings (only against a schema we fully understood)
  if (schemaState === 'valid' && schema !== null && schemaBlock !== undefined) {
    const at = (path: string): number => schemaBlock.textStart + locate(schemaLocations, path, 0)
    for (const event of Object.keys(schema.events ?? {})) {
      if (!emitted.has(event) && !broken.click) warning(at(joinPath('events', event)), `event '${event}' is declared but nothing emits it`)
    }
    const leaves = leafPaths(schema)
    for (const leaf of leaves) {
      if (displayed.has(leaf) || broken.text) continue
      const schemaPath = leaf.split('.').reduce((path, name) => joinPath(joinPath(path, 'properties'), name), 'data')
      warning(at(schemaPath), `data field '${leaf}' is never displayed`)
    }
    if (leaves.length > 0 && snapshots.length === 0 && !snapshotsUnreadable) {
      warning(
        startOf(schemaBlock.element) ?? 0,
        `the view has data fields but no snapshots; add a ${SNAPSHOTS_BLOCK_TYPE} block with sample states, awkward ones included (very long text, zero, huge numbers)`,
      )
    }
  }

  diagnostics.sort((a, b) => a.line - b.line || a.col - b.col)
  return { diagnostics, view: { title: title ?? '', schema, snapshots, issues } }
}

/** Checks one view's source. `fileName` (optional) is only used for the file name rule. */
export function checkSource(source: string, fileName?: string): Diagnostic[] {
  return analyze(source, fileName).diagnostics
}

/** Parses a view's source like loadViewFile (title, schema, snapshots and data block issues). */
export function loadViewSource(source: string): LoadedView {
  return analyze(source, undefined).view
}

/** A warning when the view's generated `<name>.types.ts` no longer matches its schema. */
function staleTypes(absolute: string, file: string, analysis: Analysis): Diagnostic | undefined {
  if (!absolute.endsWith(VIEW_FILE_SUFFIX) || analysis.diagnostics.some((d) => d.severity === 'error')) return undefined
  const typesFile = typesPathFor(absolute)
  if (!existsSync(typesFile)) return undefined
  // Compare ignoring line endings, so a checkout with CRLF (core.autocrlf) doesn't warn forever.
  const current = readFileSync(typesFile, 'utf8').replace(/\r\n/g, '\n')
  if (current === generateTypes(analysis.view.schema, basename(absolute))) return undefined
  return {
    line: 1,
    col: 1,
    severity: 'warning',
    message: `${basename(typesFile)} is out of date with the schema; run melzin types ${file}`,
  }
}

/** Checks view files and returns their diagnostics; the CLI only formats this. */
export async function checkFiles(paths: string[], options: CheckOptions = {}): Promise<CheckResult> {
  const cwd = resolve(options.cwd ?? process.cwd())
  const files: FileCheckResult[] = []
  let errorCount = 0
  let warningCount = 0
  for (const path of paths) {
    const absolute = resolve(cwd, path)
    const file = relative(cwd, absolute) || absolute
    let diagnostics: Diagnostic[]
    try {
      const analysis = analyze(await readFile(absolute, 'utf8'), absolute)
      diagnostics = analysis.diagnostics
      const stale = staleTypes(absolute, file, analysis)
      if (stale !== undefined) diagnostics.unshift(stale)
    } catch (error) {
      const code = (error as NodeJS.ErrnoException).code
      const reason = code === 'ENOENT' ? 'file not found' : code === 'EISDIR' ? 'is a directory' : (error as Error).message
      diagnostics = [{ line: 1, col: 1, severity: 'error', message: `can't read the file: ${reason}` }]
    }
    for (const diagnostic of diagnostics) {
      if (diagnostic.severity === 'error') errorCount++
      else warningCount++
    }
    files.push({ file, diagnostics })
  }
  return { files, errorCount, warningCount }
}

/** Reads a view file with parse5 (Bun side): title, schema, snapshots and their issues. */
export async function loadViewFile(path: string): Promise<LoadedView> {
  return loadViewSource(await readFile(path, 'utf8'))
}

// ---------------------------------------------------------------------------------------------------
// CLI

function plural(count: number, word: string): string {
  return `${count} ${word}${count === 1 ? '' : 's'}`
}

/** `views/counter.mel.html:12:5: error: message` */
export function formatDiagnostic(file: string, diagnostic: Diagnostic): string {
  return `${file}:${diagnostic.line}:${diagnostic.col}: ${diagnostic.severity}: ${diagnostic.message}`
}

/** `2 errors, 1 warning in 3 files` */
export function formatSummary(result: CheckResult): string {
  return `${plural(result.errorCount, 'error')}, ${plural(result.warningCount, 'warning')} in ${plural(result.files.length, 'file')}`
}

/** Every diagnostic line of a result, file by file. */
export function formatDiagnostics(result: CheckResult): string[] {
  return result.files.flatMap(({ file, diagnostics }) => diagnostics.map((diagnostic) => formatDiagnostic(file, diagnostic)))
}

const CHECK_USAGE = 'usage: melzin check [files...] [--views dir]'

/** `melzin check [files...] [--views dir]`. Returns the exit code (1 when there are errors). */
export async function runCheck(args: string[]): Promise<number> {
  let parsed
  try {
    parsed = parseArgs({ args, allowPositionals: true, options: { views: { type: 'string' } } })
  } catch (error) {
    throw new UsageError(`${(error as Error).message}\n${CHECK_USAGE}`)
  }
  const { values, positionals } = parsed
  let paths = positionals
  if (paths.length === 0) {
    const project = resolveProject({ views: values.views })
    const views = project.listViews()
    if (views.length === 0) {
      console.error(`melzin check: no *${VIEW_FILE_SUFFIX} files in ${relative(process.cwd(), project.viewsDir) || '.'}`)
      return 1
    }
    paths = views
  }
  const result = await checkFiles(paths)
  for (const line of formatDiagnostics(result)) console.log(line)
  console.log(formatSummary(result))
  return result.errorCount > 0 ? 1 : 0
}
