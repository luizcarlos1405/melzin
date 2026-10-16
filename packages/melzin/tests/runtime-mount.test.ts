import { afterEach, beforeEach, describe, expect, spyOn, test } from 'bun:test'
import { mountSource } from '../src/runtime/index.ts'
import { useDom } from './helpers/dom.ts'
import { COUNTER, COUNTER_SCHEMA, PROFILE, view } from './runtime-fixtures.ts'

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

const text = (selector: string): string | null => root.querySelector(selector)?.textContent ?? null

describe('render', () => {
  test('top-level path', () => {
    const v = mountSource(root, COUNTER, { data: { count: 3 }, on: { increment() {} }, onWarning })
    expect(text('p')).toBe('3')
    expect(v.data).toEqual({ count: 3 })
    expect(v.schema).toEqual(COUNTER_SCHEMA as never)
    expect(warnings).toEqual([])
  })

  test('nested paths, booleans and numbers via String()', () => {
    mountSource(root, PROFILE, {
      data: { title: 'Team', user: { name: 'Ada', role: 'Engineer', bio: 'Hi', followers: 1234567, verified: false } },
      on: {},
      onWarning,
    })
    expect(text('h1')).toBe('Team')
    expect(text('h2')).toBe('Ada')
    expect(text('.bio')).toBe('Hi')
    expect(text('.followers')).toBe('1234567')
    expect(text('.verified')).toBe('false')
    expect(warnings).toEqual([])
  })

  test('missing values use the schema default, else empty text', () => {
    mountSource(root, PROFILE, { data: { user: { name: 'Ada', role: 'Engineer', followers: 0 } }, on: {}, onWarning })
    expect(text('h1')).toBe('Profile')
    expect(text('.bio')).toBe('')
    expect(text('.followers')).toBe('0')
    expect(text('.verified')).toBe('')
    expect(warnings).toEqual([])
  })

  test('null falls back to the default too (with a data warning)', () => {
    mountSource(root, PROFILE, { data: { title: null, user: { name: 'A', role: 'B', followers: 1 } }, on: {}, onWarning })
    expect(text('h1')).toBe('Profile')
    expect(warnings).toEqual(["data doesn't match the schema: title: expected string, got null"])
  })

  test('copies body children, keeps directive attributes, appends after existing content', () => {
    const existing = document.createElement('span')
    existing.textContent = 'host'
    root.append(existing)
    mountSource(root, COUNTER, { data: { count: 1 }, on: { increment() {} }, onWarning })
    expect(root.firstChild).toBe(existing)
    expect(root.querySelector('main')?.className).toBe('flex')
    expect(root.querySelector('p')?.getAttribute('m-text')).toBe('count')
    expect(root.querySelector('button')?.getAttribute('m-on:click')).toBe("emit('increment')")
    expect(root.querySelector('p')?.ownerDocument).toBe(document)
  })

  test('static view without a schema mounts with empty data', () => {
    const v = mountSource(root, view({ title: 'Hello', body: '<h1>Hello</h1><p>World</p>' }), { data: {}, on: {}, onWarning })
    expect(text('h1')).toBe('Hello')
    expect(v.schema).toEqual({})
    expect(warnings).toEqual([])
  })

  test('the runtime replaces sample content inside an m-text element', () => {
    const src = view({ schema: COUNTER_SCHEMA, body: `<p m-text="count">42</p><button m-on:click="emit('increment')"></button>` })
    mountSource(root, src, { data: { count: 7 }, on: { increment() {} }, onWarning })
    expect(text('p')).toBe('7')
  })

  test('text is set as text, never parsed as HTML', () => {
    mountSource(root, PROFILE, { data: { user: { name: '<img src=x onerror=alert(1)>', role: 'r', followers: 1 } }, on: {}, onWarning })
    expect(root.querySelector('h2')?.textContent).toBe('<img src=x onerror=alert(1)>')
    expect(root.querySelector('img')).toBeNull()
  })

  test('snapshots in the file are ignored by mountSource', () => {
    mountSource(root, COUNTER, { data: { count: 9 }, on: { increment() {} }, onWarning })
    expect(text('p')).toBe('9')
  })
})

