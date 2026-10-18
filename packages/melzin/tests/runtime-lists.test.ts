// m-for in the runtime (SPEC D34): rows per item, keyed reconciliation that keeps each row's element,
// nested and leaf lists, bindings inside rows, empty states, broken lists, warnings and destroy.

import { afterEach, beforeEach, describe, expect, test } from 'bun:test'
import { mountSource } from '../src/runtime/index.ts'
import { useDom } from './helpers/dom.ts'
import { view } from './runtime-fixtures.ts'

useDom()

const SCHEMA = {
  data: {
    type: 'object',
    properties: {
      title: { type: 'string' },
      members: {
        type: 'array',
        key: 'handle',
        items: {
          type: 'object',
          properties: {
            handle: { type: 'string' },
            name: { type: 'string' },
            verified: { type: 'boolean' },
            role: { type: 'string', default: 'member' },
            url: { type: 'string', route: 'profile' },
            tags: { type: 'array', uniqueItems: true, items: { type: 'string' } },
          },
          required: ['handle', 'name'],
        },
      },
      tags: { type: 'array', uniqueItems: true, items: { type: 'string' } },
      scores: { type: 'array', uniqueItems: true, items: { type: 'number' } },
      polls: {
        type: 'array',
        key: 'id',
        items: {
          type: 'object',
          properties: {
            id: { type: 'number' },
            question: { type: 'string' },
            options: {
              type: 'array',
              key: 'id',
              items: { type: 'object', properties: { id: { type: 'string' }, label: { type: 'string' } }, required: ['id', 'label'] },
            },
          },
          required: ['id', 'question', 'options'],
        },
      },
    },
    required: ['members'],
  },
  events: { pick: { payload: { type: 'object', properties: { handle: { type: 'string' } }, required: ['handle'] } } },
}

type Member = { handle: string; name: string; verified?: boolean; role?: string; url?: string; tags?: string[] }
type Data = {
  title?: string
  members: Member[]
  tags?: string[]
  scores?: number[]
  polls?: { id: number; question: string; options: { id: string; label: string }[] }[]
}

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

function mountBody(body: string, data: Data, on: object = { pick() {} }) {
  return mountSource(root, view({ schema: SCHEMA, body }), { data, on, onWarning })
}

const member = (handle: string, name = handle.toUpperCase(), extra: Partial<Member> = {}): Member => ({ handle, name, ...extra })
const members = (...handles: string[]): Member[] => handles.map((handle) => member(handle))
const $ = (selector: string): HTMLElement => root.querySelector(selector) as HTMLElement
const all = (selector: string): HTMLElement[] => [...root.querySelectorAll<HTMLElement>(selector)]
const texts = (selector: string): string[] => all(selector).map((el) => el.textContent ?? '')
/** The kinds of a node's children: an element's tag, `#m-for` for a comment, `#text` for text. */
const children = (parent: Node): string[] =>
  [...parent.childNodes].map((node) => (node.nodeType === 8 ? `#${(node as Comment).data}` : node.nodeType === 3 ? '#text' : (node as Element).localName))

const LIST = '<ul><li m-for="member in members" m-text="member.name"></li></ul>'

