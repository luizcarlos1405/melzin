# Writing Melzin views

This guide is everything you need to write a Melzin view: the file format, the directives, the schema
and snapshots, the rules the checker enforces, how to check and preview your work, how to set up a
project that uses the view (§11), and how to design a screen in stages, comparing directions first
(§13). It describes what is built so far (see [POC.md](../POC.md)).
References such as P4 or D14 point to [SPEC.md](../SPEC.md); you don't need to read it.

## 1. What a view is

A view is one HTML file, `views/<name>.mel.html`. The same file is the design you preview and the
front end that runs in production. A host (a web page, or the preview shell) mounts it, gives it
`data` and handles the events it sends. The view never fetches anything or runs code of its own: the
checker rejects anything that would (§2), and the runtime drops it before the view reaches the page.

- The view shows data through `m-text`, shows elements only when a condition holds through `m-if`,
  `m-else-if`, `m-else` and `m-show`, sends events through `m-on:click` and links to other pages
  through `m-bind:href`.
- In an app, a view can also read the URL it's shown at as `route` (§3, §12).
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
project root. Design alternatives wait in `explore/` while you compare them (§13). Commands run from the
project root. §11 shows how to set up a new project.

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
  content and the elements behind conditions change.
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

There are seven: `m-text` shows a value, `m-if`, `m-else-if`, `m-else` and `m-show` show an element
only when a condition holds, `m-on:click` sends an event, and `m-bind:href` sets a link's URL from a
link field. Values are parsed, never evaluated: no JavaScript, no operators, no `{{ }}`. Attribute names
are case-insensitive; values are case-sensitive.

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
- Paths that start with `route` read the URL instead (§12): `route.name`, `route.params.<name>` and
  `route.query.<name>`. They're always strings, empty when the URL doesn't have them.

### `m-if`, `m-else-if`, `m-else` and `m-show`

Grammar: `condition := '!'? path`. A condition is a path, optionally preceded by `!`, which negates
it. Spaces around the value and after the `!` are allowed.

```html
<span m-show="user.verified">Verified</span>

<p m-if="user.bio" m-text="user.bio"></p>
<p m-else class="text-zinc-400">No bio yet.</p>

<button type="button" m-if="!viewer" m-on:click="emit('signIn')">Sign in to follow</button>
<p m-else-if="viewer.isSelf">This is you</p>
<button type="button" m-else-if="viewer.following" m-on:click="emit('unfollow')">Following</button>
<button type="button" m-else m-on:click="emit('follow')">Follow</button>
```

A condition holds when the value at its path is:

| Value | Holds when |
|---|---|
| boolean | `true` |
| string | not `""` |
| number | not `0` |
| object | present |
| missing | its field's `default` holds; with no default, never |

That's JavaScript's truthiness, as in Vue. `!` flips it: `m-if="!viewer"` holds while `viewer` is
missing.

- `m-if` keeps its element in the document only while the condition holds.
- `m-else-if` and `m-else` go on the elements right after an `m-if`, with only whitespace and comments
  in between, and form a chain with it: the first element whose condition holds shows, `m-else` shows
  when none does, and the rest are out of the document. `m-else` takes no value.
- `m-show` keeps its element in place and hides it with `display: none` while the condition doesn't
  hold. Use it for things that come and go, like a badge; use `m-if` and `m-else` for alternatives.
- An element has at most one of `m-if`, `m-else-if` and `m-else`. It may also have `m-show`, `m-text`
  and `m-on:click`.
- Conditions can't compare or combine values: no `==`, `>`, `&&`, `||` or `? :`. Have the host send the
  boolean the screen needs (`"isOwner": true`, `"hasVotes": false`), or nest elements:
  `<div m-if="a"><p m-if="b">` shows the `<p>` only when both hold.
- Give every optional field a designed fallback: an `m-else` with an empty state or a placeholder,
  rather than a hole in the layout.
- A required object is always present, so `m-if="user"` always holds; the checker warns about it.
  Test one of its fields, or make the object optional.
- There's no `<template>` to group elements: wrap them in one element. The `contents` class makes the
  wrapper's box disappear from the layout: `<div m-if="x" class="contents">`.
- Elements behind a condition stay bound while they're hidden, so they show current data as soon as
  they appear.
- Each element behind a condition should show in at least one snapshot, so its design can be reviewed.
  The checker warns about the ones no snapshot shows (§5).
