<img src="assets/icon.svg" width="64" height="64" alt="">

# melzin

Melzin is a design tool an AI operates, where the file the AI designs is also the production front end.
A view is one HTML file with Tailwind classes, a schema and sample states: a shell previews it in every
state, and the same file runs in production with real data. This repository holds the proof of concept.

## Layout

```
packages/melzin/    the Melzin package: runtime, checker, type generator, preview shell, CSS builder
  views/            example views (hello, profile card, counter)
  examples/counter/ a production page that mounts the counter
sample/             a separate app that uses Melzin: a quick poll with a small Bun backend
docs/authoring.md   how to write views (the guide for the AI author)
SPEC.md             the design record
POC.md              what the proof of concept builds, and how
```

## Commands

Everything runs on [Bun](https://bun.sh) 1.4. From the repo root:

| Command | What it does |
|---|---|
| `bun install` | installs every workspace's dependencies (run once) |
| `bun test` | runs every test |
| `bun run typecheck` | runs `tsc --noEmit` in every package |
| `bun run check` | checks the package's views and the sample's views |

From `packages/melzin`:

| Command | What it does |
|---|---|
| `bun run shell` | the preview shell for the example views, on http://127.0.0.1:4321 |
| `bun run example:counter` | the counter's production page, on http://localhost:3001 |
| `bun src/cli/index.ts types views/counter.melzin.html` | regenerates `views/counter.types.ts` |

From `sample/`:

| Command | What it does |
|---|---|
| `bun run dev` | the poll app, on http://localhost:3000 |
| `bun run shell` | the preview shell for the poll's views, on http://127.0.0.1:4321 |
| `bun run types` | regenerates `views/poll.types.ts` |

The CLI has four commands: `check`, `types`, `shell` and `css`. `bunx melzin --help` in `sample/`, or
`bun src/cli/index.ts --help` in `packages/melzin`, shows their usage.

## Read next

- [SPEC.md](SPEC.md): the idea, decisions and principles.
- [POC.md](POC.md): the proof of concept's scope, what was built and what comes next.
- [docs/authoring.md](docs/authoring.md): the view format and the rules, for whoever writes views.
- [sample/README.md](sample/README.md): the poll app.
