// mount / mountSource: copy a view's body into the host page, bind it once, then update in place.

import {
  CLICK_DIRECTIVE,
  type ChainDirective,
  ELSE_DIRECTIVE,
  ELSE_IF_DIRECTIVE,
  type EmitPayload,
  FOR_DIRECTIVE,
  HREF_DIRECTIVE,
  IF_DIRECTIVE,
  type Issue,
  type ListSchema,
  type MelzinSchema,
  type PayloadField,
  type RouteInput,
  SHOW_DIRECTIVE,
  type Scope,
  type ScopeEntry,
  TEXT_DIRECTIVE,
  VOID_ELEMENTS,
  attributeProblem,
  blockedLinkScheme,
  buildPayload,
  classifyAttribute,
  conditionHolds,
  dataBlockType,
  elementProblem,
  forChainMessage,
  hasField,
  isChainDirective,
  isInterElementWhitespace,
  itemKey,
  lengthMessage,
  parseClickDirective,
  parseConditionDirective,
  parseForDirective,
  parseHrefDirective,
  parseRouteRef,
  parseTextDirective,
  payloadFixMessage,
  payloadIssues,
  readPath,
  resolveField,
  resolveList,
  resolvePath,
  resolvePayloadValue,
  suggest,
  validateData,
  valueAt,
  valueOrDefault,
  withAlias,
} from '../core/index.ts'
import * as dom from './dom.ts'
import { parseDocument, readSchemaBlock } from './viewdoc.ts'

export type Handlers = object

/**
 * What a click sends for an event that declares a payload (SPEC D35): its named fields, with the
 * values their paths read when the click happens. An event without a payload sends undefined.
 */
export type Payload = Record<string, string | number | boolean>

/** Every warning about data that doesn't match the schema starts with this (they go stale with new data). */
export const DATA_WARNING_PREFIX = "data doesn't match the schema: "

export type MountOptions<D, H> = {
  data: D
  on: H
  /** The URL input views read as `route.name`, `route.params.*` and `route.query.*` (SPEC D27). */
  route?: RouteInput
  onWarning?: (message: string) => void
}

export type MelzinView<D> = {
  readonly data: D
  readonly route: RouteInput
  readonly schema: MelzinSchema
  update(data: D): void
  /** Replaces the URL input; like update, only bindings whose value changed touch the DOM. */
  setRoute(route: RouteInput): void
  destroy(): void
}

/** A condition, parsed and resolved once; each row tests it against its own item, through `scope`. */
type Test = (scope: Scope | undefined) => boolean
/** Where a node sits in a template: child indexes from the template's root, the same in every clone. */
type NodePath = readonly number[]
/**
 * What an m-on:click sends: the event, and the payload's fields when the handler gets an object. For
 * warnings at the click, the emit as written, the payload's required fields and those already warned
 * about there (once per emit, not once per row or click).
 */
type Send = { event: string; payload: EmitPayload | undefined; where: string; required: readonly string[]; warned: Set<string> }

/**
 * What a template binds, worked out once. The view's body is one template and each element an m-for
 * repeats is another, with a plan of its own: rows are clones of it, bound from the plan, so a bad
 * directive in a row warns once rather than once per row.
 */
type Plan = {
  texts: { at: NodePath; segments: readonly string[] }[]
  hrefs: { at: NodePath; segments: readonly string[] }[]
  shows: { at: NodePath; test: Test }[]
  clicks: { at: NodePath; send: Send }[]
  chains: { anchor: NodePath; branches: { at: NodePath; test: Test }[] }[]
  lists: ListPlan[]
}
/**
 * An m-for that works (a broken one is only its anchor, with no rows): the anchor comment, the element
 * to repeat (m-for removed) with its plan, the alias, the list's path as written and its field path.
 */
type ListPlan = {
  at: NodePath
  template: Element
  plan: Plan
  alias: string
  segments: readonly string[]
  list: ListSchema
  path: readonly string[]
}

type TextBinding = { segments: readonly string[]; el: Element; lastText: string | null }
/** m-bind:href: the link field's URL, or no href at all while the field is missing. */
type HrefBinding = { segments: readonly string[]; el: Element; lastHref: string | null | undefined }
type ClickBinding = { el: Element; listener: (event: Event) => void }
/** m-show: `display: none` while the condition is false; `display` is the element's own value to restore. */
type ShowBinding = { style: CSSStyleDeclaration; test: Test; display: string; shown: boolean | null }
/**
 * An m-if chain. The anchor comment marks where the chain's elements go, and the first branch whose
 * condition holds sits right after it; the others are out of the document, still bound.
 */
