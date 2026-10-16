// The production page: mounts the same view files the shell previews, with real data from the server.

import { mount, type MelzinView } from 'melzin'
import type { Data, Handlers } from './views/poll.types.ts'

type Option = 'pizza' | 'tacos' | 'sushi'

const REFRESH_MS = 3000

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

function showError(message: string): void {
  const box = document.createElement('p')
  box.setAttribute('role', 'alert')
  box.style.cssText = 'margin:1rem;padding:0.75rem 1rem;border-radius:0.75rem;background:#fee2e2;color:#991b1b;font:14px system-ui'
  box.textContent = message
  document.body.append(box)
}

async function main(): Promise<void> {
  await loadStylesheet('/styles.css')
  const initial = await request('/api/poll')

  // A static view: no data, no events.
  await mount(element('#header'), '/views/header.melzin.html', { data: {}, on: {} })

  // `latest` orders responses so a slow refresh never overwrites a newer vote result.
  let latest = 0
  const apply = (sequence: number, data: Data) => {
    if (sequence < latest) return
    latest = sequence
    view.update(data)
  }
  let next = 0

  const vote = async (option: Option) => {
    const sequence = ++next
    try {
      const data = await request('/api/poll/votes', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ option }),
      })
      apply(sequence, data)
    } catch (error) {
      console.error('[poll] vote failed:', error)
    }
  }

  // The generated types make tsc reject a missing or misspelled handler and data of the wrong shape.
  const view: MelzinView<Data> = await mount<Data, Handlers>(element('#poll'), '/views/poll.melzin.html', {
    data: initial,
    on: {
      votePizza: () => void vote('pizza'),
      voteTacos: () => void vote('tacos'),
      voteSushi: () => void vote('sushi'),
    },
  })

  // Pick up other people's votes.
  setInterval(async () => {
    const sequence = ++next
    try {
      apply(sequence, await request('/api/poll'))
    } catch (error) {
      console.warn('[poll] refresh failed:', error)
    }
  }, REFRESH_MS)
}

main().catch((error: unknown) => {
  console.error(error)
  showError(`The poll couldn't load: ${error instanceof Error ? error.message : String(error)}`)
})