describe('rows', () => {
  test('one per item, in data order, right after an anchor comment', () => {
    mountBody(LIST, { members: members('ana', 'bruno', 'carla') })
    expect(texts('li')).toEqual(['ANA', 'BRUNO', 'CARLA'])
    expect(children($('ul'))).toEqual(['#m-for', 'li', 'li', 'li'])
    // Rows drop m-for and keep their other directive attributes, like every bound element.
    expect($('li').hasAttribute('m-for')).toBe(false)
    expect($('li').getAttribute('m-text')).toBe('member.name')
    expect(warnings).toEqual([])
  })

  test('sit between the anchor and what follows it, at the top level too', () => {
    mountBody('<p id="before">B</p><span class="row" m-for="member in members" m-text="member.handle"></span><p id="after">A</p>', {
      members: members('ana', 'bruno'),
    })
    expect(children(root)).toEqual(['p', '#m-for', 'span', 'span', 'p'])
    expect(texts('.row')).toEqual(['ana', 'bruno'])
  })

  test('a row keeps its element when its item changes, and shows the current values', () => {
    const v = mountBody('<ul><li m-for="member in members"><b m-text="member.name"></b><i m-text="member.role"></i></li></ul>', {
      members: members('ana', 'bruno'),
    })
    const [ana, bruno] = all('li')
    v.update({ members: [member('ana', 'Ana Lima', { role: 'admin' }), member('bruno', 'Bruno')] })
    expect(all('li')).toEqual([ana!, bruno!])
    expect(texts('b')).toEqual(['Ana Lima', 'Bruno'])
    expect(texts('i')).toEqual(['admin', 'member'])
  })

  test('an update that changes nothing touches nothing', () => {
    const v = mountBody(LIST, { members: members('ana', 'bruno') })
    const observer = new MutationObserver(() => {})
    observer.observe(root, { childList: true, subtree: true, characterData: true, attributes: true })
    v.update({ members: members('ana', 'bruno') })
    expect(observer.takeRecords()).toEqual([])
    observer.disconnect()
  })

  test('reordering moves rows, as few as possible, and keeps each element', () => {
    const v = mountBody(LIST, { members: members('a', 'b', 'c', 'd') })
    const ul = $('ul')
    const before = new Map(all('li').map((li) => [li.textContent, li]))
    let inserts = 0
    const insertBefore = ul.insertBefore.bind(ul)
    ul.insertBefore = (<T extends Node>(node: T, child: Node | null): T => {
      inserts++
      return insertBefore(node, child)
    }) as typeof ul.insertBefore

    v.update({ members: members('b', 'c', 'd', 'a') })
    expect(texts('li')).toEqual(['B', 'C', 'D', 'A'])
    expect(inserts).toBe(1)
    // From b c d a: no two rows are in order any more, so three of the four move.
    v.update({ members: members('a', 'd', 'c', 'b') })
    expect(texts('li')).toEqual(['A', 'D', 'C', 'B'])
    expect(inserts).toBe(4)
    expect(all('li').every((li) => before.get(li.textContent) === li)).toBe(true)
    expect(children(ul)).toEqual(['#m-for', 'li', 'li', 'li', 'li'])
  })

  test('new keys get new rows, rows of keys that are gone go', () => {
    const v = mountBody(LIST, { members: members('ana', 'bruno', 'carla') })
    const [ana, , carla] = all('li')
    v.update({ members: members('dora', 'carla', 'ana', 'eva') })
    expect(texts('li')).toEqual(['DORA', 'CARLA', 'ANA', 'EVA'])
    expect(all('li')[1]).toBe(carla!)
    expect(all('li')[2]).toBe(ana!)
    v.update({ members: [] })
    expect(children($('ul'))).toEqual(['#m-for'])
    v.update({ members: members('ana') })
    expect(texts('li')).toEqual(['ANA'])
    expect($('li')).not.toBe(ana!)
  })

  test('a removed row loses its listeners', () => {
    const picked: unknown[] = []
    const v = mountBody(
      `<ul><li m-for="member in members"><button m-on:click="emit('pick', { handle: member.handle })">Pick</button></li></ul>`,
      { members: members('ana', 'bruno') },
      { pick: (payload: unknown) => picked.push(payload) },
    )
    const bruno = all('button')[1]!
    v.update({ members: members('ana') })
    expect(bruno.isConnected).toBe(false)
    bruno.click()
    expect(picked).toEqual([])
    $('button').click()
    expect(picked).toEqual([{ handle: 'ana' }])
  })

  test('with moveBefore, rows move without leaving the document; new rows are inserted', () => {
    const v = mountBody(LIST, { members: members('a', 'b', 'c') })
    const ul = $('ul') as HTMLElement & { moveBefore?: (node: Node, child: Node | null) => void }
    const moved: string[] = []
    let inserts = 0
    const insertBefore = ul.insertBefore.bind(ul)
    ul.insertBefore = (<T extends Node>(node: T, child: Node | null): T => {
      inserts++
      return insertBefore(node, child)
    }) as typeof ul.insertBefore
    ul.moveBefore = (node, child) => {
      moved.push(node.textContent ?? '')
      insertBefore(node, child)
    }
    v.update({ members: members('c', 'a', 'b', 'd') })
    expect(texts('li')).toEqual(['C', 'A', 'B', 'D'])
    expect(moved).toEqual(['C'])
    expect(inserts).toBe(1)

    // A move the browser refuses falls back to a plain insert.
    ul.moveBefore = () => {
      throw new DOMException('refused', 'HierarchyRequestError')
    }
    v.update({ members: members('a', 'b', 'd', 'c') })
    expect(texts('li')).toEqual(['A', 'B', 'D', 'C'])
    expect(inserts).toBe(2)
  })
})

