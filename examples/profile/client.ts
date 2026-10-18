// The production page: the standalone host (SPEC §7) runs the app. routes.json picks the view for the
// URL, the remote source loads its data from the server, and links between the pages switch screens
// without reloading. `?as=ana` says who is looking; without it, nobody is signed in.

import { startApp } from 'melzin'
import routes from './routes.json'
import type { Routes } from './routes.types.ts'
import { remoteSource } from './source.ts'

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
    // Start either way: an unstyled page beats an empty one.
    link.addEventListener('load', () => resolve(), { once: true })
    link.addEventListener('error', () => resolve(), { once: true })
    document.head.append(link)
  })
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
  // The generated Routes type makes tsc reject a missing route, loader or handler, data of the wrong
  // shape, and a link field filled by hand instead of with href().
  await startApp<Routes>(element('#app'), { routes, source: remoteSource() })
}

main().catch((error: unknown) => {
  console.error(error)
  showError(`The app couldn't start: ${error instanceof Error ? error.message : String(error)}`)
})