- The runtime treats a condition it can't use (an unknown field, say) as false, with a warning, so a
  broken `m-if` hides its element instead of showing it to everyone.

- Conditions can test the URL too: `m-if="route.query.tab"` holds while the URL has a non-empty
  `?tab=` (§12).

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

### `m-bind:href="path"`

Grammar: a path, like `m-text`'s. It must name a *link field*: a string field whose schema names the
route it links to (§4).

```html
<a m-bind:href="author.profileUrl" class="font-medium hover:underline">Ana Souza</a>
```

- Views never build URLs: the source sends each link ready-made, through the app's `href` helper
  (§12). So there's no `m-bind:href="'/u/' + handle"`, and no binding to a plain string field.
- Only on `<a>` and `<area>`, and not together with a static `href` on the same link.
- While the field is missing, the link has no `href` at all. `javascript:`, `vbscript:` and `data:`
  URLs never reach the link.
- Links to fixed pages need no field: write the URL, `<a href="/settings">`. The checker warns when
  such a link matches no route (§12).
- Links stay real links: they open in a new tab, can be copied, and the app switches screens without
  reloading when they lead to one of its routes.

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
| leaf | `type`: `"string"`, `"number"` or `"boolean"`; `default`; `description`; on strings, `route` |
| each event | `{}` or `{ "description": "..." }` |

- Property and event names are identifiers (`__proto__` is reserved). `route` is reserved at the top
  of `data`, since views read the URL under that name.
- `"route": "profile"` makes a string field a link field: a URL of that route in `routes.json`, for
  `m-bind:href`. A link field can't have a `default`.
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
- Besides `data`, a snapshot may set the URL it stands for, for views that read `route` or show as a
  page: `"route": { "params": { "handle": "ana" }, "query": { "as": "bruno" } }`, strings only (§12). A
  missing `data` means `{}`.
- In snapshots, link fields hold real URLs of their route (`"/u/ana"`); the checker matches them
  against `routes.json`.
- Every view with data fields needs snapshots. Make them hostile, not just pretty (P8): very long
  text, zero, huge numbers, every optional field missing. They are how you find where the layout
  breaks.
- Cover every condition: each element behind `m-if`, `m-else-if`, `m-else` or `m-show` should show in
  at least one snapshot, or nobody sees its design. The checker names the condition that never holds.
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
- Classes can't change with data yet. For a state such as "liked", put both versions in the view and
  let a condition pick one: `<button m-if="post.liked" class="bg-rose-600 ...">` and
  `<button m-else class="bg-white ...">`. Variants that react to content, such as `empty:hidden`,
  work too.
- Plan for long values: `wrap-anywhere`, `truncate`, `min-w-0` and `text-balance` keep layouts intact.

## 7. Not supported yet

Don't try these; the checker rejects them. POC.md §11 lists when each comes in.

