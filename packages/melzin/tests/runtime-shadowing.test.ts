// Markup can't break the runtime by shadowing DOM members. WebIDL's [LegacyOverrideBuiltIns] makes a
// document's named elements its own properties (<img name="createComment"> is document.createComment),
// and a form's named controls the form's (<input name="insertBefore"> is form.insertBefore). Browsers
// do this and happy-dom doesn't, so these tests do it by hand: the documents and forms the runtime gets
// from parsing, importing and cloning get their names as own properties, as in a browser.

import { afterEach, beforeEach, describe, expect, test } from 'bun:test'
import { mountSource } from '../src/runtime/index.ts'
import { useDom } from './helpers/dom.ts'
import { patchMember, view } from './runtime-fixtures.ts'

useDom()

const SCHEMA = {
  data: {
    type: 'object',
    properties: {
      open: { type: 'boolean' },
      items: {
        type: 'array',
        key: 'id',
        items: { type: 'object', properties: { id: { type: 'string' }, done: { type: 'boolean' } }, required: ['id'] },
      },
    },
    required: ['items'],
  },
  events: { pick: { payload: { type: 'object', properties: { id: { type: 'string' } }, required: ['id'] } } },
}

type Data = { open?: boolean; items: { id: string; done?: boolean }[] }

const FORM_WARNING = `<form> isn't supported yet; use <button type="button"> with m-on:click instead`

/** Names that shadow the members the runtime reads or calls on an element. */
const ELEMENT_MEMBERS = [
  'insertBefore', 'appendChild', 'remove', 'before', 'after', 'replaceWith', 'cloneNode', 'childNodes', 'children',
  'firstElementChild', 'parentNode', 'nextSibling', 'previousSibling', 'getAttribute', 'hasAttribute',
  'getAttributeNames', 'removeAttribute', 'setAttribute', 'tagName', 'localName', 'namespaceURI', 'style',
  'addEventListener', 'removeEventListener',
]
const controls = (names: readonly string[]): string => names.map((name) => `<input type="hidden" name="${name}">`).join('')

let root: HTMLElement
let warnings: string[]
let picked: unknown[]
let undo: (() => void)[]

const elementsIn = (node: Node, selector: string): Element[] => {
  const proto = node.nodeType === 9 ? Document.prototype : node.nodeType === 11 ? DocumentFragment.prototype : Element.prototype
  return [...(proto.querySelectorAll.call(node, selector) as NodeListOf<Element>)]
}
const shadow = (node: object, name: string, value: Element): void => {
  if (!Object.hasOwn(node, name)) undo.push(() => delete (node as Record<string, unknown>)[name])
  Object.defineProperty(node, name, { configurable: true, value })
}
const nameOf = (el: Element): string => Element.prototype.getAttribute.call(el, 'name') ?? ''
/**
 * happy-dom's own code calls these on the nodes it copies, connects and styles, which a browser
 * doesn't do through JavaScript, so the simulation leaves them alone.
 */
const HAPPY_DOM_CALLS = new Set(['cloneNode', 'getAttribute', 'setAttribute', 'removeAttribute'])
/** Gives every form in `node` (itself included) its named controls as own properties. */
const shadowForms = (node: Node): void => {
  const forms = elementsIn(node, 'form')
  if (node.nodeType === 1 && (node as Element).localName === 'form') forms.push(node as Element)
  for (const form of forms) {
    for (const control of elementsIn(form, '[name]')) if (!HAPPY_DOM_CALLS.has(nameOf(control))) shadow(form, nameOf(control), control)
  }
}
/** Gives `doc` its named images as own properties, and its forms their controls. */
const shadowDocument = (doc: Document): void => {
  for (const img of elementsIn(doc, 'img[name]')) shadow(doc, nameOf(img), img)
  shadowForms(doc)
}

beforeEach(() => {
  root = document.createElement('div')
  document.body.append(root)
  warnings = []
  picked = []
  undo = []
  const { parseFromString } = DOMParser.prototype
  const { importNode } = Document.prototype
  const { cloneNode } = Node.prototype
  undo.push(
    patchMember(DOMParser.prototype, 'parseFromString', {
      value(this: DOMParser, html: string, type: DOMParserSupportedType) {
        const doc = parseFromString.call(this, html, type)
        shadowDocument(doc)
        return doc
      },
    }),
    patchMember(Document.prototype, 'importNode', {
      value(this: Document, node: Node, deep?: boolean) {
        const copy = importNode.call(this, node, deep)
        shadowForms(copy)
        return copy
      },
    }),
    patchMember(Node.prototype, 'cloneNode', {
      value(this: Node, deep?: boolean) {
        const copy = cloneNode.call(this, deep)
        shadowForms(copy)
        return copy
      },
    }),
  )
})

