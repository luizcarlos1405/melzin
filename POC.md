# Melzin POC

> The smallest version that proves "design is implementation": an AI writes a page as one HTML file, a
> shell previews it in several states, and the same file runs in production with real data and a
> working button.

**Status:** built, and M3's AI authoring trial passed (§10). Since then, conditionals and a second
example app have been added (§14), and routing: the route table, links, the URL input, the standalone
host and pages in the shell (§15). The code is a Bun workspace: the Melzin packages in
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
one comes in.

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

That was the whole language of the POC; conditions came after it (§14). Values are parsed into a small
syntax tree and never evaluated (P1, #24). Paths and event names are identifiers (`[A-Za-z_][A-Za-z0-9_]*`); paths join them with dots. The
event name is a string in single or double quotes. Vue's `$emit(...)` is an error with the hint
"use emit('name') instead of Vue's $emit" (§13).

### Schema

- `data` is a subset of JSON Schema: objects with `properties` and `required`, leaf types `string`,
  `number` and `boolean`, and `default` for missing values (P4). `description` is allowed anywhere; any
  other keyword is an error.
- `events` maps each event name to `{}`. The `payload` key is reserved for typed payloads (D14).
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

- Each snapshot is a named, complete state with a `data` object. A `ui` object comes later.
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
  take it as their argument (D14).
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
  - an event log with each emitted event and its time. Nothing else happens, because the shell has no
    host (#43)
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
- invalid JSON or a duplicate data block, or a schema outside the subset above ("lists aren't supported
  yet (SPEC #1)")
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
sushi.

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
| Snapshots that extend a base snapshot and override what differs | D30, #34, Q14 |
| `m-bind`, including `m-bind:class` with literal classes | #8, #11, #52 |
| `m-for` with keys and empty states | #1, §9.1 |
| Internal `ui` state and state operations in handlers | D5, #46 |
| Formatters for numbers and dates, built on `Intl` | #6 |
| Event payloads, any DOM event in `m-on`, and modifiers | D13, D14 |
| `m-model` and forms | #20 |
| Stable IDs and schema diffs | #13, #3, §9.3, §9.4 |
| Components: views inside views, schemas composed with `$ref` | D16–D19, #12, §9.5 |
| A custom element that dispatches DOM events | D7, §7 |
| The standalone host: *built, with the route table, links and pages in the shell (§15)* | D11, D20–D27, #31, #51 |
| Exploration: design alternatives side by side in the shell | D28, #61, #62 |
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

Now two pages: the members at `/` (three fixed slots, since lists aren't built; "Browsing as" from
`route.query.as`; links that try each scenario) and the profile at `/u/:handle`, with a link back. The
adapter moved to `model.ts`, with no server in it, so `source.ts` has two sources over one contract
(D20): `remoteSource()` asks the server's API, and `localSource(network)` runs the adapter in the
browser, as an offline-first app would over IndexedDB. The client uses the remote one; a new app test
runs the whole app on the local one in happy-dom. Checked by hand in a real browser: the screens switch
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
