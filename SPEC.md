# Melzin

> Design is implementation.

**Status:** draft from the first design discussion (2026-10-16). Nothing is implemented yet.

Every numbered item keeps its number: decisions (D1, D2, ...), principles (P1, ...), complications
(#1, ...) and open questions (Q1, ...). New items are appended; settled ones stay in place with a note.

## 1. Summary

Melzin is a design tool an AI operates, like pen.dev, where the file the AI designs is also the
production front end of a webapp. The design marks where data goes and carries sample data. In
production, the same file renders real data and updates reactively when that data changes.

The artifact is a typed, pure function `view(state) → UI`, written by an AI and shipped with its own
input type (the schema) and example inputs (the snapshots).

Melzin owns the view, not the app. Business logic and data fetching stay in regular code, which feeds
the view data that matches its schema.

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
- An explicit, typed, diffable data contract between the UI and the backend.
- Every UI state can be rendered, inspected and tested.
- Precise reactive updates: a data change only touches the DOM that depends on it.
- A format that's easy for models to write, validate and check visually.

**Non-goals for now**

- Owning the whole app: business logic, data fetching, auth.
- A visual editor for humans (D1).
- Targets other than webapps, such as native mobile.

## 4. Decisions

- **D1. The AI is the main author.** It works on the file directly. Humans review and explore through a
  preview; there's no visual editor for now.
- **D2. The preview is a real browser** inside a shell that can zoom in and out and show many snapshots
  at once (§7).
- **D3. Humans can inspect and edit the state of each render.** Edits change state only and are
  temporary: nothing is saved, and a refresh reloads everything from the file (for now).

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
(§8.2).

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

**P6. Data in, events out, two kinds of state.** The view emits typed events (`follow {userId}`). State
has two parts:

- `data`: the backend contract.
- `ui`: menu open, selected tab, unsaved input. Owned by the runtime or a controller.

Both can be snapshotted, but only `data` goes into the backend schema. In production, a controller or the
backend handles events. In the preview, an event can be linked to a snapshot ("click Follow → the
*following* snapshot"), which is prototyping.

**P7. Code components are typed black boxes.** Where design can't express behavior (date picker, map,
rich text editor), a hand-written component with declared props and events plugs in. The ceiling becomes
explicit instead of a dead end.

**P8. Snapshots are the AI's test suite.** Generate hostile states from the schema: long strings,
0/1/500 items, every enum value, every optional field missing. Render them all and have a model review
the screenshots. This finds the design's real limits ("names break past ~40 characters"), which become
constraints in the schema (#15). Varied snapshots also catch forgotten bindings (#33): if "Ana Souza"
shows up in Bruno's snapshot, it's hardcoded.

## 6. Building blocks

The conceptual parts of a Melzin file. No syntax is decided yet (Q3).

**View tree.** The UI, made of nodes that can carry bindings:

- text and attribute bindings: a path plus formatters
- conditionals: show or hide
- variants: styles driven by a boolean, an enum or list position (first/last/odd)
- repeat: a template repeated over a list, with a key and an `empty` slot
- switch: picks a template by the tag of a value that can take one of several shapes
- component instances, with page data mapped to the component's props
- code components (P7)
- event emitters with typed payloads

**Schema.** Fields, each with a stable ID, name, type, optionality, default and constraints. List item
types declare their key field.

**Snapshots.** Named states (`data` + `ui`). A base snapshot holds the sample values; other snapshots
override parts of it.

**Design-time content.** Notes, explorations and similar, kept apart from what runs in production (#37).

**Types (draft):** string, number, boolean, enum, id, date, money, url, color, image (url, size, alt),
rich text; list of T (with a key), object, optional, tagged union. Constraints such as max length and
ranges.

**Binding operations (draft):** paths; formatters for dates, relative times, numbers, money, plurals and
list joining (like `Intl.ListFormat`); comparisons. Whether to go further is #6.

## 7. Preview shell

The browser app where humans look at and explore the design (D1–D3).

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

**Proposed, not decided:**

- Each render in its own iframe, so viewport sizes and media queries are real and CSS stays isolated.
- An event log per render: with no backend in the preview, emitted events and their payloads show up
  there. An event could optionally be linked to a snapshot or a state change (P6).
- Headless access for the AI: render a snapshot at a given viewport size and get a screenshot, validate
  the file, show schema diffs. The AI then checks its work against the same renders humans see (P8).

**Later:**

- Save an edited state as a new snapshot.
- Reload when the file changes, keeping manual edits that still fit the schema (#44).
- Show the generated hostile states (P8) in the grid.
- Click a schema field to highlight every element bound to it.

## 8. Approach to the first three complications

### 8.1 Lists (#1)

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
  updates can't preserve focus or animations, or target a single item in a partial update.
- **Later:** lists mixing item types (a feed with posts and ads, switched on a type tag), recursion
  (comment replies), separators ("Ana, Bruno and 3 others", via an `Intl.ListFormat`-style formatter),
  grouping (better if the backend sends lists that are already grouped, P3).

### 8.2 Schema extraction (#2)

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

### 8.3 Schema change analysis (#3)

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

The diff feeds:

- generated types for the backend (TypeScript, Zod, Pydantic)
- a contract test: the adapter's output for test fixtures must match the schema
- an AI task: "the schema changed like this, update the adapter"

To avoid version mismatches between a new UI and an old backend (#35), deploy the adapter with the UI
(P3), and check data where it enters the UI: fall back to defaults and report anything missing.

## 9. Complications

⚑ marks items that change what the file means: settle them before the format hardens.

### Data and contract

1. ⚑ **Lists:** zero or more items that appear, disappear and change. Approach in §8.1.
2. ⚑ **Schema extraction:** getting a consistent schema out of the design as it changes. Approach in
   §8.2.
3. **Schema change analysis:** when the design changes, know exactly how the schema changed and whether
   data fetching has to change. Approach in §8.3.
4. ⚑ **Events:** the contract goes both ways. Typed events (`follow {userId}`,
   `saveProfile {name, bio}`), and who handles them (P6).
5. ⚑ **UI state vs. data:** "menu open", "selected tab", unsaved input. Can be snapshotted, but isn't
   part of the backend contract (P6).
6. ⚑ **Logic creep:** formatting, plurals, "+3 more", comparisons. Choose between no logic, a formatter
   library, or small typed expressions without side effects (P1). Template languages historically fail
   here by growing into bad programming languages.
7. ⚑ **Sample vs. default vs. placeholder** (P4).
8. ⚑ **Conditionals and variants:** show/hide, styles driven by a boolean or enum, position-based
   variants in lists.
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
    (`followers[id=42]`), batching, streaming from the server.
17. **Preserving DOM state:** focus, cursor position, scroll, selection and running animations must
    survive updates.
18. **Async lifecycle:** loading, partial, error, optimistic. Maybe a standard wrapper type with a
    designed slot for each?
19. ⚑ **Behavior-heavy widgets:** combobox, date picker, drag and drop, rich text editor, maps,
    payments. Every visual builder hits this ceiling (P7).
20. **Forms:** two-way binding, validation derived from schema limits, server errors shown on the right
    fields.
21. **UI that depends on time or measurement:** "5 min ago", "show more" when text overflows, popover
    positioning. None of these is a pure function of state.
22. **Animations and transitions:** list items entering and leaving, state changes.
23. **Overlays:** modals, toasts and dropdowns render outside their parent, which brings stacking order
    and keyboard focus trapping.
24. **Security:** script injection (XSS) through text, rich text, URL and style bindings. A strict
    Content Security Policy rules out expression engines that rely on `eval`.
25. **Authorization:** an admin section in the design must not mean always sending admin data. Fields
    that depend on permissions are optional.
26. **Server rendering and performance:** first paint, SEO, long lists, runtime size. A pure view makes
    server rendering easy, even for emails and link-preview images.

### Presentation

27. ⚑ **Responsive layout:** design tools draw fixed-size frames, but production is fluid. The layout
    model needs to be built on flexbox/grid, with breakpoints as variants. Rendering at several real
    viewport sizes in the shell (§7) helps catch problems.
28. ⚑ **Semantics and accessibility:** element roles, headings, labels, focus order, keyboard use.
29. **Translation:** static text becomes data (message catalogs), plural rules, longer text in other
    languages, right-to-left layouts.
30. **Theming and design tokens:** dark mode, brand tokens, and where tokens end and data begins.
31. **Routing and multiple screens:** syncing URL and state, a shared app shell, navigation events, deep
    links to specific UI states.

### Tooling and workflow

32. **Design edit or data edit:** is a given change a template change, a sample change, or a new
    variant? With no visual editor (D1), this falls on the AI: "make the second row red" has to become a
    field or a position rule (§8.1).
33. **Forgotten bindings:** a hardcoded "Ana Souza" looks perfect in the design and is wrong for every
    user in production (P8).
34. **Snapshot upkeep:** a base state plus overrides, updating snapshots when the schema changes, and the
    explosion of possible combinations.
35. **Version mismatch at deploy:** the new UI expects a field the deployed backend doesn't send yet (P3,
    §8.3).
36. **Adapter and contract tests:** generated types, contract tests, an adapter the AI keeps up to date.
37. ⚑ **File format:** plain text, easy to diff and merge, AI-friendly, with what runs in production kept
    separate from design-time content (notes, explorations, snapshots). See Q3 and Q5.
38. **LLMs don't know a new format** (Q3).
39. **Gradual adoption:** mounting a Melzin view inside an existing React/Vue app, and a way to export
    out (Q4).
40. **The editor itself:** a visual editor good enough for humans is a huge build. *Deferred by D1: the
    preview shell (§7) replaces it for now.*

### Preview shell

41. **Zoom vs. layout:** zooming the canvas must scale renders visually without changing their layout
    width, or media queries fire at the wrong sizes. Scale the frames; don't use browser zoom.
42. **Many live renders at once:** dozens of frames, each running the runtime, can get heavy. Off-screen
    renders may need to pause or be virtualized.
43. **Events with no backend:** in the preview, emitted events have nowhere to go. Needs an event log,
    maybe simple mock transitions (§7).
44. **File reloads vs. manual edits:** when the AI changes the file while a human is editing state, what
    survives? For now, a refresh discards the edits (D3).
45. **Invalid states:** should the inspector allow edits that break the schema, to test how the runtime
    copes with bad data, or block them?

## 10. Choosing battles

The ⚑ items change what the file means, so getting one wrong means migrating every file later. The rest
can be added without breaking anything. Settle the ⚑ items on paper first; put off animations,
translation, server rendering, form polish, routing and theming.

**First build battle**, when it's time: a small prototype of the core.

- One hand-written profile page with text, an image attribute, an optional field with a fallback, a list
  with keys and an empty state, an enum variant and one event.
- A tiny runtime that renders it.
- A minimal shell: about six snapshots in a grid, zoom, and a state inspector per render.
- TypeScript types generated from the schema.

That tests #1, #2, #4, #7–#9 and #13, and the state inspector exercises reactive updates.

**Second battle:** #3, schema diffs plus the compatibility rules.

## 11. Open questions

- **Q1. Which webapps?** CRUD apps, dashboards and SaaS screens fit well; highly interactive apps need
  strong code components (P7). Lean: the first group.
- **Q2. Does the view hold any state of its own,** or is it strictly `state → UI` with events going out?
  Lean: no hidden state; `ui` state lives in the state tree, where it can be snapshotted and inspected.
- **Q3. What shape is the file?** An HTML-based natural template (models know it well, it opens in a
  browser, "the same file in production" is literally true) or a JSON node tree (easier structural
  edits, IDs everywhere)? Lean: HTML, since the AI is the main author (D1) and the preview is a browser
  (D2).
- **Q4. Standalone or embeddable?** A whole-app tool, or a view layer you mount inside an existing
  React/Vue app (#39)? Lean: embeddable first; it's much easier to adopt.
- **Q5. Where do snapshots live?** In the Melzin file itself (one artifact; the shell reloads one file)
  or in files next to it (smaller production file, fewer merge conflicts, like Storybook stories)? Lean:
  the same file to start (#37).

## 12. Why this could beat "just let the AI write React"

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

## 13. Risks

- **LLMs don't know the format.** Models know HTML and React deeply and Melzin not at all. Stay close to
  HTML/CSS ideas (Q3) and give the AI fast validate-and-render feedback (§7).
- **There's a ceiling.** Anything that isn't a pure function of state needs code. Make that boundary
  explicit and typed (P7) instead of pretending it isn't there. This behavior boundary (events, UI
  state, forms, complex widgets) is likely the hardest part of the project, and it's where existing
  design-to-production tools stop: Webflow and Framer stay with websites, while Plasmic and Builder.io
  act as a visual layer inside a code app.
- **A visual editor is expensive to build.** Avoided for now by D1.
- **The opposite approach exists.** In Onlook-style tools, the canvas edits real React code. That gives
  unlimited power but loses the static analysis Melzin depends on. Melzin deliberately trades that power
  for analysis.

## 14. Prior art

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

## 15. Glossary

- **Melzin file:** the artifact: view tree, schema and snapshots.
- **Binding:** a declared link from part of a node (text, attribute, visibility, style, list) to a data
  path, plus operations.
- **Field:** a schema entry: stable ID, name, type, optionality, default, constraints.
- **Schema:** all the fields; the typed contract between the UI and the backend adapter.
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
