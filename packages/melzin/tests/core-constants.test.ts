import { describe, expect, test } from 'bun:test'
import * as core from '../src/core/index.ts'
import { type DirectiveName, classifyAttribute, forChainMessage, isChainDirective, isIdent } from '../src/core/constants.ts'

const ONLY_HREF = '(m-bind:href is the only binding, for links)'
const CLASS_HINT = `classes and styles are static for now ${ONLY_HREF}; to switch styles, show one of two elements with m-if and m-else`
const NAME_HINT = `attributes are static for now ${ONLY_HREF}; for an accessible name from data, put sr-only text with m-text inside the element`
const ATTRIBUTE_HINT = `attributes are static for now ${ONLY_HREF}; to switch one, show one of two elements with m-if and m-else`

describe('constants', () => {
  test('identifiers', () => {
    for (const name of ['a', '_', 'A_1', 'camelCase']) expect(isIdent(name)).toBe(true)
    for (const name of ['', '1a', 'a-b', 'a.b', '$a', 'a b']) expect(isIdent(name)).toBe(false)
  })

  test('supported directives', () => {
    const names: DirectiveName[] = ['m-text', 'm-show', 'm-if', 'm-else-if', 'm-else', 'm-for', 'm-on:click']
    for (const name of names) {
      expect(classifyAttribute(name)).toEqual({ kind: 'directive', name })
    }
  })

  test('chain directives', () => {
    expect(['m-if', 'm-else-if', 'm-else'].every(isChainDirective)).toBe(true)
    expect(['m-show', 'm-text', 'm-on:click', 'm-elseif', 'v-if'].some(isChainDirective)).toBe(false)
  })

  test('Vue/Alpine spellings with a direct equivalent', () => {
    expect(classifyAttribute('v-text')).toEqual({ kind: 'foreign', suggestion: 'm-text', message: "'v-text' is Vue/Alpine syntax; use m-text" })
    expect(classifyAttribute('x-text')).toMatchObject({ kind: 'foreign', suggestion: 'm-text' })
    for (const name of ['v-on:click', '@click', 'x-on:click']) {
      expect(classifyAttribute(name)).toMatchObject({ kind: 'foreign', suggestion: 'm-on:click' })
    }
    const conditionals: Record<string, DirectiveName> = {
      'v-if': 'm-if',
      'x-if': 'm-if',
      'v-else-if': 'm-else-if',
      'v-else': 'm-else',
      'v-show': 'm-show',
      'x-show': 'm-show',
    }
    for (const [name, suggestion] of Object.entries(conditionals)) {
      expect(classifyAttribute(name)).toEqual({ kind: 'foreign', suggestion, message: `'${name}' is Vue/Alpine syntax; use ${suggestion}` })
    }
  })

  test('other Vue/Alpine syntax', () => {
    for (const name of ['x-data', 'x-init', 'v-cloak']) {
      expect(classifyAttribute(name)).toEqual({
        kind: 'foreign',
        message: `'${name}': Vue/Alpine syntax isn't supported; Melzin has m-text, m-show, m-if, m-else-if, m-else, m-for, m-on:click and m-bind:href`,
      })
    }
    // Spellings of directives Melzin doesn't have get the same hint as their m-* spelling (docs/authoring.md §7).
    const hints: Record<string, string> = {
      ':class': CLASS_HINT,
      'v-bind:class': CLASS_HINT,
      'x-bind:class': CLASS_HINT,
      ':style': CLASS_HINT,
      ':class.prop': CLASS_HINT,
      ':title': NAME_HINT,
      ':aria-label': NAME_HINT,
      'v-bind:aria-describedby': NAME_HINT,
      ':src': ATTRIBUTE_HINT,
      'v-bind': ATTRIBUTE_HINT,
      '@submit': 'only clicks for now: m-on:click',
      'v-on:submit': 'only clicks for now: m-on:click',
      'v-model': "forms and inputs aren't supported yet",
      'x-html': 'only plain text, through m-text',
    }
    for (const [name, hint] of Object.entries(hints)) {
      expect(classifyAttribute(name)).toEqual({ kind: 'foreign', message: `'${name}' is Vue/Alpine syntax; ${hint} (docs/authoring.md §7)` })
    }
    for (const name of [':href', 'v-bind:href', 'x-bind:href']) {
      expect(classifyAttribute(name)).toEqual({ kind: 'foreign', suggestion: 'm-bind:href', message: `'${name}' is Vue/Alpine syntax; use m-bind:href` })
    }
  })

  test('unsupported m-* directives', () => {
    const hints: Record<string, string> = {
      'm-bind:class': CLASS_HINT,
      'm-class': CLASS_HINT,
      'm-style': CLASS_HINT,
      'm-bind:title': NAME_HINT,
      'm-bind:aria-label': NAME_HINT,
      'm-bind:src': ATTRIBUTE_HINT,
      'm-bind': ATTRIBUTE_HINT,
      'm-on:submit': 'only clicks for now: m-on:click',
      'm-model': "forms and inputs aren't supported yet",
    }
    const supported = 'm-text, m-show, m-if, m-else-if, m-else, m-for, m-on:click and m-bind:href'
    for (const [name, hint] of Object.entries(hints)) {
      expect(classifyAttribute(name)).toEqual({
        kind: 'unsupported',
        message: `'${name}' is not supported yet; Melzin supports only ${supported}; ${hint} (docs/authoring.md §7)`,
      })
    }
    expect(classifyAttribute('m-foo')).toEqual({
      kind: 'unsupported',
      message: `'m-foo' is not supported yet; Melzin supports only ${supported} (docs/authoring.md §7)`,
    })
    // Not spellings of the supported ones.
    for (const name of ['m-elseif', 'm-else:if', 'm-showif']) expect(classifyAttribute(name)).toMatchObject({ kind: 'unsupported' })
  })

  test('lists: v-for and x-for map to m-for; keys live in the schema (D34)', () => {
    expect(classifyAttribute('m-for')).toEqual({ kind: 'directive', name: 'm-for' })
    expect(classifyAttribute('v-for')).toEqual({ kind: 'foreign', suggestion: 'm-for', message: "'v-for' is Vue/Alpine syntax; use m-for" })
    expect(classifyAttribute('x-for')).toEqual({
      kind: 'foreign',
      suggestion: 'm-for',
      message: "'x-for' is Vue/Alpine syntax; use m-for on the element to repeat (<template> isn't supported)",
    })
    const keys = 'keys live in the schema: add "key": "<field>" to the list, such as "key": "id"'
    expect(classifyAttribute('m-bind:key')).toEqual({ kind: 'unsupported', message: `'m-bind:key': ${keys}` })
    expect(classifyAttribute('m-key')).toEqual({ kind: 'unsupported', message: `'m-key': ${keys}` })
    for (const name of [':key', 'v-bind:key', 'x-bind:key']) {
      expect(classifyAttribute(name)).toEqual({ kind: 'foreign', message: `'${name}' is Vue/Alpine syntax; ${keys}` })
    }
    // Other bindings keep their message.
    expect(classifyAttribute('m-bind:id')).toMatchObject({ kind: 'unsupported', message: expect.stringContaining(ATTRIBUTE_HINT) })
    expect(forChainMessage('m-if')).toBe(
      "m-if can't go on an element with m-for: wrap the list in an element with m-if, or put the condition inside the row; to show only some items, have the host filter the list",
    )
  })

  test('attribute names are never looked up on Object.prototype', () => {
    for (const name of ['constructor', 'tostring', '__proto__', 'hasownproperty']) expect(classifyAttribute(name)).toEqual({ kind: 'plain' })
  })

  test('plain attributes', () => {
    expect(classifyAttribute('m-bind:href')).toEqual({ kind: 'directive', name: 'm-bind:href' })
    for (const name of ['class', 'id', 'data-x', 'aria-label', 'href', 'mtext']) {
      expect(classifyAttribute(name)).toEqual({ kind: 'plain' })
    }
  })

  test('the core barrel exports everything', () => {
    for (const name of [
      'parseExpression', 'parseTextDirective', 'parseClickDirective', 'parseConditionDirective', 'validateSchema',
      'validateData', 'resolvePath', 'resolveField', 'leafPaths', 'defaultAt', 'valueAt', 'valueOrDefault',
      'conditionHolds', 'parseSnapshots', 'classifyAttribute', 'isInterElementWhitespace', 'SCHEMA_BLOCK_TYPE',
      'SNAPSHOTS_BLOCK_TYPE', 'IDENT_RE', 'parseHrefDirective', 'readPath', 'validateRouteTable', 'matchRoute',
      'buildUrl', 'parseRouteRef', 'routeValue', 'validateRouteInput', 'ROUTES_FILE', 'ROUTE_INPUT',
      'FOR_DIRECTIVE', 'parseForDirective', 'resolveList', 'withAlias', 'fieldPathOf', 'LIST_ITEMS', 'formatFieldPath',
      'schemaPathOf', 'indexPath', 'schemaFields', 'itemKey', 'valuesAt', 'payloadIssues', 'buildPayload',
      'resolvePayloadValue', 'forChainMessage', 'positionMessage', 'KEY_BINDING_MESSAGE', 'TEMPLATE_FOR_MESSAGE',
    ]) {
      expect(core).toHaveProperty(name)
    }
  })
})
