// The profile app's backend: it owns the people and who follows whom, shapes a profile for the screen
// and serves the page, the view files (unchanged, P5) and the CSS built from those same views.

import { VIEW_FILE_HEADERS, buildCss, resolveProject, resolveViewFile } from '@melzin/cli/tools'
import indexPage from './index.html'
import type { Data } from './views/profile.types.ts'

/** What the backend stores about a person. */
export type Person = {
  name: string
  verified: boolean
  pronouns?: string
  bio?: string
  location?: string
  /** `YYYY-MM` */
  joined: string
  posts: number
  /** Followers and follows from outside this demo, so the counts look lived in. */
  followersElsewhere: number
  followingElsewhere: number
}

export type Network = {
  /** People by handle. */
  people: Map<string, Person>
  /** Who follows whom, as `follower>followed` handles. */
  follows: Set<string>
}

export function demoNetwork(): Network {
  return {
    people: new Map<string, Person>([
      ['ana', {
        name: 'Ana Souza',
        verified: true,
        pronouns: 'she/her',
        bio: 'Designs tools for people who make things. Coffee, maps and long walks.',
        location: 'Recife, Brazil',
        joined: '2019-06',
        posts: 1204,
        followersElsewhere: 18240,
        followingElsewhere: 312,
      }],
      ['bruno', {
        name: 'Bruno Lima',
        verified: false,
        pronouns: 'he/him',
        bio: 'Backend engineer. Writes about queues, caches and the bugs that live between them.',
        location: 'Lisbon, Portugal',
        joined: '2021-03',
        posts: 312,
        followersElsewhere: 2480,
        followingElsewhere: 189,
      }],
      // A new account that hasn't filled anything in yet.
      ['carla', { name: 'Carla Mendes', verified: false, joined: '2026-09', posts: 0, followersElsewhere: 0, followingElsewhere: 0 }],
    ]),
    follows: new Set(['bruno>ana', 'carla>bruno']),
  }
}

const FULL = new Intl.NumberFormat('en-US')
const COMPACT = new Intl.NumberFormat('en-US', { notation: 'compact', maximumFractionDigits: 1 })
const MONTH = new Intl.DateTimeFormat('en-US', { month: 'long', year: 'numeric', timeZone: 'UTC' })

/** `2,481` below ten thousand, then `18.2K` or `98.8M`, so the stats fit side by side on a phone. */
export function countLabel(count: number): string {
  return count < 10_000 ? FULL.format(count) : COMPACT.format(count)
}

/** `2019-06` → `Joined June 2019`. */
export function joinedLabel(joined: string): string {
  return `Joined ${MONTH.format(new Date(`${joined}-01T00:00:00Z`))}`
}

/** `Ana Souza` → `AS`: the first letters of the first and last names. */
export function initials(name: string): string {
  const words = name.trim().split(/\s+/)
  const first = [...(words[0] ?? '')][0] ?? ''
  const last = words.length > 1 ? ([...(words.at(-1) ?? '')][0] ?? '') : ''
  return (first + last).toUpperCase()
}

function countFollows(network: Network, matches: (follower: string, followed: string) => boolean): number {
  let count = 0
  for (const pair of network.follows) {
    const [follower = '', followed = ''] = pair.split('>')
    if (matches(follower, followed)) count++
  }
  return count
}

/**
 * The adapter (P3): one person's profile as `viewer` sees it, shaped exactly like the profile view's
 * data, so the view never computes anything. `viewer` null means nobody is signed in, and the view
 * then gets no `viewer` at all. Null when there's no such person. Fields a person left empty are left
 * out, so the view shows its fallbacks. The contract test checks the output against the view's schema.
 */
export function toViewModel(network: Network, handle: string, viewer: string | null): Data | null {
  const person = network.people.get(handle)
  if (person === undefined) return null
  const followers = person.followersElsewhere + countFollows(network, (_, followed) => followed === handle)
  const following = person.followingElsewhere + countFollows(network, (follower) => follower === handle)
  const data: Data = {
    user: {
      name: person.name,
      handle,
      initials: initials(person.name),
      verified: person.verified,
      ...(person.pronouns ? { pronouns: person.pronouns } : {}),
      ...(person.bio ? { bio: person.bio } : {}),
      ...(person.location ? { location: person.location } : {}),
      joined: joinedLabel(person.joined),
    },
    stats: { posts: countLabel(person.posts), followers: countLabel(followers), following: countLabel(following) },
  }
  if (viewer !== null) {
    const isSelf = viewer === handle
    data.viewer = {
      isSelf,
      following: !isSelf && network.follows.has(`${viewer}>${handle}`),
      followsYou: !isSelf && network.follows.has(`${handle}>${viewer}`),
    }
  }
  return data
}

