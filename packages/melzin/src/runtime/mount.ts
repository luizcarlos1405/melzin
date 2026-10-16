// mount / mountSource: copy a view's body into the host page, bind it once, then update in place.

import {
  CLICK_DIRECTIVE,
  type Issue,
  type MelzinSchema,
  TEXT_DIRECTIVE,
  VOID_ELEMENTS,
  attributeProblem,
  classifyAttribute,
  dataBlockType,
  defaultAt,
  elementProblem,
  hasField,
  isPlainObject,
  parseClickDirective,
  parseTextDirective,
  resolvePath,
  suggest,
  validateData,
} from '../core/index.ts'
import { parseDocument, readSchemaBlock } from './viewdoc.ts'

export type Handlers = object

/** Every warning about data that doesn't match the schema starts with this (they go stale with new data). */
export const DATA_WARNING_PREFIX = "data doesn't match the schema: "

export type MountOptions<D, H> = {
  data: D
  on: H
  onWarning?: (message: string) => void
}

export type MelzinView<D> = {
  readonly data: D
  readonly schema: MelzinSchema
  update(data: D): void
  destroy(): void
}

type TextBinding = { segments: readonly string[]; el: Element; lastText: string | null }
type ClickBinding = { el: Element; listener: (event: Event) => void }

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
  return `<${el.tagName.toLowerCase()} ${attribute}="${value}">`
}

/** Reads a path with hasField: getters and prototypes count, Object.prototype members (`constructor`) don't. */
function valueAt(data: unknown, segments: readonly string[]): unknown {
  let node: unknown = data
  for (const segment of segments) {
    if (!isPlainObject(node) || !hasField(node, segment)) return undefined
    node = node[segment]
  }
  return node
}

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

  const target = element.ownerDocument
  const fragment = target.createDocumentFragment()
  const nodes: Node[] = []
  for (const child of body.childNodes) {
    const copy = target.importNode(child, true)
    nodes.push(copy)
    fragment.appendChild(copy)
  }
  element.appendChild(fragment)

  let data = options.data
  let destroyed = false
  const texts: TextBinding[] = []
  const clicks: ClickBinding[] = []
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
    const resolved = resolvePath(schema, parsed.path)
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

  // One walk over the copied elements builds the binding table; directive attributes stay in place.
  for (const node of nodes) {
    if (node.nodeType !== 1) continue
    const root = node as Element
    for (const el of [root, ...root.querySelectorAll('*')]) {
      for (const name of el.getAttributeNames()) {
        const kind = classifyAttribute(name)
        if (kind.kind === 'plain') continue
        if (kind.kind !== 'directive') {
          warn(`<${el.tagName.toLowerCase()}>: ${kind.message}; ignored`)
          continue
        }
        const value = el.getAttribute(name) ?? ''
        if (kind.name === TEXT_DIRECTIVE) bindText(el, value)
        else bindClick(el, value)
      }
    }
  }

  const checkData = (next: unknown): void => {
    for (const issue of validateData(schema, next)) {
      warn(`${DATA_WARNING_PREFIX}${issue.path === undefined ? '' : `${issue.path}: `}${issue.message}`)
    }
  }

  const render = (): void => {
    for (const binding of texts) {
      let value = valueAt(data, binding.segments)
      if (value === undefined || value === null) value = defaultAt(schema, binding.segments)
      const text = toText(value)
      if (text !== binding.lastText) {
        binding.el.textContent = text
        binding.lastText = text
      }
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

  return {
    get data() {
      return data
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
    destroy(): void {
      if (destroyed) return
      destroyed = true
      for (const { el, listener } of clicks) el.removeEventListener('click', listener)
      clicks.length = 0
      texts.length = 0
      for (const node of nodes) node.parentNode?.removeChild(node)
      nodes.length = 0
    },
  }
}
