# Melzin

> Design is implementation.

**Status:** draft from the first design discussions (2026-10-16). Nothing is implemented yet.

Every numbered item keeps its number: decisions (D1, D2, ...), principles (P1, ...), complications
(#1, ...) and open questions (Q1, ...). New items are appended; settled ones stay in place with a note.

## 1. Summary

Melzin is a design tool an AI operates, like pen.dev, where the file the AI designs is also the
production front end of a webapp. The design marks where data goes and carries sample data. In
production, the same file renders real data and updates reactively when that data changes.

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

**Non-goals for now**

- Owning business logic or auth: those stay in regular code, usually the backend, in both embedded and
  standalone mode.
- A visual editor for humans (D1).
- Games and other extremely interactive apps (D4).
- Targets other than webapps, such as native mobile.

## 4. Decisions

- **D1. The AI is the main author, maybe the only one.** It works on the file directly, and humans may
  never edit it by hand. Humans review and explore through the preview shell and steer the AI by
  prompting; there's no visual editor.
- **D2. The preview is a real browser** inside a shell that can zoom in and out and show many snapshots
  at once (§8).
- **D3. Humans can inspect and edit the state of each render.** Edits change state only and are
  temporary: nothing is saved, and a refresh reloads everything from the file (for now).
- **D4. Target apps:** CRUD apps, dashboards and SaaS screens, and also interactive apps such as chat
  and complex forms. Not games or other extremely interactive apps.
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
- **D12. One Tailwind theme per project.** Every screen shares it, since design tokens are brand-wide.
- **D13. Vue's directive set, under the `m-` prefix:** `m-text`, `m-html`, `m-show`, `m-if`,
  `m-else-if`, `m-else`, `m-for`, `m-on`, `m-bind`, `m-model` and `m-slot`, with Vue's modifiers
  (`.prevent`, `.enter`, `.trim`...). The `@`, `:` and `#` shorthands are left out (D10). What goes
  inside the directives is the next battle (§11).
- **D14. The schema declares every event the view emits,** with typed payloads, like Vue's `emits`.
  Interactions that only change `ui` state aren't events (§9.4).
- **D15. Static analysis catches unhandled events.** Every declared event must have a handler in
  whatever consumes the view, and the view can't emit an event the schema doesn't declare (§9.4).

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
- component instances, with page data mapped to the component's props
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
values; other snapshots override parts of it.

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
  elements for components.
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

- the URL picks a screen (#31)
- the host loads that screen's `data` from the backend-for-frontend (P3)
- events go to the backend, which answers with new data or a patch
- realtime screens such as chat receive patches pushed by the server (#49)

Business logic and auth stay in the backend in both modes. The standalone host resembles Phoenix LiveView
or Hotwire, except the server sends data shaped by the schema instead of HTML.

## 8. Preview shell

The browser app where humans review and explore the design (D1–D3), and where the AI checks its work.

**For humans**

- Renders the Melzin file with the production runtime (P5).
- A canvas with zoom and panning.
- Many renders at once: a grid of snapshots × viewport sizes (later also × screens).
- A state inspector for each render:
  - shows the render's full state (`data` + `ui`)
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
    each part's props, page schemas built from those parts, recursion.
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
    links to specific UI states. Needed for standalone mode (D7, §7).

### Tooling and workflow

32. **Design edit or data edit:** is a given change a template change, a sample change, or a new
    variant? With no visual editor (D1), this falls on the AI: "make the second row red" has to become a
    field or a position rule (§9.1).
33. **Forgotten bindings:** a hardcoded "Ana Souza" looks perfect in the design and is wrong for every
    user in production (P8).
34. **Snapshot upkeep:** a base state plus overrides, updating snapshots when the schema changes, and the
    explosion of possible combinations.
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
    programming language (P1, #6).
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
    routing (#31), loading data, sending events, realtime updates. *Shape settled by D11 (§7).*

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

## 11. Choosing battles

The ⚑ items change what the file means, so getting one wrong means migrating every file later. The rest
can be added without breaking anything. Settle the ⚑ items on paper first; put off animations,
translation, server rendering, form polish, routing and theming.

**Next on paper:** the language inside `m-` attributes. It's ⚑ and gates the first prototype. To settle:

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

**After that:** the file layout: where the schema, internal state and snapshots sit in the HTML file
(#37).

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
- **Q8. Is the standalone host in §7 the right shape?** *Settled by D11: yes.*
- **Q9. Where does the Tailwind theme live?** *Settled by D12: one theme per project.*
- **Q10. Which directives, exactly?** *Settled by D13: Vue's set.*
- **Q11. Can the view see how an event ended?** Lean: yes, through a built-in status per event (idle,
  pending, done, failed) that the view can bind to, like React's `useActionState` or Remix's fetchers.
  Anything richer comes back as data (P6, #55).

## 13. Why this could beat "just let the AI write React"

- **Checking is cheap.** A view with no side effects can be type-checked against its schema, rendered in
  every snapshot at every screen size, fed generated states and reviewed from screenshots by a model.
  When AI output is cheap, checking it is the bottleneck, and that's Melzin's advantage.
- **Nothing is lost in translation.** Design-to-code tools struggle with going from code to design and
  back. Here there's only one artifact.
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
  this boundary, so internal state operations (#46) and code components (P7) carry more weight.
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
- **Event:** a typed message the view sends to its host, declared in the schema (D14).
- **Handler:** code that consumes an event: in the host for a screen, in the parent view for a component.
  Every declared event needs one (D15).
- **Host:** whatever feeds a view its `data` and handles its events: the app embedding it, or Melzin's
  standalone host.
- **Snapshot:** a named state (`data` + `ui`) that renders the UI in one particular situation.
- **Sample, default, placeholder:** see P4.
- **Render:** one live instance of the view in the shell, for one snapshot at one viewport size.
- **Shell:** the browser app that hosts many renders, with zoom and state inspectors.
- **Adapter:** backend code that turns domain data into data that matches the schema.
- **Code component:** a hand-written component with declared props and events, used where design can't
  express behavior.

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