describe('update', () => {
  test('writes only changed text and keeps every node', () => {
    const v = mountSource(root, PROFILE, {
      data: { user: { name: 'Ada', role: 'Engineer', followers: 1 } },
      on: {},
      onWarning,
    })
    const before = [...root.querySelectorAll('*')]
    const textNodesBefore = before.map((el) => el.firstChild)
    const observer = new MutationObserver(() => {})
    observer.observe(root, { childList: true, subtree: true, characterData: true, attributes: true })

    v.update({ user: { name: 'Ada', role: 'Engineer', followers: 2 } })
    expect(text('.followers')).toBe('2')
    expect(text('h2')).toBe('Ada')

    const records = observer.takeRecords()
    observer.disconnect()
    const touched = new Set(records.map((r) => (r.target.nodeType === 1 ? (r.target as Element) : r.target.parentElement)))
    expect([...touched]).toEqual([root.querySelector('.followers')])

    const after = [...root.querySelectorAll('*')]
    expect(after.length).toBe(before.length)
    after.forEach((el, i) => expect(el).toBe(before[i]!))
    // Unchanged bindings keep even their text nodes.
    expect(root.querySelector('h2')!.firstChild).toBe(textNodesBefore[before.indexOf(root.querySelector('h2')!)]!)
    expect(v.data).toEqual({ user: { name: 'Ada', role: 'Engineer', followers: 2 } })
    expect(warnings).toEqual([])
  })

  test('does not write when the value is the same, and counts textContent writes', () => {
    const v = mountSource(root, COUNTER, { data: { count: 1 }, on: { increment() {} }, onWarning })
    const p = root.querySelector('p')!
    const button = root.querySelector('button')!
    let writes = 0
    const proto = Object.getPrototypeOf(p)
    let owner = proto
    while (owner && !Object.getOwnPropertyDescriptor(owner, 'textContent')) owner = Object.getPrototypeOf(owner)
    const descriptor = Object.getOwnPropertyDescriptor(owner, 'textContent')!
    Object.defineProperty(p, 'textContent', {
      configurable: true,
      get() {
        return descriptor.get!.call(this)
      },
      set(value: string) {
        writes++
        descriptor.set!.call(this, value)
      },
    })
    v.update({ count: 1 })
    expect(writes).toBe(0)
    v.update({ count: 2 })
    expect(writes).toBe(1)
    expect(p.textContent).toBe('2')
    v.update({ count: 2 })
    expect(writes).toBe(1)
    expect(root.querySelector('p')).toBe(p)
    expect(root.querySelector('button')).toBe(button)
  })

  test('invalid data warns but still renders', () => {
    const v = mountSource(root, COUNTER, { data: { count: 1 }, on: { increment() {} }, onWarning })
    v.update({ count: 'many', extra: true } as never)
    expect(text('p')).toBe('many')
    expect(warnings).toEqual([
      "data doesn't match the schema: count: expected number, got string",
      "data doesn't match the schema: extra: unknown field 'extra'",
    ])
  })
})

describe('events', () => {
  test('click calls the handler with undefined', () => {
    const calls: unknown[][] = []
    mountSource(root, COUNTER, {
      data: { count: 0 },
      on: {
        increment: (...args: unknown[]) => {
          calls.push(args)
        },
      },
      onWarning,
    })
    root.querySelector('button')!.click()
    root.querySelector('button')!.click()
    expect(calls).toEqual([[undefined], [undefined]])
    expect(calls[0]!.length).toBe(1)
  })

  test('a handler can update the view (the counter from POC.md §7)', () => {
    let count = 0
    const v = mountSource(root, COUNTER, { data: { count }, on: { increment: () => v.update({ count: ++count }) }, onWarning })
    const button = root.querySelector('button')!
    button.click()
    button.click()
    expect(text('p')).toBe('2')
    expect(root.querySelector('button')).toBe(button)
  })

  test('missing handler warns at mount and on click', () => {
    mountSource(root, COUNTER, { data: { count: 0 }, on: {}, onWarning })
    expect(warnings).toEqual(["declared event 'increment' has no handler; add on.increment"])
    root.querySelector('button')!.click()
    expect(warnings[1]).toBe("no handler for event 'increment'; add on.increment")
  })

  test('handler key that is not a declared event warns (possible typo)', () => {
    mountSource(root, COUNTER, { data: { count: 0 }, on: { increment() {}, incremnt() {} }, onWarning })
    expect(warnings).toHaveLength(1)
    expect(warnings[0]).toContain("handler 'incremnt' doesn't match a declared event (possible typo)")
    expect(warnings[0]).toContain('increment')
  })

  test('non-function keys on the handlers object are not treated as handlers', () => {
    class Host {
      calls = 0
      increment() {
        this.calls++
      }
    }
    mountSource(root, COUNTER, { data: { count: 0 }, on: new Host(), onWarning })
    expect(warnings).toEqual([])
  })

  test('undeclared event used by m-on:click warns at mount', () => {
    const src = view({
      schema: COUNTER_SCHEMA,
      body: `<p m-text="count"></p><button m-on:click="emit('increment')"></button><button id="b" m-on:click="emit('reset')"></button>`,
    })
    const calls: string[] = []
    mountSource(root, src, { data: { count: 0 }, on: { increment: () => calls.push('inc') }, onWarning })
    expect(warnings).toEqual(["m-on:click emits 'reset', which isn't declared in the schema's events"])
    ;(root.querySelector('#b') as HTMLElement).click()
    expect(warnings[1]).toBe("no handler for event 'reset'; add on.reset")
    expect(calls).toEqual([])
  })
})

