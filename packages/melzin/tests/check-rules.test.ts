// One fixture per checker rule (tests/fixtures/check). Positions are computed from the fixture text, so
// each expectation also says which character the diagnostic must point at.

import { describe, expect, test } from 'bun:test'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { type Diagnostic, type Severity, checkFiles } from '../src/cli/check.ts'

const dir = join(import.meta.dir, 'fixtures/check')

/** 1-based line/col of the `nth` occurrence of `needle` in a fixture, plus `shift` characters. */
function pos(file: string, needle: string, shift = 0, nth = 0): { line: number; col: number } {
  const source = readFileSync(join(dir, file), 'utf8')
  let index = -1
  for (let i = 0; i <= nth; i++) {
    index = source.indexOf(needle, index + 1)
    if (index < 0) throw new Error(`${needle} not found in ${file}`)
  }
  const offset = index + shift
  const before = source.slice(0, offset)
  const line = before.split('\n').length
  return { line, col: offset - before.lastIndexOf('\n') }
}

async function diagnosticsOf(file: string): Promise<Diagnostic[]> {
  const result = await checkFiles([file], { cwd: dir })
  expect(result.files[0]?.file).toBe(file)
  return result.files[0]?.diagnostics ?? []
}

type Case = { file: string; severity: Severity; message: string; at: { line: number; col: number } }

