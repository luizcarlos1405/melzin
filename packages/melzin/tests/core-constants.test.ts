import { describe, expect, test } from 'bun:test'
import * as core from '../src/core/index.ts'
import { classifyAttribute, isIdent } from '../src/core/constants.ts'

describe('constants', () => {
  test('identifiers', () => {
    for (const name of ['a', '_', 'A_1', 'camelCase']) expect(isIdent(name)).toBe(true)
    for (const name of ['', '1a', 'a-b', 'a.b', '$a', 'a b']) expect(isIdent(name)).toBe(false)
  })

  test('supported directives', () => {
    expect(classifyAttribute('m-text')).toEqual({ kind: 'directive', name: 'm-text' })
    expect(classifyAttribute('m-on:click')).toEqual({ kind: 'directive', name: 'm-on:click' })
  })

  test('Vue/Alpine spellings with a direct equivalent', () => {
    expect(classifyAttribute('v-text')).toEqual({ kind: 'foreign', suggestion: 'm-text', message: "'v-text' is Vue/Alpine syntax; use m-text" })
    expect(classifyAttribute('x-text')).toMatchObject({ kind: 'foreign', suggestion: 'm-text' })
    for (const name of ['v-on:click', '@click', 'x-on:click']) {
      expect(classifyAttribute(name)).toMatchObject({ kind: 'foreign', suggestion: 'm-on:click' })
    }
  })

  test('other Vue/Alpine syntax', () => {
    for (const name of ['v-if', 'x-show', '@submit', ':href', 'v-bind:class']) {
      expect(classifyAttribute(name)).toEqual({
        kind: 'foreign',
        message: `'${name}': Vue/Alpine syntax isn't supported; this POC has m-text and m-on:click`,
      })
    }
  })

  test('unsupported m-* directives', () => {
    const hints: Record<string, string> = {
      'm-if': 'to hide an element, bind it to a value that may be "" and add the class empty:hidden',
      'm-bind:href': 'attributes and classes are static for now',
      'm-on:submit': 'only clicks for now: m-on:click',
      'm-for': 'lists come later; use a fixed number of fields such as first, second, third',
      'm-model': "forms and inputs aren't supported yet",
    }
    for (const [name, hint] of Object.entries(hints)) {
      expect(classifyAttribute(name)).toEqual({
        kind: 'unsupported',
        message: `'${name}' is not supported yet; the POC supports only m-text and m-on:click; ${hint} (docs/authoring.md §7)`,
      })
    }
    expect(classifyAttribute('m-foo')).toEqual({
      kind: 'unsupported',
      message: "'m-foo' is not supported yet; the POC supports only m-text and m-on:click (docs/authoring.md §7)",
    })
  })

  test('plain attributes', () => {
    for (const name of ['class', 'id', 'data-x', 'aria-label', 'href', 'mtext']) {
      expect(classifyAttribute(name)).toEqual({ kind: 'plain' })
    }
  })

  test('the core barrel exports everything', () => {
    for (const name of [
      'parseExpression', 'parseTextDirective', 'parseClickDirective', 'validateSchema', 'validateData',
      'resolvePath', 'leafPaths', 'defaultAt', 'parseSnapshots', 'classifyAttribute', 'SCHEMA_BLOCK_TYPE',
      'SNAPSHOTS_BLOCK_TYPE', 'IDENT_RE',
    ]) {
      expect(core).toHaveProperty(name)
    }
  })
})
