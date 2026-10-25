// What the runtime drops from a view's body before it reaches the host page (core/markup.ts), and
// what it only warns about. The checker reports the same rules as errors (check-rules.test.ts).

import { afterEach, beforeEach, describe, expect, spyOn, test } from 'bun:test'
import { mountSource } from '../src/runtime/index.ts'
import { useDom } from './helpers/dom.ts'
import { view } from './runtime-fixtures.ts'

useDom()

let root: HTMLElement
let warnings: string[]
const onWarning = (message: string): void => {
  warnings.push(message)
}

beforeEach(() => {
  root = document.createElement('div')
  document.body.append(root)
  warnings = []
})

afterEach(() => {
  root.remove()
})

const mountBody = (body: string): void => {
  mountSource(root, view({ body }), { data: {}, on: {}, onWarning })
}

describe('elements that would run code or change the host page are dropped', () => {
  test('embedded documents, styles, <base>, <meta>, <title>, <link>', () => {
    // happy-dom (unlike a browser's DOMParser) tries to load iframes of the parsed document; mute that.
    const muted = spyOn(console, 'error').mockImplementation(() => {})
    mountBody(
      `<p id="keep">kept</p>` +
        `<iframe srcdoc="<script>parent.pwned = 1</script>"></iframe>` +
        `<iframe></iframe>` +
        `<object data="/x.swf"></object><embed src="/x.swf">` +
        `<base href="https://evil.example/">` +
        `<meta http-equiv="refresh" content="0;url=https://evil.example/">` +
        `<title>Evil</title>` +
        `<style>body { display: none }</style>` +
        `<link rel="preconnect">`,
    )
    muted.mockRestore()
    expect(root.innerHTML).toBe('<p id="keep">kept</p>')
    expect(document.baseURI).not.toContain('evil.example')
    expect(warnings).toEqual([
      "<iframe> isn't allowed; views can't embed other documents; dropped",
      "<iframe> isn't allowed; views can't embed other documents; dropped",
      "<object> isn't allowed; views can't embed other documents; dropped",
      "<embed> isn't allowed; views can't embed other documents; dropped",
      "<base> isn't allowed; it would change how every relative URL in the host page resolves; dropped",
      '<meta> belongs in <head>; in the body it would act on the host page; dropped',
      '<title> belongs in <head>; dropped',
      "<style> isn't allowed; styling is Tailwind classes only, with design tokens in theme.css; dropped",
      "<link> isn't allowed; styling is Tailwind classes only, with design tokens in theme.css; dropped",
    ])
  })

  test('<template> is dropped with its content (it would never be bound), with one warning', () => {
    mountBody(`<template><p m-text="a"></p><script>x()</script><img onerror="x()"></template><p>after</p>`)
    expect(root.innerHTML).toBe('<p>after</p>')
    expect(warnings).toEqual(['<template> isn\'t supported; to group elements, wrap them in one element, such as <div class="contents">; dropped'])
  })

  // SVG <script> and <style> follow the same rule (core-markup.test.ts, check-rules.test.ts), but
  // happy-dom's parser drops them, and whatever follows, by itself, so they can't be tested here.
  test('SVG href animations are dropped; an SVG <title> stays', () => {
    mountBody(
      `<svg viewBox="0 0 1 1"><title>Close icon</title>` +
        `<a href="/ok"><set attributeName="href" to="javascript:x()"></set><animate attributeName="fill" to="red"></animate></a></svg>`,
    )
    expect(root.querySelector('svg title')?.textContent).toBe('Close icon')
    expect(root.querySelector('svg set')).toBeNull()
    expect(root.querySelector('svg animate')).not.toBeNull()
    expect(warnings).toEqual(["SVG <set> can't animate href; links in views are static; dropped"])
  })

  test('a data block in the body is dropped as misplaced', () => {
    mountBody(`<script type="melzin/snapshots">{}</script><p>x</p>`)
    expect(root.innerHTML).toBe('<p>x</p>')
    expect(warnings).toEqual(['the melzin/snapshots block belongs in <head>; dropped'])
  })
})