describe('directive warnings', () => {
  const schema = {
    data: { type: 'object', properties: { count: { type: 'number' }, user: { type: 'object', properties: { name: { type: 'string' } } } } },
    events: { go: {} },
  }
  const mountBody = (body: string) =>
    mountSource(root, view({ schema, body }), { data: { count: 1, user: { name: 'A' } }, on: { go() {} }, onWarning })

  test('invalid m-text is warned and skipped', () => {
    mountBody(`<p id="a" m-text="1count"></p><p id="b" m-text="emit('go')"></p><p id="c" m-text="count"></p>`)
    expect(warnings).toHaveLength(2)
    expect(warnings[0]).toStartWith(`<p m-text="1count">: `)
    expect(warnings[0]).toContain('skipped')
    expect(warnings[1]).toStartWith(`<p m-text="emit('go')">: m-text needs a path`)
    expect(text('#a')).toBe('')
    expect(text('#c')).toBe('1')
  })

  test('m-text with an unknown path or an object path is warned and skipped', () => {
    mountBody(`<p id="a" m-text="cout">x</p><p id="b" m-text="user"></p><p m-text="user.name"></p>`)
    expect(warnings).toEqual([
      `<p m-text="cout">: unknown field 'cout' (did you mean 'count'?); skipped`,
      `<p m-text="user">: 'user' is an object; m-text needs a string, number or boolean; skipped`,
    ])
    expect(text('#a')).toBe('x')
  })

  test('invalid m-on:click is warned and skipped', () => {
    mountBody(`<button id="a" m-on:click="$emit('go')"></button><button id="b" m-on:click="go()"></button>`)
    expect(warnings).toHaveLength(2)
    expect(warnings[0]).toContain("use emit('name') instead of Vue's $emit")
    expect(warnings[1]).toContain("only emit('name') is supported for now")
  })

  test('foreign and unsupported directives are warned and ignored', () => {
    mountBody(`<p v-text="count"></p><button @click="go"></button><a m-bind:href="url"></a><p m-if="count"></p><p :title="x"></p>`)
    expect(warnings).toEqual([
      "<p>: 'v-text' is Vue/Alpine syntax; use m-text; ignored",
      "<button>: '@click' is Vue/Alpine syntax; use m-on:click; ignored",
      "<a>: 'm-bind:href' is not supported yet; the POC supports only m-text and m-on:click; attributes and classes are static for now (docs/authoring.md §7); ignored",
      '<p>: \'m-if\' is not supported yet; the POC supports only m-text and m-on:click; to hide an element, bind it to a value that may be "" and add the class empty:hidden (docs/authoring.md §7); ignored',
      "<p>: ':title': Vue/Alpine syntax isn't supported; this POC has m-text and m-on:click; ignored",
    ])
  })

  test('invalid data at mount warns with the path', () => {
    mountSource(root, COUNTER, { data: { count: '3' } as never, on: { increment() {} }, onWarning })
    expect(warnings).toEqual(["data doesn't match the schema: count: expected number, got string"])
    mountSource(document.createElement('div'), COUNTER, { data: {} as never, on: { increment() {} }, onWarning })
    expect(warnings[1]).toBe("data doesn't match the schema: count: missing required field 'count'")
  })
})

describe('warnings channel', () => {
  test('onWarning receives the plain message and console.warn is not used', () => {
    const spy = spyOn(console, 'warn').mockImplementation(() => {})
    try {
      mountSource(root, COUNTER, { data: { count: 0 }, on: {}, onWarning })
      expect(warnings).toEqual(["declared event 'increment' has no handler; add on.increment"])
      expect(spy).not.toHaveBeenCalled()
    } finally {
      spy.mockRestore()
    }
  })

  test('without onWarning, console.warn gets a [melzin] prefix', () => {
    const spy = spyOn(console, 'warn').mockImplementation(() => {})
    try {
      mountSource(root, COUNTER, { data: { count: 0 }, on: {} })
      expect(spy).toHaveBeenCalledTimes(1)
      expect(spy).toHaveBeenCalledWith("[melzin] declared event 'increment' has no handler; add on.increment")
    } finally {
      spy.mockRestore()
    }
  })
})