type ChainBinding = { anchor: Comment; branches: { el: Element; test: Test }[]; active: Element | null }
/**
 * A row: its element, its item in `entry` (which the row's bindings read through the alias, so a kept
 * row shows its item's current values) and the item's key, undefined when the row has none.
 */
type Row = { key: string | number | undefined; el: Element; entry: ScopeEntry; block: Block }
/** An m-for. Its rows sit right after the anchor comment, back to back, in the data's order. */
type ListBinding = { anchor: Comment; plan: ListPlan; rows: Row[] }
/** The bindings of the view's body, or of one row; `scope` has the aliases of the m-for rows around it. */
type Block = {
  scope: Scope | undefined
  texts: TextBinding[]
  hrefs: HrefBinding[]
  shows: ShowBinding[]
  clicks: ClickBinding[]
  chains: ChainBinding[]
  lists: ListBinding[]
}

const ELEMENT_NODE = 1
const TEXT_NODE = 3
const COMMENT_NODE = 8

/** Fetches a view file and mounts it into `element` (see mountSource). */
export async function mount<
  D extends object = Record<string, unknown>,
  H extends object = Record<string, (payload?: Payload) => void>,
>(element: Element, url: string | URL, options: MountOptions<D, H>): Promise<MelzinView<D>> {
  const label = String(url)
  let response: Response
  try {
    response = await fetch(url)
  } catch (error) {
    const detail = error instanceof Error ? error.message : String(error)
    throw new Error(`melzin: couldn't load view ${label}: ${detail}`, { cause: error })
  }
  if (!response.ok) {
    const status = `${response.status}${response.statusText ? ` ${response.statusText}` : ''}`
    throw new Error(`melzin: couldn't load view ${label}: HTTP ${status}`)
  }
  return mountView(element, await response.text(), options, label)
}

/**
 * Mounts a view from its source. Throws when the schema block is invalid; every other problem
 * (bad directives, data that doesn't match the schema, missing handlers) is a warning.
 */
export function mountSource<D, H>(element: Element, html: string, options: MountOptions<D, H>): MelzinView<D> {
  return mountView(element, html, options, null)
}

function formatIssues(issues: readonly Issue[]): string {
  return issues.map((issue) => `  - ${issue.path === undefined ? '' : `${issue.path}: `}${issue.message}`).join('\n')
}

function describeElement(el: Element, attribute: string, value: string): string {
  return `<${dom.tagName(el).toLowerCase()} ${attribute}${value === '' ? '' : `="${value}"`}>`
}

/** The element's m-if, m-else-if or m-else: the first one, if it has several. */
function chainRole(el: Element): ChainDirective | undefined {
  return dom.getAttributeNames(el).find(isChainDirective)
}

/** Text for a value: primitives through String(); objects (wrong data, already warned about) show nothing. */
function toText(value: unknown): string {
  if (value === undefined || value === null || typeof value === 'object' || typeof value === 'function') return ''
  return String(value)
}

/** The child indexes that lead from `root` down to `node`. */
function pathOf(node: Node, root: Node): number[] {
  const path: number[] = []
  for (let at = node; at !== root; at = dom.parentNode(at)!) {
    let index = 0
    for (let sibling = dom.previousSibling(at); sibling !== null; sibling = dom.previousSibling(sibling)) index++
    path.push(index)
  }
  return path.reverse()
}

function nodeAt(root: Node, path: NodePath): Node {
  let node = root
  for (const index of path) node = dom.childNodes(node)[index]!
  return node
}

/**
 * The positions in `source` of a longest increasing run of its values, skipping -1 (a new row): the
 * rows that keep their place while the others move around them, as few as possible (as in Vue 3).
 */
function stablePositions(source: readonly number[]): Set<number> {
  const tails: number[] = [] // tails[k]: the position ending the best run of length k + 1 found so far
  const previous: number[] = new Array<number>(source.length).fill(-1)
  for (let i = 0; i < source.length; i++) {
    const value = source[i]!
    if (value < 0) continue
    let low = 0
    let high = tails.length
    while (low < high) {
      const middle = (low + high) >> 1
      if (source[tails[middle]!]! < value) low = middle + 1
      else high = middle
    }
    if (low > 0) previous[i] = tails[low - 1]!
    tails[low] = i
  }
  const stable = new Set<number>()
  for (let i = tails.at(-1) ?? -1; i >= 0; i = previous[i]!) stable.add(i)
  return stable
}

