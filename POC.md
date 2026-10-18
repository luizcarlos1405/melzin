# Melzin POC

> The smallest version that proves "design is implementation": an AI writes a page as one HTML file, a
> shell previews it in several states, and the same file runs in production with real data and a
> working button.

**Status:** built, and M3's AI authoring trial passed (§10). Since then, conditionals and a second
example app have been added (§14), routing: the route table, links, the URL input, the standalone
host and pages in the shell (§15), design in stages: alternatives in `explore/` side by side in the
shell, several device sizes at once and each view's stage (§16), snapshots that extend a base
(§17), and lists and event payloads (§18). The code is a Bun workspace: the Melzin packages in
`packages/melzin` and `packages/cli` and example apps in `examples/` (§7, §14). It follows
[SPEC.md](SPEC.md); references such as D9, P1 or #46 point there. The guide for authors is
[docs/authoring.md](docs/authoring.md).

## 1. What the POC must prove

1. **One file is both design and implementation.** The shell and a production page render the same
   file through the same runtime, and look the same for the same data (P5).
2. **Data in, events out.** A view shows the data it's given and sends declared events to its host. A
   data change rewrites only the text that depends on it (P1, P6).
3. **The contract can be checked.** A checker catches mistakes in the file, and the host's handlers are
   type-checked against the declared events (D14, D15).
4. **An AI can author it.** A short guide, the checker's output and shell screenshots are enough for an
   AI to write a new view and fix its mistakes (D1).

It touches D1–D3, D6, D8–D10, D12–D15, P1 and P4–P6, each in its smallest form.

## 2. Scope

**In**

- Views made of static HTML and Tailwind classes, plus two directives: `m-text` and `m-on:click`.
- A schema with `data` (strings, numbers, booleans, nested objects) and events without payloads.
- Named snapshots inside the file.
- A runtime with `mount`, `update` and `destroy`.
- A preview shell: snapshot grid, device sizes, zoom, and a state editor and event log per render.
- A checker CLI, and TypeScript types for hosts.
- Three example views, one production page, an example app with a small backend, and an authoring guide
  for the AI.

**Out:** everything else, including lists, conditionals, attribute bindings, internal state, event
payloads, components, the custom element, the standalone host and performance work. §11 lists when each
one comes in; conditionals (§14), the standalone host (§15), and lists and event payloads (§18) have
been built since.

## 3. The view file

`packages/cli/views/counter.mel.html`:

```html
<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <title>Counter</title>
  <script type="melzin/schema">
    {
      "data": {
        "type": "object",
        "properties": {
          "count": { "type": "number" }
        },
        "required": ["count"]
      },
      "events": {
        "increment": {}
      }
    }
  </script>
  <script type="melzin/snapshots">
    {
      "zero": { "data": { "count": 0 } },
      "a few clicks": { "data": { "count": 3 } },
      "huge number": { "data": { "count": 1234567 } }
    }
  </script>
</head>
<body>
  <main class="flex min-h-screen flex-col items-center justify-center gap-6 bg-zinc-50">
    <p class="text-6xl font-bold tabular-nums text-zinc-900" m-text="count"></p>
    <button class="rounded-lg bg-violet-600 px-5 py-2.5 font-medium text-white hover:bg-violet-500"
            m-on:click="emit('increment')">
      Click me
    </button>
  </main>
</body>
</html>
```

Rules:

- A view is a complete HTML document named `*.mel.html` (D6), so it opens in any browser.
- The children of `<body>` are the view. `<body>` itself takes no attributes, and several top-level
  elements are fine.
