// What a view's body may not contain, shared by the runtime and the checker so both apply the same
// rules. The runtime drops what would run code or change the host page (`drop: true`) and warns about
// the rest; the checker reports every rule as an error. Element and attribute names are expected as
// parsers give them: lowercase for HTML, case-adjusted for SVG (`attributeName`).

import { CLICK_DIRECTIVE, FOR_DIRECTIVE, TEMPLATE_FOR_MESSAGE } from './constants.ts'

export const HTML_NAMESPACE = 'http://www.w3.org/1999/xhtml'

/**
 * Why a view's markup can't be as written, shared by the runtime and the checker. `drop` tells the
 * runtime to take the element or attribute out before it reaches the host page; `warning` tells the
 * checker to report it as a warning rather than an error (the runtime warns either way).
 */
export type MarkupProblem = { message: string; drop: boolean; warning?: boolean }

const STYLING = 'styling is Tailwind classes only, with design tokens in theme.css'
const EMBEDDING = "views can't embed other documents"

/** Rules that apply whatever the namespace (SVG has its own <script> and <style>). */
const ANY_NAMESPACE: Readonly<Record<string, MarkupProblem>> = {
  script: { message: "<script> isn't allowed in the body; views have no scripts", drop: true },
  style: { message: `<style> isn't allowed; ${STYLING}`, drop: true },
}

const HTML_ONLY: Readonly<Record<string, MarkupProblem>> = {
  link: { message: `<link> isn't allowed; ${STYLING}`, drop: true },
  base: { message: "<base> isn't allowed; it would change how every relative URL in the host page resolves", drop: true },
  meta: { message: '<meta> belongs in <head>; in the body it would act on the host page', drop: true },
  title: { message: '<title> belongs in <head>', drop: true },
  iframe: { message: `<iframe> isn't allowed; ${EMBEDDING}`, drop: true },
  frame: { message: `<frame> isn't allowed; ${EMBEDDING}`, drop: true },
  frameset: { message: `<frameset> isn't allowed; ${EMBEDDING}`, drop: true },
  object: { message: `<object> isn't allowed; ${EMBEDDING}`, drop: true },
  embed: { message: `<embed> isn't allowed; ${EMBEDDING}`, drop: true },
  template: {
    message: `<template> isn't supported; to group elements, wrap them in one element, such as <div class="contents">`,
    drop: true,
  },
  form: {
    message: `<form> isn't supported yet; use <button type="button"> with ${CLICK_DIRECTIVE} instead`,
    drop: false,
  },
}

/** The loop directives a <template> may carry: Melzin's and the Vue and Alpine spellings. */
const TEMPLATE_LOOPS = [FOR_DIRECTIVE, 'v-for', 'x-for']

/**
 * Why an element can't be in a view's body, or undefined when it's fine. `attribute` reads one of
 * the element's attributes (null when missing). `insideForm` is true when the element sits inside a
 * kept <form>, where a button's default `type="submit"` would submit it.
 */
export function elementProblem(
  localName: string,
  namespace: string | null,
  attribute: (name: string) => string | null,
  insideForm = false,
): MarkupProblem | undefined {
  if (Object.hasOwn(ANY_NAMESPACE, localName)) return ANY_NAMESPACE[localName]
  if (namespace === HTML_NAMESPACE || namespace === null) {
    // Vue and Alpine repeat a <template>; Melzin repeats the element itself.
    if (localName === 'template' && TEMPLATE_LOOPS.some((name) => attribute(name) !== null)) {
      return { message: TEMPLATE_FOR_MESSAGE, drop: true }
    }
    if (insideForm && localName === 'button' && attribute('type') === null) {
      return {
        message: `<button> needs type="button"; the default type="submit" would submit a form in the host page`,
        drop: false,
        warning: true,
      }
    }
    return Object.hasOwn(HTML_ONLY, localName) ? HTML_ONLY[localName] : undefined
  }
  // SVG animation can rewrite a link's href after the fact (to a javascript: URL, say).
  if (localName === 'animate' || localName === 'set') {
    const target = (attribute('attributeName') ?? '').trim().toLowerCase()
    if (target === 'href' || target === 'xlink:href') {
      return { message: `SVG <${localName}> can't animate href; links in views are static`, drop: true }
    }
  }
  return undefined
}