/** Moves a row: with moveBefore where the browser has it, so the row keeps its state; else insertBefore. */
function move(parent: Node, node: Node, before: Node | null): void {
  try {
    if (dom.moveBefore(parent, node, before)) return
  } catch {
    // A move the browser refuses (across documents, say) still works as a plain insert.
  }
  dom.insertBefore(parent, node, before)
}

/**
 * Cleans the inert parsed body before anything reaches the live document, with the rules the checker
 * reports (core/markup.ts): drops what would run code or change the host page (scripts, styles, <base>,
 * embedded documents, inline handlers, javascript: URLs...) and warns about the rest.
 */
function sanitize(body: HTMLElement, warn: (message: string) => void): void {
  for (const el of [...body.querySelectorAll('*')]) {
    if (!body.contains(el)) continue // inside an element dropped earlier
    const tag = dom.localName(el)
    const blockType = tag === 'script' ? dataBlockType(dom.getAttribute(el, 'type')) : undefined
    const problem = blockType === undefined
      ? elementProblem(tag, dom.namespaceURI(el), (name) => dom.getAttribute(el, name), dom.closest(el, 'form') !== null)
      : { message: `the ${blockType} block belongs in <head>`, drop: true }
    if (problem !== undefined) {
      warn(problem.drop ? `${problem.message}; dropped` : problem.message)
      if (problem.drop) {
        dom.remove(el)
        continue
      }
    }
    for (const name of dom.getAttributeNames(el)) {
      const attribute = attributeProblem(name, dom.getAttribute(el, name) ?? '')
      if (attribute === undefined) continue
      warn(`<${tag}>: ${attribute.message}${attribute.drop ? '; removed' : ''}`)
      if (attribute.drop) dom.removeAttribute(el, name)
    }
  }
}

