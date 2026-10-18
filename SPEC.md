# Melzin

> Design is implementation.

**Status:** design record, started 2026-10-16. The proof of concept described in [POC.md](POC.md) is
built, and so are conditionals, routing, design in stages and snapshots that extend a base (POC.md
§14–§17); everything beyond them is still design.

Every numbered item keeps its number: decisions (D1, D2, ...), principles (P1, ...), complications
(#1, ...) and open questions (Q1, ...). New items are appended; settled ones stay in place with a note.

## 1. Summary

Melzin is a design tool an AI operates, like pen.dev, where the file the AI designs is also the
production front end of a webapp. The design marks where data goes and carries sample data. In
production, the same file renders real data and updates reactively when that data changes.

Designing happens in three stages (D28): exploring directions in plain HTML, then the states (which data
goes in and how the UI changes with it), then the contracts that connect the UI to the rest of the app.
Melzin doesn't grow into a programming language to cover everything (D29): where a screen needs real
code, Melzin is still where it gets designed, explored and reviewed.

The artifact is a typed component written by an AI. It takes `data` in, sends events out and keeps its
own `ui` state, and it ships with its types (the schema) and example states (the snapshots). What it
renders is a pure function of `data` + `ui`.

Melzin owns the view, not the app. Business logic and auth stay in regular code, usually the backend,
which feeds the view data that matches its schema and handles its events. A Melzin view can be embedded
in an existing app or, with a small generic host, make up a whole webapp front end (D7).

## 2. The idea

- The AI builds a design, say a profile page. For each dynamic part (the user's name, avatar...) it adds
  a sample value and declares that the element's content is data fed to the UI.
- The finished design carries a schema of all the data it needs, with types (number, boolean, ...).
- The same file opens in the design tool and runs in production, rendering whatever data it's given.
- Updating the data updates the existing UI reactively, without rebuilding everything, the way React or
  Vue do.
- Backend code reads the schema and transforms its data to fit it. UI and data stay cleanly separated.
- The UI's state is one global state that the tool shows to the user, so every state can be tested.
  Named state snapshots show the UI in many different states.

## 3. Goals and non-goals

**Goals**

- One source of truth: production runs the file the AI designs. Automatically stripping design-time
  content or compiling the file is fine; translating it by hand is not.
- An explicit, typed, diffable contract between the UI and the backend, covering data in and events out
  (D14).
- Every UI state can be rendered, inspected and tested.
- Precise reactive updates: a data change only touches the DOM that depends on it.
- A format built from HTML and other widely known web patterns, so models can write, validate and check
  it easily (D6).
- Covers CRUD apps, dashboards and SaaS screens, and also interactive apps like chat and complex forms
  (D4).
- Works embedded in existing apps and on its own for whole webapps (D7).
- Supports each stage of design (exploration, states and contracts) on its own terms, so exploring never
  waits on the contract (D28).

**Non-goals for now**

- Owning business logic or auth: those stay in regular code, usually the backend, in both embedded and
  standalone mode.
- A visual editor for humans (D1).
- Games and other extremely interactive apps (D4).
- Targets other than webapps, such as native mobile.
- Becoming a programming language: behavior that would need one is code (D29).

## 4. Decisions

- **D1. The AI is the main author, maybe the only one.** It works on the file directly, and humans may
  never edit it by hand. Humans review and explore through the preview shell and steer the AI by
  prompting; there's no visual editor. It's the workflow Melzin starts from: designing in pen.dev
  through an AI, where nearly every change is a prompt and hand edits are rare. Direct manipulation
  isn't ruled out for later, but it isn't planned.
- **D2. The preview is a real browser** inside a shell that can zoom in and out and show many snapshots
  at once (§8).
- **D3. Humans can inspect and edit the state of each render.** Edits change state only and are
  temporary: nothing is saved, and a refresh reloads everything from the file (for now).
- **D4. Target apps:** CRUD apps, dashboards and SaaS screens, and also interactive apps such as chat
  and complex forms. Not games or other extremely interactive apps. *Refined by D29: where a screen
  would need programming, Melzin designs it and code ships it.*
- **D5. The view holds its own internal state.** State that doesn't come from a database or anywhere
  else (menu open, selected tab, unsaved input) lives inside the view. The outside only feeds data in
  and handles events. Internal state is still declared in the file and visible to tools: snapshots can
  set it and the shell can inspect and edit it (P6).
- **D6. HTML and known patterns.** The file is HTML-based, and each part leans on a widely known web
  pattern wherever one fits (P9, §6).
- **D7. Embeddable and standalone.** A Melzin view can be mounted inside an existing app, and a whole
  webapp front end can also be built with Melzin alone (§7).
- **D8. Snapshots live inside the Melzin file,** at least to start. Production builds strip them, like
  any design-time content (§3).
- **D9. Styling uses Tailwind.** Plain CSS may be allowed later if a real need shows up; maybe it never
  will.
- **D10. Directives use an `m-` prefix** (for Melzin) with Vue-like shapes, such as `m-if` and `m-for`;
  the exact set is D13. The prefix keeps models from treating the file as full Vue or Alpine, where any
  JavaScript is allowed, and avoids clashes with host pages that use them. (Tailwind's margin classes,
  like `m-4`, also start with `m-`, but they're class values rather than attribute names, so nothing
  clashes.)
- **D11. Standalone mode uses the generic host in §7:** the URL picks a screen, the backend-for-frontend
  serves its data, events go to the backend, and realtime screens get patches pushed by the server.
  *Amended by D20–D21: the URL picks a screen from the route table, and a source serves its data. The
  backend-for-frontend is one kind of source.*
- **D12. One Tailwind theme per project.** Every screen shares it, since design tokens are brand-wide.
- **D13. Vue's directive set, under the `m-` prefix:** `m-text`, `m-html`, `m-show`, `m-if`,
  `m-else-if`, `m-else`, `m-for`, `m-on`, `m-bind`, `m-model` and `m-slot`, with Vue's modifiers
  (`.prevent`, `.enter`, `.trim`...). The `@`, `:` and `#` shorthands are left out (D10). What goes
  inside the directives is the next battle (§11).
- **D14. The schema declares every event the view emits,** with typed payloads, like Vue's `emits`.
  Interactions that only change `ui` state aren't events (§9.4).
- **D15. Static analysis catches unhandled events.** Every declared event must have a handler in
  whatever consumes the view, and the view can't emit an event the schema doesn't declare (§9.4).
- **D16. Every view is a component.** There's no separate component format: any Melzin file can render
  on its own (in the shell, embedded, or as a standalone screen) and can be used inside another view.
  It behaves the same in both cases, in the shell and in production (P5, §9.5).
- **D17. Types are flat, data is nested.** Each view's schema is a named type in one project-wide
  registry. A parent's schema refers to a child's type with `$ref` instead of restating it, so the data
  a parent receives stays a nested tree shaped like the screen (P3). Melzin doesn't normalize data into
  tables of entities (§9.5).
- **D18. Props are subtrees, never reshaped.** A child's top-level `data` fields are its props. Each one
  receives a whole value of the right type from the parent's data, or a literal. Renaming, merging or
  computing values for a child belongs in the backend adapter (P3), not in the view.
- **D19. Child views stay encapsulated.** A child's `ui` state is private to it. Its events go to its
  parent only, and the parent handles, re-emits or explicitly ignores each one (D15, §9.4).
- **D20. Data comes from pluggable sources.** The contract stays fixed: a route's params go in, data
  matching its view's schema comes out, and events go to handlers. Where that code runs is the app's
  choice: a *static* source runs at build time (static sites), a *remote* source runs on a server
  (the backend-for-frontend of D11), and a *local* source runs on the device, such as a worker reading
  IndexedDB (offline-first apps). Each route can use a different source. Business logic stays in regular
  code (§3); that code may simply run on the device (§7).
- **D21. Routes are declared in a route table,** not derived from folders. Each named route maps a path
  to a view, and the route's data is that view's data type. The browser owns the table, so navigation
  works offline and with no server. The checker, the shell, the prerenderer and the service worker
  read it without running code (§7).
- **D22. Paths use `URLPattern` syntax** (`/u/:handle`), the web standard, instead of an invented one
  (P9).
- **D23. Views never build URLs.** A link is a plain `<a>` whose `href` binds to a `data` field typed
  as a link to a named route. The source fills it in through generated, typed helpers, and the checker
  knows every link's target (§7).
- **D24. Loading policies per route.** Code is `eager` (in the first bundle), `prefetch` (downloaded in
  the background after first paint; the default) or `lazy` (fetched on intent, such as hovering a
  link). Data is `network-only`, `stale-while-revalidate` (the default) or `offline` (§7).
- **D25. Navigation is one built-in `navigate` event,** modeled on the Navigation API's `navigate`
  event. Any `<a>` that points to a route fires it with `{route, params, url}`; views don't declare it.
  By default the host navigates: it matches the route, runs its loader and shows its view. The app's
  source can override that to add logic (analytics, unsaved-changes prompts), send the user elsewhere or
  cancel, and event handlers can start a navigation too, such as after a save. The default counts as a
  handler for D15. In the shell, nothing navigates: the event goes to the event log (§7, §8).
- **D26. The shell shows routes as well as views.** It lists the routes from the table explicitly, as
  pages, and renders each one in many snapshots, the same way it renders views. A route frame renders
  its view with that view's snapshots (§8).
- **D27. The URL is a third input, `route`,** next to `data` and `ui`: the route's name, its `params`
  and its `query`. The host injects it, it's read-only, and any view can bind to it, including
  components deep in the tree, a deliberate exception to D18. The checker makes sure a view that reads
  `route.params.handle` is only used under routes whose path declares `:handle`. Snapshots can set it
  (`"route": { "params": { "handle": "bruno" } }`), and the shell shows it in the frame and lets the
  inspector edit it.
- **D28. Design happens in three stages.** Each is a valid place to stop, grows the file the previous
  one left, and asks for nothing a later one decides. The contract never gets in the way of exploring,
  and looks, states and wiring each get the author's full attention, as they do when a design made in
  pen.dev comes before any code (#61, Q13).
  1. *Exploration:* compare alternatives and pick a design direction. Static HTML and Tailwind, with
     sample content written inline; a view needs no schema (POC.md §3).
  2. *States:* which data goes in, how the UI changes with it, and the edge cases. Bindings, the
     schema's `data` and `ui`, and snapshots, hostile ones included (P8).
  3. *Contracts:* the engine behind the UI. Typed events, links and routes, sources, and the connection
     to the backend (D14, D20–D27).
- **D29. Melzin stops where programming would start.** The format doesn't grow to express behavior
  that takes a programming language (P1, #6). Past that line the behavior is code: a code component
  (P7), or a screen written in regular code. Melzin may fit some apps very well and others poorly, and
  that's acceptable. Where its views can't be what ships, Melzin is still the design tool: exploration
  and states (D28) give the implementation, and its review, a design and every state to build from, as
  pen.dev or any other design tool would (#63).
- **D30. Snapshots extend other snapshots.** A snapshot can name a base snapshot and list only what
  differs, so states don't repeat their shared data, and a change to that data reaches every snapshot
  built on it (#34). The exact form is Q14. *Built in the form Q14 leans to (POC.md §17).*
- **D31. Design alternatives live in `explore/`.** Each alternative is a folder, `explore/<name>/`, next
  to `views/`, and its views stand in for the views with the same file name, so one folder can hold a
  single screen or every screen of a direction. The shell shows every version of a view side by side,
  the one in `views/` first, in every snapshot (§8). Nothing in `explore/` ships, so production builds
  have nothing to strip (#37). Once a direction wins, its files move into `views/` and the folders go;
  git keeps the rest. Plain files leave the format unchanged and let several agents explore at once,
  unlike variants inside one file or a branch per alternative (#61).
- **D32. An alternative can bring its own theme.** A `theme.css` in its folder loads after the
  project's, so the tokens it sets win and the rest still applies (D12). Promoting the alternative merges
  those tokens into the project theme, which restyles every screen, so the shell also shows the views it
  doesn't redesign with its theme, next to their current version (#62).
- **D33. A view's stage is inferred from its file.** No schema and no snapshots: exploration. A schema
  or snapshots: states. An event, a link field or the URL input (`route`): contracts. There's nothing to
  declare or keep current. A finished static page reads as stopped at exploration, which D28 allows, and
  drafts are told apart by living in `explore/` (D31). The shell shows each view's stage, and checks
  that only help from a given stage on, such as forgotten bindings (#33), will use it (Q13).

## 5. Principles

The agreed direction. Details are still open.

**P1. Bindings are data, never code.** A binding is a path plus a fixed set of operations: formatters,
comparisons, maybe a tiny side-effect-free typed expression language like CEL (#6). If bindings could be
arbitrary JavaScript (Alpine/Vue style, `x-text="a + b.c()"`), extracting and diffing the schema would
become guesswork. Libraries like Vue, Alpine or Solid are fine as compile targets, not as the format we
write. And because every binding is declared up front, the runtime knows exactly which DOM nodes depend
on which data paths, so precise updates come almost for free, without a virtual DOM.

**P2. Maintain the schema, don't infer it.** Fields are first-class entities with stable IDs, saved in
the file. Making an element dynamic creates a field: the element's current content becomes the sample,
and the type is suggested from the content and how the field is used. Inference only suggests and lints
(§9.2).

**P3. The schema is shaped for the screen.** It's a view model, not the domain model. A backend adapter
turns domain data into it, for example sending lists already grouped. Deploying the adapter together
with the UI, as a backend-for-frontend, avoids version mismatches (#35).

**P4. Sample, default and placeholder are different things.**

- *Sample*: what the preview shows ("Ana Souza"). Never reaches production.
- *Default*: what production shows when a value is missing ("Anonymous", or nothing).
- *Placeholder*: what shows while data loads (a skeleton).

Mixing them up is how "John Doe" ships to real users.

**P5. One renderer.** The preview runs the production runtime, so the design and production can't drift
apart.

**P6. Data in, events out, two kinds of state.** The host (the app embedding the view, or Melzin's
standalone host) feeds `data` in and handles events. The view owns its `ui` state (D5).

- `data`: the backend contract. Comes from the host.
- `ui`: menu open, selected tab, unsaved input. Declared in the file with types and initial values, and
  changed only by the view's own interactions (#46).

A third input, `route` (the URL's params and query), is injected by the host and read-only (D27).

Both are visible to tools: snapshots can set them and the shell can inspect and edit them. Only `data`
and events go into the backend contract. Every event is declared in the schema (D14), and its payload is
typed (`follow {userId}`, `sendMessage {text}`) and often built from `ui` state. In the preview, an
event can be linked to a snapshot ("click Follow → the *following* snapshot"), which is prototyping.

**P7. Code components are typed black boxes.** Where design can't express behavior (date picker, map,
rich text editor), a hand-written component with declared props and events plugs in. The ceiling becomes
explicit instead of a dead end.

**P8. Snapshots are the AI's test suite.** Generate hostile states from the schema: long strings,
0/1/500 items, every enum value, every optional field missing. Render them all and have a model review
the screenshots. This finds the design's real limits ("names break past ~40 characters"), which become
constraints in the schema (#15). Varied snapshots also catch forgotten bindings (#33): if "Ana Souza"
shows up in Bruno's snapshot, it's hardcoded.

**P9. Prefer known patterns.** When a web standard or a widely used convention covers a need (HTML
elements, native form validation, `Intl` formatters, JSON Schema, Web Components, DOM events), use it
instead of inventing something. Models already know these, and so do developers (D6).

## 6. Building blocks

The conceptual parts of a Melzin file. Directives are Vue's set under the `m-` prefix (D10, D13), and
styling uses Tailwind with a project-wide theme (D9, D12). What goes inside directives, and how the file
is laid out, is the next battle (§11).

**View tree.** The UI, made of nodes that can carry bindings:

- text and attribute bindings: a path plus formatters
- two-way bindings for form inputs
- conditionals: show or hide
- variants: styles driven by a boolean, an enum or list position (first/last/odd)
- repeat: a template repeated over a list, with a key and an `empty` slot
- switch: picks a template by the tag of a value that can take one of several shapes
- component instances: another view, given parts of this view's data as props (D16–D18, §9.5)
- code components (P7)
- event handlers: a short list of declarative operations, such as changing `ui` state or emitting an
  event (#46)

**Schema.** Three parts:

- `data` fields: the contract with the host
- `ui` fields: internal state, with initial values (D5)
- events: everything the view can emit, with payload types (D14)

Each field has a stable ID, name, type, optionality, default and constraints; events have stable IDs
too, so renames stay renames. List item types declare their key field. The contract exported for the
backend covers `data` and events only.

**Snapshots.** Named states (`data` + `ui`), stored inside the file (D8). A base snapshot holds the sample
values; other snapshots override parts of it (D30, Q14).

**Design-time content.** Snapshots, notes, explorations and similar. They live in the file but are
stripped from production (#37).

**Types (draft):** string, number, boolean, enum, id, date, money, url, color, image (url, size, alt),
rich text; list of T (with a key), object, optional, tagged union. Constraints such as max length and
ranges.

**Binding operations (draft):** paths; formatters for dates, relative times, numbers, money, plurals and
list joining (like `Intl.ListFormat`); comparisons. Whether to go further is #6.

**State operations (draft):** set, toggle, reset to the initial value, add or remove a list item, emit an
event (#46).

### Known patterns

Following D6 and P9, each building block maps to something models and developers already know. Items
that cite a decision are settled; the rest are proposals.

- **Markup:** plain HTML with semantic elements (`button`, `form`, `label`, `ul`, headings), which also
  covers much of accessibility (#28).
- **Directives:** Vue's built-in set under the `m-` prefix (D13). What goes inside them is limited to an
  analyzable subset (P1).
- **Events:** declared like Vue's `emits`, with typed payloads (D14), and sent to the host as DOM events
  (§7).
- **Reuse:** `<template>` for repeated content, `<slot>` for content passed into components, custom
  elements for components (§9.5).
- **Composition:** JSON Schema `$ref` for a child's types (D17), and Vue's prop binding for passing
  data: `m-bind:user="post.author"` for one prop, `m-bind="post.author"` for all of them (D18).
- **Forms:** native input types and validation attributes (`required`, `pattern`, `min`, `max`,
  `maxlength`, `type="email"`) and the browser's built-in constraint validation (#20).
- **Formatting:** the browser's `Intl` APIs (dates, relative times, numbers, plurals, lists), exposed as
  formatters (#6).
- **Styling:** Tailwind (D9), with one project-wide theme holding the design tokens (D12).
- **Conditional classes:** Vue's class-binding object syntax, such as
  `m-bind:class="{ 'bg-yellow-100': item.featured }"`, which keeps Tailwind class names literal (#8,
  #52).
- **Schema:** JSON Schema. Every language can validate it, and it already has `default`, `examples`,
  `enum`, `maxLength` and required fields; a custom keyword adds stable field IDs (P2).
- **Snapshots:** JSON documents inside the Melzin file (D8) that validate against the schema.
- **Embedding:** Web Components: data in as a property, events out as DOM events (§7).
- **Partial updates:** JSON Patch, with a caveat: it addresses list items by index, which breaks when
  lists change concurrently (#16).

## 7. Embedding and standalone

Melzin views must work inside existing apps and also make up a whole webapp front end on their own (D7).

**Embedded** (proposed). Each Melzin view is a custom element. The host app sets `data` as a property (or
sends partial updates, #16) and listens for the view's events as DOM events. That works the same in
React, Vue, Svelte or plain HTML, with no per-framework adapter.

**Standalone** (D11). A small generic host does a host app's job (#51):

- the URL picks a screen from the route table (D21, #31)
- the host loads that screen's `data` from the route's source (D20)
- events go to the source's handlers, which answer with new data or a patch
- realtime screens such as chat receive patches pushed by the source (#49)

Business logic and auth stay in regular code in both modes. With a remote source, the standalone host
resembles Phoenix LiveView or Hotwire, except the server sends data shaped by the schema instead of HTML.

**Sources** (D20). The same app can range from a static site to an offline-first app by changing where
its loaders and handlers run:

| Source | Where the code runs | Fits |
|---|---|---|
| static | at build time; every route is prerendered | marketing sites, docs, blogs |
| remote | on a server, fetched as JSON | single-page apps with a backend-for-frontend (P3) |
| local | on the device, such as a worker reading IndexedDB | offline-first apps and PWAs |

Melzin types the contract and doesn't care where it runs. A sync engine (Replicache, PowerSync and
similar) sits behind a local source; Melzin doesn't build one.

**Routes** (D21, D22). A sketch of the route table:

```json
{
  "routes": {
    "home": { "path": "/", "view": "feed", "code": "eager" },
    "profile": {
      "path": "/u/:handle",
      "view": "profile",
      "params": { "handle": { "type": "string" } }
    },
    "settings": { "path": "/settings", "view": "settings", "code": "lazy", "data": "network-only" }
  }
}
```

Compared with routes from folders (Next, SvelteKit, Nuxt), the table keeps file names free of syntax
(`[handle]`, `(group)`, `+page`), which frameworks spell differently and models mix up. Every view keeps
a clean type name in the registry (D16, D17), route settings sit next to the path instead of in
frontmatter or sidecar files, and URLs can change without moving files. The cost is editing two places
to add a screen; the checker catches the drift (a route to a missing view, a dead link). Code splitting
doesn't need folders either: the `$ref` graph (D17) already says which views each route needs.

**Links** (D23). The schema marks a field as a link to a route, the source fills it with a generated
helper such as `href('profile', { handle })`, and the view binds it:
`<a m-bind:href="authorUrl">`. Links keep their native behavior (open in a new tab, copy link,
crawlers), and the host intercepts the ones that stay inside the app.

**Loading** (D24). Views are small (HTML and JSON, no logic) and fixed per build, so code gets a content
hash and is cached forever; data changes, so it gets a cache policy. The intended timeline:

1. First draw: the page carries the current route's views and data inline, or is prerendered.
2. Idle: the host downloads the `prefetch` routes in the background, and a generated service worker can
   cache them for offline use.
3. Intent: hovering or pressing a link (or the link scrolling into view) fetches that route's code and,
   if its policy allows, its data.
4. Navigation: render from the cache when the policy allows, then revalidate. Back and forward redraw
   the cached state (route, data and `ui`).

A route whose views have no events and no `ui` state needs no JavaScript at all, so a static site
could ship none on most pages.

**Navigation** (D25). Following a link, going back or forward, or a handler asking to navigate fires
one built-in `navigate` event. The host handles it by default by swapping the whole screen; the app's
source can override it. Keeping parts of the screen across navigation, such as an app shell, is #60.

**The URL as input** (D27). The view reads the current route as `route`, next to `data` and `ui`:

```html
<a m-bind:href="followersUrl">Followers of @<span m-text="route.params.handle"></span></a>
```

**Not decided yet:** shared frames across routes (#60), not-found and error screens, `ui` state in the
URL (`?tab=`), modals as routes, how embedded views (no route table) get `route`, and the details of
each source's protocol.

## 8. Preview shell

The browser app where humans review and explore the design (D1–D3), and where the AI checks its work.

**For humans**

- Renders the Melzin file with the production runtime (P5).
- A canvas with zoom and panning.
- Many renders at once: a grid of snapshots × viewport sizes (later also × screens). A view with
  alternatives shows every version side by side, one column each, the one in `views/` first (D31, D32).
- Shows each view's stage (D33).
- Routes listed as pages next to the views, each rendered in many snapshots (D26). A route frame shows
  its URL, built from the snapshot's `route` params (D27). Link clicks fire `navigate` (D25), which
  goes to the event log instead of navigating.
- A state inspector for each render:
  - shows the render's full state (`data` + `ui`, plus `route` for routes)
  - controls generated from the schema: toggles, enum pickers, text and number inputs,
    adding/removing/reordering list items, setting an optional field to missing
  - a raw JSON view
  - edits apply live through the runtime's reactive updates, so the inspector also exercises the update
    path
  - edits are temporary: a refresh reloads from the file (D3)

**For the AI** (needed, since the AI is the main or only author: D1, P8)

- Render any snapshot at any viewport size and get a screenshot.
- Validate the file and its snapshots against the schema, including the event checks (§9.4).
- Show the schema diff between two versions of the file (§9.3).
- Generate hostile states from the schema (P8).

**Proposed, not decided:**

- Each render in its own iframe, so viewport sizes and media queries are real and CSS stays isolated.
- An event log per render: with no backend in the preview, emitted events and their payloads show up
  there. An event could optionally be linked to a snapshot or a state change (P6).

**Later:**

- Before/after renders of every snapshot when the file changes, so humans can review the AI's changes by
  looking (#50).
- Save an edited state as a new snapshot.
- Reload when the file changes, keeping manual edits that still fit the schema (#44).
- Show the generated hostile states (P8) in the grid.
- Click a schema field to highlight every element bound to it.
- A follow mode for prototyping: clicking a link in a route frame shows the target route with a chosen
  snapshot instead of logging the event.
- An app map: routes as nodes and links as arrows, drawn from the link fields' target routes (D23)
  without clicking anything.
- Simulated loading, failed, offline and stale states per route frame (P4, D24).
- Live frames that run against a real source (a dev server, or a local source with seeded data) instead
  of snapshots (D20).
- An overview of one alternative across every screen it changes (#61).
- Alternatives from other git worktrees or branches, compared in the same columns (D31).

## 9. Approaches to key complications

### 9.1 Lists (#1)

- **Store one template, not N rows.** The file holds `repeat(followers, key: id)` with a template and an
  `empty` slot; the sample items live in the snapshot. The preview shows 3 rows because the sample has 3
  items.
- **Editing rule:** changing the structure or style of any row changes the template, so every row
  updates. Changing bound text changes only that item's sample. Unbound text is the same in every row.
  With D1, this rule guides how the AI reads requests ("rename the second follower" vs. "make the rows
  taller").
- **One-off differences have to become data.** If one row should be highlighted, that's either a field
  (`isFeatured: bool`) or a position rule (first/last/odd). Production can't have hand-tweaked rows, so
  the AI should propose the field.
- **Every list gets automatic states:** 0 items, 1, many, overflow ("+12 more"), long content.
- **Keys belong in the schema.** Each item type declares which field identifies it. Without that,
  updates can't preserve focus or animations, keep per-item internal state with the right item (#48), or
  target a single item in a partial update.
- **Later:** lists mixing item types (a feed with posts and ads, switched on a type tag), recursion
  (comment replies), separators ("Ana, Bruno and 3 others", via an `Intl.ListFormat`-style formatter),
  grouping (better if the backend sends lists that are already grouped, P3).

### 9.2 Schema extraction (#2)

Pure inference is inherently unstable: a rename silently changes the contract, usage can't tell `string`
apart from `"active" | "banned"`, and optionality is invisible. So the schema is maintained, not inferred
(P2):

- **Fields are first-class, with stable IDs, saved in the file.** Making an element dynamic creates a
  field. Its current content becomes the field's sample, and the type is suggested from the content and
  usage.
- **Inference becomes a linter.** It flags type conflicts between places a field is used, unused fields,
  fields shown conditionally but not marked optional, and snapshots that don't match the schema.
- **Not all needed data is visible.** IDs used for list keys, event payloads, link URLs and analytics
  belong in the schema too (#14); extracting only what's on screen misses them.

### 9.3 Schema change analysis (#3)

With field IDs, every design change produces an exact diff. The UI is the side that reads the data, so
Avro's reader rules classify each change:

| Design change | Backend impact |
|---|---|
| New optional field | Safe: the default shows until the backend sends it |
| New required field | Breaking: the adapter must provide it |
| Field removed | Safe: the backend can stop sending it |
| Required → optional | Safe |
| Optional → required | Breaking |
| Enum value added | Safe |
| Enum value removed | Breaking: the backend may still send it |
| Type changed | Breaking |
| Rename (same ID) | Routine: rename it in the adapter |

Events follow the same idea with the roles flipped (§9.4).

The diff feeds:

- generated types for the backend (TypeScript, Zod, Pydantic)
- a contract test: the adapter's output for test fixtures must match the schema
- an AI task: "the schema changed like this, update the adapter"

To avoid version mismatches between a new UI and an old backend (#35), deploy the adapter with the UI
(P3), and check data where it enters the UI: fall back to defaults and report anything missing.

### 9.4 Events (#4)

The schema declares every event the view can emit, with typed payloads (D14), like Vue's `emits`. Only
what the view sends to its host counts as an event; interactions that only change `ui` state don't.

Static analysis checks both ends (D15):

- **View against schema:** every `emit` in a handler names a declared event and passes a payload of the
  right type. Anything else is an error.
- **Schema against view:** a declared event that nothing emits gets a warning.
- **Schema against consumer:** every declared event needs a handler in whatever consumes the view: the
  host for a screen, the parent view for a component (#12). A missing handler is an error. An event the
  consumer deliberately ignores needs an explicit no-op, so the check stays exhaustive.

How the host side gets checked (proposed):

- Melzin generates typed handler definitions from the schema, TypeScript first and other backend
  languages later, with one required handler per event. A missing handler then fails the host's own type
  check.
  - Embedded: the typed wrapper for the custom element requires a handler for every event.
  - Standalone (D11): the backend-for-frontend registers each screen's handlers through the same
    generated types.
- Where types can't reach, a contract test sends each event with a sample payload and expects it to be
  handled (#54).
- In development, an event that fires with no handler logs a loud warning. In the shell, which has no
  host, events show up in the event log (§8).

When events change, the view writes and the host reads, so the rules run the other way from §9.3:

| Event change | Host impact |
|---|---|
| New event | Breaking: the host needs a handler |
| Event removed | Safe: the old handler becomes dead code (warning) |
| Payload field added | Safe: handlers can ignore it |
| Payload field removed | Breaking if a handler uses it |
| Payload field type changed | Breaking |
| Required → optional payload field | Breaking: handlers can no longer rely on it |
| Optional → required payload field | Safe |
| Enum value added | Breaking: handlers may not expect it |
| Enum value removed | Safe |
| Rename (same ID) | Routine: rename the handler |

### 9.5 Components and composition (#12)

Every view is a component (D16). A view that renders on its own in the shell can also sit inside another
view, unchanged, and behaves the same in both places and in production. Composing views must not make
schemas heavy: each schema stays local and about as long as its own UI, and the composed contract for a
screen is generated, not written.

**Why the data isn't normalized.** One option is to flatten all state into top-level tables of entities
keyed by ID, with children pointing to entries by ID, the shape of a Redux store or Apollo's cache. That
stores each entity once and makes updates by ID easy, but for Melzin:

- it's a domain model, not a view model (P3): the adapter would build a small database instead of filling
  in a screen
- every binding becomes a lookup by ID, which is harder to analyze (P1) and harder for an AI to write
- every ID must point to an entry that exists, which adds integrity checks to the checker and keeps
  snapshots consistent only with effort
- the schema stops looking like the screen, which is what makes it readable

Normalizing is a cache and transport concern. Melzin keeps its useful parts elsewhere: the flat registry
with stable IDs holds types, not data (D17), and partial updates address data by key path, such as
`polls[id=7].options[id=3].votes` (#16). When the same entity shows up in several places, the payload
repeats it. That costs bytes, not complexity.

**Example.** The poll example repeats the same block for pizza, tacos and sushi. As a component,
`option-row.mel.html` declares its own schema and renders on its own in the shell:

```json
{
  "data": {
    "type": "object",
    "properties": {
      "label": { "type": "string" },
      "votes": { "type": "number" },
      "percent": { "type": "string" }
    },
    "required": ["label", "votes", "percent"]
  },
  "events": {
    "vote": { "description": "One vote for this option" }
  }
}
```

`poll.mel.html` refers to that type instead of restating it (D17):

```json
"data": {
  "type": "object",
  "properties": {
    "question": { "type": "string" },
    "pizza": { "$ref": "option-row" },
    "tacos": { "$ref": "option-row" },
    "sushi": { "$ref": "option-row" },
    "totalLabel": { "type": "string" }
  },
  "required": ["question", "pizza", "tacos", "sushi", "totalLabel"]
}
```

and passes each subtree as the child's props, handling the child's event by emitting its own (D18, D19):

```html
<m-option-row m-bind="pizza" m-on:vote="emit('votePizza')"></m-option-row>
```

With lists and event payloads, the three fields become `options: array of option-row` with an `m-for`,
and one `vote {optionId}` event. The exact syntax inside directives waits for the language battle (§11).

**Names and references** (proposed)

- A view's `data` type is registered under its file name without `.mel.html` (`option-row`), unique in
  the project (#53). Types a view declares in `$defs` are registered under it (`option-row#/$defs/x`).
- The custom element for a view is `m-` plus that name (`<m-option-row>`). Custom element names need a
  hyphen, and the prefix keeps them apart from the host's own elements (D10).
- `$ref` can point at a whole view type or at one of its props, for a parent that passes some props as
  literals and only needs part of the child's type in its own data.

**Props** (D18)

- A child's top-level `data` fields are its props. `m-bind:label="option.label"` binds one,
  `m-bind="option"` binds all of them from one object, as in Vue.
- A prop gets a path into the parent's `data`, `ui` state or the list item in scope, or a literal (an
  enum value such as `size="compact"`, a fixed string). Nothing else: no renaming of nested fields, no
  merging objects, no computed values. If a child needs a different shape, the adapter sends that shape
  (P3), or the child's schema changes.
- A child that needs data from two places, such as the signed-in user and a post, gets two props. Each one
  is still a subtree.

**Checks** (extending §9.2 and §9.4)

- Every `$ref` resolves to a registered type.
- Every required prop is bound, and each bound value's type matches the prop's type. Paths are checked
  against the parent's schema exactly like any other binding (P1).
- Every event the child declares is handled, re-emitted or explicitly ignored by the parent (D15). A
  parent's own `events` list only what it emits, including what it re-emits.
- A type that requires itself through non-list, non-optional fields can't be satisfied by any data, so
  it's an error.

**Generated contract.** The checker and the type generator follow the references and produce one
resolved contract per screen, which is what the host and the adapter see: one nested JSON document, with
named types (`PollData`, `OptionRowData`) instead of anonymous nested objects. A child type used by many
screens is generated once and shared.

**Rendering.** One runtime (P5). Whether a child compiles into its parent's render or mounts as its own
custom element is an implementation detail authors never see. Updates stay precise across the boundary:
the parent's binding table maps `pizza.votes` to the child's `votes` binding, so a change touches only
that text node. Each child instance has its own `ui` state, which the parent can't read or write (D19).
In a list, an instance follows its item's key (§9.1); what happens to its state when the parent passes a
different subtree is #48.

**Events.** A child's events go to its parent only, one level up. The parent's handler can change its own
`ui` state, emit its own event (with a payload built from the child's payload, the item in scope and its
own state) or do nothing on purpose. A child event never reaches the host directly, so a parent's event
list is its whole contract no matter how deep the tree is. Re-emitting through several levels can get
verbose (#57).

**In the shell**

- A child renders on its own like any view: its own snapshots, inspector and event log.
- A parent's snapshot holds the full nested data, children included. The inspector shows a child's data
  as a subtree, edited with controls generated from the child's schema, and each instance's `ui` state
  labelled with its place in the tree (proposed).
- The event log shows what the parent emits. Child events the parent handles internally could appear as
  nested entries (proposed).
- Hostile states (P8) compose: the states generated for a child can be plugged into every place a parent
  uses it. Parent snapshots could reuse a child's snapshots by name (Q12).

**Recursion.** A type can refer to itself, such as a `comment` with `replies: array of comment`. Data is
finite, so rendering ends, and nested JSON Schema handles it natively.

**Change analysis.** A change to a child's schema is a change to every schema that refers to it. The diff
(§9.3, §9.4) follows the references and reports the impact per screen: "`option-row` gained a required
field: breaking for `poll`". Field IDs (P2, #13) belong to the type, so a field has the same ID in every
place the type appears (#59).

## 10. Complications

⚑ marks items that change what the file means: settle them before the format hardens.

### Data and contract

1. ⚑ **Lists:** zero or more items that appear, disappear and change. Approach in §9.1.
2. ⚑ **Schema extraction:** getting a consistent schema out of the design as it changes. Approach in
   §9.2.
3. **Schema change analysis:** when the design changes, know exactly how the schema changed and whether
   data fetching has to change. Approach in §9.3 for data and §9.4 for events.
4. ⚑ **Events:** the contract goes both ways. Typed events (`follow {userId}`,
   `saveProfile {name, bio}`), and who handles them (P6). *Settled in part: events are declared in the
   schema (D14) and unhandled ones are caught statically (D15). Approach in §9.4.*
5. ⚑ **UI state vs. data:** "menu open", "selected tab", unsaved input. Can be snapshotted, but isn't
   part of the backend contract (P6). *Ownership settled by D5: the view owns `ui` state. Still open:
   where the line falls. Rule of thumb: if the host needs it to load or save data, it's `data` or an
   event.*
6. ⚑ **Logic creep:** formatting, plurals, "+3 more", comparisons. Choose between no logic, a formatter
   library, or small typed expressions without side effects (P1). Internal state operations (#46) widen
   the surface. Template languages historically fail here by growing into bad programming languages.
   *D29 sets the limit: what would take programming is code, not a bigger language.*
7. ⚑ **Sample vs. default vs. placeholder** (P4).
8. ⚑ **Conditionals and variants:** show/hide, styles driven by a boolean or enum, position-based
   variants in lists. With Tailwind (D9) and Vue's directives (D13), a variant is a class binding with
   literal class names (`m-bind:class="{ 'font-bold': item.unread }"`) or a `data-*` attribute styled
   with `data-[…]:` variants. Class names are never built from strings (#52).
9. ⚑ **Optional fields:** each one doubles the number of states and needs a designed fallback.
10. ⚑ **Values with one of several shapes:** loading/error/ready, mixed feed items, different block
    types.
11. **Richer field types:** image (url, size, alt), rich text, date, money, url, color. "string" is too
    weak for both design and safety.
12. ⚑ **Components and composition:** reusable parts with their own schemas, mapping a page's data to
    each part's props, page schemas built from those parts, recursion. *Settled in part by D16–D19:
    every view is a component, types are referenced and data stays nested, props are whole subtrees.
    Approach in §9.5. Still open: #56–#59 and Q12.*
13. ⚑ **Identity:** stable IDs for nodes, schema fields and list items.
14. **Data that's never displayed:** IDs for list keys, events, links and analytics.
15. **Design limits in the schema:** max lengths and ranges the backend must respect (P8).

### Runtime

16. **Update format:** replace the whole state or send partial updates, target list items by key
    (`followers[id=42]`), batching, streaming from the server. JSON Patch is the known pattern, but it
    addresses list items by index, which breaks when lists change concurrently. Chat apps (D4) make
    streaming a core need.
17. **Preserving DOM state:** focus, cursor position, scroll, selection and running animations must
    survive updates.
18. **Async lifecycle:** loading, partial, error, optimistic. Maybe a standard wrapper type with a
    designed slot for each?
19. ⚑ **Behavior-heavy widgets:** combobox, date picker, drag and drop, rich text editor, a chat
    composer with mentions and attachments, maps, payments. Every visual builder hits this ceiling (P7).
20. ⚑ **Forms:** complex forms are in scope (D4): two-way binding, multi-step flows, conditional fields,
    repeatable field groups, sync and async validation, dirty/touched state, server errors shown on the
    right fields. Native HTML validation is the known pattern to build on (§6).
21. **UI that depends on time or measurement:** "5 min ago", "show more" when text overflows, popover
    positioning. None of these is a pure function of state.
22. **Animations and transitions:** list items entering and leaving, state changes.
23. **Overlays:** modals, toasts and dropdowns render outside their parent, which brings stacking order
    and keyboard focus trapping.
24. **Security:** script injection (XSS) through text, rich text, URL and style bindings. A strict
    Content Security Policy rules out expression engines that rely on `eval`. `m-html` (D13) must only
    accept sanitized rich text.
25. **Authorization:** an admin section in the design must not mean always sending admin data. Fields
    that depend on permissions are optional.
26. **Server rendering and performance:** first paint, SEO, long lists, runtime size. A pure view makes
    server rendering easy, even for emails and link-preview images.

### Presentation

27. ⚑ **Responsive layout:** design tools draw fixed-size frames, but production is fluid. The layout
    model needs to be built on flexbox/grid, with breakpoints as variants. Rendering at several real
    viewport sizes in the shell (§8) helps catch problems.
28. ⚑ **Semantics and accessibility:** element roles, headings, labels, focus order, keyboard use.
29. **Translation:** static text becomes data (message catalogs), plural rules, longer text in other
    languages, right-to-left layouts.
30. **Theming and design tokens:** dark mode, brand tokens, and where tokens end and data begins.
    Tailwind's theme holds the tokens and `dark:` handles dark mode (D9), and there's one theme per
    project (D12).
31. **Routing and multiple screens:** syncing URL and state, a shared app shell, navigation events, deep
    links to specific UI states. Needed for standalone mode (D7, §7). *Settled in part by D20–D27:
    pluggable sources, a declared route table, `URLPattern` paths, links as typed fields, loading
    policies, the `navigate` event, routes in the shell and the URL as the `route` input. Still open: a
    shared app shell (#60), `ui` state in the URL, and not-found and error screens.*

### Tooling and workflow

32. **Design edit or data edit:** is a given change a template change, a sample change, or a new
    variant? With no visual editor (D1), this falls on the AI: "make the second row red" has to become a
    field or a position rule (§9.1).
33. **Forgotten bindings:** a hardcoded "Ana Souza" looks perfect in the design and is wrong for every
    user in production (P8).
34. **Snapshot upkeep:** a base state plus overrides, updating snapshots when the schema changes, and the
    explosion of possible combinations. *Settled in part by D30: snapshots extend a base and override
    what differs (Q14), built in POC.md §17.*
35. **Version mismatch at deploy:** the new UI expects a field the deployed backend doesn't send yet (P3,
    §9.3).
36. **Adapter and contract tests:** generated types, contract tests, an adapter the AI keeps up to date.
37. ⚑ **File format:** HTML-based (D6), plain text, easy to diff and merge. Snapshots live inside the
    file (D8), so design-time content must be easy to strip from production builds, and the file grows
    with every snapshot.
38. **LLMs and the format:** a brand-new format is unknown to models. A Vue-like one (D6, D10) is
    familiar but tempts them to write arbitrary JavaScript, which P1 forbids, or to slip back into
    `v-if`, `x-for` and `@click`. The validator must explain what's allowed and suggest the `m-`
    equivalent.
39. **Gradual adoption:** mounting a Melzin view inside an existing React/Vue app, and a way to export
    out. *Settled by D7: both embedded and standalone; approach in §7. The `m-` prefix (D10) avoids
    clashing with host pages that use Vue or Alpine. Still open: Shadow DOM isolates styles both ways,
    which is safe but awkward for sharing fonts and tokens with the host, and each view's Tailwind CSS
    has to be available inside its shadow root (#52). Without Shadow DOM, a host that also uses Tailwind
    with a different theme would clash: same class names, different values.*
40. **The editor itself:** a visual editor good enough for humans is a huge build. *Deferred by D1: the
    preview shell (§8) replaces it.*

### Preview shell

41. **Zoom vs. layout:** zooming the canvas must scale renders visually without changing their layout
    width, or media queries fire at the wrong sizes. Scale the frames; don't use browser zoom.
42. **Many live renders at once:** dozens of frames, each running the runtime, can get heavy. Off-screen
    renders may need to pause or be virtualized.
43. **Events with no backend:** in the preview, emitted events have nowhere to go. Needs an event log,
    maybe simple mock transitions (§8).
44. **File reloads vs. manual edits:** when the AI changes the file while a human is editing state, what
    survives? For now, a refresh discards the edits (D3).
45. **Invalid states:** should the inspector allow edits that break the schema, to test how the runtime
    copes with bad data, or block them?

### Internal state and interactive apps

46. ⚑ **Internal state operations:** with the view owning `ui` state (D5), interactions must change it:
    toggle a menu, pick a tab, type a draft, clear it after sending. That needs a small set of
    declarative operations (set, toggle, reset, add/remove an item, emit) that doesn't turn into a
    programming language (P1, #6, D29).
47. **Host influence on internal state:** resetting a form after a successful save, focusing an input,
    opening a dialog when the server says so. React calls this controlled vs. uncontrolled components.
48. **Internal state lifetime:** per-item state (each message's "expanded" toggle) must follow its
    item's key (#13). When the host swaps the data (another user's profile), which internal state
    resets?
49. **Chat patterns** (D4): streaming text into a message, staying scrolled to the bottom, loading older
    messages without the view jumping, optimistic sends with pending and failed states, very long
    histories.

### Authorship and hosting

50. **Reviewing AI changes:** if humans never read the file (D1), they review by looking: before/after
    renders of every snapshot, plus the schema diff (§9.3).
51. **Standalone host** (D7): building only with Melzin means something has to do a host app's job:
    routing (#31), loading data, sending events, realtime updates. *Shape settled by D11 (§7), with
    routing and data sources settled by D20–D24.*

### Styling

52. **Generating Tailwind CSS** (D9): production needs CSS for exactly the classes the file uses, and
    the shell needs it live as the AI edits. A generator running in the browser can serve the shell
    while production precompiles, as long as both produce the same CSS (P5). Class names must appear
    literally in the file, never built from strings, which also fits P1.
53. **Project context** (D12): a file only renders correctly with its project's theme, so the shell, the
    AI's renders and embedded views all have to find and load it. The project needs a known layout, such
    as the theme at the project root.

### Events

54. **Hosts the checker can't see** (D15): the host is arbitrary code, such as a React app or a Python
    backend. Generated types catch missing handlers only where the host uses them and has a type
    checker; elsewhere the check falls back to contract tests and runtime warnings (§9.4).
55. **Event outcomes:** most results come back as new data (P6), but some UIs need to know how a specific
    event ended (saving, saved, failed, validation errors) to update `ui` state: disable a button, clear
    a draft, show an error (#47, Q11).

### Components

56. ⚑ **Content passed into components:** a `<slot>` filled with static content is simple. Content that
    binds to data, or handles events, crosses the line between two schemas: does slotted content bind to
    the parent's data (Vue's default) or to values the child hands it (Vue's scoped slots)? Both need
    the checker to know which schema each binding belongs to.
57. **Re-emitting in deep trees:** with events going one level up (D19), a button four views deep needs
    a handler at every level. A forwarding shorthand may help, as long as each level's event list stays
    explicit and checked (D15).
58. **Styles across nested views:** if each view gets its own Shadow DOM (#39), every child needs the
    project's CSS inside its shadow root too (#52). One shadow root per screen, with children rendered
    inside it, avoids that.
59. **Shared children:** a child used by many screens turns one schema change into many breaking
    changes. The diff reports them per screen (§9.5); the shell could show where each view is used, and
    render every screen that uses a changed child for review (#50).
60. **Shared frames across routes:** an app shell (nav bar, sidebar) that wraps many routes. The aim is
    to need no "layout" concept: a frame is an ordinary view with a `<slot>` (D16) that receives a whole
    screen. Still open: whether the frame stays mounted across navigation (keeping its `ui` state and
    data), whether it has its own loader, and how slotted screens relate to #56. *Deferred: routes map
    straight to views for now (D21).*

### Stages

61. **Exploration** (D28): comparing alternatives and design directions before anything is bound.
    Today an alternative can simply be its own view, and the shell shows one view at a time. Still open:
    where alternatives live, whether as separate views, as variants in one file that production strips
    like other design-time content (#37), or as git branches; showing them side by side the way a design
    tool's canvas does (§8); a direction that spans several screens; and promoting the chosen one
    without leaving the rest behind as clutter. *Settled in part by D31: alternatives are folders in
    `explore/`, shown side by side in the shell and promoted by moving their files into `views/`. Still
    open: an overview of a direction across every screen it changes.*
62. **Themes while exploring:** comparing design directions often means comparing colors, fonts and
    radii, but a project has one theme (D12). Alternatives need a way to bring their own theme while the
    screens that ship keep sharing one. *Settled by D32: a `theme.css` in the alternative's folder,
    layered over the project's.*
63. **Designs that ship as code** (D29): when a screen is written in regular code, its views and
    snapshots are its spec, and the design-tool problem comes back: the code can drift from the design.
    If the implementation can render the same `data`, rendering every snapshot with it and comparing
    screenshots with the design's would catch the drift.

## 11. Choosing battles

The ⚑ items change what the file means, so getting one wrong means migrating every file later. The rest
can be added without breaking anything. Settle the ⚑ items on paper first; put off animations,
translation, server rendering, form polish and theming. Routing (D20–D27, §7) is built (POC.md §15);
shared frames across routes (#60) wait. Design in stages is built too: alternatives in `explore/` side
by side in the shell, and each view's stage (D28, D31–D33, POC.md §16).

**Next on paper:** the language inside `m-` attributes. It's ⚑ and gates the first prototype. D29 bounds
it: a need that would take programming gets code (P7), not a bigger language. To settle:

- what an expression can contain: paths, literals, comparisons, `!`, `&&`, `||`, maybe ternaries,
  formatter calls (#6)
- `m-for`: which of Vue's forms are allowed (index, destructuring, ranges), and whether the key comes
  from `m-bind:key` or from the schema (§9.1)
- empty states: Vue has no `empty` slot, so it's `m-if`/`m-else` around the list, which needs `.length`
  in expressions
- handler operations (#46), what `emit` payloads can be built from (`data`, `ui`, the list item in scope,
  the DOM event), and which modifiers apply
- `m-model`: what it can write to (only `ui`, since `data` belongs to the host?) and its modifiers
- `m-html`: sanitized rich text only (#24)
- whether Vue's niche directives (`v-pre`, `v-once`, `v-memo`, `v-cloak`) carry over

Conditionals (`m-if`, `m-else-if`, `m-else`, `m-show`) were built ahead of this battle with a
provisional subset: a condition is a path, optionally negated with `!`, tested for truthiness
(POC.md §14). The battle can still change it.

Snapshots that extend a base (D30) didn't depend on the language either, and are built, in the form
Q14 leans to (POC.md §17).

**After that:** the file layout: where the schema, internal state and snapshots sit in the HTML file
(#37).

**Step zero: [POC.md](POC.md).** An even smaller first version: static pages, text bindings and click
events, with the shell, the checker and a production page. It only needs paths and `emit('name')`, so it
doesn't wait for the language battle above.

**First build battle**, when it's time: a small prototype of the core.

- One hand-written profile page in HTML with `m-` directives and Tailwind classes, snapshots included:
  text, an image attribute, an optional field with a fallback, a list with keys and an empty state, an
  enum variant, a tab switch held in internal state, and one event.
- A tiny runtime that renders it, packaged as a custom element so embedding (D7) is tested from day one.
- A minimal shell: about six snapshots in a grid, zoom, and a state inspector per render.
- TypeScript types generated from the schema.

That tests #1, #2, #4, #7–#9, #13, #46 and #52, and the state inspector exercises reactive updates.

**Second battle:** #3, schema diffs plus the compatibility rules.

**Third battle:** a chat screen, to stress the interactive end of D4: streaming updates, the draft in
internal state, optimistic sends and a long history (#16–#18, #46–#49).

## 12. Open questions

- **Q1. Which webapps?** *Settled by D4.*
- **Q2. Does the view hold any state of its own?** *Settled by D5: yes, its `ui` state.*
- **Q3. What shape is the file?** *Settled by D6: HTML and known patterns.*
- **Q4. Standalone or embeddable?** *Settled by D7: both.*
- **Q5. Where do snapshots live?** *Settled by D8: inside the file, to start.*
- **Q6. Plain CSS or Tailwind?** *Settled by D9: Tailwind.*
- **Q7. Exact Vue/Alpine directive names, or a Melzin prefix?** *Settled by D10: `m-`.*
- **Q8. Is the standalone host in §7 the right shape?** *Settled by D11: yes, amended by D20–D21.*
- **Q9. Where does the Tailwind theme live?** *Settled by D12: one theme per project.*
- **Q10. Which directives, exactly?** *Settled by D13: Vue's set.*
- **Q11. Can the view see how an event ended?** Lean: yes, through a built-in status per event (idle,
  pending, done, failed) that the view can bind to, like React's `useActionState` or Remix's fetchers.
  Anything richer comes back as data (P6, #55).
- **Q12. Can a parent's snapshot reuse a child's snapshot?** Such as
  `"pizza": { "$snapshot": "option-row#landslide winner" }`, instead of repeating its data. It keeps
  child states in sync and lets generated states compose (P8), but adds a reference mechanism to
  snapshots (#34). Lean: yes.
- **Q13. How does a view show its stage?** *Settled by D33: inferred from what the file has.*
- **Q14. How does a snapshot override its base?** Lean: JSON Merge Patch (RFC 7396), a known pattern
  (P9). Objects merge field by field, `null` removes a field, and lists and plain values replace whole.
  Melzin's types have no `null` so far, so that's how a snapshot makes an optional field missing:
  `"signed out": { "extends": "follows you", "data": { "viewer": null } }`. The `extends` key names
  the base, as in `tsconfig.json`; chains are fine, cycles are errors, and the checker validates each
  snapshot once it's resolved. Changing one list item means restating the list (D30). *Built as this
  lean (POC.md §17); not settled yet.*

## 13. Why this could beat "just let the AI write React"

- **The design never goes stale.** In a design-first workflow (a design in pen.dev or Figma, then an AI
  writes the code), the design stops matching the product the first time the code changes without it,
  and a few iterations later nobody trusts it. Here the design is the product, so every change after
  launch is still a design change, reviewed by looking at every state before and after (#50) and at the
  contract diff (§9.3). Over a product's life, that's worth more than skipping the first implementation.
- **Checking is cheap.** A view with no side effects can be type-checked against its schema, rendered in
  every snapshot at every screen size, fed generated states and reviewed from screenshots by a model.
  When AI output is cheap, checking it is the bottleneck, and that's Melzin's advantage.
- **Nothing is lost in translation.** Design-to-code tools struggle with going from code to design and
  back. Here there's only one artifact.
- **Plain files on disk.** A view is an HTML file in the repository: any agent edits it with ordinary
  file tools, git versions, diffs and merges it, and many files and projects can be worked on at once.
  Design tools keep the open document inside the app. With pen.dev, for example, the AI edits what the
  app holds in memory, which it can't save to disk itself, and only one file is active at a time.
- **The contract is explicit and diffable.** After a design change, the backend work becomes routine,
  and an AI can do it.
- **States become something you can browse.** Anyone can look at every state. A production bug report
  can be a state (with personal data removed) that you open in the shell to see exactly what the user
  saw.
- **A pure view renders anywhere:** on the server, in emails, in link-preview images.

## 14. Risks

- **LLMs don't know the format.** Models know HTML and React deeply and Melzin not at all. D6, D9, D10
  and D13 keep the format close to what they know, and the AI gets fast validate-and-render feedback
  (§8). The flip side is #38.
- **There's a ceiling.** Anything that isn't a pure function of state needs code. Make that boundary
  explicit and typed (P7) instead of pretending it isn't there. This behavior boundary (events, UI
  state, forms, complex widgets) is likely the hardest part of the project, and it's where existing
  design-to-production tools stop: Webflow and Framer stay with websites, while Plasmic and Builder.io
  act as a visual layer inside a code app. D4 raises the bar: chat apps and complex forms sit right at
  this boundary, so internal state operations (#46) and code components (P7) carry more weight. D29
  sets the response: past the ceiling, the behavior is code and Melzin stays the design tool, instead of
  the format growing into a language.
- **Scope creep.** Standalone mode (D7) plus interactive apps (D4) pull Melzin toward becoming a whole
  framework. Keeping business logic and auth in the backend (§3) is the guardrail.
- **A visual editor is expensive to build.** Avoided by D1.
- **The opposite approach exists.** In Onlook-style tools, the canvas edits real React code. That gives
  unlimited power but loses the static analysis Melzin depends on. Melzin deliberately trades that power
  for analysis.

## 15. Prior art

- **Natural templates** (Zope's TAL in the early 2000s, Thymeleaf today): valid HTML with sample content
  that bindings replace at runtime, so designers could keep using their own tools. Thymeleaf even needs
  a special attribute so a prototype can show several sample rows (`th:remove="all-but-first"`): the
  list problem is old.
- **Webflow and Framer CMS:** elements bound to data fields, collection lists (Webflow's include a
  built-in empty state), conditional visibility, field types made for designers (image, rich text,
  option, reference, color).
- **Relay (GraphQL):** each component declares the data it needs; a compiler merges those declarations
  and generates types, so schema changes are known without running anything. Closest match to #2 and
  #3.
- **Storybook stories and Figma component properties:** named states and typed props (text, boolean,
  variant) with controls to edit them. Same idea as snapshots and the state inspector.
- **Plasmic:** a visual builder that either renders designs at runtime or generates code, with code
  components for what design can't express. The closest existing product, and open source, so we can see
  what they learned.
- **A2UI (Google, 2025):** AI-generated UI as a component tree plus a separate data model. Components bind
  to data by path, and lists are a template repeated over an array. The AI-era version of the same
  separation.
- **Protobuf, Avro, Pact:** stable field IDs, rules for which schema changes are compatible, contract
  tests written from the consumer's side. Reuse as-is for #3.
- **Elm architecture:** the view is a pure function of the model; user interactions go out as messages.
- **Vue and Alpine:** directive syntax for HTML templates that models already write fluently. Melzin uses
  Vue's built-in set under its own prefix (D10, D13), and Vue's `emits` is the model for declared events
  (D14).
- **Web Components:** the standard way to ship a component that works in any framework, or none (§7).
- **JSON Schema:** language-neutral schemas with validators in every language; the likely schema format
  (§6).
- **Phoenix LiveView and Hotwire:** apps where the server drives the UI over a live connection. The
  standalone host idea is similar but sends data instead of HTML (§7).
- **Tailwind CSS:** utility classes that models write fluently, with variants for state, breakpoints and
  dark mode; Melzin's styling (D9).

## 16. Glossary

- **Melzin file:** the artifact: view tree, schema and snapshots.
- **Binding:** a declared link from part of a node (text, attribute, visibility, style, list) to a data
  path, plus operations.
- **Directive:** an `m-` attribute that binds part of an element to data or state, or handles an event
  (D10, D13).
- **Field:** a schema entry: stable ID, name, type, optionality, default, constraints.
- **Schema:** the declared `data` fields, `ui` fields and events. Its `data` fields and events form the
  contract with the backend.
- **Data (`data`):** state that comes from the host. The backend contract.
- **Internal state (`ui`):** state the view owns, declared in the file and changed by the view's own
  interactions. Visible to tools, not part of the backend contract.
- **URL input (`route`):** the current route's name, params and query, injected by the host and
  read-only. Any view can bind to it (D27).
- **Event:** a typed message the view sends to its host, declared in the schema (D14).
- **Handler:** code that consumes an event: in the host for a screen, in the parent view for a component.
  Every declared event needs one (D15).
- **Host:** whatever feeds a view its `data` and handles its events: the app embedding it, or Melzin's
  standalone host.
- **Route:** a named entry in the route table that maps a `URLPattern` path to a view (D21, D22).
- **Source:** the code that loads a route's data and handles its events: static (build time), remote
  (a server) or local (on the device) (D20).
- **Snapshot:** a named state (`data` + `ui`) that renders the UI in one particular situation.
- **Sample, default, placeholder:** see P4.
- **Render:** one live instance of the view in the shell, for one snapshot at one viewport size.
- **Shell:** the browser app that hosts many renders, with zoom and state inspectors.
- **Adapter:** backend code that turns domain data into data that matches the schema.
- **Code component:** a hand-written component with declared props and events, used where design can't
  express behavior.
- **Component:** any view used inside another view (D16). The outer view is its parent.
- **Prop:** a top-level `data` field of a component, bound by its parent to a subtree of the parent's
  data or to a literal (D18).
- **Type registry:** the project-wide set of named types, one per view plus their `$defs`, that schemas
  refer to with `$ref` (D17).
- **Stage:** exploration, states or contracts, the three passes a design goes through (D28). Each is a
  valid place to stop. Inferred from the file (D33).
- **Alternative:** a design direction in a folder of `explore/`, whose views stand in for the views with
  the same file name, with its own theme if it needs one (D31, D32).

## Changelog

- 2026-10-16: first discussion. Idea, principles P1–P8, complications #1–#40. Then D1–D3 (AI as main
  author, browser preview shell, temporary state edits) and complications #41–#45.
- 2026-10-16: answered the open questions. D1 refined (AI-first, maybe AI-only); D4–D7 (target apps,
  internal state, HTML and known patterns, embeddable and standalone). Added P9, the known-patterns and
  embedding/standalone proposals (§6, §7), the AI's tools in the shell, complications #46–#51 (#20 is now
  ⚑) and questions Q6–Q8.
- 2026-10-16: settled Q5–Q8 as D8–D11 (snapshots inside the file, Tailwind, the `m-` prefix, the
  standalone host). Added complication #52, questions Q9–Q10 and the next battle on paper.
- 2026-10-16: settled Q9–Q10 as D12–D13 (one Tailwind theme per project, Vue's directive set). Added
  complication #53 and the checklist for the next battle.
- 2026-10-16: D14–D15 (events declared in the schema; unhandled events caught by static analysis). Added
  §9.4, complications #54–#55 and Q11.
- 2026-10-16: added POC.md as step zero before the first build battle (§11).
- 2026-10-16: D16–D19 (every view is a component; flat types, nested data; props are whole subtrees;
  encapsulated children). Added §9.5, complications #56–#59 and Q12.
- 2026-10-17: conditionals built ahead of the language battle, with a provisional condition syntax, and
  the profile example that uses them (POC.md §14).
- 2026-10-17: routing on paper. D20–D24 (pluggable sources, a declared route table, `URLPattern`
  paths, links as typed fields with no URL building in views, loading policies per route); D11 amended.
  Expanded §7 and added complication #60 (shared frames across routes, deferred).
- 2026-10-17: D25–D27 (navigation as one built-in `navigate` event, routes shown in the shell like
  views, the URL as a third input `route`). Added navigation and URL notes to §7 and routes to §8,
  with a follow mode, an app map, simulated loading states and live frames under "Later".
- 2026-10-17: routing built (POC.md §15): routes.json, link fields and `m-bind:href`, the `route` input,
  `startApp` with sources and the `navigate` hook, loading policies, and routes in the shell. The profile
  example became a routed app.
- 2026-10-17: D28–D29 (design in three stages: exploration, states and contracts; Melzin stops where
  programming would start and stays the design tool past it). Notes on D1 and D4, complications #61–#63
  (exploration, themes while exploring, designs that ship as code) and Q13.
- 2026-10-17: D30 (snapshots extend other snapshots) and Q14 on its form; planned in POC.md §11.
- 2026-10-17: §13 leads with the design that never goes stale and adds plain files on disk; the README's
  Why section follows.
- 2026-10-17: D31–D33 (alternatives as folders in `explore/`, each with its own theme if it needs one,
  and a view's stage inferred from its file), built in the shell with several device sizes at once
  (POC.md §16). Settles Q13 and #62, and #61 in part.
- 2026-10-17: snapshots that extend a base (D30) built as Q14's lean: JSON Merge Patch with `extends`
  (POC.md §17).
