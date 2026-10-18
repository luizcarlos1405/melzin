<h1>
  <picture>
    <source media="(prefers-color-scheme: dark)" srcset="assets/logo-dark.svg">
    <img src="assets/logo-light.svg" alt="Melzin" height="72">
  </picture>
</h1>

**Design is implementation.**

[![CI](https://github.com/luizcarlos1405/melzin/actions/workflows/ci.yml/badge.svg)](https://github.com/luizcarlos1405/melzin/actions/workflows/ci.yml)
[![License: MIT](https://img.shields.io/badge/license-MIT-blue.svg)](LICENSE)
![Status: proof of concept](https://img.shields.io/badge/status-proof%20of%20concept-orange.svg)

<img align="right" src="assets/mascot/zin-sticker.svg" width="120" alt="Zin, the Melzin bee, waving">

Melzin is a UI framework built for AI authors. A view is one HTML file: Tailwind classes, a schema of the
data it shows and the events it sends, and sample states. The same file is the design you preview in
every state and the front end you ship. Nothing gets handed off or translated between the two.

> **Early proof of concept.** The basics work end to end and are tested, but the format has only a few
> directives so far, the npm packages are early placeholders, and everything can still change. Ideas, questions and
> critique are very welcome in [issues](https://github.com/luizcarlos1405/melzin/issues).

## Why

- **The design never goes stale.** With a design tool, the design stops matching the product the first
  time the code changes without it, and a few iterations later nobody trusts it. In Melzin the design is
  the product: the preview and production render the same file with the same runtime, so every change
  after launch is still a design change, and what you review is what ships.
- **Explore first, wire up last.** Compare directions in plain HTML, bind data and add sample states once
  one wins, then declare events and connect the backend. Each stage grows the same file, so the contract
  never gets in the way of exploring. A screen too interactive to build this way still gets the first
  two stages: a reviewed design, and every state to build the code from.
- **A typed contract between UI and backend.** Each view declares the data it needs and the events it
  emits. The backend feeds data in and handles events, and generated types make the compiler catch a
  missing handler or data of the wrong shape.
- **Every state, visible.** Views carry named snapshots: empty, typical, very long text, huge numbers. The
  preview shell renders them all side by side, and you can edit any of them live.
- **Made for AI authors, checkable by machines.** The format is plain HTML, Tailwind and Vue-like
  directives that models already know. Views are plain files in your repository, so any agent can edit
  them, many at a time, with ordinary file tools, and git diffs them; no design app has to be running.
  Bindings are data, never code, so a checker can verify a view and explain each mistake.

## A quick look

A view, `views/counter.mel.html` (trimmed):

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
views/counter.mel.html:30:70: error: m-text: unknown field 'cuont' (did you mean 'count'?)
views/counter.mel.html:32:25: error: m-on:click: use emit('name') instead of Vue's $emit
```

`melzin types` turns the schema into TypeScript, and the host mounts the same file in production:

```ts
import { mount } from 'melzin'
import type { Data, Handlers } from './views/counter.types.ts'

let count = 0
const view = await mount<Data, Handlers>(document.querySelector('#app')!, '/views/counter.mel.html', {
  data: { count },
  on: { increment: () => view.update({ count: ++count }) },
})
```

The view never changes its own data. It emits `increment`, the host decides what that means and calls
`update`, and only the text that changed is rewritten.

## How it works

1. **Write** a `*.mel.html` view. [docs/authoring.md](docs/authoring.md) is the complete guide, written
   so an AI can follow it with no other context.
2. **Check** it with `melzin check` until it's clean.
3. **Preview** it with `melzin shell`: every snapshot in its own frame at phone, tablet or desktop size,
   with zoom, a live state editor and an event log per frame. URL parameters open a single state for
   screenshots, so an AI can review its own work.
4. **Generate types** with `melzin types` and wire the host or backend to them.
5. **Ship** the same file. In the browser, `mount` parses the view, strips anything unsafe, binds the `m-`
   directives once, and from then on touches only what changed: the text whose value changed and the
   elements whose condition flipped.

A whole app adds `routes.json`, a route table that maps URLs to views, and calls `startApp` with a
*source*: the code that loads each page's data and handles its events, whether it asks a server or reads
a local database. Links switch pages without reloading, and the shell lists the routes as pages.

Rendering happens in the browser for now; server-side rendering is on the roadmap.

## Try it

You need [Bun](https://bun.sh) 1.4 or newer. To use Melzin in your own project:

```bash
bun add melzin           # the runtime your app mounts views with
bun add -d @melzin/cli   # the `melzin` command: check, types, shell and css
```

To run the examples and the tests, clone this repository.

```bash
git clone https://github.com/luizcarlos1405/melzin.git
cd melzin
bun install        # installs every workspace
bun run test       # builds the runtime, then runs every test
```

Then try the poll example, a separate app that uses Melzin as a package and has a small Bun backend:

```bash
cd examples/poll
bun run dev        # the app, on http://localhost:3000
bun run shell      # the preview shell for its views, on http://127.0.0.1:4321
```

`examples/profile` works the same way, on http://localhost:3002: a small routed app, a members page and
a profile whose follow button depends on who is looking.

More commands:

| Where | Command | What it does |
|---|---|---|
| root | `bun run typecheck` | type-checks every package |
| root | `bun run check` | checks every view in the package and the examples |
| `packages/cli` | `bun run shell` | the preview shell for the example views |
| `packages/cli` | `bun run example:counter` | the counter's production page, on http://localhost:3001 |
| `examples/poll` | `bun run types` | regenerates `views/poll.types.ts` |
| `examples/profile` | `bun run dev` | the profile app, on http://localhost:3002 |
| `examples/profile` | `bun run types` | regenerates `routes.types.ts` and the views' types |

The CLI has four commands: `check`, `types`, `shell` and `css`. Run `bunx melzin --help` in `examples/poll/` to
see their usage.

## What's in the repository

```
packages/melzin/      `melzin`: the runtime (mount, update, destroy, startApp) and the shared core
packages/cli/         `@melzin/cli`: checker, type generator, CSS builder, preview shell
  views/              example views (hello, profile card, counter)
  examples/counter/   a production page that mounts the counter
examples/             apps that use Melzin as a package; each folder is its own workspace
  poll/               a poll with a small Bun backend, contract tests and API tests
  profile/            a routed app: members and profiles, a remote and a local source, view and app tests
docs/authoring.md     the view format and its rules, for whoever writes views
SPEC.md               the design record: decisions, principles and a numbered list of hard problems
POC.md                what the proof of concept builds, how, and what comes next
assets/               the logo, the icon and Zin, the mascot
```

## Progress

The proof of concept ([POC.md](POC.md)) is done:

- [x] View format v0: one HTML file with a schema, snapshots, Tailwind classes, `m-text` and `m-on:click`
- [x] Browser runtime: `mount`, `update` and `destroy`, with precise updates and unsafe markup stripped
- [x] Checker with line and column positions, Vue and Alpine hints, and security rules
- [x] Type generation, so a missing handler or wrong data fails type checking
- [x] Tailwind v4 CSS build with one project-wide theme
- [x] Preview shell: snapshot grid, device sizes, zoom, live state editor, event log, single-state URLs
- [x] A production example, and an example app with a backend, contract tests and API tests
- [x] AI authoring trial: an agent given only the guide wrote a new view that passed the checker on its
  first draft

Since then:

- [x] Conditionals: `m-if`, `m-else-if`, `m-else` and `m-show`, with a checker that warns when no snapshot
  shows an element behind a condition
- [x] A second example app: a member profile whose follow button depends on who is looking, with view
  tests that mount the real view in happy-dom
- [x] Routing: a route table in `routes.json`, links bound to link fields with `m-bind:href`, the URL as
  a `route` input, and `startApp`, a standalone host with pluggable sources, one `navigate` hook and
  per-route loading policies. The checker, the generated types and the shell know the routes, and the
  profile example is now a routed app

## Roadmap

Roughly in order. [SPEC.md](SPEC.md) explains the reasoning, and POC.md §11 maps each step to the spec.

**Next: the binding language, on paper.** What an expression can contain, list syntax and keys, internal
state operations, event payloads and forms. It shapes the file format, so it gets designed before it gets
built. Conditionals came first, with a provisional syntax: a path, optionally negated with `!`.

**First real prototype: a profile page**, growing from [examples/profile](examples/profile/).
- [x] `m-show`, `m-if`, `m-else-if` and `m-else`
- [ ] Snapshots that extend a base snapshot and override only what differs
- [ ] `m-bind` for attributes, including `m-bind:class` with literal Tailwind classes
- [ ] `m-for` with keys and empty states
- [ ] Internal UI state (open menus, selected tabs, drafts) and state operations in handlers
- [ ] Formatters for numbers, dates and plurals, built on `Intl`

**Contract and change analysis.**
- [ ] Stable IDs for schema fields and events
- [ ] Schema diffs that classify each design change as safe or breaking for the backend

**Components.**
- [ ] Any view used inside another view, with its data passed as whole subtrees and its events handled by
  the parent
- [ ] Schemas that refer to other views' types with `$ref`, and one generated contract per screen

**Interactive apps, with a chat screen as the stress test.**
- [ ] Event payloads, any DOM event in `m-on`, and modifiers
- [ ] `m-model` and forms
- [ ] Partial updates and streaming

**Embedding and hosting.**
- [ ] A custom element, so views embed in React, Vue or plain HTML
- [x] A standalone host: a declared route table picks the screen, and a pluggable source serves its data
  and handles its events
- [x] Per-route lazy loading and background prefetching
- [x] Routes in the shell as pages, each shown in many snapshots, with the URL as a `route` input any
  view can read
- [ ] A generated service worker and the `offline` data policy
- [ ] A static source that prerenders every route at build time
- [ ] Frames shared across routes, such as an app shell with navigation
- [ ] Page titles, not-found and error pages, focus after navigation and view transitions
- [ ] Server-side rendering and hydration
- [ ] Production builds that strip snapshots

**Tooling for AI authors.**
- [ ] Exploration: design alternatives side by side in the shell, to pick a direction before anything is
  bound
- [ ] Generated hostile states and a screenshot command
- [ ] Events linked to snapshots in the shell, for prototyping flows
- [ ] Checks for unknown Tailwind classes

**Distribution.**
- [x] Publish to npm: a dependency-free `melzin` runtime and a separate `@melzin/cli` package
- [ ] Compile the CLI so it also runs on Node, and publish with provenance from CI

## Contributing

Melzin is at the stage where design discussion is worth more than code. Issues about the idea, the format
or the numbered problems in SPEC.md are the most useful contributions right now. If you send a pull
request, run `bun run test`, `bun run typecheck` and `bun run check` first.

## The name, and Zin

*Mel* is Portuguese for honey, and *melzin* is a cute, informal way to say it. The name also nods to
*melzinho na chupeta*, "a little honey on the pacifier", a Brazilian saying for something that's a
piece of cake. That's how building a UI should feel.

<img src="assets/mascot/zin-building.svg" width="96" alt="Zin carrying a honeycomb cell with the Melzin logo">

Zin is the mascot: a bee that builds the comb one cell at a time, the way AI agents build views. The
logo, Zin's poses and the colors are in [assets/](assets/README.md).

## License

[MIT](LICENSE)
