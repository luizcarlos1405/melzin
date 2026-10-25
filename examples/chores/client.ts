// The production page: mounts the same view file the shell previews, with real data from the server.

import { mount, type MelzinView } from 'melzin'
import type { Data, Handlers } from './views/chores.types.ts'

function element(selector: string): Element {
  const found = document.querySelector(selector)
  if (found === null) throw new Error(`missing ${selector} in index.html`)
  return found
}

function loadStylesheet(href: string): Promise<void> {
  return new Promise((resolve) => {
    const link = document.createElement('link')
    link.rel = 'stylesheet'
    link.href = href
    // Mount either way: an unstyled page beats an empty one.
    link.addEventListener('load', () => resolve(), { once: true })
    link.addEventListener('error', () => resolve(), { once: true })
    document.head.append(link)
  })
}

async function request(url: string, init?: RequestInit): Promise<Data> {
  const response = await fetch(url, { cache: 'no-store', ...init })
  if (!response.ok) throw new Error(`${init?.method ?? 'GET'} ${url}: HTTP ${response.status}`)
  return (await response.json()) as Data
}

async function main(): Promise<void> {
  await loadStylesheet('/styles.css')
  // The filter is the host's to keep: the view says which one was picked, the server sends the list.
  let show = 'all'
  const query = () => `?show=${encodeURIComponent(show)}`

  // Each update keeps every row's elements: the toggles, their focus and the classes the bindings set.
  const view: MelzinView<Data> = await mount<Data, Handlers>(element('#chores'), '/views/chores.mel.html', {
    data: await request(`/api/chores${query()}`),
    on: {
      toggle: async ({ choreId }) => {
        try {
          view.update(await request(`/api/chores/toggle${query()}`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ choreId }),
          }))
        } catch (error) {
          console.error('[chores] toggle failed:', error)
        }
      },
      filter: async ({ filterId }) => {
        show = filterId
        try {
          view.update(await request(`/api/chores${query()}`))
        } catch (error) {
          console.error('[chores] filter failed:', error)
        }
      },
    },
  })
}

main().catch((error: unknown) => {
  console.error(error)
  const box = document.createElement('p')
  box.setAttribute('role', 'alert')
  box.textContent = `The chores couldn't load: ${error instanceof Error ? error.message : String(error)}`
  document.body.append(box)
})
