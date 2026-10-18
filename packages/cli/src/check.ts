// `melzin check`, checkFiles and loadViewFile. Views are parsed with parse5 (with source locations) so
// every diagnostic points at a line and column: the attribute or the exact character inside its value,
// and the exact JSON position inside data blocks.

import { existsSync, readFileSync } from 'node:fs'
import { readFile } from 'node:fs/promises'
import { basename, join, relative, resolve } from 'node:path'
import { parseArgs } from 'node:util'
import { parse, type DefaultTreeAdapterTypes } from 'parse5'
import {
  CLICK_DIRECTIVE,
  type ChainDirective,
  type Condition,
  type DataBlockType,
  ELSE_DIRECTIVE,
  ELSE_IF_DIRECTIVE,
  FOR_DIRECTIVE,
  HREF_DIRECTIVE,
  IF_DIRECTIVE,
  type Issue,
  type MelzinSchema,
  ROUTES_FILE,
  type RouteRef,
  type RouteTable,
  SCHEMA_BLOCK_TYPE,
  SHOW_DIRECTIVE,
  SNAPSHOTS_BLOCK_TYPE,
  type Snapshot,
  type SnapshotOwnPaths,
  type Stage,
  TEXT_DIRECTIVE,
  VIEW_FILE_SUFFIX,
  VOID_ELEMENTS,
  attributeProblem,
  classifyAttribute,
  conditionHolds,
  dataBlockType,
  describeRouteRef,
  elementProblem,
  findRoute,
  formatFieldPath,
  isInterElementWhitespace,
  isPlainObject,
  joinPath,
  linkFields,
  matchRoute,
  parseClickDirective,
  parseConditionDirective,
  parseExpression,
  parseHrefDirective,
  parseRouteRef,
  parseSnapshots,
  parseTextDirective,
  resolveField,
  resolvePath,
  routesForView,
  schemaFields,
  schemaPathOf,
  snapshotOwnPaths,
  suggest,
  validateRouteTable,
  validateSchema,
  valueAt,
  viewStage,
} from 'melzin/core'
import { UsageError, misplacedViewProblem, misplacedViews, resolveProject } from './project.ts'
import { generateRouteTypes, generateTypes, routeTypesPathFor, typesPathFor, viewTypesImport } from './typegen.ts'

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
  /**
   * The project's route table, for the checks between views and routes. Defaults to the routes.json
   * in cwd; null skips those checks.
   */
  routes?: RouteContext | null
  /** The views directory, relative to cwd (default `views`): routes.json's views must be in it. */
  viewsDir?: string
}

/**
 * The project's route table as views are checked against it. `table` is null when routes.json is
 * missing (`present: false`) or has errors (then only its own check reports them).
 */
export type RouteContext = { present: boolean; table: RouteTable | null }