| Not yet | What to do now |
|---|---|
| Lists (`m-for`, `"type": "array"`) | A fixed number of fields: `first`, `second`, `third`, with `m-if` on the optional ones |
| Attribute and class bindings other than links (`m-bind:class`, `:title`) | Static attributes and classes; to switch styles, two elements with `m-if` and `m-else` |
| Layouts shared by several pages, nested routes | Each route shows one whole view; repeat the shared part in each |
| Route paths with wildcards, optional or partial segments (`*`, `:id?`, `/@:handle`) | Literal segments and whole-segment parameters: `/u/:handle` |
| Comparisons and `&&`, `\|\|` in conditions | A boolean the host computes: `m-if="hasVotes"` |
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
bunx melzin check                          # every view in views/ and explore/, and routes.json
bunx melzin check views/order.mel.html  # some files
```

Output is one line per problem, then a summary:

```
views/order.mel.html:9:19: warning: data field 'note' is never used
views/order.mel.html:13:20: error: snapshots["typical"].data.total: missing required field 'total'
views/order.mel.html:13:30: error: snapshots["typical"].data.totl: unknown field 'totl' (did you mean 'total'?)
views/order.mel.html:17:37: warning: m-text elements should be empty; sample text belongs in snapshots
views/order.mel.html:18:37: error: m-on:click: use emit('name') instead of Vue's $emit
3 errors, 2 warnings in 1 file
```

Line and column point at the problem, usually the exact character inside an attribute value or the
JSON. The exit code is 1 when there are errors. Fix every error and every warning: a clean view
prints `0 errors, 0 warnings`. Warnings flag a declared event nothing emits, a data field nothing
displays or tests, text inside an `m-text` element, a view with data but no snapshots, an element
behind a condition that no snapshot shows, a condition on a required object (it always holds), a
snapshot named with a whole number, a literal `{{ }}`, a missing `<title>`, attributes on `<body>` and
a `<name>.types.ts` that no longer matches the schema. With a `routes.json`, the checker also checks it
and each view against it (§12). "Nothing emits it" and "never used" wait until
the broken bindings are fixed, since a broken binding is often the missing one, and "no snapshot shows
this element" waits until the snapshots match the schema.

`melzin check --views <dir>` checks another folder.

### Types

```
bunx melzin types views/order.mel.html
```

This writes `views/order.types.ts` with a `Data` and a `Handlers` type for the host. It refuses to write
while the view has checker errors, and prints `views/order.types.ts is up to date` when nothing
changed. Run it again after every schema change; until you do, `melzin check` warns that the types file
is out of date. In an app, `bunx melzin types routes.json` writes `routes.types.ts` and the types of
every view a route shows (§12).

### Preview

```
bunx melzin shell            # http://127.0.0.1:4321
bunx melzin shell --port 4400 --views views --theme theme.css
```

The shell lists the routes of `routes.json` as pages, and every view. It renders one card per snapshot
through the production runtime and CSS, with a frame per device size, and shows for each card the data
as editable JSON (not for a static view), an event log and the runtime's warnings. A view with
alternatives in `explore/` shows every version side by side, one column each (§13). The top bar shows a
view's stage. Clicking a link in a frame doesn't follow it; it shows up in the event log. Refresh the
page after editing a file; edits in the shell are temporary. A red banner lists problems in the schema
and snapshots blocks; directive problems only show as warnings under each frame, so `melzin check`
remains the full list.

The shell's pages are built in the browser, so `curl` gets empty pages: use a browser, headless or
not (for example `chromium --headless=new --screenshot=out.png --window-size=375,812 <url>`). Some
plain URLs help without one: `/__melzin/api/views` returns the view list as JSON
(`[{ "name", "file", "url", "title", "description", "stage" }]`), `/__melzin/api/explore` the
alternatives (`{ "alternatives": [{ "name", "theme", "views" }], "problems" }`), and
`/__melzin/styles.css` is the compiled CSS.

The URL holds the state, so you can open a precise render:

| Parameter | Meaning |
|---|---|
| `view` | the file name without `.mel.html`, `order` (or the whole file name). Not the `<title>` |
| `route` | a route's name, `profile`: its view as that page, with a URL bar per frame (§12). Wins over `view` |
| `device` | `WxH` with each side from 120 to 4096, such as `375x812`, or `phone`, `tablet`, `desktop` (375×812, 768×1024, 1280×800). Several, separated by commas (`phone,desktop`), show every render at each size. Other values are ignored, with a notice |
| `zoom` | 0.25 to 2 |
| `snapshot` | show only this snapshot, URL-encoded: `a%20few%20clicks` |
| `alt` | for a view with alternatives, show only one version: an alternative's name, or `current` for the one in `views/` (§13) |
| `chrome` | `0` hides the top bar, card headers and panels |

For a screenshot of one state, open
`http://127.0.0.1:4321/?view=order&snapshot=typical&device=375x812&zoom=1&chrome=0`, wait until
`<body>` has a `data-melzin-ready` attribute, and capture the frame, which sits at the top-left corner
at exactly the device size. With several devices or versions, the first frame sits there and the others
follow to the right, 16 pixels apart. Alternatively, size the browser window to the device and open the frame
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
| `v-if`, `v-else-if`, `v-else`, `v-show`, `x-show` | `m-if`, `m-else-if`, `m-else`, `m-show` |
| `m-if="count > 0"`, `m-if="a && b"`, `m-if="status === 'paid'"` | a boolean the host computes: `m-if="hasItems"`, `m-if="isPaid"`; or nested `m-if`s for "and" |
| `<p m-if="a">…</p><hr><p m-else>…</p>` | `m-else` right after the `m-if` element, with only whitespace or comments between |
| `<p m-else="!a">` | `<p m-else>`, or `m-else-if="b"` for another condition |
| `m-if="user"` on a required object | it always holds: test a field (`m-if="user.bio"`) or make the object optional |
| `<template m-if="x">` | one wrapper element: `<div m-if="x" class="contents">` |
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
| `` class="bg-${color}-500" `` | one full class name; two elements behind `m-if`/`m-else` for two styles |
| an event used in `m-on:click` but missing from `events` | declare it: `"events": { "save": {} }` |
| a snapshot with `"nmae"` | the exact field name; the checker suggests it |
| a snapshot that skips a level: `{ "title": "..." }` | the full shape: `{ "post": { "title": "..." } }` |
| `"type": "integer"`, `"enum"`, `"minLength"` | `"type": "number"` or `"string"`, no constraints yet |
| `:href="url"`, `v-bind:href` | `m-bind:href="url"`, with `url` a link field |
| `m-bind:href="profileUrl"` on a plain string field | give the field `"route": "profile"`; the source fills it with `href()` |
| `<a href="/u/ana">` built for one person | a link field the source fills: `m-bind:href="author.url"` |
| `m-text="route.handle"` | `m-text="route.params.handle"` (or `route.query.<name>`, `route.name`) |
| a data field named `route` | another name: `route` is the URL |
| `explore/plans.mel.html`, `explore/current/plans.mel.html` | a folder per alternative: `explore/calm/plans.mel.html` (§13) |
| a schema and bindings in a first draft | static HTML with the sample content inline; bind it once a direction wins (§13) |
| the losing alternatives left in `explore/` | move the winner into `views/` and delete the rest (§13) |

