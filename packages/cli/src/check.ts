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
  LIST_ITEMS,
  type ListSchema,
  type MelzinSchema,
  PATH_PLACEHOLDER,
  ROUTES_FILE,
  ROUTE_INPUT,
  type RouteRef,
  type RouteTable,
  SCHEMA_BLOCK_TYPE,
  SHOW_DIRECTIVE,
  SNAPSHOTS_BLOCK_TYPE,
  type Scope,
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
  fieldPathOf,
  findRoute,
  forChainMessage,
  formatFieldPath,
  hasField,
  isChainDirective,
  isInterElementWhitespace,
  isPlainObject,
  itemName,
  joinPath,
  lengthMessage,
  linkFields,
  matchRoute,
  parseClickDirective,
  parseConditionDirective,
  parseExpression,
  parseForDirective,
  parseHrefDirective,
  parseRouteRef,
  parseSnapshots,
  parseTextDirective,
  payloadFixMessage,
  payloadIssues,
  resolveField,
  resolveList,
  resolvePath,
  routesForView,
  schemaFields,
  schemaPathOf,
  snapshotOwnPaths,
  suggest,
  validateRouteTable,
  validateSchema,
  valueAt,
  valuesAt,
  viewStage,
  withAlias,
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
const UNTERMINATED_STRING = 'unterminated string'
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
      if (this.pos >= this.text.length) throw new JsonSyntaxError(UNTERMINATED_STRING, start)
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
  /** Where a `</script>` inside one of its JSON strings ended the block, if one did (see scriptEndCut). */
  cutAt?: number
}

/**
 * Where a data block's JSON was cut short by a `</script>` inside one of its strings, which ends the
 * block in HTML: the offset of that tag, and the source the rest of the JSON spilled into (up to and
 * with the `</script>` meant to end the block). Undefined unless the JSON, continued up to a later
 * `</script>`, parses whole.
 */
