// The DOM calls the runtime makes on elements and documents, safe from the markup's names.
//
// WebIDL's [LegacyOverrideBuiltIns] lets markup shadow DOM members by name. A document's named
// elements hide its members: with <img name="createComment"> in the page, document.createComment is
// that img. A form's named controls do the same to the form: <input name="insertBefore"> hides
// form.insertBefore, and any other member. Such a name is an own property of the node, so these
// helpers read a member from the node's prototypes whenever the node has an own property of that
// name. Comments and text nodes have no named properties, so the runtime calls them directly.

/** The member `name` as the node's interface defines it, past an own property of the node. */
function inherited(node: object, name: string): PropertyDescriptor | undefined {
  for (let proto = Object.getPrototypeOf(node); proto !== null; proto = Object.getPrototypeOf(proto)) {
    const descriptor = Object.getOwnPropertyDescriptor(proto, name)
    if (descriptor !== undefined) return descriptor
  }
  // A member that is the node's own ([LegacyUnforgeable]) has nothing to shadow.
  return Object.getOwnPropertyDescriptor(node, name)
}

function get(node: object, name: string): unknown {
  if (!Object.hasOwn(node, name)) return (node as Record<string, unknown>)[name]
  const descriptor = inherited(node, name)
  return descriptor?.get === undefined ? descriptor?.value : descriptor.get.call(node)
}

function set(node: object, name: string, value: unknown): void {
  if (!Object.hasOwn(node, name)) (node as Record<string, unknown>)[name] = value
  else inherited(node, name)?.set?.call(node, value)
}

function call(node: object, name: string, ...args: unknown[]): unknown {
  return Reflect.apply(get(node, name) as (...args: unknown[]) => unknown, node, args)
}

// --- documents

export const ownerDocument = (node: Node): Document => get(node, 'ownerDocument') as Document
export const defaultView = (doc: Document): (Window & typeof globalThis) | null => get(doc, 'defaultView') as (Window & typeof globalThis) | null
export const head = (doc: Document): HTMLHeadElement => get(doc, 'head') as HTMLHeadElement
export const body = (doc: Document): HTMLElement => get(doc, 'body') as HTMLElement
export const baseURI = (node: Node): string => get(node, 'baseURI') as string
export const createComment = (doc: Document, data: string): Comment => call(doc, 'createComment', data) as Comment
export const createDocumentFragment = (doc: Document): DocumentFragment => call(doc, 'createDocumentFragment') as DocumentFragment
export const createElement = (doc: Document, tag: string): HTMLElement => call(doc, 'createElement', tag) as HTMLElement
export const getElementById = (doc: Document, id: string): HTMLElement | null => call(doc, 'getElementById', id) as HTMLElement | null
/** A deep copy of `node`, owned by `doc`. */
export const importNode = <T extends Node>(doc: Document, node: T): T => call(doc, 'importNode', node, true) as T

// --- the tree

export const nodeType = (node: Node): number => get(node, 'nodeType') as number
export const parentNode = (node: Node): ParentNode | null => get(node, 'parentNode') as ParentNode | null
export const previousSibling = (node: Node): ChildNode | null => get(node, 'previousSibling') as ChildNode | null
export const nextSibling = (node: Node): ChildNode | null => get(node, 'nextSibling') as ChildNode | null
export const childNodes = (node: Node): NodeListOf<ChildNode> => get(node, 'childNodes') as NodeListOf<ChildNode>
/** The element children of an element or a fragment. */
export const children = (node: Element | DocumentFragment): HTMLCollection => get(node, 'children') as HTMLCollection
export const firstElementChild = (el: Element): Element | null => get(el, 'firstElementChild') as Element | null
export const insertBefore = (parent: Node, node: Node, before: Node | null): void => {
  call(parent, 'insertBefore', node, before)
}
export const appendChild = (parent: Node, node: Node): void => {
  call(parent, 'appendChild', node)
}
/**
 * Moves `node` with moveBefore, which keeps its state (focus, animations, iframes); false where the
 * browser has no moveBefore. Throws when the browser refuses the move.
 */
export const moveBefore = (parent: Node, node: Node, before: Node | null): boolean => {
  const method = get(parent, 'moveBefore')
  if (typeof method !== 'function') return false
  Reflect.apply(method, parent, [node, before])
  return true
}
/** Takes `node` out of its parent, if it has one. */
export const remove = (node: ChildNode): void => {
  call(node, 'remove')
}
/** A deep copy of `node`. */
export const cloneNode = <T extends Node>(node: T): T => call(node, 'cloneNode', true) as T
export const setTextContent = (node: Node, text: string): void => set(node, 'textContent', text)

// --- elements

export const localName = (el: Element): string => get(el, 'localName') as string
export const tagName = (el: Element): string => get(el, 'tagName') as string
export const namespaceURI = (el: Element): string | null => get(el, 'namespaceURI') as string | null
export const getAttribute = (el: Element, name: string): string | null => call(el, 'getAttribute', name) as string | null
export const hasAttribute = (el: Element, name: string): boolean => call(el, 'hasAttribute', name) as boolean
export const getAttributeNames = (el: Element): string[] => call(el, 'getAttributeNames') as string[]
export const setAttribute = (el: Element, name: string, value: string): void => {
  call(el, 'setAttribute', name, value)
}
export const removeAttribute = (el: Element, name: string): void => {
  call(el, 'removeAttribute', name)
}
/** The element's inline style, undefined for an element that has none. */
export const style = (el: Element): CSSStyleDeclaration | undefined => get(el, 'style') as CSSStyleDeclaration | undefined

// --- events

export const addEventListener = (target: EventTarget, type: string, listener: EventListener, options?: AddEventListenerOptions): void => {
  call(target, 'addEventListener', type, listener, options)
}
export const removeEventListener = (target: EventTarget, type: string, listener: EventListener): void => {
  call(target, 'removeEventListener', type, listener)
}
