# Writing Melzin views

This guide is everything you need to write a Melzin view: the file format, the two directives, the
schema and snapshots, the rules the checker enforces, how to check and preview your work, and how to
set up a project that uses the view (§11). It describes the POC (see [POC.md](../POC.md)). References
such as P4 or D14 point to [SPEC.md](../SPEC.md); you don't need to read it.

## 1. What a view is

A view is one HTML file, `views/<name>.mel.html`. The same file is the design you preview and the
front end that runs in production. A host (a web page, or the preview shell) mounts it, gives it
`data` and handles the events it sends. The view never fetches anything or runs code of its own: the
checker rejects anything that would (§2), and the runtime drops it before the view reaches the page.

- The view shows data through `m-text` and sends events through `m-on:click`.
- The schema in the file declares the data the view needs and the events it sends.
- Snapshots in the file are named sample states. The shell renders one frame per snapshot.

Skeleton:

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
      "huge number": { "data": { "count": 1234567 } }
    }
  </script>
</head>
<body>
  <main class="flex min-h-screen flex-col items-center justify-center gap-6 bg-zinc-50">
    <p class="text-6xl font-bold tabular-nums text-zinc-900" m-text="count"></p>
    <button type="button" class="rounded-lg bg-violet-600 px-5 py-2.5 font-medium text-white"
            m-on:click="emit('increment')">
      Click me
    </button>
  </main>
