// The checker's rules for attribute and class bindings (SPEC D37, POC.md §19).

import { beforeAll, describe, expect, test } from 'bun:test'
import { join } from 'node:path'
import { type Diagnostic, checkSource } from '../src/check.ts'
import { type ClassInfo, loadClassInfo } from '../src/classes.ts'

const SCHEMA = JSON.stringify({
  data: {
    type: 'object',
    properties: {
      label: { type: 'string' },
      count: { type: 'number' },
      open: { type: 'boolean' },
      status: { type: 'string' },
      tasks: {
        type: 'array',
        key: 'id',
        items: {
          type: 'object',
          properties: { id: { type: 'string' }, text: { type: 'string' }, done: { type: 'boolean' } },
          required: ['id', 'text', 'done'],
        },
      },
    },
    required: ['label', 'count', 'open', 'status', 'tasks'],
  },
})
const TASKS = [{ id: '1', text: 'a', done: true }, { id: '2', text: 'b', done: false }]
const SNAPSHOTS = JSON.stringify({
  one: { data: { label: 'x', count: 0, open: true, status: 'urgent', tasks: TASKS } },
  two: { data: { label: 'y', count: 2, open: false, status: 'low', tasks: [] } },
})

function page(body: string, snapshots = SNAPSHOTS): string {
  return `<!doctype html><html><head><title>T</title><script type="melzin/schema">${SCHEMA}</script><script type="melzin/snapshots">${snapshots}</script></head><body>${body}</body></html>`
}

let classInfo: ClassInfo
beforeAll(async () => {
  classInfo = (await loadClassInfo([join(import.meta.dir, '..', 'theme.css')]))!
})

function check(body: string, snapshots?: string): string[] {
  const all = checkSource(page(body, snapshots), undefined, undefined, classInfo)
  // The fields a test doesn't read would warn as never used; leave those out.
  return all.filter((d: Diagnostic) => !d.message.includes('is never used')).map((d) => `${d.severity}: ${d.message}`)
}

const USES_ALL = `<p m-text="label"></p><p m-text="count"></p><p m-if="open">o</p><p m-text="status"></p><ul m-if="tasks.length"><li m-for="task in tasks" m-text="task.text"></li></ul><p m-else>none</p>`

describe('m-bind:<attr>', () => {
  test('a view that binds aria-*, data-* and title right is clean', () => {
    const body = `<ul m-if="tasks.length"><li m-for="task in tasks" class="group/task data-done:line-through" m-bind:data-done="task.done" m-bind:title="task.text">
      <button type="button" m-bind:aria-pressed="task.done" class="aria-pressed:bg-emerald-600">x</button></li></ul><p m-else>none</p>
      <div role="img" m-bind:aria-label="label" m-bind:data-status="status" class="data-[status=urgent]:bg-red-100 data-[status=low]:bg-sky-100"></div>
      <p m-text="count"></p><p m-if="open">o</p>`
    expect(check(body)).toEqual([])
  })

  test('targets outside the allowlist are errors that name the fix', () => {
    expect(check(`${USES_ALL}<p m-bind:id="label"></p><p m-bind:style="label"></p><p m-bind:aria-labelledby="label"></p><img m-bind:src="label"><p m-bind:aria-lable="label"></p><my-card m-bind:title="label"></my-card>`)).toEqual([
      "error: m-bind:id: id names elements in the whole host page, so it can't come from data",
      `error: m-bind:style: styles never come from data (D9): switch classes with m-bind:class="{ 'classes': condition }"`,
      'error: m-bind:aria-labelledby: aria-labelledby names ids, which resolve against the whole host page; bind aria-label or aria-description to the text instead',
      'error: m-bind:src: src waits for image and URL field types (#11); for now show initials or an emoji with m-text',
      "error: m-bind:aria-lable: aria-lable isn't an ARIA attribute that holds a value; did you mean m-bind:aria-label?",
      'error: m-bind:title: attributes can\'t be bound on custom elements yet (<my-card>); there, m-bind will mean a component\'s props (D18)',
    ])
  })

  test('values are paths of the right type, without a static twin', () => {
    expect(check(`${USES_ALL}<button type="button" m-bind:aria-expanded="!open"></button><button type="button" m-bind:aria-pressed="count"></button><p title="x" m-bind:title="label"></p><p m-bind:title="tasks"></p>`)).toEqual([
      "error: m-bind:aria-expanded: m-bind:aria-expanded needs a path; '!' only works in conditions: style the opposite with not-aria-expanded: variants, or have the host send the negated field",
      'error: m-bind:aria-pressed: aria-pressed takes true, false or mixed: bind a boolean field (or a string one for mixed)',
      "error: an element with m-bind:title can't also have a static title; keep one (a fallback goes in the schema's default)",
      "error: m-bind:title: 'tasks' is a list; show its items with m-for",
    ])
  })

  test('static aria-* names get a did-you-mean', () => {
    expect(check(`${USES_ALL}<p aria-lable="x"></p><p aria-grabbed="true"></p>`)).toEqual([
      "error: aria-lable isn't an ARIA attribute; did you mean aria-label?",
      'warning: aria-grabbed is deprecated in WAI-ARIA 1.2',
    ])
  })
})

