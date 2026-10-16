// Gives a test file a browser-like DOM (happy-dom) for its duration only. Call useDom() at the top
// level of a DOM test file, BEFORE anything touches `document`; other test files keep a plain Bun
// environment because the globals are removed again in afterAll.
//
//   import { useDom } from './helpers/dom.ts'
//   useDom()
//
// Note: Bun runs test files one after another in one process, so per-file register/unregister is
// safe. Don't read `document`/`window` at module top level; do it inside tests or hooks.

import { GlobalRegistrator } from '@happy-dom/global-registrator'
import { afterAll, beforeAll } from 'bun:test'

export function useDom(url = 'http://localhost:4321/'): void {
  beforeAll(() => {
    if (!GlobalRegistrator.isRegistered) GlobalRegistrator.register({ url })
  })
  afterAll(async () => {
    if (GlobalRegistrator.isRegistered) await GlobalRegistrator.unregister()
  })
}