const errors: Case[] = [
  {
    file: 'wrong-name.html',
    severity: 'error',
    message: "view files must be named *.melzin.html (got 'wrong-name.html')",
    at: { line: 1, col: 1 },
  },
  {
    file: 'invalid-json-schema.melzin.html',
    severity: 'error',
    message: "invalid JSON in the melzin/schema block: trailing commas aren't allowed in JSON",
    at: pos('invalid-json-schema.melzin.html', ', }', 2),
  },
  {
    file: 'invalid-json-snapshots.melzin.html',
    severity: 'error',
    message: 'invalid JSON in the melzin/snapshots block: JSON strings need double quotes',
    at: pos('invalid-json-snapshots.melzin.html', "'zero'"),
  },
  {
    file: 'duplicate-schema.melzin.html',
    severity: 'error',
    message: 'duplicate melzin/schema block; a view has at most one',
    at: pos('duplicate-schema.melzin.html', '<script type="melzin/schema">', 0, 1),
  },
  {
    file: 'schema-issue.melzin.html',
    severity: 'error',
    message: "schema data.properties.tags: lists aren't supported yet; use a fixed number of fields such as first, second, third",
    at: pos('schema-issue.melzin.html', '"tags"'),
  },
  {
    file: 'snapshot-issue.melzin.html',
    severity: 'error',
    message: 'snapshots["a few clicks"].data.count: expected number, got string',
    at: pos('snapshot-issue.melzin.html', '"count": "3"'),
  },
  {
    file: 'head-link.melzin.html',
    severity: 'error',
    message:
      "<link> isn't allowed in <head>; it may only hold <title>, <meta> and the melzin/schema and melzin/snapshots blocks (styling is Tailwind classes only)",
    at: pos('head-link.melzin.html', '<link'),
  },
  {
    file: 'head-script.melzin.html',
    severity: 'error',
    message: "<script> isn't allowed in <head>; views have no scripts, only the melzin/schema and melzin/snapshots data blocks",
    at: pos('head-script.melzin.html', '<script src'),
  },
  {
    file: 'head-div.melzin.html',
    severity: 'error',
    message: "<div> isn't allowed in <head>; it may only hold <title>, <meta> and the melzin/schema and melzin/snapshots blocks",
    at: pos('head-div.melzin.html', '<div>'),
  },
  {
    file: 'body-script.melzin.html',
    severity: 'error',
    message: "<script> isn't allowed in the body; views have no scripts",
    at: pos('body-script.melzin.html', '<script>console'),
  },
  {
    file: 'foreign-v-text.melzin.html',
    severity: 'error',
    message: "'v-text' is Vue/Alpine syntax; use m-text",
    at: pos('foreign-v-text.melzin.html', 'v-text'),
  },
  {
    file: 'foreign-click.melzin.html',
    severity: 'error',
    message: "'@click' is Vue/Alpine syntax; use m-on:click",
    at: pos('foreign-click.melzin.html', '@click'),
  },
  {
    file: 'foreign-other.melzin.html',
    severity: 'error',
    message: "':class': Vue/Alpine syntax isn't supported; this POC has m-text and m-on:click",
    at: pos('foreign-other.melzin.html', ':class'),
  },
  {
    file: 'unsupported-directive.melzin.html',
    severity: 'error',
    message: '\'m-if\' is not supported yet; the POC supports only m-text and m-on:click; to hide an element, bind it to a value that may be "" and add the class empty:hidden (docs/authoring.md §7)',
    at: pos('unsupported-directive.melzin.html', 'm-if'),
  },
  {
    file: 'text-parse-error.melzin.html',
    severity: 'error',
    message: "m-text: expected a name after '.', found '.'",
    // the second dot of count..x
    at: pos('text-parse-error.melzin.html', 'count..x', 6),
  },
  {
    file: 'text-unknown-path.melzin.html',
    severity: 'error',
    message: "m-text: unknown field 'cuont' (did you mean 'count'?)",
    at: pos('text-unknown-path.melzin.html', 'cuont'),
  },
  {
    file: 'text-object-path.melzin.html',
    severity: 'error',
    message: "m-text: 'user' is an object; m-text needs a string, number or boolean",
    at: pos('text-object-path.melzin.html', 'm-text="user"', 8),
  },
  {
    file: 'text-child-elements.melzin.html',
    severity: 'error',
    message: "an m-text element can't contain elements; the runtime replaces its content",
    at: pos('text-child-elements.melzin.html', '<span>'),
  },
  {
    file: 'click-parse-error.melzin.html',
    severity: 'error',
    message: "m-on:click: expected a string, found 'increment' (quote it: 'increment')",
    at: pos('click-parse-error.melzin.html', 'emit(increment)', 5),
  },
  {
    file: 'click-dollar-emit.melzin.html',
    severity: 'error',
    message: "m-on:click: use emit('name') instead of Vue's $emit",
    at: pos('click-dollar-emit.melzin.html', '$emit'),
  },
  {
    file: 'click-undeclared.melzin.html',
    severity: 'error',
    message: "m-on:click: event 'incremnt' isn't declared in the schema's events (did you mean 'increment'?)",
    at: pos('click-undeclared.melzin.html', 'incremnt'),
  },  // Body markup: the same rules the runtime applies (src/core/markup.ts).
  {
    file: 'body-style.melzin.html',
    severity: 'error',
    message: "<style> isn't allowed; styling is Tailwind classes only, with design tokens in theme.css",
    at: pos('body-style.melzin.html', '<style>'),
  },
  {
    file: 'body-link.melzin.html',
    severity: 'error',
    message: "<link> isn't allowed; styling is Tailwind classes only, with design tokens in theme.css",
    at: pos('body-link.melzin.html', '<link'),
  },
  {
    file: 'body-base.melzin.html',
    severity: 'error',
    message: "<base> isn't allowed; it would change how every relative URL in the host page resolves",
    at: pos('body-base.melzin.html', '<base'),
  },
  {
    file: 'body-meta.melzin.html',
    severity: 'error',
    message: '<meta> belongs in <head>; in the body it would act on the host page',
    at: pos('body-meta.melzin.html', '<meta http-equiv'),
  },
  {
    file: 'body-iframe.melzin.html',
    severity: 'error',
    message: "<iframe> isn't allowed; views can't embed other documents",
    at: pos('body-iframe.melzin.html', '<iframe'),
  },
  {
    file: 'body-template.melzin.html',
    severity: 'error',
    message: "<template> isn't supported; its content would never be bound. Write the markup directly",
    at: pos('body-template.melzin.html', '<template>'),
  },
  {
    file: 'body-form.melzin.html',
    severity: 'error',
    message: '<form> isn\'t supported yet; use <button type="button"> with m-on:click instead',
    at: pos('body-form.melzin.html', '<form>'),
  },
  {
    file: 'inline-handler.melzin.html',
    severity: 'error',
    message: "inline handler 'onclick' isn't allowed; use m-on:click=\"emit('name')\"",
    at: pos('inline-handler.melzin.html', 'onclick'),
  },
  {
    file: 'style-attribute.melzin.html',
    severity: 'error',
    message: "style attributes aren't allowed; styling is Tailwind classes only, with design tokens in theme.css",
    at: pos('style-attribute.melzin.html', 'style="'),
  },
  {
    file: 'javascript-url.melzin.html',
    severity: 'error',
    message: "javascript: URLs aren't allowed in href; views run no code",
    at: pos('javascript-url.melzin.html', 'href='),
  },
  {
    file: 'srcdoc-attribute.melzin.html',
    severity: 'error',
    message: "srcdoc isn't allowed; views can't embed other documents",
    at: pos('srcdoc-attribute.melzin.html', 'srcdoc'),
  },
  {
    file: 'text-void-element.melzin.html',
    severity: 'error',
    message: "m-text can't go on <input>: it has no content to set; use an element such as <span>",
    at: pos('text-void-element.melzin.html', '<input'),
  },
]