export type ProfileServerOptions = {
  /** Defaults to 3002; 0 picks a free port. */
  port?: number
  hostname?: string
  /** The people and follows to start from (default: demoNetwork()). Changed in place. */
  network?: Network
  /** Rebuilds the CSS on every request and enables Bun's dev bundling. Defaults to NODE_ENV !== 'production'. */
  development?: boolean
}

const NO_STORE = { 'Cache-Control': 'no-store' }

function json(body: unknown, status = 200): Response {
  return Response.json(body, { status, headers: NO_STORE })
}

export function createProfileServer(options: ProfileServerOptions = {}) {
  const network = options.network ?? demoNetwork()
  const development = options.development ?? process.env.NODE_ENV !== 'production'
  const project = resolveProject({ cwd: import.meta.dir })

  let cachedCss: Promise<string> | undefined
  const css = (): Promise<string> => {
    const build = () => buildCss({ projectDir: project.root, viewsDir: project.viewsDir, themeFile: project.themeFile })
    if (development) return build()
    cachedCss ??= build()
    return cachedCss
  }

  const noProfile = (handle: string): Response => json({ error: `no profile named '${handle}'` }, 404)

  // Follows and unfollows answer with the profile as the follower now sees it, ready for view.update.
  // They are PUT and DELETE, which another site can't send without a CORS preflight this server never
  // answers, so a cross-site page can't make someone follow.
  const changeFollow = (handle: string, follower: string, follow: boolean): Response => {
    if (!network.people.has(handle)) return noProfile(handle)
    if (!network.people.has(follower)) return noProfile(follower)
    if (handle === follower) return json({ error: "people can't follow themselves" }, 400)
    const pair = `${follower}>${handle}`
    if (follow) network.follows.add(pair)
    else network.follows.delete(pair)
    return json(toViewModel(network, handle, follower))
  }

  return Bun.serve({
    port: options.port ?? 3002,
    hostname: options.hostname,
    development,
    routes: {
      '/': indexPage,
      // There are no accounts in this example: `?as=ana` says who is signed in, and no `as` means nobody.
      '/api/profiles/:handle': {
        GET: (request) => {
          const viewer = new URL(request.url).searchParams.get('as') || null
          if (viewer !== null && !network.people.has(viewer)) return json({ error: `no profile named '${viewer}' to view as` }, 400)
          const data = toViewModel(network, request.params.handle, viewer)
          return data === null ? noProfile(request.params.handle) : json(data)
        },
      },
      '/api/profiles/:handle/followers/:follower': {
        PUT: (request) => changeFollow(request.params.handle, request.params.follower, true),
        DELETE: (request) => changeFollow(request.params.handle, request.params.follower, false),
      },
      '/views/*': (request) => {
        // Only the view files the project lists qualify (melzin's guard), so encoded separators and `..`
        // never reach the file system.
        const file = resolveViewFile(project, new URL(request.url).pathname.slice('/views/'.length))
        if (file === null) return new Response('Not found', { status: 404 })
        return new Response(Bun.file(file), { headers: { ...VIEW_FILE_HEADERS, ...NO_STORE } })
      },
      '/styles.css': async () => {
        try {
          return new Response(await css(), {
            headers: { 'Content-Type': 'text/css; charset=utf-8', 'Cache-Control': development ? 'no-store' : 'no-cache' },
          })
        } catch (error) {
          const message = String((error as Error).message ?? error).replaceAll('*/', '* /')
          return new Response(`/* buildCss failed: ${message} */\n`, {
            status: 500,
            headers: { 'Content-Type': 'text/css; charset=utf-8', ...NO_STORE },
          })
        }
      },
    },
    fetch: () => new Response('Not found', { status: 404 }),
  })
}

if (import.meta.main) {
  const port = Number(process.env.PORT ?? 3002)
  if (!Number.isInteger(port) || port < 0 || port > 65535) {
    console.error(`PORT must be a port number, got ${JSON.stringify(process.env.PORT)}`)
    process.exit(1)
  }
  const server = createProfileServer({ port })
  console.log(`Profile app on ${server.url}`)
}
