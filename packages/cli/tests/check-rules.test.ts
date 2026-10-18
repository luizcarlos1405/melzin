// One fixture per checker rule (tests/fixtures/check). Positions are computed from the fixture text, so
// each expectation also says which character the diagnostic must point at.

import { describe, expect, test } from 'bun:test'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { type Diagnostic, type Severity, checkFiles } from '../src/check.ts'

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
    message: "view files must be named *.mel.html (got 'wrong-name.html')",
    at: { line: 1, col: 1 },
  },
  {
    file: 'invalid-json-schema.mel.html',
    severity: 'error',
    message: "invalid JSON in the melzin/schema block: trailing commas aren't allowed in JSON",
    at: pos('invalid-json-schema.mel.html', ', }', 2),
  },
  {
    file: 'invalid-json-snapshots.mel.html',
    severity: 'error',
    message: 'invalid JSON in the melzin/snapshots block: JSON strings need double quotes',
    at: pos('invalid-json-snapshots.mel.html', "'zero'"),
  },
  {
    file: 'duplicate-schema.mel.html',
    severity: 'error',
    message: 'duplicate melzin/schema block; a view has at most one',
    at: pos('duplicate-schema.mel.html', '<script type="melzin/schema">', 0, 1),
  },
  {
    file: 'schema-issue.mel.html',
    severity: 'error',
    message: `schema data.properties.tags: a list needs 'items', the schema every item matches, such as "items": { "type": "string" }`,
    at: pos('schema-issue.mel.html', '"tags"'),
  },
  {
    file: 'snapshot-issue.mel.html',
    severity: 'error',
    message: 'snapshots["a few clicks"].data.count: expected number, got string',
    at: pos('snapshot-issue.mel.html', '"count": "3"'),
  },
  {
    file: 'head-link.mel.html',
    severity: 'error',
    message:
      "<link> isn't allowed in <head>; it may only hold <title>, <meta> and the melzin/schema and melzin/snapshots blocks (styling is Tailwind classes only)",
    at: pos('head-link.mel.html', '<link'),
  },
  {
    file: 'head-script.mel.html',
    severity: 'error',
    message: "<script> isn't allowed in <head>; views have no scripts, only the melzin/schema and melzin/snapshots data blocks",
    at: pos('head-script.mel.html', '<script src'),
  },
  {
    file: 'head-div.mel.html',
    severity: 'error',
    message: "<div> isn't allowed in <head>; it may only hold <title>, <meta> and the melzin/schema and melzin/snapshots blocks",
    at: pos('head-div.mel.html', '<div>'),
  },
  {
    file: 'body-script.mel.html',
    severity: 'error',
    message: "<script> isn't allowed in the body; views have no scripts",
    at: pos('body-script.mel.html', '<script>console'),
  },
  {
    file: 'foreign-v-text.mel.html',
    severity: 'error',
    message: "'v-text' is Vue/Alpine syntax; use m-text",
    at: pos('foreign-v-text.mel.html', 'v-text'),
  },
  {
    file: 'foreign-click.mel.html',
    severity: 'error',
    message: "'@click' is Vue/Alpine syntax; use m-on:click",
    at: pos('foreign-click.mel.html', '@click'),
  },
  {
    file: 'foreign-other.mel.html',
    severity: 'error',
    message: "':class': Vue/Alpine syntax isn't supported; Melzin has m-text, m-show, m-if, m-else-if, m-else, m-for, m-on:click and m-bind:href",
    at: pos('foreign-other.mel.html', ':class'),
  },
  {
    file: 'unsupported-directive.mel.html',
    severity: 'error',
    message:
      "'m-model' is not supported yet; Melzin supports only m-text, m-show, m-if, m-else-if, m-else, m-for, m-on:click and m-bind:href; forms and inputs aren't supported yet (docs/authoring.md §7)",
    at: pos('unsupported-directive.mel.html', 'm-model'),
  },
  {
    file: 'text-parse-error.mel.html',
    severity: 'error',
    message: "m-text: expected a name after '.', found '.'",
    // the second dot of count..x
    at: pos('text-parse-error.mel.html', 'count..x', 6),
  },
  {
    file: 'text-unknown-path.mel.html',
    severity: 'error',
    message: "m-text: unknown field 'cuont' (did you mean 'count'?)",
    at: pos('text-unknown-path.mel.html', 'cuont'),
  },
  {
    file: 'text-object-path.mel.html',
    severity: 'error',
    message: "m-text: 'user' is an object; m-text needs a string, number or boolean",
    at: pos('text-object-path.mel.html', 'm-text="user"', 8),
  },
  {
    file: 'text-child-elements.mel.html',
    severity: 'error',
    message: "an m-text element can't contain elements; the runtime replaces its content",
    at: pos('text-child-elements.mel.html', '<span>'),
  },
  {
    file: 'click-parse-error.mel.html',
    severity: 'error',
    message: "m-on:click: expected a string, found 'increment' (quote it: 'increment')",
    at: pos('click-parse-error.mel.html', 'emit(increment)', 5),
  },
  {
    file: 'click-dollar-emit.mel.html',
    severity: 'error',
    message: "m-on:click: use emit('name') instead of Vue's $emit",
    at: pos('click-dollar-emit.mel.html', '$emit'),
  },
  {
    file: 'click-undeclared.mel.html',
    severity: 'error',
    message: "m-on:click: event 'incremnt' isn't declared in the schema's events (did you mean 'increment'?)",
    at: pos('click-undeclared.mel.html', 'incremnt'),
  },  // Body markup: the same rules the runtime applies (src/core/markup.ts).
  {
    file: 'body-style.mel.html',
    severity: 'error',
    message: "<style> isn't allowed; styling is Tailwind classes only, with design tokens in theme.css",
    at: pos('body-style.mel.html', '<style>'),
  },
  {
    file: 'body-link.mel.html',
    severity: 'error',
    message: "<link> isn't allowed; styling is Tailwind classes only, with design tokens in theme.css",
    at: pos('body-link.mel.html', '<link'),
  },
  {
    file: 'body-base.mel.html',
    severity: 'error',
    message: "<base> isn't allowed; it would change how every relative URL in the host page resolves",
    at: pos('body-base.mel.html', '<base'),
  },
  {
    file: 'body-meta.mel.html',
    severity: 'error',
    message: '<meta> belongs in <head>; in the body it would act on the host page',
    at: pos('body-meta.mel.html', '<meta http-equiv'),
  },
  {
    file: 'body-iframe.mel.html',
    severity: 'error',
    message: "<iframe> isn't allowed; views can't embed other documents",
    at: pos('body-iframe.mel.html', '<iframe'),
  },
  {
    file: 'body-template.mel.html',
    severity: 'error',
    message: "<template> isn't supported; its content would never be bound. Write the markup directly",
    at: pos('body-template.mel.html', '<template>'),
  },
  {
    file: 'body-form.mel.html',
    severity: 'error',
    message: '<form> isn\'t supported yet; use <button type="button"> with m-on:click instead',
    at: pos('body-form.mel.html', '<form>'),
  },
  {
    file: 'inline-handler.mel.html',
    severity: 'error',
    message: "inline handler 'onclick' isn't allowed; use m-on:click=\"emit('name')\"",
    at: pos('inline-handler.mel.html', 'onclick'),
  },
  {
    file: 'style-attribute.mel.html',
    severity: 'error',
    message: "style attributes aren't allowed; styling is Tailwind classes only, with design tokens in theme.css",
    at: pos('style-attribute.mel.html', 'style="'),
  },
  {
    file: 'javascript-url.mel.html',
    severity: 'error',
    message: "javascript: URLs aren't allowed in href; views run no code",
    at: pos('javascript-url.mel.html', 'href='),
  },
  {
    file: 'srcdoc-attribute.mel.html',
    severity: 'error',
    message: "srcdoc isn't allowed; views can't embed other documents",
    at: pos('srcdoc-attribute.mel.html', 'srcdoc'),
  },
  {
    file: 'text-void-element.mel.html',
    severity: 'error',
    message: "m-text can't go on <input>: it has no content to set; use an element such as <span>",
    at: pos('text-void-element.mel.html', '<input'),
  },
  // Conditions: m-show, m-if, m-else-if and m-else.
  {
    file: 'if-parse-error.mel.html',
    severity: 'error',
    message: "m-if: expected a name after '.', found end of value",
    at: pos('if-parse-error.mel.html', 'verified."', 9),
  },
  {
    file: 'if-operator.mel.html',
    severity: 'error',
    message: "m-if: '>' isn't supported yet: a condition is a path, optionally negated with !, so have the host send a boolean field such as hasCount",
    at: pos('if-operator.mel.html', '> 0'),
  },
  {
    file: 'if-unknown-path.mel.html',
    severity: 'error',
    message: "m-if: unknown field 'verifed' (did you mean 'verified'?)",
    at: pos('if-unknown-path.mel.html', 'verifed'),
  },
  {
    file: 'show-call.mel.html',
    severity: 'error',
    message: 'm-show: m-show needs a condition such as user.verified or !user.verified, not a call',
    at: pos('show-call.mel.html', 'isVerified()'),
  },
  {
    file: 'else-orphan.mel.html',
    severity: 'error',
    message: 'm-else must come right after an element with m-if or m-else-if',
    at: pos('else-orphan.mel.html', 'm-else'),
  },
  {
    file: 'else-value.mel.html',
    severity: 'error',
    message: 'm-else takes no value; for another condition use m-else-if="!verified"',
    at: pos('else-value.mel.html', 'm-else'),
  },
  {
    file: 'chain-two-roles.mel.html',
    severity: 'error',
    message: 'an element can have only one of m-if, m-else-if and m-else',
    at: pos('chain-two-roles.mel.html', 'm-else'),
  },
  // Lists (SPEC D34): the schema, m-for and paths inside rows.
  {
    file: 'schema-list-key.mel.html',
    severity: 'error',
    message: 'schema data.properties.members: a list of objects needs a "key": the field of its items that identifies each one, such as "key": "handle"',
    at: pos('schema-list-key.mel.html', '"members"'),
  },
  {
    file: 'schema-list-unique.mel.html',
    severity: 'error',
    message: 'schema data.properties.tags: a list of strings is keyed by its values: add "uniqueItems": true',
    at: pos('schema-list-unique.mel.html', '"tags"'),
  },
  {
    file: 'snapshot-duplicate-key.mel.html',
    severity: 'error',
    message: 'snapshots["two"].data.members[1].handle: duplicate key "ana": members[0] has it too; keys must be unique in a list',
    at: pos('snapshot-duplicate-key.mel.html', '"handle": "ana", "name": "Ana again"'),
  },
  {
    file: 'snapshot-min-items.mel.html',
    severity: 'error',
    message: 'snapshots["one"].data.options: has 1 item; the schema allows at least 2',
    at: pos('snapshot-min-items.mel.html', '"options"', 0, 3),
  },
  {
    file: 'snapshot-null-item.mel.html',
    severity: 'error',
    message: "snapshots[\"two\"].data.members[1]: a list item can't be null; leave it out of the list",
    at: pos('snapshot-null-item.mel.html', 'null'),
  },
  {
    file: 'for-parse-error.mel.html',
    severity: 'error',
    message: `m-for: use 'in': m-for="member in members"`,
    at: pos('for-parse-error.mel.html', 'of members'),
  },
  {
    file: 'for-index.mel.html',
    severity: 'error',
    message: "m-for: there's no index: style rows by position with Tailwind's first:, last:, odd: and nth-* variants, and identify them by the list's key",
    at: pos('for-index.mel.html', '(member'),
  },
  {
    file: 'for-unknown-list.mel.html',
    severity: 'error',
    message: "m-for: unknown field 'membrs' (did you mean 'members'?)",
    at: pos('for-unknown-list.mel.html', 'membrs'),
  },
  {
    file: 'for-not-a-list.mel.html',
    severity: 'error',
    message: `m-for: 'title' is a string, not a list; m-for goes over a list field ("type": "array")`,
    at: pos('for-not-a-list.mel.html', 'in title', 3),
  },
  {
    file: 'for-alias-clash.mel.html',
    severity: 'error',
    message: "m-for: 'title' is already a data field; pick another name, such as member",
    at: pos('for-alias-clash.mel.html', 'title in members'),
  },
  {
    file: 'for-with-if.mel.html',
    severity: 'error',
    message: "m-if can't go on an element with m-for: wrap the list in an element with m-if, or put the condition inside the row; to show only some items, have the host filter the list",
    at: pos('for-with-if.mel.html', 'm-if'),
  },
  {
    file: 'for-template.mel.html',
    severity: 'error',
    message: "put m-for on the element to repeat; <template> isn't supported",
    at: pos('for-template.mel.html', '<template'),
  },
  {
    file: 'key-binding.mel.html',
    severity: 'error',
    message: `':key' is Vue/Alpine syntax; keys live in the schema: add "key": "<field>" to the list, such as "key": "id"`,
    at: pos('key-binding.mel.html', ':key'),
  },
  {
    file: 'text-list.mel.html',
    severity: 'error',
    message: "m-text: 'members' is a list; show its items with m-for",
    at: pos('text-list.mel.html', 'm-text="members"', 8),
  },
  {
    file: 'text-position.mel.html',
    severity: 'error',
    message: "m-text: 'members.0' picks an item by position: a list's items are shown with m-for; for one particular item, have the host send it as its own field, such as featured",
    at: pos('text-position.mel.html', 'members.0', 8),
  },
  {
    file: 'text-length.mel.html',
    severity: 'error',
    message: "m-text: 'members.length' counts the items, which only conditions can use (m-if, m-else-if, m-show); to show a count, have the host send it as its own field, such as memberCount",
    at: pos('text-length.mel.html', 'members.length'),
  },
  {
    file: 'row-unknown-field.mel.html',
    severity: 'error',
    message: "m-text: unknown field 'member.nmae' (did you mean 'member.name'?)",
    at: pos('row-unknown-field.mel.html', 'member.nmae'),
  },
  {
    file: 'href-length.mel.html',
    severity: 'error',
    message: "m-bind:href: 'members.length' counts the items, which only conditions can use (m-if, m-else-if, m-show); to show a count, have the host send it as its own field, such as memberCount",
    at: pos('href-length.mel.html', 'members.length'),
  },
  // Event payloads (SPEC D35): each emit against its event's payload (D15).
  {
    file: 'payload-missing.mel.html',
    severity: 'error',
    message: "m-on:click: event 'follow' has a payload; send it: emit('follow', { handle: ... })",
    at: pos('payload-missing.mel.html', "emit('follow')", 6),
  },
  {
    file: 'payload-unexpected.mel.html',
    severity: 'error',
    message: "m-on:click: event 'follow' has no payload; send emit('follow'), or declare its payload in the schema's events",
    at: pos('payload-unexpected.mel.html', '{ handle: member.handle }'),
  },
  {
    file: 'payload-unknown-field.mel.html',
    severity: 'error',
    message: "m-on:click: 'nmae' isn't a field of the payload of 'follow' (did you mean 'name'?)",
    at: pos('payload-unknown-field.mel.html', 'nmae'),
  },
  {
    file: 'payload-required-field.mel.html',
    severity: 'error',
    message: "m-on:click: the payload of 'follow' needs 'name'",
    at: pos('payload-required-field.mel.html', '{ handle: member.handle }'),
  },
  {
    file: 'payload-type.mel.html',
    severity: 'error',
    message: "m-on:click: 'member.followers' is a number, but the payload's 'handle' is a string",
    at: pos('payload-type.mel.html', 'member.followers }'),
  },
  {
    file: 'payload-maybe-missing.mel.html',
    severity: 'error',
    message: "m-on:click: 'member.email' may be missing, but the payload requires 'email'",
    at: pos('payload-maybe-missing.mel.html', 'member.email'),
  },
  {
    file: 'payload-positional.mel.html',
    severity: 'error',
    message: "m-on:click: a payload is an object of named fields: emit('follow', { memberHandle: member.handle })",
    at: pos('payload-positional.mel.html', 'member.handle)'),
  },
  {
    file: 'payload-literal.mel.html',
    severity: 'error',
    message: 'm-on:click: payload values are paths for now; have the host send the value as data',
    at: pos('payload-literal.mel.html', "'ana'"),
  },
]