- `<head>` holds `<title>` (the view's name), optional `<meta>` tags and at most two data blocks:
  `melzin/schema` and `melzin/snapshots`. Nothing else: no stylesheets, no scripts. Browsers treat script
  tags with unknown types as inert data, so these never run.
- Styling is Tailwind classes only (D9), always written out in full (#52).
- `m-text` elements stay empty: the runtime fills them, and sample values belong in snapshots (P4). The
  checker warns about content inside one, and the runtime replaces it anyway (§13).
- Nothing in the body may run code or change the host page around the view: no scripts (also in SVG),
  inline `on*` handlers, `javascript:` URLs, embedded documents (`<iframe>`, `<object>`, `<embed>`,
  `srcdoc`), `<style>`, `<link>`, `<base>`, `<meta>` or `<title>`. `<template>`, `<form>` and `style`
  attributes are out too (unsupported, and D9). The rules live in one place (`src/core/markup.ts`),
  shared by the checker and the runtime.

### Directives

| Directive | Value | Effect |
|---|---|---|
| `m-text` | a path, such as `count` or `user.name` | sets the element's text to that value from `data` |
| `m-on:click` | `emit('increment')` | sends the declared event to the host |

That was the whole language of the POC; conditions came after it (§14), then lists and payloads
(§18). Values are parsed into a small syntax tree and never evaluated (P1, #24). Paths and event names
are identifiers (`[A-Za-z_][A-Za-z0-9_]*`); paths join them with dots. The event name is a string in
single or double quotes. Vue's `$emit(...)` is an error with the hint
"use emit('name') instead of Vue's $emit" (§13).

### Schema

- `data` is a subset of JSON Schema: objects with `properties` and `required`, leaf types `string`,
  `number` and `boolean`, and `default` for missing values (P4). `description` is allowed anywhere; any
  other keyword is an error. (Since §18, a field can also be a list.)
- `events` maps each event name to `{}`. The `payload` key is reserved for typed payloads (D14), and
  §18 fills it.
- The `ui` key is reserved for internal state (D5) and rejected for now.
- A view without a schema block has no data and no events: a fully static page.

The profile card's schema shows nesting and a default:

```json
{
  "data": {
    "type": "object",
    "properties": {
      "user": {
        "type": "object",
        "properties": {
          "name": { "type": "string" },
          "role": { "type": "string" },
          "bio": { "type": "string", "default": "" },
          "followers": { "type": "number" }
        },
        "required": ["name", "role", "followers"]
      }
    },
    "required": ["user"]
  },
  "events": {}
}
```

### Snapshots

- Each snapshot is a named, complete state with a `data` object. A `ui` object comes later. (Since
  §17, a snapshot can also extend another and list only what differs.)
- Snapshots must match the schema. Unknown fields are errors, which catches typos.
- A view without snapshots shows once in the shell, with empty data.

## 4. Runtime

```ts
const view = await mount(element, url, { data, on })
view.update(newData) // replaces the data; only bindings whose value changed touch the DOM
view.destroy()       // removes the listeners and the view's elements
```

- `mount` fetches the file, parses it with the browser's `DOMParser`, reads the schema and copies the
  children of `<body>` into `element`. An HTTP failure or an invalid schema throws, with the reasons.
  `mountSource(element, html, options)` does the same from a string; the shell's frames use it.
- It walks the copied elements once and builds a binding table: path → elements for `m-text`,
  element → event for `m-on:click`. Everything afterwards goes through that table (P1).
- Text is set with `textContent`, never `innerHTML` (#24). A missing value falls back to the schema's
  `default`, or to empty text.
- `update` replaces the data and rewrites only the elements whose value changed. Nothing re-renders, so
  the button and everything else keep their identity (#17).
- A click calls `on[event](payload)`. The payload is always `undefined` for now, but handlers already
  take it as their argument (D14). (Since §18, an event can declare a payload, built from paths.)
- The runtime warns about data that doesn't match the schema, declared events without a handler,
  handlers for events that don't exist, and invalid directives, which it skips (D15). Warnings go to the
  `onWarning` option, or to `console.warn` with a `[melzin]` prefix.
- Before anything reaches the host page, the body is cleaned with the rules in §3: what would run code
  or change the page (scripts, inline `on*` handlers, `javascript:` URLs, embedded documents, styles,
  `<base>`, `<meta>`, `<template>`) is dropped with a warning; `<form>` and `style` attributes stay,
  with a warning. A schema block that ended up in `<body>` (stray content in `<head>` ends the head
  early) throws, like an invalid schema.
- Data and handlers are read as own or inherited properties, stopping before `Object.prototype`:
  getters and class methods work, and names such as `constructor` never reach the builtins.
- No `eval` or `new Function` anywhere (#24).

## 5. Preview shell

`melzin shell` starts a development web app on `http://127.0.0.1:4321` that lists every view in
`views/` by its `<title>`.

- Picking a view renders each of its snapshots side by side, each in its own iframe running the same
  runtime and CSS as production (P5).
- A device-size picker applies to every frame: 375×812, 768×1024 and 1280×800. Frames get real
  viewports, so responsive classes behave as they would on a device.
- Zoom (25% to 200%) scales the canvas with a CSS transform, never browser zoom, so the frames' layout
  width doesn't change (#41).
- Each frame shows:
  - a state editor with the current `data` as JSON; valid edits apply live through `update`, and
    invalid JSON shows the parse error (D3)
  - an event log with each emitted event and its time (and, since §18, its payload). Nothing else
    happens, because the shell has no host (#43)
  - the runtime's warnings
- A refresh, or the Reload button, reloads everything from the file and drops the edits (D3). Files
  aren't watched yet.
- URL parameters such as `?view=counter&snapshot=zero&device=375x812&zoom=1` show a single frame, and
  `&chrome=0` hides the shell's own UI, so the AI can screenshot one state with any browser tool
  (SPEC §8). `<body>` gets `data-melzin-ready="true"` once every frame has finished loading, or
  `"error"` when the view couldn't be loaded. Problems in the schema and snapshots blocks are shown
  even with `chrome=0`.
- Links and forms in a frame aren't followed; the event log records them.

## 6. Checker

`melzin check` checks every view in `views/`, or the files given. It runs on Bun and parses with parse5
so it can report positions, down to the character inside an attribute value or the JSON. Output looks
like a compiler's, `file:line:col: error: message`, followed by a summary such as
`2 errors, 1 warning in 3 files`. The exit code is 1 when there are errors.

Errors:

- a file not named `*.mel.html`
- invalid JSON or a duplicate data block, or a schema outside the subset above (lists and payloads
  joined the subset in §18)
- an unknown directive, with a hint for Vue and Alpine spellings: `v-text` → `m-text`, `@click` →
  `m-on:click` (#38)
- an `m-text` path that's missing from the schema or points at an object, an `m-text` element with
  child elements, or `m-text` on an element without content (`<input>`, `<img>`)
- an `m-on:click` value that isn't `emit('name')`, or that names an undeclared event (D15)
- anything in `<head>` besides the title, meta tags and data blocks
- in the body: a script (also in SVG), an inline `on*` handler, a `javascript:` URL in `href`, `src`,
  `action`, `formaction` and the like, an embedded document (`<iframe>`, `<object>`, `<embed>`,
  `srcdoc`), `<style>`, `<link>`, `<base>`, `<meta>`, `<title>`, `<template>`, `<form>` or a `style`
  attribute (D9). These are the runtime's rules (§4), from the same code
- a snapshot that doesn't match the schema

Warnings:

- a declared event that nothing emits (SPEC §9.4)
- a data field that nothing displays (SPEC §9.2)
- content inside an `m-text` element (P4)
- a view with data but no snapshots (P8), and snapshot names that are whole numbers (JavaScript lists
  them first, whatever the file's order)
- a literal `{{ ... }}` in the text (#38)
- attributes on `<body>`, and a missing or empty `<title>`
- a `<name>.types.ts` next to the view that no longer matches its schema

Messages name the fix or the workaround (docs/authoring.md §7) instead of pointing at SPEC.md.

`melzin types views/counter.mel.html` writes `views/counter.types.ts` with `Data` and `Handlers`
types. `Handlers` has one required method per event, so a host that misses one fails its type check
(D15). The command refuses to write while the view has errors.

## 7. Production example

`packages/cli/examples/counter/` is a plain page that mounts the counter and counts clicks:

```ts
import { mount } from '../../src/runtime/mount.ts'
import type { Data, Handlers } from '../../views/counter.types.ts'

let count = 0
const view = await mount<Data, Handlers>(document.querySelector('#app')!, '/views/counter.mel.html', {
  data: { count },
  on: { increment: () => view.update({ count: ++count }) },
})
```

- `bun run example:counter` serves it on port 3001 (`PORT` overrides). Bun bundles `index.html` and
  `main.ts`, `/views/*` serves the view files unchanged ("the same file in production" at its most
  literal), and `/styles.css` comes from `buildCss`, the function the shell uses.
- `main.ts` adds the stylesheet link at runtime, because Bun's HTML bundler would try to resolve a
  static link to a server route.
- Removing the `increment` handler fails `bun run typecheck` and logs a warning at runtime (D15).
- With the same count and device size, the page looks exactly like the matching frame in the shell (P5).

### Sample app

`examples/poll/` is a separate app, `melzin-example-poll`, that depends on Melzin as a workspace package. It's
a quick poll, "What should we eat at the next team meetup?", with three fixed options: pizza, tacos and
sushi. (Since §18, the options are a list and one `vote` event says which one was picked.)

- `server.ts` is a tiny Bun backend on port 3000 that owns the votes in memory. Its adapter,
  `toViewModel`, shapes them for the screen (P3): votes and a percent string per option, and a total
  label such as "12 votes". `GET /api/poll` returns that view model, and `POST /api/poll/votes` counts a
  vote and returns the new one.
- `views/poll.mel.html` declares `votePizza`, `voteTacos` and `voteSushi` (no payloads yet) and has
  the snapshots "no votes yet", "close race", "landslide", "huge numbers" and "very long question".
  `views/header.mel.html` is static. `theme.css` is the app's own theme (D12).
- `client.ts` mounts the poll with its generated types, and the static header (no schema, so nothing
  to type) as is. Each vote handler posts the vote and calls `update` with the answer, and the page
  refreshes from the API every 3 seconds.
- A contract test validates the adapter's output for several states against the schema read with
  `loadViewFile` (SPEC §9.3). API tests run against the server on a random port.
- From `examples/poll/`: `bun run dev` runs the app, `bun run shell` previews its views, `bun run check` checks
  them. `examples/poll/README.md` has the rest.

## 8. Example views

They live in `packages/cli/views/`, with the theme in `packages/cli/theme.css` (a honey-amber
`brand` scale, D12).

- `hello.mel.html`: a static page with no schema. Plain design has to work too.
- `profile-card.mel.html`: a name, role, bio and follower count through nested `user.*` paths.
  Snapshots include a very long name and an empty bio, to see the layout under awkward data (a first
  taste of P8).
- `counter.mel.html`: the count and a button that emits `increment`.

## 9. Stack and layout

Stack:

- TypeScript everywhere. Bun 1.4 runs it directly, serves the shell and the examples (`Bun.serve` with
  HTML imports), bundles the browser code and runs the tests (`bun test`). The code sticks to erasable
  syntax and explicit `.ts` imports.
- `tsc --noEmit` only type-checks.
- Tailwind v4, compiled in-process by `buildCss` with the official `@tailwindcss/node` and
  `@tailwindcss/oxide` packages. The entry stylesheet is generated in memory: Tailwind, an `@source`
  line covering `views/` and the project-wide theme in `theme.css` (D12, #52, #53). The shell and
  production builds call the same function (P5). Projects don't depend on Tailwind themselves.
- View files are served and shipped as they are, never transformed.
- parse5 in the checker, for line and column numbers.
- happy-dom for the runtime's DOM tests.
- The `melzin` CLI: `check`, `types`, `shell` and `css`. Other projects import the runtime from
  `melzin`, the shared code from `melzin/core` and the Bun-side helpers (`buildCss`, `loadViewFile`,
  `checkFiles`) from `@melzin/cli/tools`.

Layout:

```
package.json            workspace root: packages/*, examples/*
tsconfig.base.json      shared strict compiler options
docs/authoring.md       authoring guide for the AI
packages/melzin/        `melzin`, the runtime package (compiled to dist/ on publish)
  src/core/             expression parser, schema and snapshot helpers, shared by runtime, checker and shell
  src/runtime/          mount, binding table, updates (browser)
  tests/
packages/cli/           `@melzin/cli`, the CLI package (Bun)
  src/                  the melzin CLI and tools.ts
  shell/                preview shell
  views/                example views and their generated *.types.ts
  explore/              a demo exploration: two directions for a plans page (§16)
  theme.css             project-wide Tailwind theme for the example views (D12)
  examples/counter/     production page
  tests/
examples/poll/          the poll app (§7); more examples go in examples/<name>/
examples/profile/       the profile app (§14)
```

Commands, from the root after `bun install`: `bun run test` (builds the runtime first), `bun run typecheck`
and `bun run check`. In `packages/cli`: `bun run shell` and `bun run example:counter`.

## 10. Milestones

**M1: runtime and production page.** The runtime, the three example views and the counter page. Done
when clicks count, a test shows that `update` changes only the bound text (the button stays the same DOM
node), and the development warnings fire. *Built.*

**M2: preview shell.** Grid, device sizes, zoom, state editor, event log and URL parameters. Done when
every snapshot of every view shows up, JSON edits update their frame live, a refresh resets everything,
and a single state can be opened by URL for a screenshot. *Built.*

**M3: checker, types and the AI loop.** Every checker rule with a test fixture, the `types` command, and
`docs/authoring.md`. Done when an AI, given only the authoring guide, writes a new view (say, a like
button with a count) and gets it clean using the checker and the shell. *Built; the trial passed.*

The trial: an AI agent got only `docs/authoring.md` and wrote a like-button view (nested `post` data,
a `like` event, four hostile snapshots, a heart icon and theme tokens) in an empty project. Its first
draft passed `melzin check` with 0 errors and 0 warnings. `melzin types`, the shell (screenshots of
every snapshot at phone and desktop sizes, clicks logged), `tsc` against the generated types
(including a deliberately wrong host that failed as expected) and a production page in a real browser
all worked. What it hit was outside the view:

- The guide said nothing about project setup, the `tsconfig` that Melzin's `.ts` sources need, the
  production CSS (`melzin css`), or that the shell's pages need a browser (`curl` gets empty pages).
- Its probes found checker gaps: inline `onclick`, `style` attributes, `<form>`, `<template>` and
  `{{ }}` passed silently although the guide called them wrong, and some messages misled
  (`emit('like', 1)` was told to quote the `1`) or pointed at SPEC.md, which the guide says not to read.
- The shell's problem banner counted only schema and snapshot problems, and `/frame?view=` didn't
  accept the bare name the shell itself uses.

All of these were fixed after the trial (guide §2, §6, §8 and §11, the checker rules in §6, the
messages, and the shell), together with the findings of a code review: the runtime's cleanup of the
body now covers everything that runs code or changes the host page, not only scripts and `on*`
attributes. Not fixed: nothing checks Tailwind class names, so a misspelled class or a missing theme
token still produces no CSS and no warning; the guide tells authors to look at the screenshots. The
trial ran before these fixes, so the fixed guide hasn't had a trial of its own.

## 11. What comes next

Roughly in order. The first rows lead straight into the first build battle in SPEC §11, and every row
reuses the binding table, the shared parser and the host API.

| Next | SPEC |
|---|---|
| `m-show`, `m-if` and `m-else`: *built, with `m-else-if` (§14)* | #8, #9 |
| Snapshots that extend a base snapshot and override what differs: *built (§17)* | D30, #34, Q14 |
| `m-bind`, including `m-bind:class` with literal classes | #8, #11, #52 |
| `m-for` with keys and empty states: *built, with `.length` in conditions (§18)* | #1, §9.1, D34 |
| Internal `ui` state and state operations in handlers | D5, #46 |
| Formatters for numbers and dates, built on `Intl` | #6 |
| Event payloads: *built from paths (§18)*; literals in payloads, any DOM event in `m-on`, and modifiers | D13, D14, D35 |
| `m-model` and forms | #20 |
| Stable IDs and schema diffs | #13, #3, §9.3, §9.4 |
| Components: views inside views, schemas composed with `$ref` | D16–D19, #12, §9.5 |
| A custom element that dispatches DOM events | D7, §7 |
| The standalone host: *built, with the route table, links and pages in the shell (§15)* | D11, D20–D27, #31, #51 |
| Exploration: design alternatives side by side in the shell: *built, with several device sizes at once (§16)* | D28, D31–D33, #61, #62 |
| Events linked to snapshots in the shell | P6, #43 |
| Generated hostile states and a screenshot CLI | P8, §8 |
| Stripping snapshots from production builds | D8 |
| Partial updates and streaming | #16 |

## 12. Groundwork rules

What keeps the growth above cheap:

- **One grammar.** The expression parser in `src/core` serves both the runtime and the checker. Values
  become syntax trees; nothing reads them with regexes or `eval`. Growing the language (#6, #46) means
  extending one parser.
- **One path from data to DOM.** The binding table is it. New directives add entries; nothing
  re-renders a whole view.
- **Final shapes, early.** The schema keeps its full top level (`data`, `ui`, `events`) even though `ui`
  is rejected for now, and events keep a reserved `payload` key. Snapshots are `{ data }` objects, so
  `ui` and base-plus-overrides (#34, D30) can slot in. Handlers take a payload argument from day one.
  (Payloads slotted into both in §18, with no change to the host API.)
- **One host API.** `mount`, `update` and `destroy` are what the custom element (D7) and the standalone
  host (D11) will wrap.
- **One renderer.** The shell only renders through the runtime (P5).
- **Safe by default.** No `eval`, no `innerHTML` (#24). Bindings only set text, and the markup rules
  that keep code out of a view are one shared list, applied by both the checker and the runtime.

## 13. Decisions

The plan's open questions, settled before the build:

- **Empty bound elements.** `m-text` elements stay empty, and samples live only in snapshots (P4). The
  checker warns about content inside an `m-text` element, and the runtime replaces it anyway. The raw
  file opened in a browser shows gaps where the data goes; the shell is where the design is read.
- **`emit`, not `$emit`.** Events are sent with `emit('name')`, in single or double quotes, which leaves
  room for `set()` and `toggle()` later (#46). `$emit(...)` is an error with the hint "use emit('name')
  instead of Vue's $emit". The binding language (SPEC §11) can still revisit this.
- **Bun, not Vite and Node.** Bun runs the TypeScript, serves (HTML imports), bundles and tests, so one
  tool replaces Vite, Vitest and Node. `tsc` only type-checks. The cost is a less common setup (P9).
- **A separate example app.** Besides the counter page, `examples/poll/` is an app of its own that uses Melzin as
  a workspace package and has a small backend. It shows the adapter (P3), typed events (D14, D15) and the
  same file in production (P5) from outside the package (§7).

## 14. After the POC: conditionals

The first row of §11, built on 2026-10-17 together with a second example app. It grows the POC's pieces
instead of adding new ones: the shared parser gained `!`, the binding table gained two kinds of entries,
and the runtime and the checker still share their rules through `src/core`.

### Format

| Directive | Value | Effect |
|---|---|---|
| `m-if` | a condition | the element is in the document only while the condition holds |
| `m-else-if` | a condition | in a chain after an `m-if`: the first element whose condition holds shows |
| `m-else` | none | in a chain: shows when no condition before it holds |
| `m-show` | a condition | `display: none` while the condition doesn't hold |

- A condition is a path, optionally negated with `!`: `condition := '!'? path`. It holds when its value
  is truthy in JavaScript, so `false`, `""`, `0` and missing values don't hold; a missing value uses the
  field's `default` first. Objects hold when present, which makes an optional object (`viewer`) a
  natural condition.
- A chain is an `m-if` element followed by `m-else-if` and `m-else` siblings, with only whitespace and
  comments in between. An element has at most one of the three, and may also have `m-show`, `m-text`
  and `m-on:click`.
- No operators. Comparisons, `&&`, `||` and ternaries get one error that names the workaround, a boolean
  the host computes; nested elements cover "and".

### Runtime

- The view is bound and rendered in a document fragment and attached when it's finished.
- Each chain leaves a comment anchor (`<!--m-if-->`) where its first element was, and the element whose
  condition holds sits right after it. The others are out of the document but stay bound, so they show
  current data when they come back, and every element keeps its identity across switches.
- `m-show` sets `style.display` to `none` and restores the element's own value, like Vue's `v-show`.
- A condition the runtime can't use (a parse error, an unknown field) warns and counts as false. An
  `m-else` with no chain to join is ignored, so it shows; an `m-else-if` with none works as an `m-if`.

### Checker

Errors: a condition that doesn't parse (operators get the hint above), an unknown field, a call, an
`m-else` or `m-else-if` with no chain to join, a value on `m-else`, and more than one of `m-if`,
`m-else-if` and `m-else` on an element. Warnings:

- a condition on a required object, which always holds (or never, with `!`)
- **no snapshot shows an element behind a condition** (P8). The checker evaluates every condition
  against every snapshot with the runtime's own rules (`core/data.ts`) and names the condition that never
  holds, or says that it only holds where an element around it is hidden. It waits until the snapshots
  match the schema, and reports only the outermost element that never shows.

"data field 'x' is never displayed" became "is never used", since conditions use fields too.

### Profile example

`examples/profile/` is a member profile with a follow button and a small Bun backend that owns who follows
whom. The button is a four-way chain on the optional `viewer` object (sign in, this is you, following,
follow or follow back), optional fields get designed fallbacks with `m-else`, and the badges use
`m-show`. Its six snapshots cover every branch, and the hostile one found a design limit: nine-digit
counts don't fit the stats row on a phone, so the adapter sends compact ones (`98.8M`). Besides contract
and API tests, it has view tests that mount the real view file with the real runtime in happy-dom, fed by
the adapter. It's the seed of the profile page in SPEC §11's first build battle.

### Decisions

Made for this step. The binding-language battle (SPEC §11) can still revisit them.

- **A condition is a path with an optional `!`.** It's the smallest part of the language conditionals
  need. Comparisons would bring literals and enum types with them, so they wait for the battle; until
  then the host sends booleans, which also keeps the schema shaped for the screen (P3).
- **JavaScript truthiness, as in Vue** (P9), applied after defaults. Numbers included:
  `m-show="unread"` hides a zero count.
- **A broken condition is false.** A typo in `m-if="isAdmin"` should hide the admin button, not show it
  to everyone.
- **Hidden branches stay bound.** Simpler than binding on demand, and showing one again is a single
  insert. Images in a hidden branch still load; binding on demand can come later without changing the
  format.
- **`m-show` sets an inline `display`, not the `hidden` attribute.** On a host page without Tailwind's
  preflight, a class such as `flex` would override `hidden`. Vue does the same.
- **Snapshot coverage is a warning**, like the other P8 checks: a view in progress can have a branch
  without a snapshot yet.

## 15. After the POC: routing

Built on 2026-10-17, from SPEC D20–D27, settled on paper the same day. It turns the profile example
into an app with two pages. As with conditionals, it grows the existing pieces: the shared core gained
the route table, `mount` gained a directive and an input, and a new `startApp` wraps `mount` (§12).

### Format

**routes.json**, at the project root (D21):

```json
{
  "routes": {
    "members": { "path": "/", "view": "members", "query": { "as": {} }, "code": "eager" },
    "profile": { "path": "/u/:handle", "view": "profile", "query": { "as": {} } }
  }
}
```

- A route has a name (an identifier), a `path`, a `view` (its file name without `.mel.html`), optional
  `query` parameters, a `code` policy (`eager`, `prefetch` by default, `lazy`), a `data` policy
  (`stale-while-revalidate` by default, `network-only`) and a `description` (D24).
- Paths are URLPattern syntax (D22), its simplest part only: literal segments and whole-segment `:name`
  parameters. Routes match in table order, case-sensitively; parameters are decoded. A test checks
  that matching agrees with the browser's `URLPattern`.

**Link fields** (D23): a string field with `"route": "<name>"` in the schema. Views bind it with
`m-bind:href="path"`, the only `m-bind` so far, on `<a>` and `<area>`. The generated types make the
field `Href<'<name>'>`, which only the `href` helper returns.

**The URL input** (D27): `route.name`, `route.params.<name>` and `route.query.<name>` in `m-text` and in
conditions. `route` is reserved at the top of `data`. Snapshots may set
`"route": { "params": { ... }, "query": { ... } }`.

### Runtime

- `mount` takes a `route` option, `view.setRoute(route)` replaces it, and `m-bind:href` sets or removes
  `href` from a link field. `javascript:`, `vbscript:` and `data:` URLs are dropped with a warning.
- `startApp(root, { routes, source, navigate?, viewUrl?, loadView?, onWarning? })` is the standalone
  host (§7 of SPEC). The URL picks the route, the route's view is fetched and mounted with the data
  from `source.<route>.load(route, { signal })`, and its events go to `source.<route>.on`. Handlers get
  the payload and the page: `route`, `data`, `update`, `navigate`, `reload`, and `current`.
- Navigation (D25): clicks on links to routes (left button, no modifier keys, no `target`, no
  `download`), back and forward, and `navigate()` all go through the optional `navigate` hook, which
  may return `false` to stay or a URL to go elsewhere (redirects go through the hook too; ten in a row
  stop). The URL changes first, as with a normal link; then the data loads and the screen swaps. A URL
  with no route leaves the app with a normal page load.
- Loading (D24): `eager` views load with the first page, `prefetch` ones when the browser is idle after
  it, `lazy` ones on intent (a link hovered, focused or touched). Intent also prefetches the data of
  `stale-while-revalidate` routes. Those routes keep their last data per URL: navigating back shows it
  at once and refreshes it; data a prefetch just loaded shows without a second load.
- Scroll: to the top (or to the `#hash`) after a new navigation, and back to where it was on back and
  forward.
- `hrefs<Routes>(routes)` builds URLs from the table, typed by the generated `Routes`.

### Checker and types

`melzin check` checks routes.json with the views (by default when it exists): its own rules, that each
route's view exists, and each view against it: `route.params` and `route.query` that every route showing
the view has, link fields that name real routes, snapshot link values that are URLs of their route,
snapshot routes and the parameters a view shows, and static links that match no route (a warning).
`melzin types routes.json` writes `routes.types.ts` (each route's `params`, `query`, `data` and
`handlers`) and the types of the views it shows; `melzin check` warns when it's out of date. A tsc test
shows a typed source rejecting a hand-built link, a link to the wrong route, a missing handler and a
missing route.

### Shell

The view picker lists the routes as pages above the views (`?route=profile`, D26). A page renders its
view's snapshots, each card with a URL bar that shows the URL from the snapshot's `route` and accepts
another URL of the same route, which reaches the view through `setRoute`. A click on a link to a route
shows as `navigate → profile /u/ana` in the event log (D25). `/__melzin/api/routes` lists the routes,
or the problems in routes.json.

### Profile example

Now two pages: the members at `/` (three fixed slots, since lists weren't built yet, and a list since
§18; "Browsing as" from `route.query.as`; links that try each scenario) and the profile at
`/u/:handle`, with a link back. The adapter moved to `model.ts`, with no server in it, so `source.ts`
has two sources over one contract (D20): `remoteSource()` asks the server's API, and
`localSource(network)` runs the adapter in the browser, as an offline-first app would over IndexedDB.
The client uses the remote one; a new app test runs the whole app on the local one in happy-dom. Checked by hand in a real browser: the screens switch
without a reload, follow and unfollow update the page, back and forward work, and the shell lists the
pages, logs navigations and applies edited URLs.

### Decisions

Made for this step; SPEC's open items (§7) can still revisit them.

- **`routes.json` at the project root,** next to `theme.css`, one per project.
- **Only whole-segment parameters.** Matching and building URLs are a few lines that also run on the
  server (the example's server registers one route per path), and the checker can say exactly which
  URLPattern feature isn't supported yet.
- **Link fields are `"route": "<name>"` on a string field,** not a new type. Without a route table, a
  link field and `route.*` paths are warnings, not errors, so a view can be written before its route.
- **`route` needs no declaration in the view.** The checker checks it against the routes that show the
  view; a view no route shows gets a warning.
- **The History API, not the Navigation API.** The `navigate` hook follows the Navigation API's model
  (one event for every navigation, a default the app can override), but the host listens to clicks and
  `popstate`, which every browser has. Back and forward can't be cancelled before they happen; a hook
  that returns `false` puts the current page's URL back.
- **The host doesn't set `document.title`, and has no not-found or error pages:** a URL with no route
  or a failing loader shows a plain message. Page titles, error pages, focus after navigation and view
  transitions are still open.
- **`offline` waits** for the generated service worker; the checker says so. So do server rendering
  and the static source's prerendering.

## 16. After the POC: design stages

Built on 2026-10-17, from SPEC D28 and D31–D33. The later stages already worked as places to stop: a
static view, or one with a schema and snapshots but no events, renders and checks clean, and nothing
asks for what a later stage decides. This step gives the first stage a home: alternatives sit side by
side in the shell, each view shows its stage, and every render can show at several device sizes at once.
As before, it grows the existing pieces: the core gained the stage rule, the project gained `explore/`,
the shell server two endpoints, and the shell a second layout.

### Format

```
views/                  what ships
  profile.mel.html
theme.css
explore/                design alternatives (D31), never shipped
  compact/
    profile.mel.html    stands in for views/profile.mel.html
  warm/
    theme.css           layered over theme.css (D32)
    welcome.mel.html    a screen that only exists here so far
    signup.mel.html
```

- An alternative is a folder directly inside `explore/`, named after the alternative. Its `*.mel.html`
  files stand in for the views with the same file name, whether `views/` has them yet or not.
  `current` can't name one (it's the shell's name for the version in `views/`), and a view file
  directly in `explore/` belongs to no alternative.
- A `theme.css` in the folder follows the project theme's rules and loads after it, so the tokens it
  sets win (D32).
- `<meta name="description">` says what an alternative tries; the shell shows it above its column.
- The stage (D33) is `exploration` with no schema block and no snapshots block, `states` with either,
  and `contracts` once the schema declares an event or a link field, or a directive reads `route.*`.
  `viewStage()` in the core holds the rule.

### Shell

- A view with alternatives shows as a comparison: a column per version, the one in `views/` first
  (`current`) and then each alternative by name, and a row per snapshot, in order of first appearance.
  A version without snapshots shows in a first row, `no data`; a version that lacks a row's snapshot
  gets an empty cell that says so.
- Column headers give the version, its file, its stage, a badge for a theme, and its description. In a
  comparison the panels sit under the frames, closed, so each column is as wide as its frames.
- An alternative with a theme also shows next to the views it doesn't redesign, marked `theme only`:
  the file in `views/` with the alternative's CSS.
- `?alt=<name>` (or `alt=current`) shows one version; so do the Version picker and "Open alone" on a
  version's header. "Open alone" on a card keeps its version. The view picker counts each view's
  alternatives and lists the screens that only exist in `explore/` under Exploring.
- `?device=` takes a list, `phone,desktop` or `375x812,1280x800`: each card shows a frame per size,
  sharing the card's state editor, URL bar and logs. Events say which frame they came from; warnings come
  from the first frame, since every frame renders the same data. The device picker offers each preset
  and two combinations (Phone + Desktop, and all three).
- A static view has no state editor, and its event log waits for link clicks. The top bar shows a
  view's stage with its file: `profile-card.mel.html · states · 4 snapshots`.
- With `chrome=0`, the first frame still sits at the top-left corner at its exact size; the others
  follow 16 pixels apart.
- `/__melzin/api/explore` lists the alternatives (their views and whether they bring a theme) and the
  view files `explore/` can't use. `/explore/<alternative>/<file>` serves an alternative's file like
  `/views/`, and `/__melzin/styles.css?alt=<name>` is an alternative's CSS. Entries of
  `/__melzin/api/views` gained `description` and `stage`.

### Checker and CSS

- `melzin check` checks every alternative by default, as the view it stands in for, so the route rules
  apply to it. A view file directly in `explore/` or in `explore/current/` is an error.
- `buildCss` takes an `alternative`: its folder is scanned too, and its theme comes after the project's.
  Production builds (`melzin css`) and servers still read only `views/`.
- `loadViewFile` also returns the view's description and stage.

### Demo

`packages/cli/explore/` explores a new screen, Plans, in two directions: `calm` (centered cards, the
project theme) and `bold` (dark, plans as rows, its own theme with an indigo brand and tighter corners),
so the shell also shows the other demo views with `bold`'s theme. Checked by hand in a real browser: the
comparison at phone and desktop sizes, the theme-only columns, the version and device pickers, focused
and broken URLs, `chrome=0` positions, events from each frame of a card, and a route page of the profile
example compared with an alternative.

### Decisions

Made for this step; SPEC #61 keeps what's still open.

- **Folders, not variants in one file or branches** (D31). Alternatives stay plain view files, so the
  format doesn't change, several agents can explore at once, and a direction can span screens and bring
  a theme. A comparison across git worktrees could reuse the same columns later.
- **An alternative replaces whole files.** Nothing merges its markup with the current file.
- **A theme reaches every screen** (D32). Promoting an alternative merges its tokens into the project
  theme, which restyles screens it never touched, so the shell shows those too.
- **`current` is reserved** for the version in `views/` instead of adding a URL parameter for it; a
  folder with that name is an error.
- **The stage is inferred** (D33), so it's never out of date. No check depends on it yet; forgotten
  bindings (#33) would be the first.
- **Promoting is a file move,** not a command: the authoring guide says how (move the files, merge the
  theme, delete the folders), and git keeps the alternatives that lost.
- **Device sizes share one card,** with one state editor, so an edit shows at every size at once.
- **No CSS cache.** Each frame builds its CSS on request (about 14 ms; thirty at once take about 0.3 s),
  so nothing can go stale.

## 17. After the POC: snapshots that extend a base

Built on 2026-10-17, from SPEC D30, in the form Q14 leans to. Only the snapshots changed: the core
resolves them, so the runtime, the shell and the checker all see merged snapshots.

### Format

```json
{
  "follows you": {
    "data": {
      "membersUrl": "/?as=ana",
      "user": { "name": "Bruno Lima", "handle": "bruno" },
      "viewer": { "isSelf": false, "following": false, "followsYou": true }
    },
    "route": { "params": { "handle": "bruno" }, "query": { "as": "ana" } }
  },
  "signed out": {
    "extends": "follows you",
    "data": { "membersUrl": "/", "viewer": null },
    "route": { "query": null }
  }
}
```

- `extends` names another snapshot of the block, before or after it in the file.
- The snapshot's `data` and `route` merge into its base's like JSON Merge Patch (RFC 7396): objects
  merge field by field, `null` removes a field, and anything else replaces the base's whole.
- Chains are fine. Extending itself, a name the block doesn't have, a value that isn't a name or a
  cycle is an error. Such a snapshot still shows in the shell with what it sets itself, and its data is
  checked once its chain resolves.

### Core

- `parseSnapshots` resolves every snapshot (memoized, catching cycles) and checks it once merged. A
  problem it shares with its base, in a value it inherits, is reported only at the base, so a mistake in
  a base shows once instead of in every snapshot built on it. A `null` on a required field says "the
  schema requires this field, so null can't remove it", at the `null`.
- `melzin/core` exports `mergePatch` (RFC 7396) and `snapshotOwnPaths` (what a snapshot sets itself,
  as opposed to what it inherits). Merged snapshots share no objects, and a `__proto__` key stays an
  ordinary key.
- `Snapshot` gained `extends`.

### Checker and shell

- Problems in `extends` point at its key, like every snapshot problem.
- New warnings for a `null` that removes nothing: a field the base doesn't have, with a suggestion when
  it looks like a typo, or any `null` in a snapshot that extends none.
- The route checks (link values, URL parameters) follow the data's rule: a problem in an inherited
  value is reported at the base.
- A card in the shell shows `extends <base>` next to its name. Its state editor shows the merged data,
  and Reset goes back to it.

### Examples

In the profile example, "signed out" and "very long everything" extend "follows you", and "your own
profile" extends "following"; profile.mel.html is 26 lines shorter. The members page's "browsing as
Ana" extends "nobody signed in" and changes only its links and URL (since §18 it restates the list,
which replaces whole), and the poll's "very long question" extends "close race" and sets only the
question. The contract tests, which compare each snapshot with
what the adapter produces for its state, pass unchanged.

### Decisions

Made for this step; SPEC Q14 can still revisit them.

- **JSON Merge Patch, as Q14 leans** (P9), with `extends` as in `tsconfig.json`. Changing one list item
  means restating the list.
- **The whole snapshot merges,** `route` included: a state that drops `?as=` sets
  `"route": { "query": null }`.
- **`null` means "don't inherit this".** In a snapshot that extends none it removes nothing, so it's a
  warning (leave the field out) rather than the type error it was: the data is valid either way.
- **A mistake is reported where it's made.** A snapshot isn't held to what it inherits; fixing the base
  fixes every snapshot built on it.
- **Order doesn't matter,** as with names: a snapshot can extend one further down, so the file keeps the
  order the shell shows.
- **Every snapshot shows.** There are no hidden bases; a base is a real state, like "follows you".
- **A broken chain doesn't stop the preview.** The snapshot shows with what it sets itself, and its data
  waits to be checked, instead of piling up "missing field" errors that the broken `extends` explains.

## 18. After the POC: lists and event payloads

Built on 2026-10-18, from SPEC D34–D36, settled on paper the same day. Like conditionals, it comes ahead
of the binding-language battle (SPEC §11): what the contract depends on is settled, and the syntax
inside the attributes is provisional. It grows the existing pieces: the schema gained lists and
payloads, the shared parser two forms, the binding table a block per row, and the core a module of
payload rules (`core/payload.ts`), so the runtime and the checker still agree (§12).

### Format

```html
<ul class="divide-y" m-if="options.length">
  <li m-for="option in options">
    <span m-text="option.label"></span>
    <button type="button" m-on:click="emit('vote', { optionId: option.id })">Vote</button>
  </li>
</ul>
<p m-else>No options yet</p>
```

```json
{
  "data": {
    "type": "object",
    "properties": {
      "options": {
        "type": "array",
        "key": "id",
        "items": {
          "type": "object",
          "properties": { "id": { "type": "string" }, "label": { "type": "string" } },
          "required": ["id", "label"]
        }
      }
    },
    "required": ["options"]
  },
  "events": {
    "vote": {
      "payload": { "type": "object", "properties": { "optionId": { "type": "string" } }, "required": ["optionId"] }
    }
  }
}
```

| Directive | Value | Effect |
|---|---|---|
| `m-for` | `alias in path` | repeats its element once per item of a list, keyed by the list's key |
| `m-on:click` | `emit('name')` or `emit('name', { field: path, ... })` | sends the event, with a payload built from paths |

- **Lists (D34).** A list field has `"type": "array"`, `items`, and optionally `key`, `uniqueItems`,
  `minItems`, `maxItems` and `description`. It has no `default`: a missing optional list renders like
  an empty one. Items are an object schema, whose `key` names a direct, required string or number
  field, or a string or number leaf, keyed by its values, which says so with `"uniqueItems": true`
  and may carry `route` (a list of links). Lists of lists, lists of booleans and tuples are errors
  whose messages name the fix. `data` stays an object.
- **Payloads (D35).** `events.<name>.payload` is an object schema of string, number and boolean
  leaves, with `required` and descriptions. No defaults, links, objects or lists.
- **Grammar.** `loop := ident 'in' path` for `m-for`, and for payloads
  `call := ident '(' (string (',' arg)*)? ')'`, `arg := string | object`,
  `object := '{' (field (',' field)* ','?)? '}'` and `field := ident ':' path`. An `m-for` path may
  start with an outer alias (`tag in member.tags`). Every other form gets a message that names its
  fix: `of`, an index, destructuring, ranges, and calls or filters after the list for `m-for`; a
  positional payload, shorthand, literals, `!`, calls and repeated fields for `emit`.
- **Scope.** Inside a row, a path may start with the alias, which stands for the row's item; for a
  list of strings or numbers the alias is the value. A row's item always exists, so a path from the
  alias starts out required. `<list>.length` counts the items, in conditions only (`m-if`,
  `m-else-if`, `m-show`); a real field named `length` is still that field.
- **Data.** `validateData` checks lists: arrays, every item, keys present and unique in each list
  (two polls may reuse option ids), `minItems` and `maxItems`, and no `null` items. Issue paths show
  indexes, `members[2].handle`. Keys compare in a `Map`, so `1` and `"1"` differ and `__proto__` is a
  plain key.
- **Stage (D33).** A link field inside items makes the view a contract; a key doesn't change the stage.

### Runtime

- **Compiled once per template.** The view's body is one template and every `m-for` element another,
  with its own plan: where its texts, links, conditions, clicks, chains and nested lists sit, as child
  indexes. Each directive is parsed and resolved once, so a bad one warns once, not once per row. A
  row is a clone of its template, bound from the plan.
- **Rows.** Each `m-for` element is replaced by a comment anchor, `<!--m-for-->`, and its rows (without
  the `m-for` attribute) follow it back to back, in data order. When the `m-for` element is its
  container's only content (the rest is whitespace-only text or comments), the container's
  whitespace-only text goes, so it's `:empty` while the list has no rows. Anywhere else the source's
  whitespace stays, so a list in running text keeps the spaces before its first row and after its
  last. Another list's anchor counts as content.
- **A scope per row.** Every row has its own bindings, and its alias reads the row's current item at
  render time, so a kept row shows its item's new values in the same elements.
- **Keyed rows.** On every render, rows match items in a `Map` by key: the key field, or the value in a
  list of strings or numbers. A kept key keeps its row; new keys get new rows; rows of keys that are
  gone are removed, with their listeners and their nested rows' listeners. Rows in the longest run that
  is already in order stay put, as in Vue 3, and the others move with `Element.prototype.moveBefore`
  where the browser has it, which keeps their state, or `insertBefore` otherwise.
- **Data that doesn't match.** Missing, mistyped or duplicate keys are data warnings (from
  `validateData`, which already runs), and that list's rows follow its items by position for that
  render. A value that isn't an array renders no rows.
- **A broken `m-for`** (a parse error, an unknown list, a field that isn't a list, an alias already
  taken, or `m-if`, `m-else-if` or `m-else` on the element) warns once ("...; shows no rows") and
  renders nothing: as with a broken condition, hiding beats showing the wrong thing. Nothing inside it
  is compiled.
- An `m-for` element ends any chain before it. Lists inside hidden branches stay bound, rows included
  (§14).
- **Payloads.** A click builds the payload with `buildPayload` (`core/payload.ts`) from the row's
  current item, the data and the URL, with defaults, leaves out fields whose value is missing, and
  calls the handler with it. Events without a payload still get `undefined`. An emit that doesn't match
  its event's payload warns once; one that leaves out a payload its event declares sends `{}`.
- **Types.** `melzin` exports `Payload` (`Record<string, string | number | boolean>`), which `mount`'s
  default handler type takes. `startApp`'s handlers get `(payload, page)`, with the payload typed from
  the generated `Handlers`.
- `destroy()` removes every row and its listeners, at every depth, top-level lists included.

### Checker and types

- **Errors** for every rule above, at its line and column: an `m-for` problem at the alias or the
  path, a payload problem at the field or the value. Paths inside rows resolve through the alias, and
  an unknown field suggests names from the items. Also errors: `m-if`, `m-else-if` or `m-else` on an
  `m-for` element, `.length` outside conditions, a list in `m-text` or `m-bind:href` (pointed at
  `m-for`), `:key` and its spellings ("keys live in the schema"), and a `<template>` with `m-for`,
  `v-for` or `x-for`. A broken `m-for` skips the paths that may read its item, so it's the only error
  until it's fixed.
- **Payloads (D15),** with core's `payloadIssues`: a payload exactly when the event declares one,
  every required field, no unknown field ("did you mean"), each value a leaf of the field's type (a
  link field is a string), and a value that may be missing only in an optional field.
  `route.params.<p>` is a present string where the route declares `:p`; `route.query.<q>` may be
  missing.
- **Snapshots.** List data problems (keys, duplicates, `minItems` and `maxItems`, nulls) are errors at
  their JSON position, `data.members[2].handle`. A `null` inside a list is never a removal, so it gets
  its own error instead of the "removes nothing" warning. A problem in an inherited list is reported at
  the base (§17). Each item's link value is checked against its route, `data.members[1].url`.
- **Coverage (P8),** with the runtime's rules: an element in a row shows when it shows in any row of
  any snapshot. A list whose rows never show gets "no snapshot shows a row of 'members' (it's empty in
  every snapshot)". Once per list field, at the first `m-for` over it: "no snapshot shows 'members'
  empty; add one to design the empty state, or set "minItems": 1 if it's never empty" (skipped when
  `minItems` is 1 or more), and "no snapshot shows 'members' with more than one item" (skipped when
  `maxItems` is 1).
- **Other warnings:** a condition on a list itself, which holds even when it's empty ("test
  members.length"), and a static `id` inside a row.
- **"Never used"** names item fields as `members[].name`. An `m-for` or a `.length` condition uses a
  list, an `m-for` its key, reading the alias of a list of strings or numbers its values, and a payload
  the fields it reads. A list that nothing uses gets one warning, not one per item field.
- **Types.** Lists are inline readonly arrays:
  `members: readonly { handle: string; url: Href<'profile'> }[]`, `members?:` when optional,
  `tags: readonly string[]`, so a host may pass readonly arrays or `as const` data. Handlers type
  their payload, `vote: (payload: { optionId: string; note?: string }) => void`, with descriptions as
  comments; events without one keep `(payload?: undefined) => void`, and `routes.types.ts` follows.
  The tsc tests show a host whose handler takes the right payload passing, and one whose handler takes
  a wrong payload type or a field the payload lacks, a wrong item or a list of the wrong values failing
  with `mount`; with `startApp`, a wrong payload type and a hand-built link inside a list fail.
- 35 new fixtures in `packages/cli/tests/fixtures/check/`: `good-lists.mel.html` with no diagnostics,
  and one per rule with exactly one.

### Shell

- The frame passes each event's payload to the shell (`protocol.ts` accepts only an object of
  strings, numbers and booleans). The event log shows it as compact JSON on its own line under the
  event name, `{"optionId":"pizza"}`, set as text. Past 80 characters it's cut, never inside an
  emoji, with the whole JSON in its title.
- The state editor already edited lists as JSON; keyed rows keep their elements through edits.
- Checked by hand in headless Chromium: rows, nested lists and empty states, payloads in the log, cut
  and whole, and edits that reorder, change, add and remove items while the other rows keep their
  nodes.

### Examples

- **Members** (`examples/profile`). The three fixed slots became `members`, a required list keyed by
  `handle`. The `<ul>` shows with `m-if="members.length"`, and an `m-else` after it is a "No members
  yet" design. `toMembersModel` returns everyone, sorted by handle. The snapshots restate the list:
  "browsing as Ana" still extends "nobody signed in" and restates all three cards to change their
  links (D36's cost), and "one member" and "no members yet" are new. View tests show that an update
  keeps each member's `<li>` when someone new sorts first, and that a member who leaves takes only
  their card. The "very long names" snapshot showed cards growing past a phone's width, which was
  already true before lists, so the grid gained `grid-cols-1`.
- **Poll** (`examples/poll`). The options became `options`, a required list keyed by `id` with
  `"minItems": 2`, so `melzin check` asks for no empty state. One `vote` event with
  `{ optionId: string }` replaced `votePizza`, `voteTacos` and `voteSushi`. The hand-drawn icons
  couldn't follow into one template (attributes can't be bound yet), so each option has an `emoji`
  shown with `m-text` in one brand-tinted square, and the button reads
  `Vote<span class="sr-only"> for <span m-text="option.label"></span></span>`. The backend's poll is
  data (`MEETUP_POLL`), `toViewModel` builds `options` in the poll's order, and
  `POST /api/poll/votes` takes `{"optionId": "pizza"}`, the view's payload, so the client's handler is
  `vote: ({ optionId }) => ...`. The snapshots became lists ("very long question" still extends
  "close race" and keeps its list), and a new one, "six options with long labels", showed labels
  squeezed to a word per line on a phone, so a row there stacks its percent above the button. New
  view tests mount the real view.
- Both were checked by hand in headless Chromium: every snapshot in the shell, and the poll's
  production page, where votes update the counts and the rows keep their elements.
- `packages/cli/views` and the `explore/` demo are unchanged: an exploration stays static (D28).

### Decisions

Made for this step; the binding-language battle (SPEC §11) can still change them.

- **`m-for="item in list"`, and nothing else.** No index, destructuring, ranges or filters: position
  variants style rows, the key identifies them, and the host sends the list as it should show (P3).
  Each other form is an error that says so.
- **The key lives in the schema** (D34), and `:key` is an error that points there. A list of objects
  names one; a list of strings or numbers is keyed by its values.
- **`.length` only in conditions.** It's what empty states need; a count to show is a field the host
  formats.
- **No `m-if` on an `m-for` element.** Vue's precedence between `v-if` and `v-for` changed from Vue 2
  to Vue 3, so either reading surprises someone. A wrapper, a condition inside the row or a filtered
  list each say what they mean.
- **No `<template>`** (SPEC Q15). A list repeats one element, and one wrapper covers the known cases:
  `class="contents"`, a `<div>` around each `<dt>` and `<dd>` pair, a `<tbody>` per item. `<template>`
  stays an error until a real screen needs it, since allowing it later only adds to the format. Its
  message names the wrapper, and `<template m-for>` points at `m-for` on the element.
- **Rows follow a comment anchor, with nothing between them,** like a chain's branches, so the
  container holds only what the author wrote, and `:empty` and position variants work.
- **Bad keys fall back to positions** for that render, with the data warning: the rows still show, as
  the data does. A broken `m-for` shows nothing, like a broken condition.
- **Compile once, bind per row.** A template's directives are parsed and resolved once; rows are
  clones bound from the plan.
- **`moveBefore` where the browser has it,** so a moved row keeps its focus and animations, and
  `insertBefore` elsewhere.
- **Payload values are paths, payload fields leaves** (D35). Literals, `!`, `.length` and the DOM
  event wait for the battle; a key such as `option.id` stands for the item.
- **A missing value is left out of the payload,** and an emit without the payload its event declares
  sends `{}` with a warning, so a handler that destructures doesn't throw.
- **Lists replace whole in snapshots** (D36). The members page's restated list is the cost, and it's
  small.
