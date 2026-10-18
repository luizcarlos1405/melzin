import { describe, expect, test } from 'bun:test'
import * as core from '../src/core/index.ts'
import { type DirectiveName, classifyAttribute, isChainDirective, isIdent } from '../src/core/constants.ts'

describe('constants', () => {
  test('identifiers', () => {
    for (const name of ['a', '_', 'A_1', 'camelCase']) expect(isIdent(name)).toBe(true)
    for (const name of ['', '1a', 'a-b', 'a.b', '$a', 'a b']) expect(isIdent(name)).toBe(false)
  })

  test('supported directives', () => {
    const names: DirectiveName[] = ['m-text', 'm-show', 'm-if', 'm-else-if', 'm-else', 'm-on:click']
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
    for (const name of ['v-for', 'x-data', '@submit', ':title', 'v-bind:class']) {
      expect(classifyAttribute(name)).toEqual({
        kind: 'foreign',
        message: `'${name}': Vue/Alpine syntax isn't supported; Melzin has m-text, m-show, m-if, m-else-if, m-else, m-on:click and m-bind:href`,
      })
    }
    for (const name of [':href', 'v-bind:href', 'x-bind:href']) {
      expect(classifyAttribute(name)).toEqual({ kind: 'foreign', suggestion: 'm-bind:href', message: `'${name}' is Vue/Alpine syntax; use m-bind:href` })
    }
  })

  test('unsupported m-* directives', () => {
    const hints: Record<string, string> = {
      'm-bind:title': 'other attributes and classes are static for now (m-bind:href is the only binding, for links); to switch styles, show one of two elements with m-if and m-else',
      'm-on:submit': 'only clicks for now: m-on:click',
      'm-for': 'lists come later; use a fixed number of fields such as first, second, third, with m-if on the optional ones',
      'm-model': "forms and inputs aren't supported yet",
    }
    const supported = 'm-text, m-show, m-if, m-else-if, m-else, m-on:click and m-bind:href'
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
    ]) {
      expect(core).toHaveProperty(name)
    }
  })
})
