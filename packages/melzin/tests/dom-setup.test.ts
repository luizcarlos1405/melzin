// Proves the happy-dom setup: DOM globals exist inside this file only (see helpers/dom.ts).
import { describe, expect, test } from 'bun:test'
import { useDom } from './helpers/dom.ts'

useDom()

describe('happy-dom', () => {
  test('document, DOMParser and events work', () => {
    const doc = new DOMParser().parseFromString(
      '<!doctype html><html><head><title>T</title><script type="melzin/schema">{"a":1}</script></head><body><p m-text="a"></p></body></html>',
      'text/html',
    )
    expect(doc.title).toBe('T')
    expect(doc.querySelector('script[type="melzin/schema"]')?.textContent).toBe('{"a":1}')
    const root = document.createElement('div')
    document.body.append(root)
    for (const node of doc.body.childNodes) root.append(document.importNode(node, true))
    const p = root.querySelector('p')!
    expect(p.getAttribute('m-text')).toBe('a')
    let clicks = 0
    p.addEventListener('click', () => clicks++)
    p.click()
    expect(clicks).toBe(1)
    expect(location.href).toBe('http://localhost:4321/')
  })
})