</body>
</html>
```

A project keeps its views directly in `views/` (no subfolders) and its theme in `theme.css` at the
project root. Commands run from the project root. §11 shows how to set up a new project.

## 2. Head and body

`<head>` may hold only:

- one `<title>`: the view's display name, shown in the shell's view picker. URLs and commands name a
  view by its file name instead (`order` for `views/order.mel.html`)
- `<meta>` tags
- at most one `<script type="melzin/schema">` and at most one `<script type="melzin/snapshots">`, each
  holding JSON

Nothing else: no `<link>`, no `<style>`, no other scripts, no text. Browsers treat these two script
types as inert data, so they never run.

The children of `<body>` are the view. Several top-level elements are fine.

- `<body>` takes no attributes. Put backgrounds and layout on a wrapper such as
  `<main class="min-h-screen ...">`.
- Static HTML is fine: headings, lists, links, images, inline SVG (with its `<title>`). Only `m-text`
  content changes.
- Relative URLs in `href` and `src` resolve against the host page, not the view file, so prefer
  absolute ones (`/images/logo.svg`).

The body is copied into the host page, so anything that would run code there or change the page
around the view is an error. The checker reports each of these. The runtime drops them before the view
reaches the page, except the last two rows, which it keeps with a warning:

| Not allowed in the body | Why, and what to do instead |
|---|---|
| `<script>`, also inside `<svg>` | views have no scripts |
| inline handlers: `onclick="..."`, `onload`, any `on*` attribute | use `m-on:click="emit('name')"` |
| `javascript:` (or `vbscript:`) URLs in `href`, `src`, `action`, `formaction` and the like | views run no code |
| `<iframe>`, `<frame>`, `<object>`, `<embed>`, and `srcdoc` on any element | views can't embed other documents |
| `<style>` (also inside `<svg>`) and `<link>` | they would restyle the whole host page; use Tailwind classes |
| `<base>` | it would change how every relative URL in the host page resolves |
| `<meta>` and `<title>` | they belong in `<head>` |
| `<template>` | its content would never be bound; write the markup directly |
| SVG `<set>` or `<animate>` that targets `href` | links are static |
| `style="..."` attributes | styling is Tailwind classes only (§6) |
| `<form>` | forms aren't supported yet; use `<button type="button">` |

A literal `{{ name }}` in the text gets a warning: it isn't Melzin syntax and would show as is.

## 3. Directives

There are exactly two. Values are parsed, never evaluated: no JavaScript, no operators, no
`{{ }}`. Attribute names are case-insensitive; values are case-sensitive.

An *identifier* is a letter or `_`, then letters, digits or `_` (`[A-Za-z_][A-Za-z0-9_]*`). So `count`,
`itemsLabel` and `total_2` are identifiers; `2nd`, `go-now` and `$emit` are not.

### `m-text="path"`

Grammar: `path := ident ('.' ident)*`. Spaces around the value are allowed.

```html
<p m-text="count"></p>
<h1 m-text="user.name"></h1>
<p>Order #<span m-text="order.number"></span></p>
```

- The path must name a `string`, `number` or `boolean` field in the schema, not an object.
- The element must be empty in the source: no text and no child elements. Sample values go in
  snapshots (P4). To mix fixed text with a value, bind an empty `<span>`, as in the last line above.
- The runtime sets the element's `textContent` to `String(value)`. A missing value shows the field's
  `default`, or nothing. To leave a value out, omit the field: snapshots and the generated types don't
  accept `null` (the runtime treats `null` like a missing value, but don't rely on it). Numbers show as
  plain digits (`1234567`) and booleans as `true` or `false`, so send preformatted strings when the
  screen needs `1,234,567`, `$42.50` or `3 items`.
- `m-text` can't go on elements without content, such as `<input>`, `<img>` or `<br>`.
- Several elements may bind the same path.
- Paths start inside `data`: write `m-text="post.title"`, not `m-text="data.post.title"`.

### `m-on:click="emit('event')"`

Grammar: exactly one call `emit('name')` with one string literal in single or double quotes. The name
is an identifier and must be declared in the schema's `events`. Spaces between tokens are allowed.

```html
<button type="button" m-on:click="emit('increment')">Add one</button>
<button type="button" m-on:click='emit("save")'>Save</button>
```

- A click calls the host's handler for that event. There is no payload: the handler receives
  `undefined`. `emit('like', post.id)` is an error; declare one event per action instead.
- `m-on:click="like()"` is an error too: the host's handlers aren't callable from the view. Write
  `emit('like')`.
- Several elements may emit the same event. An element may have both `m-text` and `m-on:click`.
- Use `<button type="button">`. Forms aren't supported, and a button inside a form would submit it.

## 4. Schema

The `melzin/schema` block is JSON with two optional keys, `data` and `events`. A view without a schema
block has no data and no events: a static page.

```json
{
  "data": {
    "type": "object",
    "properties": {
      "user": {
        "type": "object",
        "properties": {
          "name": { "type": "string" },
          "bio": { "type": "string", "default": "" },
          "followers": { "type": "number" }
        },
        "required": ["name", "followers"]
      }
    },
    "required": ["user"]
  },
  "events": {
    "follow": { "description": "The user pressed Follow" }
  }
}
```

It's a strict subset of JSON Schema. Any other keyword is an error.

| Where | Allowed keys |
|---|---|
| top level | `data`, `events`, `description` |
| object (`data` itself and nested objects) | `type: "object"`, `properties` (required), `required`, `description` |
| leaf | `type`: `"string"`, `"number"` or `"boolean"`; `default`; `description` |
| each event | `{}` or `{ "description": "..." }` |

- Property and event names are identifiers (`__proto__` is reserved).
- Entries in `required` must exist in `properties`. Fields not listed are optional.
- `default` must match the field's type. It is what production shows when the value is missing; it is
  not sample data (P4).
- Shape the data for the screen, not for the database (P3): `"totalLabel": "12 votes"`, not raw
  records the view would have to compute from. The host's adapter does the formatting.

## 5. Snapshots

The `melzin/snapshots` block maps snapshot names to `{ "data": { ... } }`, in the order the shell
shows them. Names can be any text.

```json
{
  "typical": { "data": { "user": { "name": "Ada Lovelace", "bio": "First programmer.", "followers": 1843 } } },
  "empty bio": { "data": { "user": { "name": "Grace Hopper", "followers": 52000 } } }
}
```

- Each `data` must match the schema: required fields present, right types, no unknown fields (this
  catches typos). Optional fields may be left out; the frame then shows the default. Numbers must be
  finite and values can't be `null`.
- `data` is the only key in a snapshot. A missing `data` means `{}`.
- Every view with data fields needs snapshots. Make them hostile, not just pretty (P8): very long
  text, zero, huge numbers, every optional field missing. They are how you find where the layout
  breaks.
- A view without snapshots renders once in the shell, with empty data.
- Give snapshots names with words in them. A name that is a whole number (`"0"`, `"10"`) is listed
  before all the others, whatever its place in the file (a JavaScript rule), and the checker warns
  about it. Write `"0 items"` or `"zero"`.

## 6. Styling

- Tailwind v4 utility classes only, always written out in full (`bg-violet-600`, never a class built
  from parts). Responsive and state variants work: `sm:grid-cols-3`, `hover:bg-zinc-50`.
- No `<style>`, no `<link>`, no `style` attributes (the checker reports them).
- Nothing checks class names. A misspelled class (`bg-brnad-600`) or a token the theme doesn't define
  simply produces no CSS, so look at the screenshots: a button with white text and no background is
  the usual sign.
- The project's `theme.css` holds its design tokens in an `@theme { ... }` block (one theme per
  project, D12). It's optional: without it you get Tailwind's default palette. It must not import
  Tailwind itself (the CSS build refuses it). A token such as `--color-brand-500` gives classes like
  `bg-brand-500` and `text-brand-500`; `--font-sans` sets the default font. Use the theme's tokens
  when it has them.

  ```css
  @theme {
    --color-brand-50: #fff1f2;
    --color-brand-500: #f43f5e;
    --color-brand-600: #e11d48;
    --color-brand-700: #be123c;
    --font-sans: "Inter", ui-sans-serif, system-ui, sans-serif;
  }
  ```

  Views can't load fonts. A font named in `--font-sans` is used when the page has it: load it with an
  `@font-face` rule in `theme.css` (an absolute URL) or from the host page. Otherwise the next font in
  the list shows, in the shell too.
- Classes can't change with data. Use variants that react to content instead, such as
  `empty:hidden` on an `m-text` element whose value may be `""`. For a state such as "liked", have the
  host send the text that differs (`"likeLabel": "Liked"`), or bind two elements, one of which gets
  `""` and hides itself with `empty:hidden`.
- Plan for long values: `wrap-anywhere`, `truncate`, `min-w-0` and `text-balance` keep layouts intact.

## 7. Not supported yet

Don't try these; the checker rejects them. POC.md §11 lists when each comes in.

| Not yet | What to do now |
|---|---|
| Lists (`m-for`, `"type": "array"`) | A fixed number of fields: `first`, `second`, `third` |
| Conditionals (`m-if`, `m-show`) | `empty:hidden` on an element bound to a value that may be `""` |
| Attribute and class bindings (`m-bind`, `:href`) | Static attributes and classes only |
| Event payloads, `emit('x', ...)` | One event per action: `votePizza`, `voteTacos` |
| Events other than click, modifiers | Clicks only, on buttons |
| Internal state (`ui`) | Let the host send the state as data |
| Forms and inputs (`m-model`, `<form>`) | `<button type="button">` with `m-on:click` |
| Formatters, expressions | The host sends preformatted strings |
| `m-html`, components, `<template>` | Plain static HTML |

The checker's messages for these name the workaround from this table.

## 8. Check, types, preview

Run commands from the project root. In a project that depends on Melzin, use `bunx melzin <command>`.

### Check

```
bunx melzin check                          # every view in views/
bunx melzin check views/order.mel.html  # some files
```

Output is one line per problem, then a summary:

```
views/order.mel.html:9:19: warning: data field 'note' is never displayed
views/order.mel.html:13:20: error: snapshots["typical"].data.total: missing required field 'total'
views/order.mel.html:13:30: error: snapshots["typical"].data.totl: unknown field 'totl' (did you mean 'total'?)
views/order.mel.html:17:37: warning: m-text elements should be empty; sample text belongs in snapshots
views/order.mel.html:18:37: error: m-on:click: use emit('name') instead of Vue's $emit
3 errors, 2 warnings in 1 file
```

Line and column point at the problem, usually the exact character inside an attribute value or the
JSON. The exit code is 1 when there are errors. Fix every error and every warning: a clean view
prints `0 errors, 0 warnings`. Warnings flag a declared event nothing emits, a data field nothing
displays, text inside an `m-text` element, a view with data but no snapshots, a snapshot named with a
whole number, a literal `{{ }}`, a missing `<title>`, attributes on `<body>` and a `<name>.types.ts`
that no longer matches the schema. "Nothing emits it" and "never displayed" wait until the broken
bindings are fixed, since a broken binding is often the missing one.

`melzin check --views <dir>` checks another folder.

### Types

```
bunx melzin types views/order.mel.html
```

This writes `views/order.types.ts` with a `Data` and a `Handlers` type for the host. It refuses to write
while the view has checker errors, and prints `views/order.types.ts is up to date` when nothing
changed. Run it again after every schema change; until you do, `melzin check` warns that the types file
is out of date.

### Preview

```
bunx melzin shell            # http://127.0.0.1:4321
bunx melzin shell --port 4400 --views views --theme theme.css
```

The shell lists every view, renders one frame per snapshot through the production runtime and CSS,
and shows for each frame the data as editable JSON, an event log and the runtime's warnings. Clicking
a link in a frame doesn't follow it; it shows up in the event log. Refresh the page after editing a
file; edits in the shell are temporary. A red banner lists problems in the schema and snapshots
blocks; directive problems only show as warnings under each frame, so `melzin check` remains the full
list.

The shell's pages are built in the browser, so `curl` gets empty pages: use a browser, headless or
not (for example `chromium --headless=new --screenshot=out.png --window-size=375,812 <url>`). Two
plain URLs help without one: `/__melzin/api/views` returns the view list as JSON
(`[{ "name", "file", "url", "title" }]`), and `/__melzin/styles.css` is the compiled CSS.

The URL holds the state, so you can open a precise render:

| Parameter | Meaning |
|---|---|
| `view` | the file name without `.mel.html`, `order` (or the whole file name). Not the `<title>` |
| `device` | `WxH` with each side from 120 to 4096, such as `375x812`, or `phone`, `tablet`, `desktop` (375×812, 768×1024, 1280×800). Other values are ignored, with a notice |
| `zoom` | 0.25 to 2 |
| `snapshot` | show only this snapshot, URL-encoded: `a%20few%20clicks` |
| `chrome` | `0` hides the top bar, card headers and panels |

For a screenshot of one state, open
`http://127.0.0.1:4321/?view=order&snapshot=typical&device=375x812&zoom=1&chrome=0`, wait until
`<body>` has a `data-melzin-ready` attribute, and capture the frame, which sits at the top-left corner
at exactly the device size. Alternatively, size the browser window to the device and open the frame
alone: `/frame?view=order&snapshot=typical` (the name or the file name), which sets
`data-melzin-ready` on `<html>`.

