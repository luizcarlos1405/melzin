# melzin

The runtime of [Melzin](https://github.com/luizcarlos1405/melzin): a UI framework where one HTML file is
both the design and the production front end. It has no dependencies and runs in the browser.

```ts
import { mount } from 'melzin'

const view = await mount(document.querySelector('#app')!, '/views/counter.mel.html', {
  data: { count: 0 },
  on: { increment: () => view.update({ count: 1 }) },
})
```

`mount` fetches the view, strips anything unsafe, binds its `m-` directives once, and on `update` touches
only what changed: text, and elements behind conditions. Generated types make a missing handler or wrong
data a compile error.

The `melzin` command (check, types, preview shell, CSS) is in [`@melzin/cli`](https://www.npmjs.com/package/@melzin/cli).
The view format and the plan are in the [main repository](https://github.com/luizcarlos1405/melzin).

> Early proof of concept: the format has only a few directives so far and can still change.

MIT