describe('bindings in rows', () => {
  test('directives on the m-for element apply per row and see the alias', () => {
    const picked: unknown[] = []
    mountBody(
      `<a m-for="member in members" m-text="member.name" m-show="member.verified" m-bind:href="member.url" m-on:click="emit('pick', { handle: member.handle })"></a>`,
      { members: [member('ana', 'Ana', { verified: true, url: '/u/ana' }), member('bruno', 'Bruno')] },
      { pick: (payload: unknown) => picked.push(payload) },
    )
    const [ana, bruno] = all('a')
    expect([ana!.textContent, bruno!.textContent]).toEqual(['Ana', 'Bruno'])
    expect([ana!.style.display, bruno!.style.display]).toEqual(['', 'none'])
    expect([ana!.getAttribute('href'), bruno!.hasAttribute('href')]).toEqual(['/u/ana', false])
    bruno!.click()
    expect(picked).toEqual([{ handle: 'bruno' }])
    expect(warnings).toEqual([])
  })

  test("conditions inside a row test the row's item, and can still read the data", () => {
    const v = mountBody(
      `<ul><li m-for="member in members">
         <span class="badge" m-if="member.verified">Verified</span><span class="badge" m-else>New</span>
         <em m-show="title" m-text="title"></em>
       </li></ul>`,
      { members: [member('ana', 'Ana', { verified: true }), member('bruno')] },
    )
    expect(texts('.badge')).toEqual(['Verified', 'New'])
    expect(all('em').map((em) => em.style.display)).toEqual(['none', 'none'])
    const [ana, bruno] = all('li')
    v.update({ title: 'Team', members: [member('ana', 'Ana'), member('bruno', 'Bruno', { verified: true })] })
    expect(texts('.badge')).toEqual(['New', 'Verified'])
    expect(all('em').map((em) => [em.style.display, em.textContent])).toEqual([['', 'Team'], ['', 'Team']])
    expect(all('li')).toEqual([ana!, bruno!])
  })

  test('link fields inside items set each row\'s href, and script URLs never reach it', () => {
    const v = mountBody('<a m-for="member in members" m-bind:href="member.url" m-text="member.name"></a>', {
      members: [member('ana', 'Ana', { url: '/u/ana' }), member('bruno', 'Bruno', { url: 'javascript:alert(1)' })],
    })
    expect(all('a').map((a) => a.getAttribute('href'))).toEqual(['/u/ana', null])
    expect(warnings).toEqual(['m-bind:href="member.url": javascript: URLs aren\'t allowed in links; the link has no href'])
    v.update({ members: [member('ana', 'Ana'), member('bruno', 'Bruno', { url: '/u/bruno' })] })
    expect(all('a').map((a) => a.getAttribute('href'))).toEqual([null, '/u/bruno'])
  })

  test('a bad directive in a row warns once, not once per row', () => {
    mountBody('<ul><li m-for="member in members"><b m-text="member.nmae"></b><i v-text="member.name"></i></li></ul>', {
      members: members('ana', 'bruno', 'carla'),
    })
    expect(all('li')).toHaveLength(3)
    expect(warnings).toEqual([
      `<b m-text="member.nmae">: unknown field 'member.nmae' (did you mean 'member.name'?); skipped`,
      "<i>: 'v-text' is Vue/Alpine syntax; use m-text; ignored",
    ])
  })

  test('a list inside a hidden branch stays bound, rows included', () => {
    const v = mountBody('<section m-if="title"><ul><li m-for="member in members" m-text="member.name"></li></ul></section>', {
      members: members('ana'),
    })
    expect(root.querySelector('section')).toBeNull()
    v.update({ members: members('ana', 'bruno') })
    v.update({ title: 'Team', members: members('bruno', 'ana') })
    expect(texts('li')).toEqual(['BRUNO', 'ANA'])
  })
})