describe('data-* variants', () => {
  test('a variant on a name nothing sets, presence on a string, and =false on a boolean warn', () => {
    expect(check(`${USES_ALL}<p class="data-stauts:font-bold"></p><p m-bind:data-status="status" class="data-status:underline"></p><p m-bind:data-open="open" class="data-[open=false]:hidden"></p>`)).toEqual([
      "warning: 'data-stauts:font-bold' styles data-stauts, which nothing in the view sets; bind it with m-bind:data-stauts=\"path\", or check the name",
      `warning: 'data-status:underline' tests only that data-status is there, and a bound string or number always is (0 and "" included); test a value with data-[status=<value>]:, or bind a boolean`,
      "warning: 'data-[open=false]:hidden' never matches: a bound boolean removes data-open when false; style the false look with not-data-open:",
    ])
  })

  test('a value no snapshot sends warns', () => {
    expect(check(`${USES_ALL}<p m-bind:data-status="status" class="data-[status=done]:opacity-50"></p>`)).toEqual([
      `warning: no snapshot sends data-status="done" where it's bound, so 'data-[status=done]:opacity-50' is never seen; add one`,
    ])
  })
})

describe('m-bind:class', () => {
  test('a pair of exclusive keys is clean, and keys read rows and counts', () => {
    expect(check(`${USES_ALL}<p class="text-sm" m-bind:class="{ 'line-through text-zinc-400': open, 'text-zinc-900': !open }"></p><ul m-bind:class="{ 'border': tasks.length }"><li m-for="task in tasks" m-bind:class="{ 'opacity-50': task.done }"></li></ul>`)).toEqual([])
  })

  test('grammar errors name the object form', () => {
    const out = check(`${USES_ALL}<p m-bind:class="classes"></p><p m-bind:class="{ 'a': open, 'a': count }"></p><p m-bind:class="{ 'a': nope }"></p><p class="a" m-bind:class="{ 'a': open }"></p>`)
    expect(out[0]).toContain('class names are written in the file (literal keys), never built from data')
    expect(out[1]).toContain("'a' appears twice")
    expect(out[2]).toContain("unknown field 'nope'")
    expect(out[3]).toContain("'a' is also in class, so it stays on whatever its condition says")
  })

  test("a key that loses to a static class on the same property is an error with the pair to write", () => {
    expect(check(`${USES_ALL}<button type="button" class="bg-white" m-bind:class="{ 'bg-rose-600': open }">x</button>`)).toEqual([
      `error: m-bind:class: 'bg-rose-600' never applies: the static 'bg-white' also sets background-color and comes later in Tailwind's CSS (its order, not the class attribute's, decides); move 'bg-white' into the binding: { 'bg-rose-600': open, 'bg-white': !open }`,
    ])
  })

  test('one that wins only by order warns, with an m-show hint for display', () => {
    expect(check(`${USES_ALL}<p class="flex" m-bind:class="{ 'hidden': open }"></p>`)).toEqual([
      `warning: m-bind:class: 'hidden' and the static 'flex' both set display; 'hidden' wins only because of Tailwind's CSS order; put both looks in the binding: { 'hidden': open, 'flex': !open }; to hide or show the element, m-show beats any class`,
    ])
  })

  test('keys that can hold together and set one property warn', () => {
    expect(check(`${USES_ALL}<p m-bind:class="{ 'text-red-500': open, 'text-sky-500': tasks.length }"></p>`)).toEqual([
      "warning: m-bind:class: 'text-red-500' and 'text-sky-500' both set color and their conditions can hold together, so Tailwind's CSS order picks one; make the conditions exclusive (x and !x)",
    ])
  })
})

describe('coverage (P8)', () => {
  test('a key that is always on, or never, where its element shows warns', () => {
    const same = JSON.stringify({ one: { data: { label: 'x', count: 0, open: true, status: 'a', tasks: TASKS } } })
    expect(check(`${USES_ALL}<p m-bind:class="{ 'font-bold': open }"></p><p m-bind:data-open="open"></p>`, same).filter((m) => m.includes('every snapshot that shows'))).toEqual([
      "warning: 'font-bold' (m-bind:class) is on in every snapshot that shows its element; add one where it's off, to design that look",
      "warning: m-bind:data-open is on in every snapshot that shows its element; add one where it's off, to design that look",
    ])
  })

  test('an ARIA token no one defines warns', () => {
    expect(check(`${USES_ALL}<a href="/" m-bind:aria-current="status">x</a>`)).toEqual([
      "warning: m-bind:aria-current: a snapshot sends a value ARIA doesn't define: aria-current takes page, step, location, date, time, true, false, not 'urgent'",
    ])
  })
})
