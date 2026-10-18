// The body rules shared by the runtime and the checker (src/core/markup.ts).

import { describe, expect, test } from 'bun:test'
import { HTML_NAMESPACE, attributeProblem, elementProblem, urlScheme } from '../src/core/index.ts'

const SVG = 'http://www.w3.org/2000/svg'
const none = (): null => null

describe('elementProblem', () => {
  test('dropped HTML elements', () => {
    for (const tag of ['script', 'style', 'link', 'base', 'meta', 'title', 'iframe', 'frame', 'frameset', 'object', 'embed', 'template']) {
      expect({ tag, drop: elementProblem(tag, HTML_NAMESPACE, none)?.drop }).toEqual({ tag, drop: true })
    }
  })

  test('a <template> with a loop says where m-for goes', () => {
    for (const name of ['m-for', 'v-for', 'x-for']) {
      const attribute = (attr: string): string | null => (attr === name ? 'member in members' : null)
      expect(elementProblem('template', HTML_NAMESPACE, attribute)).toEqual({
        message: "put m-for on the element to repeat; <template> isn't supported",
        drop: true,
      })
    }
    expect(elementProblem('template', HTML_NAMESPACE, none)?.message).toBe(
      '<template> isn\'t supported; to group elements, wrap them in one element, such as <div class="contents">',
    )
  })

  test('<form> is reported but not dropped', () => {
    expect(elementProblem('form', HTML_NAMESPACE, none)).toEqual({
      message: `<form> isn't supported yet; use <button type="button"> with m-on:click instead`,
      drop: false,
    })
  })

  test('SVG: <script> and <style> are dropped, <title> and plain animations are fine, href animations are dropped', () => {
    expect(elementProblem('script', SVG, none)?.drop).toBe(true)
    expect(elementProblem('style', SVG, none)?.drop).toBe(true)
    expect(elementProblem('title', SVG, none)).toBeUndefined()
    expect(elementProblem('animate', SVG, (name) => (name === 'attributeName' ? 'fill' : null))).toBeUndefined()
    expect(elementProblem('set', SVG, (name) => (name === 'attributeName' ? ' HREF ' : null))?.drop).toBe(true)
    expect(elementProblem('animate', SVG, (name) => (name === 'attributeName' ? 'xlink:href' : null))?.drop).toBe(true)
  })

  test('ordinary elements are fine', () => {
    for (const tag of ['div', 'a', 'img', 'button', 'svg', 'noscript']) expect(elementProblem(tag, HTML_NAMESPACE, none)).toBeUndefined()
  })
})

describe('attributeProblem', () => {
  test('inline handlers, srcdoc and script URLs are dropped; style is reported', () => {
    expect(attributeProblem('onclick', 'x()')).toEqual({ message: `inline handler 'onclick' isn't allowed; use m-on:click="emit('name')"`, drop: true })
    expect(attributeProblem('srcdoc', '')?.drop).toBe(true)
    expect(attributeProblem('style', 'color: red')).toEqual({
      message: "style attributes aren't allowed; styling is Tailwind classes only, with design tokens in theme.css",
      drop: false,
    })
    for (const name of ['href', 'src', 'action', 'formaction', 'xlink:href', 'poster', 'data']) {
      expect({ name, problem: attributeProblem(name, 'javascript:alert(1)')?.drop }).toEqual({ name, problem: true })
    }
    expect(attributeProblem('href', 'vbscript:x')?.message).toBe("vbscript: URLs aren't allowed in href; views run no code")
  })

  test('ordinary URLs and attributes are fine', () => {
    for (const value of ['/a', 'https://x.example/', 'mailto:a@b.c', '#top', 'data:image/png;base64,AA==', 'notes/javascript:x']) {
      expect(attributeProblem('href', value)).toBeUndefined()
    }
    expect(attributeProblem('title', 'javascript:x')).toBeUndefined()
    expect(attributeProblem('class', 'p-4')).toBeUndefined()
  })
})

test('urlScheme reads the scheme like the URL parser: controls, spaces, tabs and newlines and case ignored', () => {
  expect(urlScheme('javascript:x')).toBe('javascript')
  expect(urlScheme('  \u0001JaVa\tScRi\npt:x')).toBe('javascript')
  expect(urlScheme('/relative')).toBeUndefined()
  expect(urlScheme('HTTPS://x')).toBe('https')
})