const warnings: Case[] = [
  {
    file: 'body-attributes.mel.html',
    severity: 'warning',
    message: "<body> takes no attributes ('class'); put classes on an element inside it",
    at: pos('body-attributes.mel.html', 'class="bg-zinc-50"'),
  },
  {
    file: 'missing-title.mel.html',
    severity: 'warning',
    message: 'missing <title>; the title names the view in the shell',
    at: pos('missing-title.mel.html', '<head>'),
  },
  {
    file: 'text-content.mel.html',
    severity: 'warning',
    message: 'm-text elements should be empty; sample text belongs in snapshots',
    at: pos('text-content.mel.html', '42'),
  },
  {
    file: 'event-never-emitted.mel.html',
    severity: 'warning',
    message: "event 'increment' is declared but nothing emits it",
    at: pos('event-never-emitted.mel.html', '"increment"'),
  },
  {
    file: 'leaf-never-used.mel.html',
    severity: 'warning',
    message: "data field 'count' is never used",
    at: pos('leaf-never-used.mel.html', '"count": { "type"'),
  },
  {
    file: 'no-snapshots.mel.html',
    severity: 'warning',
    message: 'the view has data fields but no snapshots; add a melzin/snapshots block with sample states, awkward ones included (very long text, zero, huge numbers)',
    at: pos('no-snapshots.mel.html', '<script type="melzin/schema">'),
  },  {
    file: 'mustache.mel.html',
    severity: 'warning',
    message: "'{{ count }}' isn't Melzin syntax and would show as is; bind an empty element instead: <span m-text=\"name\"></span>",
    at: pos('mustache.mel.html', '{{'),
  },
  {
    file: 'snapshot-index-name.mel.html',
    severity: 'warning',
    message:
      'snapshots["10"]: names that are whole numbers are listed before all the others, whatever their order in the file; use words, such as "10 items"',
    at: pos('snapshot-index-name.mel.html', '"10"'),
  },
  {
    file: 'stale-types.mel.html',
    severity: 'warning',
    message: 'stale-types.types.ts is out of date with the schema; run melzin types stale-types.mel.html',
    at: { line: 1, col: 1 },
  },
  {
    file: 'if-always-true.mel.html',
    severity: 'warning',
    message: "m-if: 'user' is a required object, so this condition is always true",
    at: pos('if-always-true.mel.html', 'user">'),
  },
  {
    file: 'else-if-never-shown.mel.html',
    severity: 'warning',
    message: 'no snapshot shows this element; add one where m-else-if="verified" holds and the conditions before it don\'t',
    at: pos('else-if-never-shown.mel.html', 'm-else-if'),
  },
  // Lists: snapshot coverage (P8, SPEC §9.1), uses and rows.
  {
    file: 'for-no-rows.mel.html',
    severity: 'warning',
    message: "no snapshot shows a row of 'members' (it's empty in every snapshot)",
    at: pos('for-no-rows.mel.html', 'm-for'),
  },
  {
    file: 'list-never-empty.mel.html',
    severity: 'warning',
    message: `no snapshot shows 'members' empty; add one to design the empty state, or set "minItems": 1 if it's never empty`,
    at: pos('list-never-empty.mel.html', 'm-for'),
  },
  {
    file: 'list-never-several.mel.html',
    severity: 'warning',
    message: "no snapshot shows 'members' with more than one item",
    at: pos('list-never-several.mel.html', 'm-for'),
  },
  {
    file: 'row-never-shown.mel.html',
    severity: 'warning',
    message: 'no snapshot shows this element; add one where m-if="member.verified" holds',
    at: pos('row-never-shown.mel.html', 'm-if'),
  },
  {
    file: 'if-required-list.mel.html',
    severity: 'warning',
    message: "m-if: 'members' is a required list, so the condition always holds, even when it's empty; test members.length",
    at: pos('if-required-list.mel.html', 'm-if="members"', 6),
  },
  {
    file: 'row-id.mel.html',
    severity: 'warning',
    message: 'every row gets the same id; ids must be unique in a page',
    at: pos('row-id.mel.html', 'id="member"'),
  },
  {
    file: 'list-never-used.mel.html',
    severity: 'warning',
    message: "data field 'members' is never used",
    at: pos('list-never-used.mel.html', '"members"'),
  },
  {
    file: 'item-field-never-used.mel.html',
    severity: 'warning',
    message: "data field 'members[].name' is never used",
    at: pos('item-field-never-used.mel.html', '"name"'),
  },
]

