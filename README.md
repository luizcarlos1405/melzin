<img src="assets/icon.svg" width="64" height="64" alt="">

# Melzin

**Design is implementation.**

[![CI](https://github.com/luizcarlos1405/melzin/actions/workflows/ci.yml/badge.svg)](https://github.com/luizcarlos1405/melzin/actions/workflows/ci.yml)
[![License: MIT](https://img.shields.io/badge/license-MIT-blue.svg)](LICENSE)
![Status: proof of concept](https://img.shields.io/badge/status-proof%20of%20concept-orange.svg)

Melzin is a UI framework built for AI authors. A view is one HTML file: Tailwind classes, a schema of the
data it shows and the events it sends, and sample states. The same file is the design you preview in
every state and the front end you ship. Nothing gets handed off or translated between the two.

> **Early proof of concept.** The basics work end to end and are tested, but the format has only two
> directives so far, nothing is on npm yet, and everything can still change. Ideas, questions and
> critique are very welcome in [issues](https://github.com/luizcarlos1405/melzin/issues).

## Why

- **One file, two jobs.** The preview and production render the same file with the same runtime, so the
  design can't drift from the product.
- **A typed contract between UI and backend.** Each view declares the data it needs and the events it
  emits. The backend feeds data in and handles events, and generated types make the compiler catch a
  missing handler or data of the wrong shape.
- **Every state, visible.** Views carry named snapshots: empty, typical, very long text, huge numbers. The
  preview shell renders them all side by side, and you can edit any of them live.
- **Made for AI authors, checkable by machines.** The format is plain HTML, Tailwind and Vue-like
  directives that models already know. Bindings are data, never code, so a checker can verify a view and
  explain each mistake.

## A quick look

A view, `views/counter.melzin.html` (trimmed):

```html
<head>
  <title>Counter</title>
  <script type="melzin/schema">
    {
      "data": { "type": "object", "properties": { "count": { "type": "number" } }, "required": ["count"] },
      "events": { "increment": {} }
    }
  </script>
  <script type="melzin/snapshots">
    { "zero": { "data": { "count": 0 } }, "huge number": { "data": { "count": 1234567 } } }
  </script>
</head>
<body>
  <p class="text-6xl font-bold" m-text="count"></p>
  <button class="rounded-lg bg-violet-600 px-5 py-2.5 text-white" m-on:click="emit('increment')">Click me</button>
</body>
```

The checker explains mistakes the way a compiler does. With a typo and Vue's `$emit` in the full file:

```
$ melzin check
views/counter.melzin.html:30:70: error: m-text: unknown field 'cuont' (did you mean 'count'?)
views/counter.melzin.html:32:25: error: m-on:click: use emit('name') instead of Vue's $emit
```

`melzin types` turns the schema into TypeScript, and the host mounts the same file in production:

```ts
import { mount } from 'melzin'
import type { Data, Handlers } from './views/counter.types.ts'

let count = 0
const view = await mount<Data, Handlers>(document.querySelector('#app')!, '/views/counter.melzin.html', {
  data: { count },
  on: { increment: () => view.update({ count: ++count }) },
})
```

The view never changes its own data. It emits `increment`, the host decides what that means and calls
`update`, and only the text that changed is rewritten.

## How it works

1. **Write** a `*.melzin.html` view. [docs/authoring.md](docs/authoring.md) is the complete guide, written
   so an AI can follow it with no other context.
2. **Check** it with `melzin check` until it's clean.
3. **Preview** it with `melzin shell`: every snapshot in its own frame at phone, tablet or desktop size,
   with zoom, a live state editor and an event log per frame. URL parameters open a single state for
   screenshots, so an AI can review its own work.
4. **Generate types** with `melzin types` and wire the host or backend to them.
5. **Ship** the same file. In the browser, `mount` parses the view, strips anything unsafe, binds the `m-`
   directives once, and from then on rewrites only the text whose value changed.

Rendering happens in the browser for now; server-side rendering is on the roadmap.

## Try it

You need [Bun](https://bun.sh) 1.4 or newer. Melzin isn't on npm yet, so you run it from this repository.

```bash
git clone https://github.com/luizcarlos1405/melzin.git
cd melzin
bun install        # installs every workspace
bun test           # runs every test
```

Then try the sample poll app, a separate app that uses Melzin as a package and has a small Bun backend:

```bash
cd sample
bun run dev        # the app, on http://localhost:3000
bun run shell      # the preview shell for its views, on http://127.0.0.1:4321
```

More commands:

| Where | Command | What it does |
|---|---|---|
| root | `bun run typecheck` | type-checks every package |
| root | `bun run check` | checks every view in the package and the sample |
| `packages/melzin` | `bun run shell` | the preview shell for the example views |
| `packages/melzin` | `bun run example:counter` | the counter's production page, on http://localhost:3001 |
| `sample` | `bun run types` | regenerates `views/poll.types.ts` |

The CLI has four commands: `check`, `types`, `shell` and `css`. Run `bunx melzin --help` in `sample/` to
see their usage.

## What's in the repository

```
packages/melzin/      the framework: runtime, checker, type generator, CSS builder, preview shell
  views/              example views (hello, profile card, counter)
  examples/counter/   a production page that mounts the counter
sample/               a poll app that uses Melzin, with a small Bun backend
docs/authoring.md     the view format and its rules, for whoever writes views
SPEC.md               the design record: decisions, principles and a numbered list of hard problems
POC.md                what the proof of concept builds, how, and what comes next
```

## Progress

The proof of concept ([POC.md](POC.md)) is done:

- [x] View format v0: one HTML file with a schema, snapshots, Tailwind classes, `m-text` and `m-on:click`
- [x] Browser runtime: `mount`, `update` and `destroy`, with precise updates and unsafe markup stripped
- [x] Checker with line and column positions, Vue and Alpine hints, and security rules
- [x] Type generation, so a missing handler or wrong data fails type checking
- [x] Tailwind v4 CSS build with one project-wide theme
- [x] Preview shell: snapshot grid, device sizes, zoom, live state editor, event log, single-state URLs
- [x] A production example, and a sample app with a backend, contract tests and API tests
- [x] AI authoring trial: an agent given only the guide wrote a new view that passed the checker on its
  first draft

## Roadmap

Roughly in order. [SPEC.md](SPEC.md) explains the reasoning, and POC.md §11 maps each step to the spec.

**Next: the binding language, on paper.** What an expression can contain, list syntax and keys, internal
state operations, event payloads and forms. It shapes the file format, so it gets designed before it gets
built.

**First real prototype: a profile page.**
- [ ] `m-show`, `m-if` and `m-else`
- [ ] `m-bind` for attributes, including `m-bind:class` with literal Tailwind classes
- [ ] `m-for` with keys and empty states
- [ ] Internal UI state (open menus, selected tabs, drafts) and state operations in handlers
- [ ] Formatters for numbers, dates and plurals, built on `Intl`

**Contract and change analysis.**
- [ ] Stable IDs for schema fields and events
- [ ] Schema diffs that classify each design change as safe or breaking for the backend

**Interactive apps, with a chat screen as the stress test.**
- [ ] Event payloads, any DOM event in `m-on`, and modifiers
- [ ] `m-model` and forms
- [ ] Partial updates and streaming

**Embedding and hosting.**
- [ ] A custom element, so views embed in React, Vue or plain HTML
- [ ] A standalone host: the URL picks a screen, the backend serves its data and handles its events
- [ ] Server-side rendering and hydration
- [ ] Production builds that strip snapshots

**Tooling for AI authors.**
- [ ] Generated hostile states and a screenshot command
- [ ] Events linked to snapshots in the shell, for prototyping flows
- [ ] Checks for unknown Tailwind classes

**Distribution.**
- [ ] Publish to npm: a dependency-free `melzin` runtime and a separate CLI package

## Contributing

Melzin is at the stage where design discussion is worth more than code. Issues about the idea, the format
or the numbered problems in SPEC.md are the most useful contributions right now. If you send a pull
request, run `bun test`, `bun run typecheck` and `bun run check` first.

## License

[MIT](LICENSE)