function mountView<D, H>(element: Element, html: string, options: MountOptions<D, H>, label: string | null): MelzinView<D> {
  const where = label === null ? 'the view' : `view ${label}`
  const warn = (message: string): void => {
    if (options.onWarning) options.onWarning(message)
    else console.warn(`[melzin] ${message}`)
  }

  const doc = parseDocument(html)
  const schemaBlock = readSchemaBlock(doc)
  if (schemaBlock.issues.length > 0) {
    throw new Error(`melzin: ${where} has an invalid schema:\n${formatIssues(schemaBlock.issues)}`)
  }
  const schema: MelzinSchema = schemaBlock.schema ?? {}
  const events = schema.events ?? {}
  const declaredEvents = Object.keys(events)
  const on = (options.on ?? {}) as Record<string, unknown>
  // Handlers are looked up like data (hasField): methods on a class count, Object.prototype's don't.
  const handlerFor = (name: string): unknown => (hasField(on, name) ? on[name] : undefined)

  const body = dom.body(doc)
  sanitize(body, warn)

  // The view is bound and rendered in a fragment, so the host page only ever sees it finished. Calls
  // on the view's elements and on the documents go through dom.ts: the markup's names can't shadow them.
  const target = dom.ownerDocument(element)
  const fragment = dom.createDocumentFragment(target)
  for (const child of body.childNodes) fragment.appendChild(dom.importNode(target, child))

  let data = options.data
  let route: RouteInput = options.route ?? {}
  let destroyed = false
  const undeclaredWarned = new Set<string>()

  // Why a required payload field came out missing at a click, with the fix. The checker can't see it
  // coming when the value is there in every snapshot: the host left the route out, or sent data that
  // doesn't match the schema.
  const missingFieldMessage = (field: PayloadField, scope: Scope | undefined): string => {
    const path = field.path.join('.')
    const missing = `payload field '${field.name}' is required but ${path} is missing`
    const ref = parseRouteRef(field.path)
    if (ref?.ok) {
      if (ref.ref.kind === 'name') return `${missing}; pass route to mount, with the route's name`
      if (ref.ref.kind === 'param') return `${missing}; pass route to mount, with params.${ref.ref.name}`
      return `${missing}; a URL may leave its query out, so make '${field.name}' optional in the payload`
    }
    const value = resolvePayloadValue(schema, field.path, scope)
    if (value.ok && !value.required) return `${missing}; make '${path}' required in the schema, or '${field.name}' optional in the payload`
    return `${missing}; the data doesn't match the schema, which requires it`
  }

  const emit = (send: Send, scope: Scope | undefined): void => {
    if (destroyed) return
    const handler = handlerFor(send.event)
    if (typeof handler !== 'function') {
      warn(`no handler for event '${send.event}'; add on.${send.event}`)
      return
    }
    if (send.payload === undefined) {
      handler.call(on, undefined)
      return
    }
    const payload = buildPayload(schema, data, route, send.payload, scope)
    for (const field of send.payload.fields) {
      if (Object.hasOwn(payload, field.name) || !send.required.includes(field.name) || send.warned.has(field.name)) continue
      send.warned.add(field.name)
      warn(`${send.where}: ${missingFieldMessage(field, scope)}; sent without it`)
    }
    handler.call(on, payload)
  }

  // --- compiling: each template's directives are parsed and resolved once, warning about problems.
  // `scope` has the aliases of the m-for rows the template sits in.

  const textPath = (el: Element, value: string, scope: Scope | undefined): readonly string[] | undefined => {
    const parsed = parseTextDirective(value)
    if (!parsed.ok) {
      warn(`${describeElement(el, TEXT_DIRECTIVE, value)}: ${parsed.message} (at column ${parsed.offset + 1}); skipped`)
      return undefined
    }
    const ref = parseRouteRef(parsed.path)
    const resolved = ref ?? resolvePath(schema, parsed.path, scope)
    if (!resolved.ok) {
      warn(`${describeElement(el, TEXT_DIRECTIVE, value)}: ${resolved.message}; skipped`)
      return undefined
    }
    if (VOID_ELEMENTS.has(dom.localName(el))) {
      warn(`${describeElement(el, TEXT_DIRECTIVE, value)}: <${dom.localName(el)}> has no content to set; skipped`)
      return undefined
    }
    if (dom.firstElementChild(el) !== null) {
      warn(`${describeElement(el, TEXT_DIRECTIVE, value)} has child elements; ${TEXT_DIRECTIVE} replaces them`)
    }
    return parsed.path
  }

  // What a click sends. For an event that declares a payload, the handler always gets an object: the
  // fields whose path reads a leaf of the declared type (the others were warned about). An event that
  // declares none gets undefined, as does an undeclared event emitted without a payload.
  const clickSend = (el: Element, value: string, scope: Scope | undefined): Send | undefined => {
    const where = describeElement(el, CLICK_DIRECTIVE, value)
    const parsed = parseClickDirective(value)
    if (!parsed.ok) {
      // A payload in a form emit doesn't take gets its fix with the event's fields and the row's alias.
      const message = parsed.fix === undefined ? parsed.message : payloadFixMessage(schema, parsed.fix, scope)
      warn(`${where}: ${message} (at column ${parsed.offset + 1}); skipped`)
      return undefined
    }
    const name = parsed.event
    const declared = Object.hasOwn(events, name) ? events[name] : undefined
    if (declared === undefined && !undeclaredWarned.has(name)) {
      undeclaredWarned.add(name)
      warn(`${CLICK_DIRECTIVE} emits '${name}', which isn't declared in the schema's events${suggest(name, declaredEvents)}`)
    }
    for (const issue of payloadIssues(schema, name, parsed.payload, 0, scope)) warn(`${where}: ${issue.message}`)
    const expected = declared?.payload
    const sendsObject = declared === undefined ? parsed.payload !== undefined : expected !== undefined
    const send = { event: name, where, required: expected?.required ?? [], warned: new Set<string>() }
    if (!sendsObject) return { ...send, payload: undefined }
    const fields = (parsed.payload?.fields ?? []).filter((field) => {
      const resolved = resolvePayloadValue(schema, field.path, scope)
      if (!resolved.ok || expected === undefined) return resolved.ok
      return Object.hasOwn(expected.properties, field.name) && expected.properties[field.name]!.type === resolved.type
    })
    return { ...send, payload: { fields, start: parsed.payload?.start ?? 0, end: parsed.payload?.end ?? 0 } }
  }

  // A condition that can't be used (a parse error, an unknown field) warns and counts as false, so a
  // broken m-if hides its element rather than showing it to everyone.
  const conditionTest = (el: Element, directive: string, scope: Scope | undefined): Test => {
    const value = dom.getAttribute(el, directive) ?? ''
    const parsed = parseConditionDirective(directive, value)
    if (!parsed.ok) {
      warn(`${describeElement(el, directive, value)}: ${parsed.message} (at column ${parsed.offset + 1}); treated as false`)
      return () => false
    }
    const resolved = parseRouteRef(parsed.condition.path) ?? resolveField(schema, parsed.condition.path, scope)
    if (!resolved.ok) {
      warn(`${describeElement(el, directive, value)}: ${resolved.message}; treated as false`)
      return () => false
    }
    const { condition } = parsed
    return (rowScope) => conditionHolds(schema, data, condition, route, rowScope)
  }

  // A link's URL comes from a link field, a string field that names its route (SPEC D23).
  const hrefPath = (el: Element, value: string, scope: Scope | undefined): readonly string[] | undefined => {
    const where = describeElement(el, HREF_DIRECTIVE, value)
    const tag = dom.localName(el)
    if (tag !== 'a' && tag !== 'area') {
      warn(`${where}: ${HREF_DIRECTIVE} only works on links (<a> and <area>); skipped`)
      return undefined
    }
    const parsed = parseHrefDirective(value)
    if (!parsed.ok) {
      warn(`${where}: ${parsed.message} (at column ${parsed.offset + 1}); skipped`)
      return undefined
    }
    if (parseRouteRef(parsed.path) !== undefined) {
      warn(`${where}: ${HREF_DIRECTIVE} needs a link field; the URL input isn't a URL; skipped`)
      return undefined
    }
    const resolved = resolveField(schema, parsed.path, scope)
    if (!resolved.ok) {
      warn(`${where}: ${resolved.message}; skipped`)
      return undefined
    }
    if (resolved.length !== undefined) {
      warn(`${where}: ${lengthMessage(parsed.path.join('.'))}; skipped`)
      return undefined
    }
    if (resolved.field.type !== 'string' || resolved.field.route === undefined) {
      warn(`${where}: '${parsed.path.join('.')}' isn't a link field; give it "route": "<route name>" in the schema; skipped`)
      return undefined
    }
    if (dom.hasAttribute(el, 'href')) warn(`${where}: the link also has a static href, which the field's URL replaces; keep one`)
    return parsed.path
  }

  const elseTest = (el: Element): Test => {
    const value = dom.getAttribute(el, ELSE_DIRECTIVE) ?? ''
    if (value.trim() !== '') {
      warn(`${describeElement(el, ELSE_DIRECTIVE, value)}: ${ELSE_DIRECTIVE} takes no value; for another condition use ${ELSE_IF_DIRECTIVE}="${value}"`)
    }
    return () => true
  }

  /**
   * Walks a template once and works out its plan. The walk takes each m-for element out of the
   * template, leaving an anchor comment in its place, and compiles it as a template of its own.
   * Directive attributes stay in place.
   */
  const compile = (root: Element | DocumentFragment, scope: Scope | undefined): Plan => {
    const texts: { node: Node; segments: readonly string[] }[] = []
    const hrefs: { node: Node; segments: readonly string[] }[] = []
    const shows: { node: Node; test: Test }[] = []
    const clicks: { node: Node; send: Send }[] = []
    const chains: { anchor: Node; branches: { node: Node; test: Test }[] }[] = []
    const lists: (Omit<ListPlan, 'at'> & { node: Node })[] = []
    // Elements already taken into a chain, so the walk doesn't call them orphans.
    const chained = new Set<Element>()

    // The chain that starts at `first`: the m-else-if and m-else siblings right after it, with only
    // whitespace and comments in between, up to the first m-else. An m-for element ends it.
    const collectChain = (first: Element, role: ChainDirective): { node: Node; test: Test }[] => {
      chained.add(first)
      const branches = [{ node: first as Node, test: conditionTest(first, role, scope) }]
      for (let node = dom.nextSibling(first); node !== null; node = dom.nextSibling(node)) {
        const type = dom.nodeType(node)
        if (type === COMMENT_NODE) continue
        if (type === TEXT_NODE && isInterElementWhitespace(node.textContent ?? '')) continue
        if (type !== ELEMENT_NODE) break
        const el = node as Element
        if (dom.hasAttribute(el, FOR_DIRECTIVE)) break
        const next = chainRole(el)
        if (next !== ELSE_IF_DIRECTIVE && next !== ELSE_DIRECTIVE) break
        chained.add(el)
        branches.push({ node: el, test: next === ELSE_DIRECTIVE ? elseTest(el) : conditionTest(el, next, scope) })
        if (next === ELSE_DIRECTIVE) break
      }
      return branches
    }

    // The anchors compileList left, which stand for their lists: content, unlike other comments.
    const listAnchors = new Set<Node>()
    const isBlank = (node: Node): boolean => {
      const type = dom.nodeType(node)
      return type === TEXT_NODE ? isInterElementWhitespace(node.textContent ?? '') : type === COMMENT_NODE && !listAnchors.has(node)
    }

    // An m-for element leaves the template for an anchor comment that its rows will follow. A list
    // that is its container's only content (the rest is whitespace and comments) takes the container's
    // whitespace with it, so the container is :empty while the list is; anywhere else the whitespace
    // stays, so a list in running text keeps the spaces around it. A broken m-for warns and shows no
    // rows: hiding beats showing the wrong thing.
    const compileList = (el: Element): void => {
      const value = dom.getAttribute(el, FOR_DIRECTIVE) ?? ''
      const skip = (message: string): void => warn(`${describeElement(el, FOR_DIRECTIVE, value)}: ${message}; shows no rows`)
      const parent = dom.parentNode(el)!
      const siblings = [...dom.childNodes(parent)]
      if (siblings.every((node) => node === el || isBlank(node))) {
        for (const node of siblings) if (dom.nodeType(node) === TEXT_NODE) node.remove()
      }
      const anchor = dom.createComment(target, FOR_DIRECTIVE)
      dom.insertBefore(parent, anchor, el)
      dom.remove(el)
      listAnchors.add(anchor)
      dom.removeAttribute(el, FOR_DIRECTIVE)
      const parsed = parseForDirective(value)
      if (!parsed.ok) return skip(`${parsed.message} (at column ${parsed.offset + 1})`)
      const role = chainRole(el)
      if (role !== undefined) return skip(forChainMessage(role))
      const resolved = resolveList(schema, parsed.alias, parsed.path, scope)
      if (!resolved.ok) return skip(resolved.message)
      const { list, path } = resolved
      lists.push({ node: anchor, template: el, plan: compile(el, resolved.scope), alias: parsed.alias, segments: parsed.path, list, path })
    }

    const visit = (el: Element): void => {
      if (dom.hasAttribute(el, FOR_DIRECTIVE)) return compileList(el)
      const role = chainRole(el)
      for (const name of dom.getAttributeNames(el)) {
        const kind = classifyAttribute(name)
        if (kind.kind === 'plain') continue
        if (kind.kind !== 'directive') {
          warn(`<${dom.tagName(el).toLowerCase()}>: ${kind.message}; ignored`)
          continue
        }
        const value = dom.getAttribute(el, name) ?? ''
        if (kind.name === TEXT_DIRECTIVE) {
          const segments = textPath(el, value, scope)
          if (segments !== undefined) texts.push({ node: el, segments })
        } else if (kind.name === CLICK_DIRECTIVE) {
          const send = clickSend(el, value, scope)
          if (send !== undefined) clicks.push({ node: el, send })
        } else if (kind.name === HREF_DIRECTIVE) {
          const segments = hrefPath(el, value, scope)
          if (segments !== undefined) hrefs.push({ node: el, segments })
        } else if (kind.name === SHOW_DIRECTIVE) {
          if (dom.style(el) === undefined) {
            warn(`${describeElement(el, SHOW_DIRECTIVE, value)}: <${dom.localName(el)}> has no style to hide it with; skipped`)
          } else {
            shows.push({ node: el, test: conditionTest(el, SHOW_DIRECTIVE, scope) })
          }
        } else if (kind.name !== role) {
          warn(`<${dom.tagName(el).toLowerCase()}>: an element can have only one of ${IF_DIRECTIVE}, ${ELSE_IF_DIRECTIVE} and ${ELSE_DIRECTIVE}; ${kind.name} ignored`)
        }
      }
      if (role !== undefined && !chained.has(el)) {
        if (role !== IF_DIRECTIVE) {
          const fallback = role === ELSE_DIRECTIVE ? 'ignored' : `treated as ${IF_DIRECTIVE}`
          warn(`${describeElement(el, role, dom.getAttribute(el, role) ?? '')}: ${role} must come right after an element with ${IF_DIRECTIVE} or ${ELSE_IF_DIRECTIVE}; ${fallback}`)
        }
        if (role !== ELSE_DIRECTIVE) {
          // The chain's anchor goes in the template, so every row cloned from it has its own.
          const branches = collectChain(el, role)
          const anchor = dom.createComment(target, IF_DIRECTIVE)
          dom.insertBefore(dom.parentNode(el)!, anchor, el)
          chains.push({ anchor, branches })
        }
      }
      for (const child of [...dom.children(el)]) visit(child)
    }

    if (dom.nodeType(root) === ELEMENT_NODE) visit(root as Element)
    else for (const child of [...dom.children(root)]) visit(child)

    // Paths are taken once the walk has put every anchor in place; rows find their nodes by them.
    const at = (node: Node): NodePath => pathOf(node, root)
    return {
      texts: texts.map(({ node, segments }) => ({ at: at(node), segments })),
      hrefs: hrefs.map(({ node, segments }) => ({ at: at(node), segments })),
      shows: shows.map(({ node, test }) => ({ at: at(node), test })),
      clicks: clicks.map(({ node, send }) => ({ at: at(node), send })),
      chains: chains.map(({ anchor, branches }) => ({ anchor: at(anchor), branches: branches.map(({ node, test }) => ({ at: at(node), test })) })),
      lists: lists.map(({ node, ...list }) => ({ at: at(node), ...list })),
    }
  }

  // --- binding: a plan on a copy of its template (or, for the body, on the template itself).

  const instantiate = (plan: Plan, root: Node, scope: Scope | undefined): Block => {
    // Every node is found before the chains below take their branches out of the tree.
    const elementAt = (path: NodePath): Element => nodeAt(root, path) as Element
    const block: Block = {
      scope,
      texts: plan.texts.map(({ at, segments }) => ({ segments, el: elementAt(at), lastText: null })),
      hrefs: plan.hrefs.map(({ at, segments }) => ({ segments, el: elementAt(at), lastHref: undefined })),
      shows: plan.shows.map(({ at, test }) => {
        const style = dom.style(elementAt(at))!
        return { style, test, display: style.display, shown: null }
      }),
      clicks: plan.clicks.map(({ at, send }) => ({ el: elementAt(at), listener: () => emit(send, scope) })),
      chains: plan.chains.map(({ anchor, branches }) => ({
        anchor: nodeAt(root, anchor) as Comment,
        branches: branches.map(({ at, test }) => ({ el: elementAt(at), test })),
        active: null,
      })),
      lists: plan.lists.map((list) => ({ anchor: nodeAt(root, list.at) as Comment, plan: list, rows: [] })),
    }
    for (const { el, listener } of block.clicks) dom.addEventListener(el, 'click', listener)
    // Each chain's elements leave the tree; render puts the one that should show after the anchor.
    for (const chain of block.chains) for (const { el } of chain.branches) dom.remove(el)
    return block
  }

  /** Removes a block's listeners, its rows' included. */
  const unbind = (block: Block): void => {
    for (const { el, listener } of block.clicks) dom.removeEventListener(el, 'click', listener)
    block.clicks.length = 0
    for (const list of block.lists) {
      for (const row of list.rows) unbind(row.block)
      list.rows = []
    }
  }

  const createRow = (plan: ListPlan, scope: Scope | undefined): Row => {
    const entry: ScopeEntry = { list: plan.list, path: plan.path }
    const el = dom.cloneNode(plan.template)
    return { key: undefined, el, entry, block: instantiate(plan.plan, el, withAlias(scope, plan.alias, entry)) }
  }

  // --- rendering

  /**
   * Matches the list's rows to its items by key (D34): a row whose key stays keeps its element and
   * shows the item's current values, new keys get new rows, rows of keys that are gone are destroyed,
   * and rows follow the data's order with as few moves as possible. Keys that are missing, of the
   * wrong type or repeated (warned about with the data) match rows to items by position instead, for
   * this render; a value that isn't a list has no items.
   */
  const renderList = (binding: ListBinding, scope: Scope | undefined): void => {
    const { anchor, plan, rows } = binding
    const parent = anchor.parentNode
    if (parent === null) return
    const value = valueAt(data, plan.segments, scope)
    const items: readonly unknown[] = Array.isArray(value) ? value : []
    const keys = items.map((item) => itemKey(plan.list, item))
    const keyed = keys.every((key) => key !== undefined) && new Set(keys).size === keys.length
    // A Map, so keys compare as values: 1 and "1" differ, and "__proto__" is a key like any other.
    const byKey = new Map<string | number, number>()
    if (keyed) {
      rows.forEach((row, i) => {
        if (row.key !== undefined && !byKey.has(row.key)) byKey.set(row.key, i)
      })
    }
    // source[j]: the old row that shows item j, or -1 for a new row.
    const source = keys.map((key, j) => (keyed ? (byKey.get(key!) ?? -1) : j < rows.length ? j : -1))
    const end = dom.nextSibling(rows.at(-1)?.el ?? anchor)
    const kept = new Set(source)
    rows.forEach((row, i) => {
      if (kept.has(i)) return
      dom.remove(row.el)
      unbind(row.block)
    })
    const next = items.map((item, j): Row => {
      const row = source[j]! >= 0 ? rows[source[j]!]! : createRow(plan, scope)
      row.entry.item = item
      row.key = keys[j]
      renderBlock(row.block)
      return row
    })
    // From the end, each row goes right before the one after it, unless it's part of the longest run
    // that is already in order.
    const stable = stablePositions(source)
    for (let j = next.length - 1; j >= 0; j--) {
      const { el } = next[j]!
      const before = j + 1 < next.length ? next[j + 1]!.el : end
      if (source[j] === -1) dom.insertBefore(parent, el, before)
      else if (!stable.has(j) && dom.nextSibling(el) !== before) move(parent, el, before)
    }
    binding.rows = next
  }

  const renderBlock = (block: Block): void => {
    const { scope } = block
    for (const chain of block.chains) {
      const next = chain.branches.find((branch) => branch.test(scope))?.el ?? null
      if (next === chain.active) continue
      if (chain.active !== null) dom.remove(chain.active)
      if (next !== null) chain.anchor.after(next)
      chain.active = next
    }
    for (const list of block.lists) renderList(list, scope)
    for (const binding of block.shows) {
      const shown = binding.test(scope)
      if (shown === binding.shown) continue
      binding.style.display = shown ? binding.display : 'none'
      binding.shown = shown
    }
    for (const binding of block.texts) {
      const text = toText(readPath(schema, data, route, binding.segments, scope))
      if (text !== binding.lastText) {
        dom.setTextContent(binding.el, text)
        binding.lastText = text
      }
    }
    for (const binding of block.hrefs) {
      const value = valueOrDefault(schema, data, binding.segments, scope)
      // A URL that would run code never reaches the link; checkData warned about it with its path.
      const href = typeof value === 'string' && value !== '' && blockedLinkScheme(value) === undefined ? value : null
      if (href === binding.lastHref) continue
      if (href === null) dom.removeAttribute(binding.el, 'href')
      else dom.setAttribute(binding.el, 'href', href)
      binding.lastHref = href
    }
  }

  const view = instantiate(compile(fragment, undefined), fragment, undefined)
  // What destroy() removes: the top-level nodes, the branch showing in a top-level chain, and the rows
  // of a top-level list.
  const nodes: Node[] = [...fragment.childNodes]
  const topLevelChains = view.chains.filter((chain) => chain.anchor.parentNode === fragment)
  const topLevelLists = view.lists.filter((list) => list.anchor.parentNode === fragment)

  const checkData = (next: unknown): void => {
    for (const issue of validateData(schema, next)) {
      warn(`${DATA_WARNING_PREFIX}${issue.path === undefined ? '' : `${issue.path}: `}${issue.message}`)
    }
  }

  for (const event of declaredEvents) {
    if (typeof handlerFor(event) !== 'function') warn(`declared event '${event}' has no handler; add on.${event}`)
  }
  // Only function-valued keys are handlers, so a class instance with own state fields isn't flagged.
  for (const key of Object.keys(on)) {
    if (typeof (on as Record<string, unknown>)[key] === 'function' && !declaredEvents.includes(key)) {
      warn(`handler '${key}' doesn't match a declared event (possible typo)${suggest(key, declaredEvents)}`)
    }
  }

  checkData(data)
  renderBlock(view)
  dom.appendChild(element, fragment)

  // A kept <form> (the checker reports it) must not submit: submitting reloads the host page. The
  // submit event bubbles from the form to the container, so one listener cancels every form.
  const cancelSubmit = (event: Event): void => {
    event.preventDefault()
  }
  dom.addEventListener(element, 'submit', cancelSubmit)

  return {
    get data() {
      return data
    },
    get route() {
      return route
    },
    schema,
    update(next: D): void {
      if (destroyed) {
        warn('update() called after destroy(); ignored')
        return
      }
      checkData(next)
      data = next
      renderBlock(view)
    },
    setRoute(next: RouteInput): void {
      if (destroyed) {
        warn('setRoute() called after destroy(); ignored')
        return
      }
      route = next
      renderBlock(view)
    },
    destroy(): void {
      if (destroyed) return
      destroyed = true
      dom.removeEventListener(element, 'submit', cancelSubmit)
      for (const list of topLevelLists) for (const row of list.rows) dom.remove(row.el)
      topLevelLists.length = 0
      unbind(view)
      for (const chain of topLevelChains) if (chain.active !== null) dom.remove(chain.active)
      topLevelChains.length = 0
      view.texts.length = 0
      view.hrefs.length = 0
      view.shows.length = 0
      view.chains.length = 0
      view.lists.length = 0
      for (const node of nodes) dom.remove(node as ChildNode)
      nodes.length = 0
    },
  }
}