describe('good views have no diagnostics', () => {
  for (const file of ['good-counter.mel.html', 'good-static.mel.html', 'good-nested.mel.html', 'good-conditionals.mel.html', 'good-lists.mel.html']) {
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
    ['good-counter.mel.html', 'text-unknown-path.mel.html', 'click-undeclared.mel.html', 'text-content.mel.html'],
    { cwd: dir },
  )
  expect(result.files.map((file) => file.file)).toEqual([
    'good-counter.mel.html',
    'text-unknown-path.mel.html',
    'click-undeclared.mel.html',
    'text-content.mel.html',
  ])
  expect(result.errorCount).toBe(2)
  expect(result.warningCount).toBe(1)
})

test('checkFiles reports files it cannot read', async () => {
  const result = await checkFiles(['nope.mel.html', '.'], { cwd: dir })
  expect(result.files).toEqual([
    { file: 'nope.mel.html', diagnostics: [{ line: 1, col: 1, severity: 'error', message: "can't read the file: file not found" }] },
    { file: dir, diagnostics: [{ line: 1, col: 1, severity: 'error', message: "can't read the file: is a directory" }] },
  ])
  expect(result.errorCount).toBe(2)
})

test('paths are relative to the cwd option, absolute input included', async () => {
  const result = await checkFiles([join(dir, 'good-counter.mel.html')], { cwd: join(dir, '..') })
  expect(result.files[0]?.file).toBe('check/good-counter.mel.html')
})