Wait for the attribute to be present, not for a value: it is `"true"` once everything has loaded and
`"error"` when something failed (a missing file, an invalid schema, an unknown snapshot), and the page
then shows the error. With `chrome=0` the shell still shows notices about problems (a broken schema or
snapshots block, a missing snapshot, an ignored URL parameter) above the frame, so a screenshot never
looks fine by mistake.

A good loop: write the view, run `melzin check` until it's clean, screenshot every snapshot at phone
and desktop sizes, fix what looks wrong, repeat.

## 9. Common mistakes

| Wrong | Right |
|---|---|
| `v-text="name"`, `x-text="name"`, `{{ name }}` | `m-text="name"` |
| `@click="save"`, `v-on:click`, `x-on:click` | `m-on:click="emit('save')"` |
| `m-on:click="$emit('save')"` | `m-on:click="emit('save')"` |
| `m-on:click="save()"` | `m-on:click="emit('save')"` |
| `m-on:click="emit('like', post.id)"` | one event per action, no payload: `emit('likePost')` |
| `onclick="save()"` | `m-on:click="emit('save')"` |
| `m-text="data.user.name"` | `m-text="user.name"` |
| `<p m-text="user.name">Ana Souza</p>` | `<p m-text="user.name"></p>`, and Ana Souza in a snapshot |
| `<p m-text="price">$<b>9</b></p>` | `<p>$<span m-text="price"></span></p>` |
| `m-text="user"` (an object) | `m-text="user.name"` (a leaf) |
| `m-text="count + 1"`, `m-text="items.length"` | a field the host computes: `m-text="countLabel"` |
| `<body class="bg-zinc-50">` | `<body><main class="min-h-screen bg-zinc-50">` |
| `<link rel="stylesheet">`, `<style>`, `style="..."` | Tailwind classes, tokens in `theme.css` |
| `<template>`, `<form>` | plain markup, `<button type="button">` |
| `` class="bg-${color}-500" `` | one full class name |
| an event used in `m-on:click` but missing from `events` | declare it: `"events": { "save": {} }` |
| a snapshot with `"nmae"` | the exact field name; the checker suggests it |
| a snapshot that skips a level: `{ "title": "..." }` | the full shape: `{ "post": { "title": "..." } }` |
| `"type": "integer"`, `"enum"`, `"minLength"` | `"type": "number"` or `"string"`, no constraints yet |