## 10. Worked example

An order status card: nested data, an optional field with a designed fallback, a badge behind a
condition, two events, and snapshots that include awkward data. `views/order-status.mel.html`:

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
              "eta": { "type": "string", "description": "Missing when there is no estimate yet" },
              "total": { "type": "string", "description": "Already formatted, like \"$42.50\"" },
              "delayed": { "type": "boolean", "default": false }
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
      "delayed, long text": {
        "data": {
          "order": {
            "number": "2024-0000000010484",
            "status": "Held at the regional distribution center awaiting customs clearance",
            "eta": "Estimated delivery between Monday, December 16 and Friday, December 20",
            "total": "$12,345,678.90",
            "delayed": true
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
      <div class="flex items-center justify-between gap-3">
        <p class="text-sm font-medium text-zinc-500">Order #<span m-text="order.number"></span></p>
        <span class="rounded-full bg-amber-100 px-2 py-0.5 text-xs font-medium text-amber-800" m-show="order.delayed">Delayed</span>
      </div>
      <h1 class="mt-1 text-xl font-semibold text-balance wrap-anywhere text-zinc-900" m-text="order.status"></h1>
      <p class="mt-2 text-sm text-zinc-600" m-if="order.eta" m-text="order.eta"></p>
      <p class="mt-2 text-sm text-zinc-400" m-else>No delivery estimate yet</p>
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
missing, so the `m-else` paragraph shows instead. Only the last snapshot sets `delayed`; without it, the
checker would warn that no snapshot shows the badge.

`melzin types views/order-status.mel.html` writes:

```ts
// Generated by `melzin types` from order-status.mel.html. Do not edit.
export type Data = {
  order: {
    number: string
    status: string
    /** Missing when there is no estimate yet */
    eta?: string
    /** Already formatted, like "$42.50" */
    total: string
    delayed?: boolean
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

A project that uses Melzin is a Bun project. `melzin` is the runtime your app mounts views with, and
`@melzin/cli` provides the `melzin` command and the server-side helpers. Inside this repository's
workspace that's `"melzin": "workspace:*"` and `"@melzin/cli": "workspace:*"` (as in `examples/poll/`);
elsewhere:

```
mkdir my-app && cd my-app && mkdir views
bun init -y
bun add melzin
bun add -d @melzin/cli
bunx melzin check      # and types, shell, css as above
```

`theme.css` at the project root is optional (§6). `bunx melzin --help` lists every command and flag.

### Type-checking the host

`melzin` ships compiled JavaScript with type declarations. `@melzin/cli/tools` ships TypeScript sources with `.ts` imports, not `.d.ts` files, so for a server file that imports it, `tsc` needs a
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
   project's theme, or call `buildCss` from `@melzin/cli/tools` in the server. With a Bun HTML import, add
   the `<link rel="stylesheet">` from the host script, as `examples/poll/client.ts` does: Bun's HTML bundler
   would try to resolve a static link to a server route at bundle time.
2. **The view file, unchanged, at the URL given to `mount`**, such as `/views/order-status.mel.html`.
   `resolveViewFile` from `@melzin/cli/tools` maps a request to a file in `views/` safely, and
   `VIEW_FILE_HEADERS` holds the headers to send with it.
3. **The host script, bundled**: a Bun HTML import in `Bun.serve`, or `bun build host.ts --outdir public`.

A minimal Bun server:

```ts
import { VIEW_FILE_HEADERS, buildCss, resolveProject, resolveViewFile } from '@melzin/cli/tools'
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

`examples/poll/` in this repository is a complete app built this way, with an API, a contract test and API
tests.

## 12. Routes, links and apps

A whole app built with Melzin has a route table, `routes.json` at the project root, and a small host
that runs it: the URL picks a route, the route picks a view, and the app's *source* loads its data and
handles its events (SPEC §7).

### routes.json

```json
{
  "routes": {
    "members": { "path": "/", "view": "members", "query": { "as": {} }, "code": "eager" },
    "profile": { "path": "/u/:handle", "view": "profile", "query": { "as": { "description": "Who is looking" } } }
  }
}
```

| Key | Meaning |
|---|---|
| route name | an identifier; links and the source use it |
| `path` | URLPattern syntax: literal segments and whole-segment `:name` parameters, such as `/u/:handle/posts/:id`. No trailing `/` (except `/` itself) |
| `view` | the view's file name without `.mel.html` |
| `query` | the query parameters the route reads, each `{}` or `{ "description": "..." }`. Others in the URL are ignored |
| `code` | when the view's file loads: `eager` (with the first page), `prefetch` (in the background after it; the default) or `lazy` (when a link to the route is hovered, focused or touched) |
| `data` | `stale-while-revalidate` (the default: show the last data for that URL at once, then refresh it) or `network-only` (always load). `offline` isn't supported yet |
| `description` | a comment, copied into the generated types |

- Routes match in table order, case-sensitively: `/u/new` before `/u/:handle`. Two routes whose paths
  match the same URLs are an error.
- Parameters arrive decoded (`/u/ana%20b` → `ana b`), as strings.
- A view can be shown by several routes. Each route shows one whole view: there are no shared layouts
  yet.

### The URL in a view

A view reads the URL it's shown at as `route`, next to its data:

```html
<p m-if="route.query.as">Browsing as @<span m-text="route.query.as"></span></p>
<p m-else>Nobody is signed in</p>
```

- `route.name`, `route.params.<name>` and `route.query.<name>`, in `m-text` and in conditions. It's
  read-only, and needs no schema entry.
- Every route that shows the view must have that parameter (`:handle`) or declare that query parameter;
  the checker says which route doesn't.
- Prefer data for what the backend knows anyway (the user's handle); use `route` for what only the URL
  says, like who is looking or which tab is open.
- Snapshots set the URL they stand for with `"route"` (§5). The checker warns about a snapshot that
  lacks a parameter the view shows.

### Links

Link fields (`"route": "profile"` in the schema) hold URLs the source builds with the app's `href`
helper, and views bind them with `m-bind:href` (§3). Static links (`href="/"`) work as they are. Clicking
a link to a route switches screens without reloading; other links behave as usual.

### Check, types and the shell

- `melzin check` checks `routes.json` (its rules, and that each route's view exists) and each view
  against it: `route.*` the routes have, link fields that name real routes, snapshot link values that
  are URLs of their route, and static links that match no route (a warning).
- `melzin types routes.json` writes `routes.types.ts`, with each route's `params`, `query`, `data` and
  `handlers`, and the types of the views it shows. Link fields are typed `Href<'profile'>`: only the
  `href` helper makes those, so a hand-built URL fails `tsc`.
- The shell lists the routes as pages. A page renders its view's snapshots, each with a URL bar showing
  the URL from the snapshot's `route`; edit it to try another URL. Clicking a link to a route logs a
  `navigate` event instead of following it.

### The app

```ts
import { hrefs, startApp } from 'melzin'
import routes from './routes.json'
import type { Routes } from './routes.types.ts'

const href = hrefs<Routes>(routes)

await startApp<Routes>(document.querySelector('#app')!, {
  routes,
  source: {
    members: {
      load: async ({ query }, { signal }) => (await fetch(`/api/members?as=${query.as ?? ''}`, { signal })).json(),
    },
    profile: {
      load: async ({ params }, { signal }) => (await fetch(`/api/profiles/${params.handle}`, { signal })).json(),
      on: {
        follow: async (_payload, page) => page.update(await (await fetch(`/api/follows/${page.route.params.handle}`, { method: 'PUT' })).json()),
        signIn: (_payload, page) => page.navigate(href('profile', { handle: page.route.params.handle }, { as: 'ana' })),
      },
    },
  },
  // Optional: runs before every navigation. Return false to stay, or a URL to go there instead.
  navigate: (to, from) => undefined,
})
```

- **The source** has a `load` and, when the view has events, an `on` handler per event, for every
  route. `load` gets the route (`name`, `params`, `query`, `url`) and an abort signal; it returns the
  view's data. Where it gets it is up to the app: a server's API (a remote source), IndexedDB or any
  other local store (a local source, for offline-first apps), or constants. Melzin only types the
  contract.
- **Handlers** get the payload (`undefined` for now) and the page: `page.route`, `page.data`,
  `page.update(data)`, `page.navigate(url)` and `page.reload()`. A page the user has left ignores
  `update`.
- **Navigation** (link clicks, back and forward, `page.navigate`, `app.navigate`) goes through the
  `navigate` hook. The first page doesn't. A URL that matches no route leaves the app with a normal
  page load.
- The server sends the same page (with the app's script) for every route's URL, and the view files at
  `/views/<view>.mel.html` (`viewUrl` changes that).
- A URL with no route, or a loader that fails, shows a plain message for now: not-found and error pages
  aren't designed yet.

`examples/profile/` is a complete app: two routes, a remote and a local source, and tests that run the
whole app without a server.

## 13. Designing in stages

A screen goes through three stages, and each one grows the same file. Each is a valid place to stop:
the checker never asks for something a later stage decides.

| Stage | What the file has | A good place to stop when |
|---|---|---|
| Exploration | static HTML and Tailwind, with the sample content inline; no schema | the page is static, or someone will build it in code and only needs the design |
| States | bindings, the schema's `data` and snapshots, hostile ones included | the screen ships as hand-written code: the view and its snapshots are its spec |
| Contracts | events, link fields, routes and the source behind them | it ships as is |

The shell shows each view's stage next to its file. It's read from the file (a schema or snapshots
mean states; an event, a link field or `route.*` mean contracts), so there's nothing to declare.

### Exploration

Write the screen as plain HTML with Tailwind classes, and put the sample content inline: real-looking
names, numbers and text. Don't add a schema or bindings yet.

To compare directions, give each one a folder in `explore/`, at the project root:

```
explore/
  calm/
    plans.mel.html
  bold/
    plans.mel.html
    theme.css
```

- The folder's name is the alternative's. Each view in it stands in for the view with the same file
  name, whether `views/` has it yet or not, so a folder can hold one screen or every screen of a
  direction. Name the folder after the direction; `current` is taken (it's the shell's name for the
  version in `views/`).
- Say what each alternative tries in `<meta name="description" content="...">`. The shell shows it
  above the alternative's column.
- A `theme.css` in the folder changes tokens for that alternative only, such as `--color-brand-500` or
  `--radius-2xl`, under the rules of §6. It loads after the project's theme, so the tokens it leaves out
  keep their values. The shell also shows the project's other views with it, since promoting the
  alternative would restyle them too.
- `melzin check` checks alternatives like any view. Nothing in `explore/` ships.
- `?view=plans&device=phone,desktop` shows every alternative side by side at both sizes, and `&alt=bold`
  shows one of them, for screenshots.

When a direction wins, promote it: move its files into `views/`, as in
`git mv explore/bold/plans.mel.html views/`, copy the tokens from its `theme.css` into the project's,
and delete the exploration's folders. Git keeps the alternatives that lost; don't leave them in
`explore/`.

To explore a screen that already ships, copy `views/<name>.mel.html` into `explore/<alternative>/` and
change the copy. The shell shows it next to the current version, snapshot by snapshot; promoting it
moves it back over the original.

### States

Make the parts that come from data dynamic, one at a time:

1. Add the field to the schema (§4) and the binding to the element (§3).
2. Move the element's inline content into the first snapshot: `<h1>Ada Lovelace</h1>` becomes
   `<h1 m-text="user.name"></h1>`, and `"Ada Lovelace"` goes into the snapshot's data. The first
   snapshot should look exactly like the static design.
3. Add the snapshots that break it (§5): long text, zero, huge numbers, every optional field missing and
   every branch of every condition.

Text that's the same for every user stays inline.

### Contracts

Declare the events the view sends (§4) and send them from its buttons (§3), turn links to other pages
into link fields (§12), add the view's route to `routes.json`, generate the types (§8), and write the
host or source that loads the data and handles the events (§10, §12).