describe('lists of strings and numbers', () => {
  test('the alias is the value, and values are the keys', () => {
    const v = mountBody('<ul><li m-for="tag in tags" m-text="tag"></li></ul><p m-for="score in scores" m-text="score"></p>', {
      members: [],
      tags: ['design', 'code'],
      scores: [3, 1],
    })
    expect(texts('li')).toEqual(['design', 'code'])
    expect(texts('p')).toEqual(['3', '1'])
    const [design, code] = all('li')
    v.update({ members: [], tags: ['code', 'design', 'ops'], scores: [1, 3] })
    expect(texts('li')).toEqual(['code', 'design', 'ops'])
    expect(all('li').slice(0, 2)).toEqual([code!, design!])
    expect(texts('p')).toEqual(['1', '3'])
  })

  test('keys named like Object.prototype members are plain keys', () => {
    const v = mountBody('<ul><li m-for="tag in tags" m-text="tag"></li></ul>', { members: [], tags: ['__proto__', 'constructor', 'toString'] })
    expect(texts('li')).toEqual(['__proto__', 'constructor', 'toString'])
    const [proto, ctor, toString] = all('li')
    v.update({ members: [], tags: ['toString', '__proto__', 'constructor'] })
    expect(all('li')).toEqual([toString!, proto!, ctor!])
    expect(warnings).toEqual([])
  })
})

describe('nested lists', () => {
  const POLLS = `
    <section m-for="poll in polls">
      <h2 m-text="poll.question"></h2>
      <ul><li m-for="option in poll.options"><b m-text="option.label"></b><i m-text="poll.id"></i></li></ul>
    </section>`
  const polls = (...specs: [number, string[]][]): Data['polls'] =>
    specs.map(([id, labels]) => ({ id, question: `Q${id}`, options: labels.map((label) => ({ id: label.toLowerCase(), label })) }))

  test('rows of rows; keys are unique per list, so polls may reuse option ids', () => {
    const v = mountBody(POLLS, { members: [], polls: polls([1, ['Yes', 'No']], [2, ['No', 'Yes', 'Maybe']]) })
    expect(texts('h2')).toEqual(['Q1', 'Q2'])
    expect(all('section').map((section) => [...section.querySelectorAll('b')].map((b) => b.textContent))).toEqual([
      ['Yes', 'No'],
      ['No', 'Yes', 'Maybe'],
    ])
    expect(texts('i')).toEqual(['1', '1', '2', '2', '2'])
    expect(warnings).toEqual([])

    const [first, second] = all('section')
    const yes = second!.querySelectorAll('li')[1]
    v.update({ members: [], polls: polls([2, ['Yes', 'No']], [1, ['Yes', 'No']]) })
    expect(all('section')).toEqual([second!, first!])
    expect(second!.querySelectorAll('li')[0]).toBe(yes!)
    expect(texts('b')).toEqual(['Yes', 'No', 'Yes', 'No'])
    expect(texts('i')).toEqual(['2', '2', '1', '1'])
  })

  test("a nested list of an item's values", () => {
    const v = mountBody('<div m-for="member in members"><span m-for="tag in member.tags" m-text="tag"></span></div>', {
      members: [member('ana', 'Ana', { tags: ['a', 'b'] }), member('bruno')],
    })
    expect(all('div').map((div) => div.textContent)).toEqual(['ab', ''])
    expect(children(all('div')[1]!)).toEqual(['#m-for'])
    v.update({ members: [member('ana', 'Ana', { tags: ['b'] }), member('bruno', 'Bruno', { tags: ['c'] })] })
    expect(all('div').map((div) => div.textContent)).toEqual(['b', 'c'])
  })
})

