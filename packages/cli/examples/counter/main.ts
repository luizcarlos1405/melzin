// The counter's production page (POC.md §7): the host owns the count and mounts the same view file
// the shell previews. The types come from `melzin types views/counter.mel.html`, so a missing or
// misspelled handler fails `tsc`.

import { mount } from 'melzin'
import type { Data, Handlers } from '../../views/counter.types.ts'

await linkStylesheet('/styles.css')

let count = 0
const view = await mount<Data, Handlers>(document.querySelector('#app')!, '/views/counter.mel.html', {
  data: { count },
  on: { increment: () => view.update({ count: ++count }) },
})

// Linked at runtime because Bun's HTML bundler would try to resolve a static <link href="/styles.css">.
// Waiting for it avoids a flash of unstyled content.
function linkStylesheet(href: string): Promise<void> {
  return new Promise((resolve) => {
    const link = document.createElement('link')
    link.rel = 'stylesheet'
    link.href = href
    link.addEventListener('load', () => resolve())
    link.addEventListener('error', () => {
      console.warn(`couldn't load ${href}; the page is unstyled`)
      resolve()
    })
    document.head.append(link)
  })
}
