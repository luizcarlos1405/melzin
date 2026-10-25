# Examples

Apps that use Melzin the way a real project would: as packages (`melzin` and `@melzin/cli`), with their
own views, theme and tests. Each folder is a workspace, so `bun install` at the repository root links
everything.

| Example | What it shows |
|---|---|
| [poll](poll/) | a meetup poll: a list of options keyed by id (`m-for`), one `vote` event with a payload, a small Bun backend, generated types, and contract, view and API tests |
| [chores](chores/) | a chore list styled from data: `m-bind:data-*` with Tailwind's `data-[…]:` and named-group variants, `aria-pressed` toggles and an `aria-label` from data, class pairs with `m-bind:class`, and contract, view and API tests |
| [profile](profile/) | a routed app: a members list with an empty state, and profiles whose follow button depends on who is looking (`m-if`, `m-else-if`, `m-else`, `m-show`), fallbacks for optional fields, a remote and a local source, and contract, view, app and API tests |

## Adding an example

1. Create `examples/<name>/` with a `package.json` named `melzin-example-<name>` (`"private": true`) that
   depends on `"melzin": "workspace:*"` and `"@melzin/cli": "workspace:*"`. Copy `poll/package.json` and
   `poll/tsconfig.json` as a starting point.
2. Put views in `views/*.mel.html`, with a `theme.css` at the example's root if it needs a theme.
3. Give it `check` and `typecheck` scripts (and `test` if it has tests). The root `bun run check`,
   `bun run typecheck` and `bun test` pick it up automatically, and CI runs them.
4. Add a README that says how to run it, and a row to the table above.