## 10. Worked example

An order status card: nested data, an optional field with a default, two events, and snapshots that
include awkward data. `views/order-status.mel.html`:

```html
<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <title>Order status</title>
  <script type="melzin/schema">
    {
      "data": {
        "type": "object",
        "properties": {
          "order": {
            "type": "object",
            "properties": {
              "number": { "type": "string" },
              "status": { "type": "string" },
              "eta": { "type": "string", "default": "", "description": "Empty when there is no estimate yet" },
              "total": { "type": "string", "description": "Already formatted, like \"$42.50\"" }
            },
            "required": ["number", "status", "total"]
          },
          "itemsLabel": { "type": "string" }
        },
        "required": ["order", "itemsLabel"]
      },
      "events": {
        "trackOrder": {},
        "contactSupport": {}
      }
    }
  </script>
  <script type="melzin/snapshots">
    {
      "on the way": {
        "data": {
          "order": { "number": "10482", "status": "On the way", "eta": "Arrives today by 6 pm", "total": "$42.50" },
          "itemsLabel": "3 items"
        }
      },
      "no estimate yet": {
        "data": {
          "order": { "number": "10483", "status": "Processing", "total": "$8.00" },
          "itemsLabel": "1 item"
        }
      },
      "long text": {
        "data": {
          "order": {
            "number": "2024-0000000010484",
            "status": "Held at the regional distribution center awaiting customs clearance",
            "eta": "Estimated delivery between Monday, December 16 and Friday, December 20",
            "total": "$12,345,678.90"
          },
          "itemsLabel": "1,250 items"
        }
      }
    }
  </script>
</head>
<body>
  <main class="flex min-h-screen items-center justify-center bg-zinc-100 p-6">
    <article class="w-full max-w-sm rounded-2xl bg-white p-6 shadow-sm ring-1 ring-zinc-900/5">
      <p class="text-sm font-medium text-zinc-500">Order #<span m-text="order.number"></span></p>
      <h1 class="mt-1 text-xl font-semibold text-balance wrap-anywhere text-zinc-900" m-text="order.status"></h1>
      <p class="mt-2 text-sm text-zinc-600 empty:hidden" m-text="order.eta"></p>
      <dl class="mt-6 flex items-baseline justify-between gap-4 border-t border-zinc-100 pt-4">
        <dt class="text-sm text-zinc-500" m-text="itemsLabel"></dt>
        <dd class="truncate text-lg font-semibold tabular-nums text-zinc-900" m-text="order.total"></dd>
      </dl>
      <div class="mt-6 flex gap-3">
        <button type="button" class="flex-1 rounded-lg bg-zinc-900 px-4 py-2.5 text-sm font-medium text-white hover:bg-zinc-700"
                m-on:click="emit('trackOrder')">
          Track order
        </button>
        <button type="button" class="flex-1 rounded-lg px-4 py-2.5 text-sm font-medium text-zinc-700 ring-1 ring-zinc-300 hover:bg-zinc-50"
                m-on:click="emit('contactSupport')">
          Get help
        </button>
      </div>
    </article>
  </main>
</body>
</html>
```

