// The production page: mounts the same view files the shell previews, with a profile from the server.
// `?profile=bruno` picks whose profile, and `?as=ana` who is looking (no `as`: nobody is signed in).

import { mount, type MelzinView } from 'melzin'
import type { Data, Handlers } from './views/profile.types.ts'

const DEFAULT_PROFILE = 'bruno'
/** Who "Sign in to follow" signs in as. There are no accounts in this example. */
const DEMO_VIEWER = 'ana'

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
  const params = new URLSearchParams(location.search)
  const handle = params.get('profile') || DEFAULT_PROFILE
  const viewer = params.get('as') || null
  const profileUrl = `/api/profiles/${encodeURIComponent(handle)}`

  await loadStylesheet('/styles.css')
  const initial = await request(viewer === null ? profileUrl : `${profileUrl}?as=${encodeURIComponent(viewer)}`)
  document.title = `${initial.user.name} (@${initial.user.handle})`

  // A static view: links to the demo's scenarios, no data, no events.
  await mount(element('#scenarios'), '/views/scenarios.mel.html', { data: {}, on: {} })

  // The server answers a follow or an unfollow with the profile as the viewer now sees it. Only the
  // newest answer is applied, so quick clicks can't leave an older state on screen.
  let latest = 0
  const changeFollow = async (method: 'PUT' | 'DELETE'): Promise<void> => {
    if (viewer === null) return
    const sequence = ++latest
    try {
      const data = await request(`${profileUrl}/followers/${encodeURIComponent(viewer)}`, { method })
      if (sequence === latest) view.update(data)
    } catch (error) {
      console.error('[profile] couldn\'t change the follow:', error)
    }
  }

  // The generated types make tsc reject a missing or misspelled handler and data of the wrong shape.
  const view: MelzinView<Data> = await mount<Data, Handlers>(element('#profile'), '/views/profile.mel.html', {
    data: initial,
    on: {
      follow: () => void changeFollow('PUT'),
      unfollow: () => void changeFollow('DELETE'),
      signIn: () => {
        location.search = `?${new URLSearchParams({ profile: handle, as: DEMO_VIEWER })}`
      },
    },
  })
}

main().catch((error: unknown) => {
  console.error(error)
  showError(`The profile couldn't load: ${error instanceof Error ? error.message : String(error)}`)
})