afterEach(() => {
  for (const step of undo.reverse()) step()
  root.remove()
})

function mountBody(body: string, data: Data) {
  return mountSource(root, view({ schema: SCHEMA, body }), {
    data,
    on: { pick: (payload: unknown) => picked.push(payload) },
    onWarning: (message: string) => warnings.push(message),
  })
}

const items = (...ids: string[]): Data['items'] => ids.map((id) => ({ id }))
const texts = (selector: string): string[] => elementsIn(root, selector).map((el) => el.textContent ?? '')

describe('named controls on a form', () => {
  test("can't stop the rows of a list the form holds", () => {
    const v = mountBody(`<form>${controls(ELEMENT_MEMBERS)}<p m-for="item in items" m-text="item.id"></p></form>`, { items: items('a', 'b') })
    const form = elementsIn(root, 'form')[0]!
    expect(Object.hasOwn(form, 'insertBefore')).toBe(true)
    expect(texts('p')).toEqual(['a', 'b'])
    v.update({ items: items('c', 'b', 'a') })
    expect(texts('p')).toEqual(['c', 'b', 'a'])
    v.update({ items: items('b') })
    expect(texts('p')).toEqual(['b'])
    v.destroy()
    expect(root.childNodes.length).toBe(0)
    expect(warnings).toEqual([FORM_WARNING])
  })

  test("can't stop a form that is the row, with its bindings", () => {
    // happy-dom's click climbs through parentNode, which a browser doesn't do through JavaScript.
    const names = ELEMENT_MEMBERS.filter((name) => name !== 'parentNode')
    const v = mountBody(
      `<div><form m-for="item in items" m-show="item.done" m-on:click="emit('pick', { id: item.id })">${controls(names)}</form></div>`,
      { items: [{ id: 'a', done: true }, { id: 'b' }] },
    )
    const forms = (): HTMLElement[] => elementsIn(root, 'form') as HTMLElement[]
    expect(forms()).toHaveLength(2)
    expect(forms().map((form) => (Object.getOwnPropertyDescriptor(HTMLElement.prototype, 'style')!.get!.call(form) as CSSStyleDeclaration).display)).toEqual(['', 'none'])
    HTMLElement.prototype.click.call(forms()[1]!)
    expect(picked).toEqual([{ id: 'b' }])
    v.update({ items: [{ id: 'b', done: true }, { id: 'c' }] })
    expect(forms()).toHaveLength(2)
    HTMLElement.prototype.click.call(forms()[1]!)
    expect(picked).toEqual([{ id: 'b' }, { id: 'c' }])
    v.destroy()
    expect(root.childNodes.length).toBe(0)
    expect(warnings).toEqual([FORM_WARNING])
  })

  test("can't stop a form that is a branch of a chain, in a row", () => {
    const v = mountBody(
      `<ul><li m-for="item in items"><form m-if="item.done">${controls(ELEMENT_MEMBERS)}done</form><i m-else>todo</i></li></ul>`,
      { items: items('a') },
    )
    expect(texts('li')).toEqual(['todo'])
    v.update({ items: [{ id: 'a', done: true }, { id: 'b' }] })
    expect(texts('li')).toEqual(['done', 'todo'])
    v.update({ items: [{ id: 'a' }, { id: 'b', done: true }] })
    expect(texts('li')).toEqual(['todo', 'done'])
    expect(warnings).toEqual([FORM_WARNING])
  })
})

describe('named images on the document', () => {
  test("can't stop new rows, with their chains, after the view is in the page", () => {
    const v = mountBody(
      `<img name="createComment" alt=""><ul><li m-for="item in items"><span m-text="item.id"></span><b m-if="item.done">done</b><i m-else>todo</i></li></ul>`,
      { items: items('a') },
    )
    shadowDocument(document)
    expect(typeof document.createComment).toBe('object')
    v.update({ items: [{ id: 'a' }, { id: 'b', done: true }] })
    expect(texts('li')).toEqual(['atodo', 'bdone'])
    expect(warnings).toEqual([])
  })

  test("can't stop another view from mounting, or the parsed view from being read", () => {
    const names = ['createComment', 'createDocumentFragment', 'importNode', 'body', 'head']
    mountBody(names.map((name) => `<img name="${name}" alt="">`).join(''), { items: [] })
    shadowDocument(document)
    const second = mountBody(`<p m-if="open">open</p><ul><li m-for="item in items" m-text="item.id"></li></ul>`, { open: true, items: items('a') })
    expect(texts('p')).toEqual(['open'])
    expect(texts('li')).toEqual(['a'])
    second.destroy()
    expect(texts('li')).toEqual([])
    expect(warnings).toEqual([])
  })
})
