// Proves that useDom() cleans up after itself, so DOM globals never leak into non-DOM tests.
import { describe, expect, test } from 'bun:test'
import { useDom } from './helpers/dom.ts'

const hasDocument = () => typeof (globalThis as { document?: unknown }).document !== 'undefined'

test('no DOM before useDom', () => {
  expect(hasDocument()).toBe(false)
})

describe('inside useDom', () => {
  useDom()
  test('DOM globals exist', () => {
    expect(hasDocument()).toBe(true)
    expect(typeof DOMParser).toBe('function')
  })
})

test('DOM globals are removed afterwards', () => {
  expect(hasDocument()).toBe(false)
  expect(typeof (globalThis as { DOMParser?: unknown }).DOMParser).toBe('undefined')
})