`melzin check` prints `0 errors, 0 warnings in 1 file`. In the "no estimate yet" snapshot, `eta` is
missing, the default `""` applies and `empty:hidden` hides the paragraph.

`melzin types views/order-status.mel.html` writes:

```ts
// Generated by `melzin types` from order-status.mel.html. Do not edit.
export type Data = {
  order: {
    number: string
    status: string
    /** Empty when there is no estimate yet */
    eta?: string
    /** Already formatted, like "$42.50" */
    total: string
  }
  itemsLabel: string
}
export type Handlers = {
  trackOrder: (payload?: undefined) => void
  contactSupport: (payload?: undefined) => void
}
```

A host mounts it like this. Leaving out a handler, adding an unknown one or passing data of the wrong
shape fails `tsc`:

```ts
import { mount } from 'melzin'
import type { Data, Handlers } from './views/order-status.types.ts'

const view = await mount<Data, Handlers>(document.querySelector('#app')!, '/views/order-status.mel.html', {
  data: await (await fetch('/api/order')).json(),
  on: {
    trackOrder: () => { location.href = '/track' },
    contactSupport: () => { location.href = '/help' },
  },
})
// Later, with fresh data: only the text that changed is rewritten.
view.update(await (await fetch('/api/order')).json())
```

The page must also load the compiled CSS and serve the view file at the URL given to `mount`; §11
shows both.

