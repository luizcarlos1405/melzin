# @melzin/cli

The command line of [Melzin](https://github.com/luizcarlos1405/melzin), the UI framework where one HTML
file is both the design and the production front end. It needs [Bun](https://bun.sh) 1.4 or newer.

```bash
bun add melzin
bun add -d @melzin/cli
bunx melzin check      # check every *.mel.html view, compiler-style
bunx melzin types views/counter.mel.html   # TypeScript types for a view's data and events
bunx melzin shell      # the preview shell: every snapshot, every device size
bunx melzin css        # the project's Tailwind CSS
```

`@melzin/cli/tools` exports the same checker, CSS builder and view-file helpers for server code. The view
format is described in the [authoring guide](https://github.com/luizcarlos1405/melzin/blob/main/docs/authoring.md).

> Early proof of concept: the format can still change.

MIT