export type LoadedView = {
  /** Text of `<title>` with whitespace collapsed (as in parseViewHtml), '' when missing. */
  title: string
  /** Content of `<meta name="description">`, whitespace collapsed; '' when missing. */
  description: string
  /** The design stage the file is at, from what it has (SPEC D28, D33). */
  stage: Stage
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

/** What a view is checked against besides itself: the route table, and the view's name in it. */
type ViewRouteContext = { routes: RouteContext; view: string }

function analyze(input: string, fileName: string | undefined, context?: ViewRouteContext): Analysis {
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
    return { diagnostics, view: { title: '', description: '', stage: 'exploration', schema: null, snapshots: [], issues: [] } }
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
  let description: string | undefined
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
    if (tag === 'meta') {
      if (description === undefined && getAttr(node, 'name')?.trim().toLowerCase() === 'description') {
        description = (getAttr(node, 'content') ?? '').replace(/\s+/g, ' ').trim()
      }
      continue
    }
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
  let snapshotLocations = new Map<string, number>()
  const snapshotsBlock = blocks.get(SNAPSHOTS_BLOCK_TYPE)
  let snapshotsUnreadable = false
  let snapshotsValid = true
  // What each snapshot sets itself, rather than inherits from the one it extends (D30).
  let snapshotOwn: (name: string) => SnapshotOwnPaths = () => snapshotOwnPaths(undefined)
  if (snapshotsBlock !== undefined) {
    const parsed = parseBlock(snapshotsBlock, { rootPath: 'snapshots', bracketTopLevel: true })
    if (parsed.ok) {
      snapshotLocations = parsed.locations
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
      checkSnapshotNulls(parsed.value, snapshots, (path, message) => warning(snapshotsBlock.textStart + locate(parsed.locations, path, 0), `${path}: ${message}`))
      const entries = isPlainObject(parsed.value) ? parsed.value : {}
      snapshotOwn = (name) => snapshotOwnPaths(Object.hasOwn(entries, name) ? entries[name] : undefined)
      snapshotsValid = result.issues.length === 0
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
  // Leaves that something displays or tests.
  const used = new Set<string>()
  const emitted = new Set<string>()
  // A broken binding would also show up as "never used" or "nothing emits it"; skip those then.
  const broken = { text: false, click: false, condition: false }
  // For the checks against the route table: what the view reads from the URL, and its static links.
  const routeRefs: { ref: RouteRef; offset: number }[] = []
  const staticLinks: { href: string; offset: number }[] = []

  // A `route.*` path: an error when it's malformed, else recorded. Undefined for data paths.
  const checkRouteRef = (directive: string, segments: readonly string[], offset: number): boolean | undefined => {
    const ref = parseRouteRef(segments)
    if (ref === undefined) return undefined
    if (!ref.ok) {
      error(offset, `${directive}: ${ref.message}`)
      return false
    }
    routeRefs.push({ ref: ref.ref, offset })
    return true
  }

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
    const expr = parseExpression(value)
    const pathStart = expr.ok ? expr.expr.start : 0
    if (!parsed.ok) {
      broken.text = true
      error(at(parsed.offset), `${TEXT_DIRECTIVE}: ${parsed.message}`)
    } else if (checkRouteRef(TEXT_DIRECTIVE, parsed.path, at(pathStart)) !== undefined) {
      // the URL input: checked against the route table at the end
    } else if (checked !== null) {
      const resolved = resolvePath(checked, parsed.path)
      if (resolved.ok) {
        used.add(parsed.path.join('.'))
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

  // m-bind:href: a link's URL, from a link field (SPEC D23).
  const checkHrefDirective = (element: Element, value: string): void => {
    const { start, exact } = valueStart(element, HREF_DIRECTIVE, value)
    const at = (offset: number): number => (exact ? start + offset : start)
    if (element.tagName !== 'a' && element.tagName !== 'area') {
      error(startOf(element) ?? 0, `${HREF_DIRECTIVE} only works on links (<a> and <area>)`)
    }
    if (getAttr(element, 'href') !== undefined) {
      const offset = element.sourceCodeLocation?.attrs?.href?.startOffset ?? startOf(element) ?? 0
      error(offset, `a link with ${HREF_DIRECTIVE} can't also have a static href; keep ${HREF_DIRECTIVE}`)
    }
    const parsed = parseHrefDirective(value)
    if (!parsed.ok) {
      broken.text = true
      error(at(parsed.offset), `${HREF_DIRECTIVE}: ${parsed.message}`)
      return
    }
    const expr = parseExpression(value)
    const pathStart = at(expr.ok ? expr.expr.start : 0)
    const name = parsed.path.join('.')
    if (parseRouteRef(parsed.path) !== undefined) {
      error(pathStart, `${HREF_DIRECTIVE} needs a link field; '${name}' isn't a URL (views never build URLs)`)
      return
    }
    if (checked === null) return
    const resolved = resolveField(checked, parsed.path)
    if (!resolved.ok) {
      broken.text = true
      error(pathStart, `${HREF_DIRECTIVE}: ${resolved.message}${noSchemaHint}`)
      return
    }
    if (resolved.field.type === 'object') {
      error(pathStart, `${HREF_DIRECTIVE}: '${name}' is an object; it needs a link field`)
      return
    }
    used.add(name)
    if (resolved.field.type !== 'string' || resolved.field.route === undefined) {
      error(pathStart, `${HREF_DIRECTIVE}: '${name}' isn't a link field; give it "route": "<route name>" in the schema and have the source fill it with href() (views never build URLs)`)
    }
  }

  // m-show, m-if and m-else-if: the condition, or undefined when it's broken or constant (already reported).
  const checkConditionDirective = (element: Element, directive: string, value: string): Condition | undefined => {
    const { start, exact } = valueStart(element, directive, value)
    const at = (offset: number): number => (exact ? start + offset : start)
    const parsed = parseConditionDirective(directive, value)
    if (!parsed.ok) {
      broken.condition = true
      error(at(parsed.offset), `${directive}: ${parsed.message}`)
      return undefined
    }
    const { condition, pathStart } = parsed
    const isRoute = checkRouteRef(directive, condition.path, at(pathStart))
    if (isRoute !== undefined) return isRoute ? condition : undefined
    if (checked === null) return undefined
    const resolved = resolveField(checked, condition.path)
    if (!resolved.ok) {
      broken.condition = true
      error(at(pathStart), `${directive}: ${resolved.message}${noSchemaHint}`)
      return undefined
    }
    const name = condition.path.join('.')
    if (resolved.field.type !== 'object') {
      used.add(name)
    } else if (resolved.required) {
      warning(at(pathStart), `${directive}: '${name}' is a required object, so this condition is always ${condition.negated ? 'false' : 'true'}`)
      return undefined // the snapshot coverage check would only repeat this
    }
    return condition
  }

  // For the snapshot coverage warning: the conditions that decide whether an element shows (its m-if
  // chain and its m-show), and the nearest element around it that has conditions of its own.
  type Conditional = {
    /** The element's first condition directive, where the warning points. */
    offset: number
    /** Each condition with the result it needs; undefined when one of them is broken or constant. */
    tests: { condition: Condition; holds: boolean }[] | undefined
    /** What has to be true, for the message: `m-if="user.bio" holds`. */
    clauses: string[]
    parent: Conditional | undefined
  }
  const conditionals: Conditional[] = []
  // The m-if chain open among a run of siblings: its conditions so far (undefined: broken or constant).
  type Chain = { conditions: (Condition | undefined)[] }

  const checkMustache = (node: TextNode): void => {
    const match = MUSTACHE_RE.exec(node.value)
    if (match === null) return
    const location = node.sourceCodeLocation
    const raw = location ? source.slice(location.startOffset, location.endOffset) : node.value
    const at = (location?.startOffset ?? 0) + Math.max(0, raw.indexOf('{{'))
    warning(at, `'${match[0]}' isn't Melzin syntax and would show as is; bind an empty element instead: <span ${TEXT_DIRECTIVE}="name"></span>`)
  }

  // An element's directives and attributes. Returns the m-if chain that continues after it, if any.
  const checkElement = (node: Element, scope: Conditional | undefined, chain: Chain | undefined): Chain | undefined => {
    const offset = startOf(node) ?? 0
    let role: { directive: ChainDirective; at: number; value: string; condition: Condition | undefined } | undefined
    let show: { at: number; value: string; condition: Condition | undefined } | undefined
    for (const attr of node.attrs) {
      const name = attr.prefix ? `${attr.prefix}:${attr.name}` : attr.name
      const at = node.sourceCodeLocation?.attrs?.[name]?.startOffset ?? offset
      const kind = classifyAttribute(name)
      if (kind.kind === 'plain') {
        const attribute = attributeProblem(name, attr.value)
        if (attribute !== undefined) error(at, attribute.message)
        else if (name === 'href' && (node.tagName === 'a' || node.tagName === 'area')) staticLinks.push({ href: attr.value, offset: at })
      } else if (kind.kind === 'foreign' || kind.kind === 'unsupported') {
        error(at, kind.message)
      } else if (kind.name === TEXT_DIRECTIVE) {
        checkTextDirective(node, attr.value)
      } else if (kind.name === CLICK_DIRECTIVE) {
        checkClickDirective(node, attr.value)
      } else if (kind.name === HREF_DIRECTIVE) {
        checkHrefDirective(node, attr.value)
      } else if (kind.name === SHOW_DIRECTIVE) {
        show = { at, value: attr.value, condition: checkConditionDirective(node, SHOW_DIRECTIVE, attr.value) }
      } else if (kind.name === FOR_DIRECTIVE) {
        // m-for and the rows it repeats aren't checked yet: the core has parseForDirective and resolveList.
      } else if (role !== undefined) {
        error(at, `an element can have only one of ${IF_DIRECTIVE}, ${ELSE_IF_DIRECTIVE} and ${ELSE_DIRECTIVE}`)
      } else if (kind.name === ELSE_DIRECTIVE) {
        if (attr.value.trim() !== '') {
          error(at, `${ELSE_DIRECTIVE} takes no value; for another condition use ${ELSE_IF_DIRECTIVE}="${attr.value}"`)
        }
        role = { directive: ELSE_DIRECTIVE, at, value: '', condition: undefined }
      } else {
        role = { directive: kind.name, at, value: attr.value, condition: checkConditionDirective(node, kind.name, attr.value) }
      }
    }

    // Like the runtime: an m-else-if with no chain to join starts one, an m-else with none always shows.
    let previous: (Condition | undefined)[] = []
    let next: Chain | undefined
    if (role !== undefined && role.directive !== IF_DIRECTIVE) {
      if (chain === undefined) {
        error(role.at, `${role.directive} must come right after an element with ${IF_DIRECTIVE} or ${ELSE_IF_DIRECTIVE}`)
      } else {
        previous = chain.conditions
      }
    }
    const tests: { condition: Condition | undefined; holds: boolean }[] = []
    const clauses: string[] = []
    if (role !== undefined && (role.directive !== ELSE_DIRECTIVE || chain !== undefined)) {
      tests.push(...previous.map((condition) => ({ condition, holds: false })))
      if (role.directive === ELSE_DIRECTIVE) {
        clauses.push(`the conditions before its ${ELSE_DIRECTIVE} are all false`)
      } else {
        tests.push({ condition: role.condition, holds: true })
        const before = previous.length > 0 ? " and the conditions before it don't" : ''
        clauses.push(`${role.directive}="${role.value.trim()}" holds${before}`)
        next = { conditions: [...previous, role.condition] }
      }
    }
    if (show !== undefined) {
      tests.push({ condition: show.condition, holds: true })
      clauses.push(`${SHOW_DIRECTIVE}="${show.value.trim()}" holds`)
    }

    let conditional: Conditional | undefined
    if (tests.length > 0) {
      const complete = tests.every((test) => test.condition !== undefined)
      conditional = {
        offset: Math.min(role?.at ?? Infinity, show?.at ?? Infinity),
        tests: complete ? (tests as { condition: Condition; holds: boolean }[]) : undefined,
        clauses,
        parent: scope,
      }
      conditionals.push(conditional)
    }
    walkNodes(node.childNodes, conditional ?? scope)
    return next
  }

  // The same element and attribute rules the runtime applies (core/markup.ts), as errors. Siblings are
  // walked in order, so an m-else-if or m-else knows the chain it continues.
  const walkNodes = (nodes: ChildNode[], scope: Conditional | undefined): void => {
    let chain: Chain | undefined
    for (const node of nodes) {
      if (isText(node)) {
        checkMustache(node)
        if (!isInterElementWhitespace(node.value)) chain = undefined
        continue
      }
      if (!isElement(node)) continue // comments don't end a chain
      const offset = startOf(node) ?? 0
      const blockType = node.tagName === 'script' ? dataBlockType(getAttr(node, 'type')) : undefined
      const problem = blockType === undefined
        ? elementProblem(node.tagName, node.namespaceURI, (name) => getAttr(node, name) ?? null)
        : { message: `the ${blockType} block belongs in <head>`, drop: true }
      if (problem !== undefined) {
        error(offset, problem.message)
        if (problem.drop) continue // the runtime drops it, content included
      }
      chain = checkElement(node, scope, chain)
    }
  }
  walkNodes(bodyNodes, undefined)

  // --- contract warnings (only against a schema we fully understood)
  if (schemaState === 'valid' && schema !== null && schemaBlock !== undefined) {
    const at = (path: string): number => schemaBlock.textStart + locate(schemaLocations, path, 0)
    for (const event of Object.keys(schema.events ?? {})) {
      if (!emitted.has(event) && !broken.click) warning(at(joinPath('events', event)), `event '${event}' is declared but nothing emits it`)
    }
    const leaves = schemaFields(schema).filter(({ field }) => field.type !== 'object' && field.type !== 'array')
    for (const { path } of leaves) {
      const leaf = formatFieldPath(path)
      if (used.has(leaf) || broken.text || broken.condition) continue
      warning(at(schemaPathOf(path)), `data field '${leaf}' is never used`)
    }
    if (leaves.length > 0 && snapshots.length === 0 && !snapshotsUnreadable) {
      warning(
        startOf(schemaBlock.element) ?? 0,
        `the view has data fields but no snapshots; add a ${SNAPSHOTS_BLOCK_TYPE} block with sample states, awkward ones included (very long text, zero, huge numbers)`,
      )
    }
  }

  // --- snapshot coverage: every element behind a condition shows in at least one snapshot, so its
  // design can be reviewed. Waits until the snapshots match the schema.
  if (checked !== null && snapshots.length > 0 && snapshotsValid) {
    type Coverage = { own: boolean[]; shows: boolean[] } | undefined
    const coverage = new Map<Conditional, Coverage>()
    const cover = (conditional: Conditional): Coverage => {
      if (coverage.has(conditional)) return coverage.get(conditional)
      const parent = conditional.parent === undefined ? undefined : cover(conditional.parent)
      let result: Coverage
      if (conditional.tests !== undefined && (conditional.parent === undefined || parent !== undefined)) {
        const { tests } = conditional
        const own = snapshots.map(({ data, route }) => tests.every(({ condition, holds }) => conditionHolds(checked, data, condition, route) === holds))
        result = { own, shows: own.map((value, i) => value && (parent?.shows[i] ?? true)) }
      }
      coverage.set(conditional, result)
      return result
    }
    for (const conditional of conditionals) {
      const result = cover(conditional)
      if (result === undefined || result.shows.some(Boolean)) continue
      // Inside an element that never shows either, only that one gets the warning.
      if (conditional.parent !== undefined && !cover(conditional.parent)!.shows.some(Boolean)) continue
      warning(
        conditional.offset,
        result.own.some(Boolean)
          ? 'no snapshot shows this element; its conditions only hold where an element around it is hidden'
          : `no snapshot shows this element; add one where ${conditional.clauses.join(' and ')}`,
      )
    }
  }

  if (context !== undefined) {
    checkAgainstRoutes({
      context,
      schema: schemaState === 'valid' ? schema : null,
      schemaAt: (path) => (schemaBlock === undefined ? 0 : schemaBlock.textStart + locate(schemaLocations, path, 0)),
      snapshots: snapshotsValid && !snapshotsUnreadable ? snapshots : [],
      snapshotAt: (path) => (snapshotsBlock === undefined ? 0 : snapshotsBlock.textStart + locate(snapshotLocations, path, 0)),
      snapshotOwn,
      routeRefs,
      staticLinks,
      error,
      warning,
    })
  }

  const stage = viewStage({
    schemaBlock: schemaBlock !== undefined,
    snapshotsBlock: snapshotsBlock !== undefined,
    schema: schemaState === 'valid' ? schema : null,
    readsRoute: routeRefs.length > 0,
  })
  diagnostics.sort((a, b) => a.line - b.line || a.col - b.col)
  return { diagnostics, view: { title: title ?? '', description: description ?? '', stage, schema, snapshots, issues } }
}

/**
 * Warns about a `null` that removes nothing (D30): null removes what a snapshot inherits from the one it
 * extends, so in a snapshot that extends none, or for a field its base doesn't have, it's a mistake,
 * likely a typo. `value` is the parsed block, `snapshots` the resolved ones.
 */
function checkSnapshotNulls(value: unknown, snapshots: readonly Snapshot[], warn: (path: string, message: string) => void): void {
  if (!isPlainObject(value)) return
  for (const snapshot of snapshots) {
    const entry = value[snapshot.name]
    if (!isPlainObject(entry)) continue
    // A broken 'extends' is an error already; its nulls can wait until it resolves.
    if (entry.extends !== undefined && snapshot.extends === undefined) continue
    const base = snapshot.extends === undefined ? undefined : snapshots.find((item) => item.name === snapshot.extends)
    if (snapshot.extends !== undefined && base === undefined) continue
    const inherited: Record<string, unknown> = base === undefined ? {} : { data: base.data, route: base.route }
    const walk = (node: Record<string, unknown>, segments: string[], path: string): void => {
      for (const [key, child] of Object.entries(node)) {
        const childPath = joinPath(path, key)
        if (isPlainObject(child)) {
          walk(child, [...segments, key], childPath)
        } else if (child === null) {
          if (base === undefined) {
            warn(childPath, 'null removes a field the snapshot inherits, and this one extends no other; leave the field out')
            continue
          }
          const parent = valueAt(inherited, segments)
          if (isPlainObject(parent) && Object.hasOwn(parent, key)) continue
          const keys = isPlainObject(parent) ? Object.keys(parent) : []
          warn(childPath, `'${base.name}' has no '${key}' here, so null removes nothing${suggest(key, keys)}`)
        }
      }
    }
    const prefix = `snapshots[${JSON.stringify(snapshot.name)}]`
    for (const key of ['data', 'route']) {
      const part = entry[key]
      if (isPlainObject(part)) walk(part, [key], `${prefix}.${key}`)
    }
  }
}

type RouteCheck = {
  context: ViewRouteContext
  /** Null when the schema has errors (those are reported already). */
  schema: MelzinSchema | null
  schemaAt: (path: string) => number
  /** Empty when the snapshots have errors. */
  snapshots: Snapshot[]
  snapshotAt: (path: string) => number
  snapshotOwn: (name: string) => SnapshotOwnPaths
  routeRefs: { ref: RouteRef; offset: number }[]
  staticLinks: { href: string; offset: number }[]
  error: (offset: number, message: string) => void
  warning: (offset: number, message: string) => void
}

// A view against the route table (SPEC D21–D27): what it reads from the URL, its link fields and the
// URLs in its snapshots, and its static links.
function checkAgainstRoutes(check: RouteCheck): void {
  const { context, schema, snapshots, error, warning } = check
  const { present, table } = context.routes
  const shownBy = table === null ? [] : routesForView(table, context.view)

  for (const { ref, offset } of check.routeRefs) {
    const name = describeRouteRef(ref)
    if (!present) {
      warning(offset, `${name} is always empty: the project has no ${ROUTES_FILE}, so no route shows this view`)
      continue
    }
    if (table === null || ref.kind === 'name') continue
    if (shownBy.length === 0) {
      warning(offset, `${name} is always empty: no route in ${ROUTES_FILE} shows the view '${context.view}'`)
      continue
    }
    for (const route of shownBy) {
      if (ref.kind === 'param' && !route.params.includes(ref.name)) {
        error(offset, `${name}: route '${route.name}' (${route.path}) has no :${ref.name} parameter${suggest(ref.name, route.params, (best) => `route.params.${best}`)}`)
      } else if (ref.kind === 'query' && !route.query.includes(ref.name)) {
        error(offset, `${name}: route '${route.name}' doesn't declare the query parameter '${ref.name}'; add "${ref.name}": {} to its query in ${ROUTES_FILE}`)
      }
    }
  }

  const links = linkFields(schema)
  for (const link of links) {
    const offset = check.schemaAt(joinPath(schemaPathOf(link.path), 'route'))
    const field = formatFieldPath(link.path)
    if (!present) {
      warning(offset, `link field '${field}' names route '${link.route}', but the project has no ${ROUTES_FILE}`)
    } else if (table !== null && findRoute(table, link.route) === undefined) {
      const hint = suggest(link.route, table.routes.map((route) => route.name))
      error(offset, `link field '${field}' names route '${link.route}', which isn't in ${ROUTES_FILE}${hint}`)
    }
  }

  if (table === null) return

  // What's wrong with each snapshot's URLs, by path relative to the snapshot (`data.authorUrl`, '' for
  // the whole snapshot) and the text after that path.
  type Finding = { relative: string; severity: Severity; text: string }
  const findingsOf = (snapshot: Snapshot): Finding[] => {
    const found: Finding[] = []
    // Snapshots show real URLs: each link field's value must be a URL of its route.
    for (const link of links) {
      const value = valueAt(snapshot.data, link.path)
      const route = findRoute(table, link.route)
      if (typeof value !== 'string' || route === undefined) continue
      const match = value.startsWith('/') && !value.startsWith('//') ? matchRoute(table, value) : null
      if (match?.route.name === link.route) continue
      const other = match === null ? '' : `; it's a URL of route '${match.route.name}'`
      const relative = link.path.reduce((result, name) => joinPath(result, name), 'data')
      found.push({ relative, severity: 'error', text: `: '${value}' isn't a URL of route '${route.name}' (${route.path})${other}` })
    }
    if (shownBy.length === 0) return found
    const params = snapshot.route?.params ?? {}
    for (const name of Object.keys(params)) {
      if (shownBy.some((route) => route.params.includes(name))) continue
      found.push({ relative: `route.params.${name}`, severity: 'warning', text: `: no route that shows this view has a :${name} parameter` })
    }
    const query = snapshot.route?.query ?? {}
    for (const name of Object.keys(query)) {
      if (shownBy.some((route) => route.query.includes(name))) continue
      found.push({ relative: `route.query.${name}`, severity: 'warning', text: `: no route that shows this view declares the query parameter '${name}'` })
    }
    // A parameter the view shows needs a value in every snapshot, or the snapshot shows a gap.
    const missing = [...new Set(check.routeRefs.flatMap(({ ref }) => (ref.kind === 'param' && !Object.hasOwn(params, ref.name) ? [ref.name] : [])))]
    if (missing.length > 0) {
      const example = missing.map((name) => `"${name}": "..."`).join(', ')
      found.push({ relative: '', severity: 'warning', text: ` has no ${missing.map((name) => `route.params.${name}`).join(', ')}, which the view shows; add "route": { "params": { ${example} } }` })
    }
    return found
  }
  const findings = new Map(snapshots.map((snapshot) => [snapshot.name, findingsOf(snapshot)]))
  for (const snapshot of snapshots) {
    const own = check.snapshotOwn(snapshot.name)
    // A problem the base has too, in a value this snapshot inherits, is the base's to report (D30).
    const inherited = snapshot.extends === undefined ? [] : (findings.get(snapshot.extends) ?? [])
    const prefix = `snapshots[${JSON.stringify(snapshot.name)}]`
    for (const finding of findings.get(snapshot.name) ?? []) {
      if (!own.sets(finding.relative) && inherited.some((other) => other.relative === finding.relative && other.text === finding.text)) continue
      const path = finding.relative === '' ? prefix : `${prefix}.${finding.relative}`
      ;(finding.severity === 'error' ? error : warning)(check.snapshotAt(path), `${path}${finding.text}`)
    }
  }

  for (const { href, offset } of check.staticLinks) {
    if (!href.startsWith('/') || href.startsWith('//')) continue
    if (matchRoute(table, href) === null) {
      warning(offset, `no route in ${ROUTES_FILE} matches '${href}', so following it loads another page instead of switching screens`)
    }
  }
}

/**
 * Checks one view's source. `fileName` (optional) is used for the file name rule and, with `routes`,
 * names the view in the route table.
 */
export function checkSource(source: string, fileName?: string, routes?: RouteContext): Diagnostic[] {
  const view = fileName?.endsWith(VIEW_FILE_SUFFIX) ? basename(fileName).slice(0, -VIEW_FILE_SUFFIX.length) : undefined
  return analyze(source, fileName, routes === undefined || view === undefined ? undefined : { routes, view }).diagnostics
}

/** The route table in `dir` (the project root) as views are checked against it. */
export function loadRouteContext(dir: string): RouteContext {
  const path = join(dir, ROUTES_FILE)
  if (!existsSync(path)) return { present: false, table: null }
  try {
    return { present: true, table: validateRouteTable(JSON.parse(readFileSync(path, 'utf8'))).table }
  } catch {
    return { present: true, table: null }
  }
}

/** Result of checking a route table's source: its diagnostics, and the table when it has no errors. */
export type RoutesCheck = { diagnostics: Diagnostic[]; table: RouteTable | null }

/**
 * Checks a routes.json source (SPEC D21–D24): JSON, the table's rules, and that each route's view is
 * in `views` (the view names in the views directory; null skips that check).
 */
export function checkRoutesSource(input: string, views: readonly string[] | null): RoutesCheck {
  const source = input.startsWith('\uFEFF') ? input.slice(1) : input
  const starts = lineStarts(source)
  const diagnostics: Diagnostic[] = []
  const report = (offset: number, message: string): void => {
    let line = 0
    while (line + 1 < starts.length && starts[line + 1]! <= offset) line++
    diagnostics.push({ line: line + 1, col: offset - starts[line]! + 1, severity: 'error', message })
  }
  const parsed = parseJsonWithLocations(source)
  if (!parsed.ok) {
    report(parsed.offset, `invalid JSON: ${parsed.message}`)
    return { diagnostics, table: null }
  }
  const { table, issues } = validateRouteTable(parsed.value)
  for (const issue of issues) report(locate(parsed.locations, issue.path, 0), issue.path === undefined ? issue.message : `${issue.path}: ${issue.message}`)
  // Views are checked from the raw table, so a missing view shows up even next to other problems.
  const routes = (parsed.value as { routes?: unknown }).routes
  if (views !== null && typeof routes === 'object' && routes !== null && !Array.isArray(routes)) {
    for (const [name, route] of Object.entries(routes)) {
      const view = (route as { view?: unknown } | null)?.view
      if (typeof view !== 'string' || view.endsWith(VIEW_FILE_SUFFIX) || view.includes('/') || views.includes(view)) continue
      const path = joinPath(joinPath('routes', name), 'view')
      report(locate(parsed.locations, path, 0), `${path}: there's no view named '${view}' (${view}${VIEW_FILE_SUFFIX} in the views folder)${suggest(view, views)}`)
    }
  }
  diagnostics.sort((a, b) => a.line - b.line || a.col - b.col)
  return { diagnostics, table: diagnostics.length === 0 ? table : null }
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

/** A warning when the generated `routes.types.ts` no longer matches the route table. */
function staleRouteTypes(absolute: string, file: string, table: RouteTable | null, viewsDir: string): Diagnostic | undefined {
  if (table === null) return undefined
  const typesFile = routeTypesPathFor(absolute)
  if (!existsSync(typesFile)) return undefined
  const current = readFileSync(typesFile, 'utf8').replace(/\r\n/g, '\n')
  const expected = generateRouteTypes(table, (view) => viewTypesImport(typesFile, viewsDir, view), basename(absolute))
  if (current === expected) return undefined
  return { line: 1, col: 1, severity: 'warning', message: `${basename(typesFile)} is out of date with the route table; run melzin types ${file}` }
}

/**
 * Checks view files, and a routes.json among them, and returns their diagnostics; the CLI only
 * formats this. Views are checked against the project's route table (see CheckOptions.routes).
 */
export async function checkFiles(paths: string[], options: CheckOptions = {}): Promise<CheckResult> {
  const cwd = resolve(options.cwd ?? process.cwd())
  const routes = options.routes === undefined ? loadRouteContext(cwd) : options.routes
  const project = resolveProject({ cwd, views: options.viewsDir })
  const files: FileCheckResult[] = []
  let errorCount = 0
  let warningCount = 0
  for (const path of paths) {
    const absolute = resolve(cwd, path)
    const file = relative(cwd, absolute) || absolute
    let diagnostics: Diagnostic[]
    try {
      const source = await readFile(absolute, 'utf8')
      if (basename(absolute) === ROUTES_FILE) {
        const views = project.listViews().map((view) => basename(view).slice(0, -VIEW_FILE_SUFFIX.length))
        const result = checkRoutesSource(source, views)
        diagnostics = result.diagnostics
        const stale = staleRouteTypes(absolute, file, result.table, project.viewsDir)
        if (stale !== undefined) diagnostics.unshift(stale)
      } else {
        // An alternative in explore/<alternative>/ is checked as the view it stands in for (SPEC D31).
        const view = absolute.endsWith(VIEW_FILE_SUFFIX) ? basename(absolute).slice(0, -VIEW_FILE_SUFFIX.length) : undefined
        const analysis = analyze(source, absolute, routes === null || view === undefined ? undefined : { routes, view })
        diagnostics = analysis.diagnostics
        const stale = staleTypes(absolute, file, analysis)
        if (stale !== undefined) diagnostics.unshift(stale)
        const misplaced = misplacedViewProblem(project, absolute)
        if (misplaced !== undefined) diagnostics.unshift({ line: 1, col: 1, severity: 'error', message: misplaced })
      }
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

/**
 * `melzin check [files...] [--views dir]`: the given files, or every view, every alternative in
 * explore/ (SPEC D31) and routes.json when there is one. Returns the exit code (1 when there are errors).
 */
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
    const views = [
      ...project.listViews(),
      ...project.listAlternatives().flatMap((alternative) => alternative.views),
      ...misplacedViews(project).map(({ path }) => path),
    ]
    if (views.length === 0) {
      console.error(`melzin check: no *${VIEW_FILE_SUFFIX} files in ${relative(process.cwd(), project.viewsDir) || '.'}`)
      return 1
    }
    paths = existsSync(join(project.root, ROUTES_FILE)) ? [...views, join(project.root, ROUTES_FILE)] : views
  }
  const result = await checkFiles(paths, { viewsDir: values.views })
  for (const line of formatDiagnostics(result)) console.log(line)
  console.log(formatSummary(result))
  return result.errorCount > 0 ? 1 : 0
}