## 11. Setting up a project

A project that uses Melzin is a Bun project with `melzin` as a dependency. Inside this repository's
workspace that's `"melzin": "workspace:*"` (as in `sample/`); elsewhere, add the package by path:

```
mkdir my-app && cd my-app && mkdir views
bun init -y
bun add /path/to/melzin/packages/melzin
bunx melzin check      # and types, shell, css as above
```

`theme.css` at the project root is optional (§6). `bunx melzin --help` lists every command and flag.

### Type-checking the host

Melzin ships TypeScript sources with `.ts` imports, not compiled `.d.ts` files, so `tsc` needs a
`tsconfig.json` that allows them (`skipLibCheck` doesn't cover sources). This is enough:

```json
{
  "compilerOptions": {
    "target": "ESNext",
    "module": "Preserve",
    "moduleResolution": "bundler",
    "lib": ["ESNext", "DOM", "DOM.Iterable"],
    "strict": true,
    "noEmit": true,
    "allowImportingTsExtensions": true,
    "skipLibCheck": true
  }
}
```

Add `"types": ["bun"]` (and `bun add -d @types/bun`) when a server file in the project uses Bun's
APIs. Then `bunx tsc` checks the host against the generated types: a missing or unknown handler, or
data of the wrong shape, fails.

### Shipping a view

Production needs three things from the host page's server:

1. **The CSS.** `bunx melzin css -o public/app.css --minify` compiles Tailwind for every view with the
   project's theme, or call `buildCss` from `melzin/tools` in the server. With a Bun HTML import, add
   the `<link rel="stylesheet">` from the host script, as `sample/client.ts` does: Bun's HTML bundler
   would try to resolve a static link to a server route at bundle time.
2. **The view file, unchanged, at the URL given to `mount`**, such as `/views/order-status.mel.html`.
   `resolveViewFile` from `melzin/tools` maps a request to a file in `views/` safely, and
   `VIEW_FILE_HEADERS` holds the headers to send with it.
3. **The host script, bundled**: a Bun HTML import in `Bun.serve`, or `bun build host.ts --outdir public`.

A minimal Bun server:

```ts
import { VIEW_FILE_HEADERS, buildCss, resolveProject, resolveViewFile } from 'melzin/tools'
import page from './index.html' // <div id="app"></div> and <script type="module" src="./host.ts">

const project = resolveProject()
const css = await buildCss({ projectDir: project.root, viewsDir: project.viewsDir, themeFile: project.themeFile, minify: true })

Bun.serve({
  routes: {
    '/': page,
    '/app.css': new Response(css, { headers: { 'Content-Type': 'text/css; charset=utf-8' } }),
    '/views/*': (request) => {
      const file = resolveViewFile(project, new URL(request.url).pathname.slice('/views/'.length))
      return file === null ? new Response('Not found', { status: 404 }) : new Response(Bun.file(file), { headers: VIEW_FILE_HEADERS })
    },
  },
})
```

`sample/` in this repository is a complete app built this way, with an API, a contract test and API
tests.