describe('destroy', () => {
  test('removes nodes and listeners; later update warns and does nothing', () => {
    const existing = document.createElement('span')
    root.append(existing)
    let calls = 0
    const v = mountSource(root, COUNTER, { data: { count: 0 }, on: { increment: () => calls++ }, onWarning })
    const button = root.querySelector('button')!
    const p = root.querySelector('p')!
    v.destroy()
    expect([...root.childNodes]).toEqual([existing])
    button.click()
    expect(calls).toBe(0)
    v.update({ count: 5 })
    expect(warnings).toEqual(['update() called after destroy(); ignored'])
    expect(p.textContent).toBe('0')
    expect(v.data).toEqual({ count: 0 })
    v.destroy()
    expect(warnings).toHaveLength(1)
  })

  test('listeners are really removed (re-attached button does not fire)', () => {
    let calls = 0
    const v = mountSource(root, COUNTER, { data: { count: 0 }, on: { increment: () => calls++ }, onWarning })
    const button = root.querySelector('button')!
    v.destroy()
    root.append(button)
    button.click()
    expect(calls).toBe(0)
    expect(warnings).toEqual([])
  })

  test('two views in one element are independent', () => {
    const a = mountSource(root, COUNTER, { data: { count: 1 }, on: { increment() {} }, onWarning })
    const b = mountSource(root, COUNTER, { data: { count: 2 }, on: { increment() {} }, onWarning })
    expect([...root.querySelectorAll('p')].map((p) => p.textContent)).toEqual(['1', '2'])
    a.destroy()
    expect([...root.querySelectorAll('p')].map((p) => p.textContent)).toEqual(['2'])
    b.update({ count: 3 })
    expect(text('p')).toBe('3')
  })
})

describe('safety', () => {
  test('body scripts are dropped with a warning', () => {
    const src = view({ body: `<p id="x">hi</p><script>window.__ran = true</script><div><script src="/evil.js"></script></div>` })
    mountSource(root, src, { data: {}, on: {}, onWarning })
    expect(root.querySelector('script')).toBeNull()
    expect(text('#x')).toBe('hi')
    expect(warnings).toEqual([
      "<script> isn't allowed in the body; views have no scripts; dropped",
      "<script> isn't allowed in the body; views have no scripts; dropped",
    ])
    expect((window as unknown as { __ran?: boolean }).__ran).toBeUndefined()
  })

  test('inline on* handler attributes are removed with a warning', () => {
    mountSource(root, view({ body: `<button onclick="window.__clicked = true">x</button>` }), { data: {}, on: {}, onWarning })
    const button = root.querySelector('button')!
    expect(button.hasAttribute('onclick')).toBe(false)
    button.click()
    expect((window as unknown as { __clicked?: boolean }).__clicked).toBeUndefined()
    expect(warnings).toEqual([`<button>: inline handler 'onclick' isn't allowed; use m-on:click="emit('name')"; removed`])
  })

  test('paths never read the prototype chain', () => {
    const src = view({
      schema: { data: { type: 'object', properties: { constructor: { type: 'string' } } } },
      body: `<p m-text="constructor"></p>`,
    })
    mountSource(root, src, { data: {}, on: {}, onWarning })
    expect(text('p')).toBe('')
  })
})

describe('invalid schema throws', () => {
  test('invalid JSON', () => {
    expect(() => mountSource(root, view({ schema: '{ "data": ', body: '' }), { data: {}, on: {} })).toThrow(
      /melzin: the view has an invalid schema:\n {2}- schema: the melzin\/schema block isn't valid JSON/,
    )
    expect(root.childNodes.length).toBe(0)
  })

  test('schema outside the subset lists every issue', () => {
    const src = view({
      schema: { data: { type: 'object', properties: { items: { type: 'array' } } }, ui: {} },
      body: '<p></p>',
    })
    let message = ''
    try {
      mountSource(root, src, { data: {}, on: {} })
    } catch (error) {
      message = (error as Error).message
    }
    expect(message).toContain("internal state (ui) isn't supported yet; let the host send that state as data")
    expect(message).toContain("data.properties.items: lists aren't supported yet; use a fixed number of fields such as first, second, third")
    expect(root.childNodes.length).toBe(0)
  })

  test('duplicate schema blocks', () => {
    const src = view({ schema: {}, head: '<script type="melzin/schema">{}</script>', body: '' })
    expect(() => mountSource(root, src, { data: {}, on: {} })).toThrow(/only one <script type="melzin\/schema"> block/)
  })
})