/** Attributes that hold a URL the browser may navigate to or load. */
const URL_ATTRIBUTES = new Set(['href', 'xlink:href', 'src', 'action', 'formaction', 'poster', 'data', 'background'])
const SCRIPT_SCHEMES = new Set(['javascript', 'vbscript'])

/** The lowercased scheme of a URL as the browser's URL parser would read it, or undefined. */
export function urlScheme(value: string): string | undefined {
  // The URL parser strips leading and trailing C0 controls and spaces and ignores tabs and newlines.
  const cleaned = value.replace(/^[\u0000- ]+|[\u0000- ]+$/g, '').replace(/[\t\n\r]/g, '')
  return /^([A-Za-z][A-Za-z0-9+.-]*):/.exec(cleaned)?.[1]?.toLowerCase()
}

/** Schemes a link field's URL may not use (SPEC D23): they would run code or load a document, not navigate. */
const LINK_BLOCKED_SCHEMES = new Set([...SCRIPT_SCHEMES, 'data'])

/**
 * The scheme that keeps a link field's URL out of its link (`javascript`, `vbscript` or `data`), or
 * undefined when the URL may be the link's href. validateData reports it as a data issue; the runtime
 * leaves such a link without an href.
 */
export function blockedLinkScheme(url: string): string | undefined {
  const scheme = urlScheme(url)
  return scheme !== undefined && LINK_BLOCKED_SCHEMES.has(scheme) ? scheme : undefined
}

/** Why an attribute can't be in a view's body, or undefined when it's fine. `name` is the qualified name. */
export function attributeProblem(name: string, value: string): MarkupProblem | undefined {
  const lower = name.toLowerCase()
  if (lower.startsWith('on')) {
    return { message: `inline handler '${name}' isn't allowed; use ${CLICK_DIRECTIVE}="emit('name')"`, drop: true }
  }
  if (lower === 'style') return { message: `style attributes aren't allowed; ${STYLING}`, drop: false }
  if (lower === 'srcdoc') return { message: `srcdoc isn't allowed; ${EMBEDDING}`, drop: true }
  // Vue and Alpine attributes: a host page running either would run them on the mounted view.
  if (lower.startsWith('x-') || lower.startsWith('@') || lower.startsWith(':') || lower.startsWith('v-')) {
    return { message: `'${name}' is Vue/Alpine syntax; a host page running Vue or Alpine would run it`, drop: true }
  }
  if (URL_ATTRIBUTES.has(lower)) {
    const scheme = urlScheme(value)
    if (scheme !== undefined && SCRIPT_SCHEMES.has(scheme)) {
      return { message: `${scheme}: URLs aren't allowed in ${name}; views run no code`, drop: true }
    }
  }
  // Form attributes reach a form in the host page (or submit it), whatever their value.
  if (lower === 'form' || lower === 'formaction' || lower === 'formmethod' || lower === 'formtarget' || lower === 'formenctype') {
    return { message: `'${name}' would submit a form in the host page; views send events with ${CLICK_DIRECTIVE}="emit('name')"`, drop: true }
  }
  return undefined
}

/**
 * Whether a text node is only HTML whitespace (spaces, tabs and line breaks), which may sit between
 * the elements of an m-if chain. A no-break space is content, so it isn't.
 */
export function isInterElementWhitespace(text: string): boolean {
  return /^[ \t\n\f\r]*$/.test(text)
}

/** Elements with no content, so m-text has nothing to set. */
export const VOID_ELEMENTS: ReadonlySet<string> = new Set([
  'area', 'base', 'br', 'col', 'embed', 'hr', 'img', 'input', 'link', 'meta', 'source', 'track', 'wbr',
])
