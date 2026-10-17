// What a view's body may not contain, shared by the runtime and the checker so both apply the same
// rules. The runtime drops what would run code or change the host page (`drop: true`) and warns about
// the rest; the checker reports every rule as an error. Element and attribute names are expected as
// parsers give them: lowercase for HTML, case-adjusted for SVG (`attributeName`).

import { CLICK_DIRECTIVE } from './constants.ts'

export const HTML_NAMESPACE = 'http://www.w3.org/1999/xhtml'

export type MarkupProblem = { message: string; drop: boolean }

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
    message: "<template> isn't supported; its content would never be bound. Write the markup directly",
    drop: true,
  },
  form: {
    message: `<form> isn't supported yet; use <button type="button"> with ${CLICK_DIRECTIVE} instead`,
    drop: false,
  },
}

/**
 * Why an element can't be in a view's body, or undefined when it's fine. `attribute` reads one of
 * the element's attributes (null when missing).
 */
export function elementProblem(
  localName: string,
  namespace: string | null,
  attribute: (name: string) => string | null,
): MarkupProblem | undefined {
  if (Object.hasOwn(ANY_NAMESPACE, localName)) return ANY_NAMESPACE[localName]
  if (namespace === HTML_NAMESPACE || namespace === null) {
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

/** Why an attribute can't be in a view's body, or undefined when it's fine. `name` is the qualified name. */
export function attributeProblem(name: string, value: string): MarkupProblem | undefined {
  const lower = name.toLowerCase()
  if (lower.startsWith('on')) {
    return { message: `inline handler '${name}' isn't allowed; use ${CLICK_DIRECTIVE}="emit('name')"`, drop: true }
  }
  if (lower === 'style') return { message: `style attributes aren't allowed; ${STYLING}`, drop: false }
  if (lower === 'srcdoc') return { message: `srcdoc isn't allowed; ${EMBEDDING}`, drop: true }
  if (URL_ATTRIBUTES.has(lower)) {
    const scheme = urlScheme(value)
    if (scheme !== undefined && SCRIPT_SCHEMES.has(scheme)) {
      return { message: `${scheme}: URLs aren't allowed in ${name}; views run no code`, drop: true }
    }
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
