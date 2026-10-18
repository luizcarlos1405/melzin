// mount / mountSource: copy a view's body into the host page, bind it once, then update in place.

import {
  CLICK_DIRECTIVE,
  type ChainDirective,
  ELSE_DIRECTIVE,
  ELSE_IF_DIRECTIVE,
  HREF_DIRECTIVE,
  IF_DIRECTIVE,
  type Issue,
  type MelzinSchema,
  type RouteInput,
  SHOW_DIRECTIVE,
  TEXT_DIRECTIVE,
  VOID_ELEMENTS,
  attributeProblem,
  classifyAttribute,
  conditionHolds,
  dataBlockType,
  elementProblem,
  hasField,
  isChainDirective,
  isInterElementWhitespace,
  parseClickDirective,
  parseConditionDirective,
  parseHrefDirective,
  parseRouteRef,
  parseTextDirective,
  readPath,
  resolveField,
  resolvePath,
  suggest,
  urlScheme,
  validateData,
  valueOrDefault,
} from '../core/index.ts'
import { parseDocument, readSchemaBlock } from './viewdoc.ts'

export type Handlers = object

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

type TextBinding = { segments: readonly string[]; el: Element; lastText: string | null }
/** m-bind:href: the link field's URL, or no href at all while the field is missing. */
type HrefBinding = { segments: readonly string[]; el: Element; lastHref: string | null | undefined }
type ClickBinding = { el: Element; listener: (event: Event) => void }
/** m-show: `display: none` while the condition is false; `display` is the element's own value to restore. */
type ShowBinding = { style: CSSStyleDeclaration; holds: () => boolean; display: string; shown: boolean | null }
/**
 * An m-if chain. The anchor comment marks where the chain's elements go, and the first branch whose
 * condition holds sits right after it; the others are out of the document, still bound.
 */
type ChainBinding = { anchor: Comment; branches: { el: Element; holds: () => boolean }[]; active: Element | null }

const ELEMENT_NODE = 1
const TEXT_NODE = 3
const COMMENT_NODE = 8

/** Fetches a view file and mounts it into `element` (see mountSource). */
export async function mount<
  D extends object = Record<string, unknown>,
  H extends object = Record<string, (payload?: undefined) => void>,
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
  return `<${el.tagName.toLowerCase()} ${attribute}${value === '' ? '' : `="${value}"`}>`
}

/** The element's m-if, m-else-if or m-else: the first one, if it has several. */
function chainRole(el: Element): ChainDirective | undefined {
  return el.getAttributeNames().find(isChainDirective)
}

/** Schemes a link field may not use: they would run code instead of navigating. */
const SCRIPT_SCHEMES = new Set(['javascript', 'vbscript', 'data'])

/** Text for a value: primitives through String(); objects (wrong data, already warned about) show nothing. */
function toText(value: unknown): string {
  if (value === undefined || value === null || typeof value === 'object' || typeof value === 'function') return ''
  return String(value)
}

/**
 * Cleans the inert parsed body before anything reaches the live document, with the rules the checker
 * reports (core/markup.ts): drops what would run code or change the host page (scripts, styles, <base>,
 * embedded documents, inline handlers, javascript: URLs...) and warns about the rest.
 */