describe('attributes', () => {
  test('javascript: and vbscript: URLs are removed, however they are spelled', () => {
    mountBody(
      `<a id="a" href="javascript:parent.pwned = 1">a</a>` +
        `<a id="b" href="  JaVa&#x0A;Script:alert(1)">b</a>` +
        `<a id="c" href="vbscript:msgbox">c</a>` +
        `<button id="d" type="submit" formaction="javascript:x()">d</button>` +
        `<svg><a id="e" xlink:href="javascript:x()"><text>e</text></a></svg>` +
        `<a id="ok" href="/orders/42">ok</a><a id="mail" href="mailto:a@b.c">mail</a><img id="img" src="data:image/png;base64,AA==">`,
    )
    for (const id of ['a', 'b', 'c']) expect(root.querySelector(`#${id}`)?.hasAttribute('href')).toBe(false)
    expect(root.querySelector('#d')?.hasAttribute('formaction')).toBe(false)
    expect(root.querySelector('#e')?.getAttributeNames()).toEqual(['id'])
    expect(root.querySelector('#ok')?.getAttribute('href')).toBe('/orders/42')
    expect(root.querySelector('#mail')?.getAttribute('href')).toBe('mailto:a@b.c')
    expect(root.querySelector('#img')?.getAttribute('src')).toStartWith('data:image/png')
    expect(warnings).toEqual([
      "<a>: javascript: URLs aren't allowed in href; views run no code; removed",
      "<a>: javascript: URLs aren't allowed in href; views run no code; removed",
      "<a>: vbscript: URLs aren't allowed in href; views run no code; removed",
      "<button>: javascript: URLs aren't allowed in formaction; views run no code; removed",
      "<a>: javascript: URLs aren't allowed in xlink:href; views run no code; removed",
    ])
  })

  test('srcdoc is removed wherever it is', () => {
    mountBody(`<div srcdoc="<script>x()</script>">x</div>`)
    expect(root.querySelector('div')?.hasAttribute('srcdoc')).toBe(false)
    expect(warnings).toEqual(["<div>: srcdoc isn't allowed; views can't embed other documents; removed"])
  })

  test('style attributes and forms are kept, with a warning (they break the authoring rules, not the host)', () => {
    mountBody(`<form><button type="button" style="color: red">x</button></form>`)
    expect(root.querySelector('button')?.getAttribute('style')).toBe('color: red')
    expect(root.querySelector('form')).not.toBeNull()
    expect(warnings).toEqual([
      `<form> isn't supported yet; use <button type="button"> with m-on:click instead`,
      "<button>: style attributes aren't allowed; styling is Tailwind classes only, with design tokens in theme.css",
    ])
  })

  test('Vue/Alpine attributes are removed, so the host page never runs them', () => {
    mountBody(`<button id="a" x-init="document.title='pwned'">a</button><div id="b" @click="go" :title="tip" v-cloak>b</div>`)
    expect(root.querySelector('#a')?.getAttributeNames()).toEqual(['id'])
    expect(root.querySelector('#b')?.getAttributeNames()).toEqual(['id'])
    expect(warnings).toEqual([
      "<button>: 'x-init' is Vue/Alpine syntax; a host page running Vue or Alpine would run it; removed",
      "<div>: '@click' is Vue/Alpine syntax; a host page running Vue or Alpine would run it; removed",
      "<div>: ':title' is Vue/Alpine syntax; a host page running Vue or Alpine would run it; removed",
      "<div>: 'v-cloak' is Vue/Alpine syntax; a host page running Vue or Alpine would run it; removed",
    ])
  })

  test('form attributes are removed, whatever their value', () => {
    mountBody(`<button id="a" form="host-form" formaction="https://evil.example/">a</button><input id="b" formmethod="post" formtarget="_top" formenctype="text/plain">`)
    expect(root.querySelector('#a')?.getAttributeNames()).toEqual(['id'])
    expect(root.querySelector('#b')?.getAttributeNames()).toEqual(['id'])
    const form = `would submit a form in the host page; views send events with m-on:click="emit('name')"; removed`
    expect(warnings).toEqual([
      `<button>: 'form' ${form}`,
      `<button>: 'formaction' ${form}`,
      `<input>: 'formmethod' ${form}`,
      `<input>: 'formtarget' ${form}`,
      `<input>: 'formenctype' ${form}`,
    ])
  })
})

describe('kept forms do not submit', () => {
  test('a <button> without type inside a form warns, and one with type is fine', () => {
    mountBody(`<form><button id="a">Go</button><button id="b" type="button">OK</button></form>`)
    expect(root.querySelector('#a')?.hasAttribute('type')).toBe(false)
    expect(root.querySelector('#b')?.getAttribute('type')).toBe('button')
    expect(warnings).toEqual([
      `<form> isn't supported yet; use <button type="button"> with m-on:click instead`,
      `<button> needs type="button"; the default type="submit" would submit a form in the host page`,
    ])
  })

  test('a submit event on a kept form is cancelled', () => {
    mountBody(`<form id="f"><input name="x"></form>`)
    const event = new Event('submit', { bubbles: true, cancelable: true })
    root.querySelector('#f')!.dispatchEvent(event)
    expect(event.defaultPrevented).toBe(true)
  })
})

describe('schema block in the wrong place', () => {
  test('a schema block that ended up in <body> throws instead of mounting without a schema', () => {
    const src =
      '<!doctype html><html><head><title>T</title></head><body>' +
      '<script type="melzin/schema">{"data":{"type":"object","properties":{"n":{"type":"number"}}}}</script>' +
      '<p m-text="n"></p></body></html>'
    expect(() => mountSource(root, src, { data: { n: 1 }, on: {}, onWarning })).toThrow(
      /melzin: the view has an invalid schema:\n {2}- schema: the melzin\/schema block ended up in <body>/,
    )
    expect(root.childNodes.length).toBe(0)
  })
})