function scriptEndCut(
  source: string,
  textStart: number,
  text: string,
  endTag: { startOffset: number; endOffset: number } | undefined,
): { at: number; spill: [number, number] } | undefined {
  if (endTag === undefined) return undefined
  const parsed = parseJsonWithLocations(text)
  if (parsed.ok || parsed.message !== UNTERMINATED_STRING) return undefined
  const close = /<\/script(?=[\s/>])[^>]*>?/gi
  close.lastIndex = endTag.endOffset
  for (let match = close.exec(source); match !== null; match = close.exec(source)) {
    const whole = parseJsonWithLocations(source.slice(textStart, match.index))
    if (whole.ok) return { at: endTag.startOffset, spill: [endTag.endOffset, match.index + match[0].length] }
    if (whole.message !== UNTERMINATED_STRING) return undefined
  }
  return undefined
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

/** Vue's and Alpine's loop attributes, which Melzin writes as m-for. */
const FOREIGN_LOOPS = new Set(['v-for', 'x-for'])

/**
 * The item's name and the list of a Vue or Alpine loop, read loosely, for the m-for to write instead:
 * `(member, i) in members` → `member`, `members`. Either is undefined when the value doesn't say.
 */
function looseLoop(value: string): { alias: string | undefined; list: string | undefined } {
  const parsed = parseForDirective(value)
  if (parsed.ok) return { alias: parsed.alias, list: parsed.path.join('.') }
  const alias = /^\s*\(?\s*([A-Za-z_][A-Za-z0-9_]*)/.exec(value)?.[1]
  const list = /\s(?:in|of)\s+([A-Za-z_][A-Za-z0-9_]*(?:\.[A-Za-z_][A-Za-z0-9_]*)*)\s*$/.exec(value)?.[1]
  return { alias, list }
}

/** `prefix:name` for namespaced attributes (xlink:href), else the name. */
function attributeName(attr: { prefix?: string; name: string }): string {
  return attr.prefix ? `${attr.prefix}:${attr.name}` : attr.name
}

/**
 * What the directives on an element the runtime drops, and on everything inside it (a <template>'s
 * content too), would do: send events, or read data. Those wait, like broken bindings, until the element
 * is fixed, since its error is often why they look unused.
 */
function droppedBindings(node: Element): { sends: boolean; reads: boolean } {
  const found = { sends: false, reads: false }
  const visit = (element: Element): void => {
    for (const attr of element.attrs) {
      const name = attributeName(attr)
      if (classifyAttribute(name).kind === 'plain') continue
      if (/^(?:m-on:|v-on:|x-on:|@)/.test(name)) found.sends = true
      else found.reads = true
    }
    const content = 'content' in element ? (element as DefaultTreeAdapterTypes.Template).content.childNodes : []
    for (const child of [...element.childNodes, ...content]) if (isElement(child)) visit(child)
  }
  visit(node)
  return found
}

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
  // Source a data block's JSON spilled into after a `</script>` in one of its strings: what the parser
  // made of it is reported as that block's error, not as head content.
  const spills: [number, number][] = []
  const spilled = (node: ChildNode): boolean => {
    const location = node.sourceCodeLocation
    if (location == null) return false
    return spills.some(([start, end]) => {
      if (location.startOffset < start || location.startOffset >= end) return false
      // Text may run on past the block's real end (over the end tags HTML ignores there); an element
      // that does holds what comes after, which is checked as usual.
      if (!isText(node)) return location.endOffset <= end
      return !/\S/.test(source.slice(end, location.endOffset).replace(/<[^>]*>/g, ''))
    })
  }
  for (const node of headNodes) {
    if (spilled(node)) continue
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
      const content = node.childNodes.find(isText)?.sourceCodeLocation
      const textStart = content?.startOffset ?? node.sourceCodeLocation?.startTag?.endOffset ?? offset
      const text = content ? source.slice(content.startOffset, content.endOffset) : ''
      const cut = scriptEndCut(source, textStart, text, node.sourceCodeLocation?.endTag ?? undefined)
      if (cut !== undefined) spills.push(cut.spill)
      if (blocks.has(blockType)) {
        error(offset, `duplicate ${blockType} block; a view has at most one`)
        issues.push({ message: `duplicate ${blockType} block; a view has at most one` })
        continue
      }
      blocks.set(blockType, { type: blockType, element: node, text, textStart, cutAt: cut?.at })
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
      const cut = block.cutAt !== undefined
      const message = cut
        ? `invalid JSON in the ${block.type} block: a '</script>' inside a string ends the block here; write it as '<\\/script>'`
        : `invalid JSON in the ${block.type} block: ${result.message}`
      error(cut ? block.cutAt! : block.textStart + result.offset, message)
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
  // Fields that something displays, tests, repeats or sends, as formatFieldPath writes them: `user.name`,
  // `members` (a list an m-for or a .length condition uses), `members[].name`, `tags[]`.
  const used = new Set<string>()
  const emitted = new Set<string>()
  // A broken binding would also show up as "never used" or "nothing emits it"; skip those then. `markup`
  // is for bindings inside an element the runtime drops (a <template>), whose error is reported alone.
  const broken = { text: false, click: false, condition: false, loop: false, payload: false, markup: false }
  // For the checks against the route table: what the view reads from the URL, and its static links.
  const routeRefs: { ref: RouteRef; offset: number }[] = []
  const staticLinks: { href: string; offset: number }[] = []

  // For the snapshot coverage warnings: what decides whether an element shows. A condition is an
  // element's m-if chain and m-show; a loop is an m-for, which shows its element once per item.
  type Conditional = {
    kind: 'condition'
    /** The element's first condition directive, where the warning points. */
    offset: number
    /** Each condition with the result it needs; undefined when one of them is broken. */
    tests: { condition: Condition; holds: boolean }[] | undefined
    /** A constant condition never gives the result it needs, which its own warning says already. */
    blocked: boolean
    /** What has to be true, for the message: `m-if="user.bio" holds`. */
    clauses: string[]
    parent: Gate | undefined
  }
  type Loop = {
    kind: 'loop'
    /** The m-for attribute, where its warnings point. */
    offset: number
    alias: string
    /** The list's path as written (`poll.options`), and its field path (['polls', '[]', 'options']). */
    segments: string[]
    path: string[]
    list: ListSchema
    parent: Gate | undefined
  }
  type Gate = Conditional | Loop
  // In document order.
  const gates: Gate[] = []
  const loops: Loop[] = []
  /**
   * Where an element sits: the nearest gate that decides whether it shows (its own, or an element's
   * around it), the aliases of the rows around it, and whether an m-for repeats it. Inside an m-for that
   * doesn't work, `lenient` has its alias, or `unknown` when the m-for didn't parse.
   */
  type Context = { gate: Gate | undefined; scope: Scope | undefined; inRow: boolean; lenient: { aliases: ReadonlySet<string>; unknown: boolean } | undefined }

  // Inside a broken m-for, a path that may read its item isn't checked: the m-for's error explains it,
  // and fixing the m-for brings the check back. Data fields, outer aliases and route.* still are.
  const unchecked = (segments: readonly string[], context: Context): boolean => {
    const { lenient } = context
    const first = segments[0]
    if (lenient === undefined || first === undefined) return false
    if (lenient.aliases.has(first)) return true
    if (!lenient.unknown || first === ROUTE_INPUT || context.scope?.has(first) === true) return false
    return !(checked?.data !== undefined && Object.hasOwn(checked.data.properties, first))
  }
  // Conditions that always hold, or never do (on a required list or object), each warned about at its
  // directive. They count in the coverage like any other: true, or false with !.
  const constants = new WeakSet<Condition>()
  const useField = (segments: readonly string[], scope: Scope | undefined): void => {
    used.add(formatFieldPath(fieldPathOf(segments, scope)))
  }

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

  const checkTextDirective = (element: Element, value: string, context: Context): void => {
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
    } else if (checked !== null && !unchecked(parsed.path, context)) {
      const resolved = resolvePath(checked, parsed.path, context.scope)
      if (resolved.ok) {
        useField(parsed.path, context.scope)
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

  const checkClickDirective = (element: Element, value: string, context: Context): void => {
    const { start, exact } = valueStart(element, CLICK_DIRECTIVE, value)
    const at = (offset: number): number => (exact ? start + offset : start)
    const parsed = parseClickDirective(value)
    if (!parsed.ok) {
      broken.click = true
      // A payload in a form emit doesn't take: the fix in the event's declared fields and the row's names.
      const message = parsed.fix === undefined ? parsed.message : payloadFixMessage(checked, parsed.fix, context.scope)
      error(at(parsed.offset), `${CLICK_DIRECTIVE}: ${message}`)
      return
    }
    emitted.add(parsed.event)
    if (checked === null) return
    const events = checked.events ?? {}
    const expr = parseExpression(value)
    const arg = expr.ok && expr.expr.kind === 'call' ? expr.expr.args[0] : undefined
    const eventAt = arg === undefined ? 0 : arg.start + 1
    const declared = Object.hasOwn(events, parsed.event)
    if (!declared) {
      // Often a typo of a declared event, which then isn't "emitted" either: that waits too.
      broken.click = true
      const hint = suggest(parsed.event, Object.keys(events)) || (schemaState === 'valid' ? ` (add "${parsed.event}": {} to the schema's events)` : '')
      error(at(eventAt), `${CLICK_DIRECTIVE}: event '${parsed.event}' isn't declared in the schema's events${hint}${noSchemaHint}`)
    }
    // The payload (D35): each value uses what it reads, and the whole must fit the event's payload.
    const fields = parsed.payload?.fields ?? []
    if (fields.some((field) => unchecked(field.path, context))) return
    for (const field of fields) {
      const ref = parseRouteRef(field.path)
      if (ref !== undefined) {
        if (ref.ok) routeRefs.push({ ref: ref.ref, offset: at(field.pathStart) })
        continue
      }
      const resolved = resolveField(checked, field.path, context.scope)
      if (resolved.ok && resolved.length === undefined && resolved.field.type !== 'object' && resolved.field.type !== 'array') {
        useField(field.path, context.scope)
      }
    }
    if (!declared) return // the payload is checked once the event is declared
    const issues = payloadIssues(checked, parsed.event, parsed.payload, eventAt, context.scope)
    if (issues.length > 0) broken.payload = true
    for (const issue of issues) error(at(issue.offset), `${CLICK_DIRECTIVE}: ${issue.message}`)
  }

  // m-bind:href: a link's URL, from a link field (SPEC D23).
  const checkHrefDirective = (element: Element, value: string, context: Context): void => {
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
    if (checked === null || unchecked(parsed.path, context)) return
    const resolved = resolveField(checked, parsed.path, context.scope)
    if (!resolved.ok) {
      broken.text = true
      error(pathStart, `${HREF_DIRECTIVE}: ${resolved.message}${noSchemaHint}`)
      return
    }
    if (resolved.length !== undefined) {
      error(pathStart, `${HREF_DIRECTIVE}: ${lengthMessage(name)}`)
      return
    }
    if (resolved.field.type === 'object') {
      error(pathStart, `${HREF_DIRECTIVE}: '${name}' is an object; it needs a link field`)
      return
    }
    if (resolved.field.type === 'array') {
      const item = itemName(parsed.path.at(-1) ?? '')
      const field = resolved.field.items.type === 'object' ? `${item}.<link field>` : item
      error(pathStart, `${HREF_DIRECTIVE}: '${name}' is a list; repeat the link with ${FOR_DIRECTIVE}="${item} in ${name}", then ${HREF_DIRECTIVE}="${field}"`)
      return
    }
    useField(parsed.path, context.scope)
    if (resolved.field.type !== 'string' || resolved.field.route === undefined) {
      error(pathStart, `${HREF_DIRECTIVE}: '${name}' isn't a link field; give it "route": "<route name>" in the schema and have the source fill it with href() (views never build URLs)`)
    }
  }

  // m-show, m-if and m-else-if: the condition, or undefined when it's broken (already reported).
  const checkConditionDirective = (element: Element, directive: string, value: string, context: Context): Condition | undefined => {
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
    if (checked === null || unchecked(condition.path, context)) return undefined
    const resolved = resolveField(checked, condition.path, context.scope)
    if (!resolved.ok) {
      broken.condition = true
      error(at(pathStart), `${directive}: ${resolved.message}${noSchemaHint}`)
      return undefined
    }
    const name = condition.path.join('.')
    const { field } = resolved
    if (resolved.length !== undefined) {
      useField(condition.path.slice(0, -1), context.scope) // the list it counts
    } else if (field.type === 'array') {
      // A list holds whenever it's there, even empty; whether it has items is what its length says.
      const test = `${condition.negated ? '!' : ''}${name}.length`
      if (resolved.required) {
        warning(at(pathStart), `${directive}: '${name}' is a required list, so the condition ${condition.negated ? 'never holds' : 'always holds'}, even when it's empty; test ${test}`)
        constants.add(condition)
        return condition
      }
      const when = condition.negated ? "doesn't hold when it's empty, only when it's missing" : "holds even when it's empty"
      warning(at(pathStart), `${directive}: '${name}' is a list, so the condition ${when}; test ${test}`)
    } else if (field.type !== 'object') {
      useField(condition.path, context.scope)
    } else if (resolved.required) {
      warning(at(pathStart), `${directive}: '${name}' is a required object, so this condition is always ${condition.negated ? 'false' : 'true'}`)
      constants.add(condition)
    }
    return condition
  }

  // m-for (D34): returns the context of the element's own directives and of everything inside it, the
  // rows; `attributeAt` is where the attribute starts. A broken m-for shows no rows, so it has no loop
  // gate. One with m-if, m-else-if or m-else is an error of its own (checkElement); the rows' paths, and
  // the condition's, are still checked.
  const checkForDirective = (element: Element, value: string, attributeAt: number, context: Context): Context => {
    const { start, exact } = valueStart(element, FOR_DIRECTIVE, value)
    const at = (offset: number): number => (exact ? start + offset : start)
    const row: Context = { ...context, inRow: true }
    const parsed = parseForDirective(value)
    if (!parsed.ok) {
      broken.loop = true
      error(at(parsed.offset), `${FOR_DIRECTIVE}: ${parsed.message}`)
      return { ...row, lenient: { aliases: context.lenient?.aliases ?? new Set(), unknown: true } }
    }
    const lenient = { aliases: new Set([...(context.lenient?.aliases ?? []), parsed.alias]), unknown: context.lenient?.unknown ?? false }
    if (checked === null) return row // nothing is checked against a schema with errors
    if (unchecked(parsed.path, context)) return { ...row, lenient }
    const resolved = resolveList(checked, parsed.alias, parsed.path, context.scope)
    if (!resolved.ok) {
      broken.loop = true
      const where = resolved.at === 'alias' ? parsed.aliasStart : parsed.pathStart
      error(at(where), `${FOR_DIRECTIVE}: ${resolved.message}${resolved.at === 'path' ? noSchemaHint : ''}`)
      return { ...row, lenient }
    }
    const { list, path } = resolved
    // The list is used, and so is its key, which tells its rows apart.
    used.add(formatFieldPath(path))
    if (list.key !== undefined) used.add(formatFieldPath([...path, LIST_ITEMS, list.key]))
    const loop: Loop = { kind: 'loop', offset: attributeAt, alias: parsed.alias, segments: parsed.path, path, list, parent: context.gate }
    gates.push(loop)
    loops.push(loop)
    return { gate: loop, scope: resolved.scope, inRow: true, lenient: context.lenient }
  }

  // The m-if chain open among a run of siblings: its conditions so far (undefined: broken).
  type Chain = { conditions: (Condition | undefined)[] }

  const checkMustache = (node: TextNode): void => {
    const match = MUSTACHE_RE.exec(node.value)
    if (match === null) return
    const location = node.sourceCodeLocation
    const raw = location ? source.slice(location.startOffset, location.endOffset) : node.value
    const at = (location?.startOffset ?? 0) + Math.max(0, raw.indexOf('{{'))
    // The mustache's own path when it is one: {{ member.name }} → m-text="member.name".
    const inner = parseTextDirective(match[0].slice(2, -2))
    const path = inner.ok ? inner.path.join('.') : PATH_PLACEHOLDER
    warning(at, `'${match[0]}' isn't Melzin syntax and would show as is; bind an empty element instead: <span ${TEXT_DIRECTIVE}="${path}"></span>`)
  }

  // An element's directives and attributes. Returns the m-if chain that continues after it, if any; an
  // m-for element is never part of one, so it ends the chain before it.
  const checkElement = (node: Element, context: Context, chain: Chain | undefined, after: Element | undefined): Chain | undefined => {
    const offset = startOf(node) ?? 0
    const attributeAt = (name: string): number => node.sourceCodeLocation?.attrs?.[name]?.startOffset ?? offset
    // The m-for first, whatever the attribute order: the element's own directives apply per row.
    const loop = node.attrs.find((attr) => attributeName(attr) === FOR_DIRECTIVE)
    // A Vue or Alpine loop is an error of its own; its rows are read like a broken m-for's, so paths
    // through its alias wait for the m-for that replaces it.
    const foreignLoop = loop === undefined ? node.attrs.find((attr) => FOREIGN_LOOPS.has(attributeName(attr))) : undefined
    let row = context
    if (loop !== undefined) {
      row = checkForDirective(node, loop.value, attributeAt(FOR_DIRECTIVE), context)
    } else if (foreignLoop !== undefined) {
      broken.loop = true
      // As for an m-for: when the loop reads as one, only its alias waits; else any path that isn't data.
      const parsed = parseForDirective(foreignLoop.value)
      const aliases = new Set([...(context.lenient?.aliases ?? []), ...(parsed.ok ? [parsed.alias] : [])])
      row = { ...context, inRow: true, lenient: { aliases, unknown: parsed.ok ? (context.lenient?.unknown ?? false) : true } }
    }
    let role: { directive: ChainDirective; at: number; value: string; condition: Condition | undefined } | undefined
    let show: { at: number; value: string; condition: Condition | undefined } | undefined
    for (const attr of node.attrs) {
      const name = attributeName(attr)
      const at = attributeAt(name)
      const kind = classifyAttribute(name)
      if (kind.kind === 'plain') {
        const attribute = attributeProblem(name, attr.value)
        if (attribute !== undefined) error(at, attribute.message)
        else if (name === 'href' && (node.tagName === 'a' || node.tagName === 'area')) staticLinks.push({ href: attr.value, offset: at })
        if (name === 'id' && row.inRow) warning(at, 'every row gets the same id, but ids must be unique in a page; remove the id')
      } else if (kind.kind === 'foreign' && FOREIGN_LOOPS.has(name)) {
        // The m-for to write, with the loop's own names: m-for="member in members".
        const { alias, list } = looseLoop(attr.value)
        const example = list === undefined ? FOR_DIRECTIVE : `${FOR_DIRECTIVE}="${alias ?? itemName(list.split('.').at(-1)!)} in ${list}"`
        error(at, kind.message.replace(`use ${FOR_DIRECTIVE}`, `use ${example}`))
      } else if (kind.kind === 'foreign' || kind.kind === 'unsupported') {
        error(at, kind.message)
      } else if (kind.name === TEXT_DIRECTIVE) {
        checkTextDirective(node, attr.value, row)
      } else if (kind.name === CLICK_DIRECTIVE) {
        checkClickDirective(node, attr.value, row)
      } else if (kind.name === HREF_DIRECTIVE) {
        checkHrefDirective(node, attr.value, row)
      } else if (kind.name === SHOW_DIRECTIVE) {
        show = { at, value: attr.value, condition: checkConditionDirective(node, SHOW_DIRECTIVE, attr.value, row) }
      } else if (kind.name === FOR_DIRECTIVE) {
        // checked first, above
      } else if (loop !== undefined && isChainDirective(kind.name)) {
        error(at, forChainMessage(kind.name))
        // Still resolved, in the row, so a typo is reported and what it reads counts as used; it decides
        // nothing for the snapshot coverage.
        if (kind.name !== ELSE_DIRECTIVE) checkConditionDirective(node, kind.name, attr.value, row)
      } else if (role !== undefined) {
        error(at, `an element can have only one of ${IF_DIRECTIVE}, ${ELSE_IF_DIRECTIVE} and ${ELSE_DIRECTIVE}`)
      } else if (kind.name === ELSE_DIRECTIVE) {
        if (attr.value.trim() !== '') {
          error(at, `${ELSE_DIRECTIVE} takes no value; for another condition use ${ELSE_IF_DIRECTIVE}="${attr.value}"`)
        }
        role = { directive: ELSE_DIRECTIVE, at, value: '', condition: undefined }
      } else {
        role = { directive: kind.name, at, value: attr.value, condition: checkConditionDirective(node, kind.name, attr.value, row) }
      }
    }

    // Like the runtime: an m-else-if with no chain to join starts one, an m-else with none always shows.
    let previous: (Condition | undefined)[] = []
    let next: Chain | undefined
    if (role !== undefined && role.directive !== IF_DIRECTIVE) {
      if (chain === undefined) {
        // Right after a list: what the author likely means is the list's empty state.
        const loop = after === undefined ? undefined : getAttr(after, FOR_DIRECTIVE)
        const parsed = loop === undefined ? undefined : parseForDirective(loop)
        const list = parsed?.ok ? parsed.path.join('.') : '<list>'
        const hint = loop === undefined
          ? ''
          : `; an ${FOR_DIRECTIVE} element ends a chain: for when the list is empty, wrap the list in an element with ${IF_DIRECTIVE}="${list}.length" and put ${role.directive} after the wrapper`
        error(role.at, `${role.directive} must come right after an element with ${IF_DIRECTIVE} or ${ELSE_IF_DIRECTIVE}${hint}`)
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
        kind: 'condition',
        offset: Math.min(role?.at ?? Infinity, show?.at ?? Infinity),
        tests: complete ? (tests as { condition: Condition; holds: boolean }[]) : undefined,
        // A constant holds exactly when it isn't negated.
        blocked: tests.some(({ condition, holds }) => condition !== undefined && constants.has(condition) && condition.negated === holds),
        clauses,
        parent: row.gate,
      }
      gates.push(conditional)
    }
    walkNodes(node.childNodes, conditional === undefined ? row : { ...row, gate: conditional })
    return next
  }

  // The same element and attribute rules the runtime applies (core/markup.ts), as errors. Siblings are
  // walked in order, so an m-else-if or m-else knows the chain it continues.
  const walkNodes = (nodes: ChildNode[], context: Context): void => {
    let chain: Chain | undefined
    // The element sibling right before, with only whitespace and comments between.
    let previous: Element | undefined
    for (const node of nodes) {
      if (isText(node)) {
        checkMustache(node)
        if (!isInterElementWhitespace(node.value)) {
          chain = undefined
          previous = undefined
        }
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
        if (problem.drop) {
          // The runtime drops it, content included.
          const inside = droppedBindings(node)
          if (inside.sends) broken.click = true
          if (inside.reads) broken.markup = true
          previous = undefined
          continue
        }
      }
      chain = checkElement(node, context, chain, previous)
      previous = node
    }
  }
  walkNodes(bodyNodes, { gate: undefined, scope: undefined, inRow: false, lenient: undefined })

  // --- contract warnings (only against a schema we fully understood)
  if (schemaState === 'valid' && schema !== null && schemaBlock !== undefined) {
    const at = (path: string): number => schemaBlock.textStart + locate(schemaLocations, path, 0)
    for (const event of Object.keys(schema.events ?? {})) {
      if (!emitted.has(event) && !broken.click) warning(at(joinPath('events', event)), `event '${event}' is declared but nothing emits it`)
    }
    // Leaves and lists, each one before the fields inside it. A list nothing uses is reported alone, not
    // with each of its items' fields; objects only hold fields.
    const fields = schemaFields(schema)
    const silenced = broken.text || broken.condition || broken.loop || broken.payload || broken.markup
    const unusedLists: string[][] = []
    for (const { path, field } of fields) {
      if (field.type === 'object' || silenced) continue
      if (unusedLists.some((list) => list.every((segment, i) => path[i] === segment))) continue
      const name = formatFieldPath(path)
      if (used.has(name)) continue
      warning(at(schemaPathOf(path)), `data field '${name}' is never used`)
      if (field.type === 'array') unusedLists.push(path)
    }
    const leaves = fields.filter(({ field }) => field.type !== 'object' && field.type !== 'array')
    if (leaves.length > 0 && snapshots.length === 0 && !snapshotsUnreadable) {
      warning(
        startOf(schemaBlock.element) ?? 0,
        `the view has data fields but no snapshots; add a ${SNAPSHOTS_BLOCK_TYPE} block with sample states, awkward ones included (very long text, zero, huge numbers)`,
      )
    }
  }

  // --- snapshot coverage (P8): every element behind a condition shows in at least one snapshot, every
  // list shows a row, and each list shows empty and with several items, so every design can be reviewed.
  // Snapshots are read with the runtime's rules (core/data.ts); an element inside a row shows when it
  // shows in any row. Waits until the snapshots match the schema.
  if (checked !== null && snapshots.length > 0 && snapshotsValid) {
    /** Per snapshot, the rows an element shows in, as the scope each one reads its items through. */
    type Rows = (Scope | undefined)[][]
    const top: Rows = snapshots.map(() => [undefined])
    const any = (rows: Rows): boolean => rows.some((scopes) => scopes.length > 0)
    // Each row an m-for shows in each of the rows around it: one per item, with the item in its scope.
    const expand = (loop: Loop, rows: Rows): Rows =>
      rows.map((scopes, i) =>
        scopes.flatMap((scope) => {
          const value = valueAt(snapshots[i]!.data, loop.segments, scope)
          return Array.isArray(value) ? value.map((item) => withAlias(scope, loop.alias, { list: loop.list, path: loop.path, item })) : []
        }),
      )
    const holds = (conditional: Conditional, i: number, scope: Scope | undefined): boolean => {
      const { data, route } = snapshots[i]!
      return conditional.tests!.every(({ condition, holds }) => conditionHolds(checked, data, condition, route, scope) === holds)
    }
    // Where a gate's element shows. Undefined when a condition on the way is broken.
    const shownMemo = new Map<Gate, Rows | undefined>()
    const shown = (gate: Gate | undefined): Rows | undefined => {
      if (gate === undefined) return top
      if (shownMemo.has(gate)) return shownMemo.get(gate)
      const parent = shown(gate.parent)
      let result: Rows | undefined
      if (parent !== undefined) {
        if (gate.kind === 'loop') result = expand(gate, parent)
        else if (gate.tests !== undefined) result = parent.map((scopes, i) => scopes.filter((scope) => holds(gate, i, scope)))
      }
      shownMemo.set(gate, result)
      return result
    }
    // The rows an element is in whatever the conditions around it: what its own conditions are tested in.
    const reachMemo = new Map<Gate, Rows>()
    const reach = (gate: Gate | undefined): Rows => {
      if (gate === undefined) return top
      const done = reachMemo.get(gate)
      if (done !== undefined) return done
      const parent = reach(gate.parent)
      const result = gate.kind === 'loop' ? expand(gate, parent) : parent
      reachMemo.set(gate, result)
      return result
    }

    for (const gate of gates) {
      const result = shown(gate)
      if (result === undefined || any(result)) continue
      // Inside an element that never shows either, only that one gets the warning.
      const parent = shown(gate.parent)!
      if (!any(parent)) continue
      if (gate.kind === 'condition') {
        if (gate.blocked) continue // its constant condition's warning says why
        const own = reach(gate.parent).some((scopes, i) => scopes.some((scope) => holds(gate, i, scope)))
        warning(
          gate.offset,
          own
            ? 'no snapshot shows this element; its conditions only hold where an element around it is hidden'
            : `no snapshot shows this element; add one where ${gate.clauses.join(' and ')}`,
        )
        continue
      }
      const name = gate.segments.join('.')
      if (any(reach(gate))) {
        warning(gate.offset, `no snapshot shows a row of '${name}'; it only has items where an element around it is hidden`)
        continue
      }
      const values = parent.flatMap((scopes, i) => scopes.map((scope) => valueAt(snapshots[i]!.data, gate.segments, scope)))
      const state = values.every(Array.isArray) ? 'empty' : values.some(Array.isArray) ? 'empty or missing' : 'missing'
      const fix = gate.list.maxItems === 0 ? `; "maxItems": 0 keeps it empty: raise it, or remove the ${FOR_DIRECTIVE}` : '; add a snapshot where it has items'
      warning(gate.offset, `no snapshot shows a row of '${name}' (it's ${state} in every snapshot${gate.parent === undefined ? '' : ' that shows it'})${fix}`)
    }

    // The states every list has (SPEC §9.1): empty, and several items. Once per list field, across all
    // of its instances in every snapshot (each poll's options), at the first m-for over it; a list that
    // never shows a row is reported above instead.
    const byField = new Map<string, Loop[]>()
    for (const loop of loops) {
      const field = formatFieldPath(loop.path)
      byField.set(field, [...(byField.get(field) ?? []), loop])
    }
    for (const over of byField.values()) {
      if (!over.some((loop) => any(shown(loop) ?? []))) continue
      const { list, path, segments, offset } = over[0]!
      const name = segments.join('.')
      const key = path.at(-1)!
      const instances = snapshots.flatMap(({ data }) =>
        valuesAt(data, path.slice(0, -1)).flatMap(({ value }) => (isPlainObject(value) ? [hasField(value, key) ? value[key] : undefined] : [])),
      )
      if ((list.minItems ?? 0) < 1 && !instances.some((value) => !Array.isArray(value) || value.length === 0)) {
        warning(offset, `no snapshot shows '${name}' empty; add one to design the empty state, or set "minItems": 1 if it's never empty`)
      }
      // Several items count only where the list shows: the empty state may be hidden on purpose (an
      // m-if on its length with an m-else), but rows nobody sees can't be reviewed.
      const several = (value: unknown): boolean => Array.isArray(value) && value.length > 1
      const shownSeveral = over.some((loop) =>
        (shown(loop.parent) ?? []).some((scopes, i) => scopes.some((scope) => several(valueAt(snapshots[i]!.data, loop.segments, scope)))),
      )
      if ((list.maxItems ?? Infinity) > 1 && !shownSeveral) {
        const fix = instances.some(several)
          ? "; it only has several where an element around it is hidden"
          : `; add one, or set "maxItems": 1 if it never has more`
        warning(offset, `no snapshot shows '${name}' with more than one item${fix}`)
      }
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
    // Snapshots show real URLs: each link field's value must be a URL of its route, in every item of a
    // list for a link field inside its items (`data.members[1].url`).
    for (const link of links) {
      const route = findRoute(table, link.route)
      if (route === undefined) continue
      for (const { path, value } of valuesAt(snapshot.data, link.path)) {
        if (typeof value !== 'string') continue
        const match = value.startsWith('/') && !value.startsWith('//') ? matchRoute(table, value) : null
        if (match?.route.name === link.route) continue
        const other = match === null ? '' : `; it's a URL of route '${match.route.name}'`
        const relative = path.startsWith('[') ? `data${path}` : `data.${path}`
        found.push({ relative, severity: 'error', text: `: '${value}' isn't a URL of route '${route.name}' (${route.path})${other}` })
      }
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

// Control characters and bidirectional controls, which messages may quote from a view (a snapshot's
// key, say): in a terminal or a CI log they could move the cursor, erase the line or reorder it.
const UNPRINTABLE_RE = /[\u0000-\u001f\u007f-\u009f\u061c\u200e\u200f\u2028\u2029\u202a-\u202e\u2066-\u2069]/g

/** `text` with the characters of UNPRINTABLE_RE written as `\u001b` escapes, so a line prints as one plain line. */
function printable(text: string): string {
  return text.replace(UNPRINTABLE_RE, (ch) => `\\u${ch.charCodeAt(0).toString(16).padStart(4, '0')}`)
}

/** `views/counter.mel.html:12:5: error: message`, with control characters escaped (see printable). */
export function formatDiagnostic(file: string, diagnostic: Diagnostic): string {
  return printable(`${file}:${diagnostic.line}:${diagnostic.col}: ${diagnostic.severity}: ${diagnostic.message}`)
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
