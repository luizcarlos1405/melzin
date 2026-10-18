// View sources shared by the runtime tests, and a way to watch the runtime's DOM calls.

/**
 * Sets `name` on `proto` to `descriptor` for one test and returns the function that puts back what was
 * there. The runtime calls DOM members from the prototypes, past a node's own properties
 * (src/runtime/dom.ts), so a test watches a call where the member's interface defines it.
 */
export function patchMember(proto: object, name: string, descriptor: PropertyDescriptor): () => void {
  const before = Object.getOwnPropertyDescriptor(proto, name)
  Object.defineProperty(proto, name, { configurable: true, ...descriptor })
  return () => {
    if (before === undefined) delete (proto as Record<string, unknown>)[name]
    else Object.defineProperty(proto, name, before)
  }
}

type ViewParts = { title?: string; schema?: unknown; snapshots?: unknown; head?: string; body: string }

/** Builds a view document; `schema` / `snapshots` may be raw strings to test invalid JSON. */
export function view(parts: ViewParts): string {
  const block = (type: string, value: unknown): string =>
    value === undefined ? '' : `<script type="${type}">${typeof value === 'string' ? value : JSON.stringify(value)}</script>`
  return [
    '<!doctype html><html lang="en"><head><meta charset="utf-8">',
    parts.title === undefined ? '' : `<title>${parts.title}</title>`,
    block('melzin/schema', parts.schema),
    block('melzin/snapshots', parts.snapshots),
    parts.head ?? '',
    `</head><body>${parts.body}</body></html>`,
  ].join('')
}

export const COUNTER_SCHEMA = {
  data: { type: 'object', properties: { count: { type: 'number' } }, required: ['count'] },
  events: { increment: {} },
}

export const COUNTER = view({
  title: 'Counter',
  schema: COUNTER_SCHEMA,
  snapshots: { zero: { data: { count: 0 } }, 'a few clicks': { data: { count: 3 } } },
  body: `
  <main class="flex">
    <p class="text-6xl" m-text="count"></p>
    <button class="rounded-lg" m-on:click="emit('increment')">Click me</button>
  </main>`,
})

export const PROFILE_SCHEMA = {
  data: {
    type: 'object',
    properties: {
      title: { type: 'string', default: 'Profile' },
      user: {
        type: 'object',
        properties: {
          name: { type: 'string' },
          role: { type: 'string' },
          bio: { type: 'string', default: '' },
          followers: { type: 'number' },
          verified: { type: 'boolean' },
        },
        required: ['name', 'role', 'followers'],
      },
    },
    required: ['user'],
  },
  events: {},
}

export const PROFILE = view({
  title: 'Profile card',
  schema: PROFILE_SCHEMA,
  body: `
  <h1 m-text="title"></h1>
  <section>
    <h2 m-text="user.name"></h2>
    <p m-text="user.role"></p>
    <p class="bio" m-text="user.bio"></p>
    <span class="followers" m-text="user.followers"></span>
    <span class="verified" m-text="user.verified"></span>
  </section>`,
})