describe('empty states', () => {
  test('.length tells an empty list from one with items', () => {
    const v = mountBody(
      `<ul id="list" m-if="members.length">
         <li m-for="member in members" m-text="member.name"></li>
       </ul>
       <p id="empty" m-else>No members yet</p>
       <b m-show="!tags.length">No tags</b>`,
      { members: [] },
    )
    expect(root.querySelector('#list')).toBeNull()
    expect($('#empty').textContent).toBe('No members yet')
    expect($('b').style.display).toBe('')
    v.update({ members: members('ana'), tags: ['x'] })
    expect(root.querySelector('#empty')).toBeNull()
    expect(texts('#list li')).toEqual(['ANA'])
    expect($('b').style.display).toBe('none')
    expect(warnings).toEqual([])
  })

  test('whitespace around an m-for goes, so a container that only holds the list is :empty', () => {
    const v = mountBody('<ul class="list">\n  <li m-for="member in members" m-text="member.name"></li>\n</ul>', { members: [] })
    expect(children($('ul'))).toEqual(['#m-for'])
    expect($('ul').matches(':empty')).toBe(true)
    v.update({ members: members('ana', 'bruno') })
    expect(children($('ul'))).toEqual(['#m-for', 'li', 'li'])
  })

  test('a missing optional list renders like an empty one', () => {
    const v = mountBody('<ul><li m-for="tag in tags" m-text="tag"></li></ul>', { members: [] })
    expect(children($('ul'))).toEqual(['#m-for'])
    v.update({ members: [], tags: ['a'] })
    expect(texts('li')).toEqual(['a'])
    v.update({ members: [] })
    expect(children($('ul'))).toEqual(['#m-for'])
    expect(warnings).toEqual([])
  })
})

describe('data that does not match', () => {
  test("a value that isn't a list shows no rows, with a data warning", () => {
    const v = mountBody(LIST, { members: 'ana' as never })
    expect(children($('ul'))).toEqual(['#m-for'])
    expect(warnings).toEqual(["data doesn't match the schema: members: expected a list, got string"])
    v.update({ members: members('ana') })
    expect(texts('li')).toEqual(['ANA'])
  })

  test('duplicate or missing keys warn, and rows follow the items by position for that render', () => {
    const v = mountBody(LIST, { members: members('ana', 'bruno') })
    const [first, second] = all('li')
    v.update({ members: [member('ana', 'Ana'), member('ana', 'Ana again'), { name: 'Nobody' } as Member] })
    expect(texts('li')).toEqual(['Ana', 'Ana again', 'Nobody'])
    expect(all('li').slice(0, 2)).toEqual([first!, second!])
    expect(warnings).toEqual([
      `data doesn't match the schema: members[1].handle: duplicate key "ana": members[0] has it too; keys must be unique in a list`,
      "data doesn't match the schema: members[2].handle: missing required field 'handle'",
    ])
    // Good keys again: a row is matched by its key where it has one.
    v.update({ members: members('bruno', 'ana') })
    expect(texts('li')).toEqual(['BRUNO', 'ANA'])
    expect(all('li')[1]).toBe(first!)
  })

  test('keys of the wrong type, or null items, also fall back to positions', () => {
    const v = mountBody('<ul><li m-for="tag in tags" m-text="tag"></li></ul>', { members: [], tags: ['a', 1 as never, null as never] })
    expect(texts('li')).toEqual(['a', '1', ''])
    expect(warnings).toEqual([
      "data doesn't match the schema: tags[1]: expected string, got number",
      "data doesn't match the schema: tags[2]: a list item can't be null; leave it out of the list",
    ])
    v.update({ members: [], tags: ['b', 'a'] })
    expect(texts('li')).toEqual(['b', 'a'])
  })
})

