# Melzin example: chores

This week's chores: tick them off, filter the list, and see how far along the week is. It shows the
attribute and class bindings (SPEC D37, POC.md §19) on a small Bun backend that owns the chores.

## Run it

From the repo root, run `bun install` once. Then, from `examples/chores/`:

| Command | What it does |
|---|---|
| `bun run dev` | the app on http://localhost:3000 (`PORT` overrides) |
| `bun run shell` | the preview shell: every snapshot of the view |
| `bun run check` | checks `views/chores.mel.html` (expect `0 errors, 0 warnings in 1 file`) |
| `bun run types` | regenerates `views/chores.types.ts` |
| `bun run typecheck` | `tsc --noEmit` |
| `bun test` | the contract, view and API tests |

## What it shows

- **State as attributes, styled with Tailwind's variants.** Each row binds
  `m-bind:data-priority="chore.priority"` and `m-bind:data-done="chore.done"`. The left border uses
  `data-[priority=high]:border-l-red-500`, the badge `group-data-[priority=high]/chore:…` (a named
  group, so a nested group can't restyle it), and the check mark `group-data-done/chore:opacity-100`.
  A boolean writes `"true"` or removes the attribute, so `data-done:` matches exactly the done rows.
- **ARIA from data.** Each toggle is a real toggle button, `m-bind:aria-pressed="chore.done"` with
  `aria-pressed:bg-brand-600`, named by `m-bind:aria-label="chore.toggleLabel"`; the filters are
  toggles too. The dots are one `role="img"` whose `m-bind:aria-label="progressLabel"` reads
  "2 of 5 done". aria-* keeps `"false"`: a toggle that's off.
- **Classes from conditions.** The title switches looks with an exclusive pair,
  `{ 'text-zinc-400 line-through': chore.done, 'text-zinc-900': !chore.done }`, so neither depends on
  Tailwind's CSS order (`melzin check` flags a static class that would win instead).
  `m-bind:title="chore.title"` shows a truncated title in full on hover.
- **The host decides what shows (P3).** The view never filters or counts: `toViewModel` sends the
  chores the filter shows, a `current` boolean per filter and the progress label already written.
- **Every look in a snapshot (P8).** `melzin check` warns when a class key, a bound boolean or a
  `data-[x=v]:` value is the same in every snapshot, so done and open, each priority, each filter and
  the empty states all have one.

Adding a chore needs a text field, which comes with forms (SPEC D38, POC.md §20).