function sanitize(body: HTMLElement, warn: (message: string) => void): void {
  for (const el of [...body.querySelectorAll('*')]) {
    if (!body.contains(el)) continue // inside an element dropped earlier
    const tag = el.localName
    const blockType = tag === 'script' ? dataBlockType(el.getAttribute('type')) : undefined
    const problem = blockType === undefined
      ? elementProblem(tag, el.namespaceURI, (name) => el.getAttribute(name))
      : { message: `the ${blockType} block belongs in <head>`, drop: true }
    if (problem !== undefined) {
      warn(problem.drop ? `${problem.message}; dropped` : problem.message)
      if (problem.drop) {
        el.remove()
        continue
      }
    }
    for (const name of el.getAttributeNames()) {
      const attribute = attributeProblem(name, el.getAttribute(name) ?? '')
      if (attribute === undefined) continue
      warn(`<${tag}>: ${attribute.message}${attribute.drop ? '; removed' : ''}`)
      if (attribute.drop) el.removeAttribute(name)
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
  const declaredEvents = Object.keys(schema.events ?? {})
  const on = (options.on ?? {}) as Record<string, unknown>
  // Handlers are looked up like data (hasField): methods on a class count, Object.prototype's don't.
  const handlerFor = (name: string): unknown => (hasField(on, name) ? on[name] : undefined)

  const body = doc.body
  sanitize(body, warn)

  // The view is bound and rendered in a fragment, so the host page only ever sees it finished.
  const target = element.ownerDocument
  const fragment = target.createDocumentFragment()
  for (const child of body.childNodes) fragment.appendChild(target.importNode(child, true))

  let data = options.data
  let route: RouteInput = options.route ?? {}
  let destroyed = false
  const texts: TextBinding[] = []
  const hrefs: HrefBinding[] = []
  const clicks: ClickBinding[] = []
  const shows: ShowBinding[] = []
  const chains: ChainBinding[] = []
  const undeclaredWarned = new Set<string>()

  const emit = (name: string): void => {
    if (destroyed) return
    const handler = handlerFor(name)
    if (typeof handler !== 'function') {
      warn(`no handler for event '${name}'; add on.${name}`)
      return
    }
    handler.call(on, undefined)
  }

  const bindText = (el: Element, value: string): void => {
    const parsed = parseTextDirective(value)
    if (!parsed.ok) {
      warn(`${describeElement(el, TEXT_DIRECTIVE, value)}: ${parsed.message} (at column ${parsed.offset + 1}); skipped`)
      return
    }
    const ref = parseRouteRef(parsed.path)
    const resolved = ref ?? resolvePath(schema, parsed.path)
    if (!resolved.ok) {
      warn(`${describeElement(el, TEXT_DIRECTIVE, value)}: ${resolved.message}; skipped`)
      return
    }
    if (VOID_ELEMENTS.has(el.localName)) {
      warn(`${describeElement(el, TEXT_DIRECTIVE, value)}: <${el.localName}> has no content to set; skipped`)
      return
    }
    if (el.firstElementChild !== null) {
      warn(`${describeElement(el, TEXT_DIRECTIVE, value)} has child elements; ${TEXT_DIRECTIVE} replaces them`)
    }
    texts.push({ segments: parsed.path, el, lastText: null })
  }

  const bindClick = (el: Element, value: string): void => {
    const parsed = parseClickDirective(value)
    if (!parsed.ok) {
      warn(`${describeElement(el, CLICK_DIRECTIVE, value)}: ${parsed.message} (at column ${parsed.offset + 1}); skipped`)
      return
    }
    const name = parsed.event
    if (!declaredEvents.includes(name) && !undeclaredWarned.has(name)) {
      undeclaredWarned.add(name)
      warn(`${CLICK_DIRECTIVE} emits '${name}', which isn't declared in the schema's events${suggest(name, declaredEvents)}`)
    }
    const listener = (): void => emit(name)
    el.addEventListener('click', listener)
    clicks.push({ el, listener })
  }

  // A condition that can't be used (a parse error, an unknown field) warns and counts as false, so a
  // broken m-if hides its element rather than showing it to everyone.
  const conditionTest = (el: Element, directive: string): (() => boolean) => {
    const value = el.getAttribute(directive) ?? ''
    const parsed = parseConditionDirective(directive, value)
    if (!parsed.ok) {
      warn(`${describeElement(el, directive, value)}: ${parsed.message} (at column ${parsed.offset + 1}); treated as false`)
      return () => false
    }
    const resolved = parseRouteRef(parsed.condition.path) ?? resolveField(schema, parsed.condition.path)
    if (!resolved.ok) {
      warn(`${describeElement(el, directive, value)}: ${resolved.message}; treated as false`)
      return () => false
    }
    const { condition } = parsed
    return () => conditionHolds(schema, data, condition, route)
  }

  // A link's URL comes from a link field, a string field that names its route (SPEC D23).
  const bindHref = (el: Element, value: string): void => {
    const where = describeElement(el, HREF_DIRECTIVE, value)
    if (el.localName !== 'a' && el.localName !== 'area') {
      warn(`${where}: ${HREF_DIRECTIVE} only works on links (<a> and <area>); skipped`)
      return
    }
    const parsed = parseHrefDirective(value)
    if (!parsed.ok) {
      warn(`${where}: ${parsed.message} (at column ${parsed.offset + 1}); skipped`)
      return
    }
    if (parseRouteRef(parsed.path) !== undefined) {
      warn(`${where}: ${HREF_DIRECTIVE} needs a link field; the URL input isn't a URL; skipped`)
      return
    }
    const resolved = resolveField(schema, parsed.path)
    if (!resolved.ok) {
      warn(`${where}: ${resolved.message}; skipped`)
      return
    }
    if (resolved.field.type !== 'string' || resolved.field.route === undefined) {
      warn(`${where}: '${parsed.path.join('.')}' isn't a link field; give it "route": "<route name>" in the schema; skipped`)
      return
    }
    if (el.hasAttribute('href')) warn(`${where}: the link also has a static href, which the field's URL replaces; keep one`)
    hrefs.push({ segments: parsed.path, el, lastHref: undefined })
  }

  const bindShow = (el: Element): void => {
    const { style } = el as Element & Partial<ElementCSSInlineStyle>
    if (style === undefined) {
      warn(`${describeElement(el, SHOW_DIRECTIVE, el.getAttribute(SHOW_DIRECTIVE) ?? '')}: <${el.localName}> has no style to hide it with; skipped`)
      return
    }
    shows.push({ style, holds: conditionTest(el, SHOW_DIRECTIVE), display: style.display, shown: null })
  }

  const elseTest = (el: Element): (() => boolean) => {
    const value = el.getAttribute(ELSE_DIRECTIVE) ?? ''
    if (value.trim() !== '') {
      warn(`${describeElement(el, ELSE_DIRECTIVE, value)}: ${ELSE_DIRECTIVE} takes no value; for another condition use ${ELSE_IF_DIRECTIVE}="${value}"`)
    }
    return () => true
  }

  // Elements already taken into a chain, so the walk doesn't call them orphans.
  const chained = new Set<Element>()

  // The chain that starts at `first`: the m-else-if and m-else siblings right after it, with only
  // whitespace and comments in between, up to the first m-else.
  const collectChain = (first: Element, role: ChainDirective): ChainBinding => {
    chained.add(first)
    const branches = [{ el: first, holds: conditionTest(first, role) }]
    for (let node = first.nextSibling; node !== null; node = node.nextSibling) {
      if (node.nodeType === COMMENT_NODE) continue
      if (node.nodeType === TEXT_NODE && isInterElementWhitespace(node.textContent ?? '')) continue
      if (node.nodeType !== ELEMENT_NODE) break
      const el = node as Element
      const next = chainRole(el)
      if (next !== ELSE_IF_DIRECTIVE && next !== ELSE_DIRECTIVE) break
      chained.add(el)
      branches.push({ el, holds: next === ELSE_DIRECTIVE ? elseTest(el) : conditionTest(el, next) })
      if (next === ELSE_DIRECTIVE) break
    }
    return { anchor: target.createComment(IF_DIRECTIVE), branches, active: null }
  }

  // One walk over the copied elements builds the binding table; directive attributes stay in place.
  for (const el of [...fragment.querySelectorAll('*')]) {
    const role = chainRole(el)
    for (const name of el.getAttributeNames()) {
      const kind = classifyAttribute(name)
      if (kind.kind === 'plain') continue
      if (kind.kind !== 'directive') {
        warn(`<${el.tagName.toLowerCase()}>: ${kind.message}; ignored`)
        continue
      }
      const value = el.getAttribute(name) ?? ''
      if (kind.name === TEXT_DIRECTIVE) bindText(el, value)
      else if (kind.name === CLICK_DIRECTIVE) bindClick(el, value)
      else if (kind.name === HREF_DIRECTIVE) bindHref(el, value)
      else if (kind.name === SHOW_DIRECTIVE) bindShow(el)
      else if (kind.name !== role) {
        warn(`<${el.tagName.toLowerCase()}>: an element can have only one of ${IF_DIRECTIVE}, ${ELSE_IF_DIRECTIVE} and ${ELSE_DIRECTIVE}; ${kind.name} ignored`)
      }
    }
    if (role === undefined || chained.has(el)) continue
    if (role !== IF_DIRECTIVE) {
      const fallback = role === ELSE_DIRECTIVE ? 'ignored' : `treated as ${IF_DIRECTIVE}`
      warn(`${describeElement(el, role, el.getAttribute(role) ?? '')}: ${role} must come right after an element with ${IF_DIRECTIVE} or ${ELSE_IF_DIRECTIVE}; ${fallback}`)
      if (role === ELSE_DIRECTIVE) continue
    }
    chains.push(collectChain(el, role))
  }

  // Each chain's elements leave the tree; render() puts the one that should show after the anchor.
  for (const chain of chains) {
    chain.branches[0]!.el.before(chain.anchor)
    for (const { el } of chain.branches) el.remove()
  }
  // What destroy() removes: the top-level nodes, and the branch showing in a top-level chain.
  const nodes: Node[] = [...fragment.childNodes]
  const topLevelChains = chains.filter((chain) => chain.anchor.parentNode === fragment)

  const checkData = (next: unknown): void => {
    for (const issue of validateData(schema, next)) {
      warn(`${DATA_WARNING_PREFIX}${issue.path === undefined ? '' : `${issue.path}: `}${issue.message}`)
    }
  }

  const render = (): void => {
    for (const chain of chains) {
      const next = chain.branches.find((branch) => branch.holds())?.el ?? null
      if (next === chain.active) continue
      chain.active?.remove()
      if (next !== null) chain.anchor.after(next)
      chain.active = next
    }
    for (const binding of shows) {
      const shown = binding.holds()
      if (shown === binding.shown) continue
      binding.style.display = shown ? binding.display : 'none'
      binding.shown = shown
    }
    for (const binding of texts) {
      const text = toText(readPath(schema, data, route, binding.segments))
      if (text !== binding.lastText) {
        binding.el.textContent = text
        binding.lastText = text
      }
    }
    for (const binding of hrefs) {
      const value = valueOrDefault(schema, data, binding.segments)
      let href = typeof value === 'string' && value !== '' ? value : null
      const scheme = href === null ? undefined : urlScheme(href)
      if (scheme !== undefined && SCRIPT_SCHEMES.has(scheme)) {
        warn(`${HREF_DIRECTIVE}="${binding.segments.join('.')}": ${scheme}: URLs aren't allowed in links; the link has no href`)
        href = null
      }
      if (href === binding.lastHref) continue
      if (href === null) binding.el.removeAttribute('href')
      else binding.el.setAttribute('href', href)
      binding.lastHref = href
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
  render()
  element.appendChild(fragment)

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
      render()
    },
    setRoute(next: RouteInput): void {
      if (destroyed) {
        warn('setRoute() called after destroy(); ignored')
        return
      }
      route = next
      render()
    },
    destroy(): void {
      if (destroyed) return
      destroyed = true
      for (const { el, listener } of clicks) el.removeEventListener('click', listener)
      clicks.length = 0
      texts.length = 0
      hrefs.length = 0
      shows.length = 0
      for (const chain of topLevelChains) chain.active?.remove()
      topLevelChains.length = 0
      chains.length = 0
      for (const node of nodes) node.parentNode?.removeChild(node)
      nodes.length = 0
    },
  }
}