describe('broken lists', () => {
  const cases: [string, string, string][] = [
    ['of instead of in', '<li m-for="member of members"></li>', `<li m-for="member of members">: use 'in': m-for="member in members" (at column 8); shows no rows`],
    ['an index', '<li m-for="(member, i) in members"></li>', `<li m-for="(member, i) in members">: there's no index: style rows by position with Tailwind's first:, last:, odd: and nth-* variants, and identify them by the list's key (at column 1); shows no rows`],
    ['an unknown list', '<li m-for="member in membres"></li>', `<li m-for="member in membres">: unknown field 'membres' (did you mean 'members'?); shows no rows`],
    ['a field that is not a list', '<li m-for="t in title"></li>', `<li m-for="t in title">: 'title' is a string, not a list; m-for goes over a list field ("type": "array"); shows no rows`],
    ['an alias that is a data field', '<li m-for="title in members"></li>', `<li m-for="title in members">: 'title' is already a data field; pick another name, such as member; shows no rows`],
    ['m-if on the m-for element', '<li m-for="member in members" m-if="title"></li>', `<li m-for="member in members">: m-if can't go on an element with m-for: wrap the list in an element with m-if, or put the condition inside the row; to show only some items, have the host filter the list; shows no rows`],
  ]
  for (const [name, body, warning] of cases) {
    test(`${name}: warns once and shows no rows`, () => {
      const v = mountBody(`<ul>${body}</ul>`, { title: 'T', members: members('ana', 'bruno') })
      expect(children($('ul'))).toEqual(['#m-for'])
      v.update({ title: 'T', members: members('ana', 'bruno', 'carla') })
      expect(children($('ul'))).toEqual(['#m-for'])
      expect(warnings).toEqual([warning])
    })
  }

  test('an alias already in scope', () => {
    mountBody('<div m-for="member in members"><span m-for="member in member.tags"></span></div>', { members: [member('ana', 'Ana', { tags: ['a'] })] })
    expect(children($('div'))).toEqual(['#m-for'])
    expect(warnings).toEqual([
      `<span m-for="member in member.tags">: 'member' is already the item of the m-for over 'members' around this one; pick another name; shows no rows`,
    ])
  })

  test('an m-for element ends a chain', () => {
    mountBody('<p id="a" m-if="title">A</p><li m-for="member in members"></li><p id="b" m-else>B</p>', { members: members('ana') })
    expect(all('[id]').map((el) => el.id)).toEqual(['b'])
    expect(all('li')).toHaveLength(1)
    expect(warnings).toEqual(['<p m-else>: m-else must come right after an element with m-if or m-else-if; ignored'])
  })

  test('Vue and Alpine habits get their fixes', () => {
    mountBody(
      '<ul><li m-for="member in members" :key="member.handle" m-bind:key="member.handle"></li><li v-for="m in members"></li></ul><template m-for="member in members"><li></li></template>',
      { members: members('ana') },
    )
    expect(warnings).toEqual([
      `put m-for on the element to repeat; <template> isn't supported; dropped`,
      `<li>: ':key' is Vue/Alpine syntax; keys live in the schema: add "key": "<field>" to the list, such as "key": "id"; ignored`,
      `<li>: 'm-bind:key': keys live in the schema: add "key": "<field>" to the list, such as "key": "id"; ignored`,
      "<li>: 'v-for' is Vue/Alpine syntax; use m-for; ignored",
    ])
  })

  test('lists and counts where a value goes get the fix', () => {
    mountBody('<p m-text="members"></p><p m-text="members.length"></p><a m-bind:href="members.length"></a><p m-text="members.0.name"></p>', {
      members: members('ana'),
    })
    expect(warnings).toEqual([
      `<p m-text="members">: 'members' is a list; show its items with m-for; skipped`,
      `<p m-text="members.length">: 'members.length' counts the items, which only conditions can use (m-if, m-else-if, m-show); to show a count, have the host send it as its own field, such as memberCount; skipped`,
      `<a m-bind:href="members.length">: 'members.length' counts the items, which only conditions can use (m-if, m-else-if, m-show); to show a count, have the host send it as its own field, such as memberCount; skipped`,
      `<p m-text="members.0.name">: 'members.0' picks an item by position: a list's items are shown with m-for; for one particular item, have the host send it as its own field, such as featured (at column 9); skipped`,
    ])
  })
})

describe('destroy', () => {
  test('removes every row and its listeners, top-level lists included', () => {
    const existing = document.createElement('span')
    root.append(existing)
    const picked: unknown[] = []
    const v = mountBody(
      `<button class="row" m-for="member in members" m-on:click="emit('pick', { handle: member.handle })"></button>
       <ul><li m-for="tag in tags" m-text="tag"></li></ul>`,
      { members: members('ana', 'bruno'), tags: ['a'] },
      { pick: (payload: unknown) => picked.push(payload) },
    )
    const buttons = all('.row')
    expect(buttons).toHaveLength(2)
    v.destroy()
    expect([...root.childNodes]).toEqual([existing])
    for (const button of buttons) button.click()
    expect(picked).toEqual([])
  })
})