const warnings: Case[] = [
  {
    file: 'body-attributes.melzin.html',
    severity: 'warning',
    message: "<body> takes no attributes ('class'); put classes on an element inside it",
    at: pos('body-attributes.melzin.html', 'class="bg-zinc-50"'),
  },
  {
    file: 'missing-title.melzin.html',
    severity: 'warning',
    message: 'missing <title>; the title names the view in the shell',
    at: pos('missing-title.melzin.html', '<head>'),
  },
  {
    file: 'text-content.melzin.html',
    severity: 'warning',
    message: 'm-text elements should be empty; sample text belongs in snapshots',
    at: pos('text-content.melzin.html', '42'),
  },
  {
    file: 'event-never-emitted.melzin.html',
    severity: 'warning',
    message: "event 'increment' is declared but nothing emits it",
    at: pos('event-never-emitted.melzin.html', '"increment"'),
  },
  {
    file: 'leaf-never-displayed.melzin.html',
    severity: 'warning',
    message: "data field 'count' is never displayed",
    at: pos('leaf-never-displayed.melzin.html', '"count": { "type"'),
  },
  {
    file: 'no-snapshots.melzin.html',
    severity: 'warning',
    message: 'the view has data fields but no snapshots; add a melzin/snapshots block with sample states, awkward ones included (very long text, zero, huge numbers)',
    at: pos('no-snapshots.melzin.html', '<script type="melzin/schema">'),
  },  {
    file: 'mustache.melzin.html',
    severity: 'warning',
    message: "'{{ count }}' isn't Melzin syntax and would show as is; bind an empty element instead: <span m-text=\"name\"></span>",
    at: pos('mustache.melzin.html', '{{'),
  },
  {
    file: 'snapshot-index-name.melzin.html',
    severity: 'warning',
    message:
      'snapshots["10"]: names that are whole numbers are listed before all the others, whatever their order in the file; use words, such as "10 items"',
    at: pos('snapshot-index-name.melzin.html', '"10"'),
  },
  {
    file: 'stale-types.melzin.html',
    severity: 'warning',
    message: 'stale-types.types.ts is out of date with the schema; run melzin types stale-types.melzin.html',
    at: { line: 1, col: 1 },
  },
]

describe('good views have no diagnostics', () => {
  for (const file of ['good-counter.melzin.html', 'good-static.melzin.html', 'good-nested.melzin.html']) {
    test(file, async () => {
      expect(await diagnosticsOf(file)).toEqual([])
    })
  }
})

describe('errors (one fixture per rule, exactly one diagnostic each)', () => {
  for (const { file, severity, message, at } of errors) {
    test(file, async () => {
      expect(await diagnosticsOf(file)).toEqual([{ ...at, severity, message }])
    })
  }
})

describe('warnings (one fixture per rule, exactly one diagnostic each)', () => {
  for (const { file, severity, message, at } of warnings) {
    test(file, async () => {
      expect(await diagnosticsOf(file)).toEqual([{ ...at, severity, message }])
    })
  }
})

test('checkFiles counts errors and warnings across files', async () => {
  const result = await checkFiles(
    ['good-counter.melzin.html', 'text-unknown-path.melzin.html', 'click-undeclared.melzin.html', 'text-content.melzin.html'],
    { cwd: dir },
  )
  expect(result.files.map((file) => file.file)).toEqual([
    'good-counter.melzin.html',
    'text-unknown-path.melzin.html',
    'click-undeclared.melzin.html',
    'text-content.melzin.html',
  ])
  expect(result.errorCount).toBe(2)
  expect(result.warningCount).toBe(1)
})

test('checkFiles reports files it cannot read', async () => {
  const result = await checkFiles(['nope.melzin.html', '.'], { cwd: dir })
  expect(result.files).toEqual([
    { file: 'nope.melzin.html', diagnostics: [{ line: 1, col: 1, severity: 'error', message: "can't read the file: file not found" }] },
    { file: dir, diagnostics: [{ line: 1, col: 1, severity: 'error', message: "can't read the file: is a directory" }] },
  ])
  expect(result.errorCount).toBe(2)
})

test('paths are relative to the cwd option, absolute input included', async () => {
  const result = await checkFiles([join(dir, 'good-counter.melzin.html')], { cwd: join(dir, '..') })
  expect(result.files[0]?.file).toBe('check/good-counter.melzin.html')
})
