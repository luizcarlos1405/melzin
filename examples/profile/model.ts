// The profile app's model: the people, who follows whom, and the adapter (P3) that shapes them for each
// screen. It's plain TypeScript with no server in it, so the same code runs behind the server's API
// (the remote source) or right in the browser (the local source); see source.ts and SPEC D20.

import { hrefs } from 'melzin'
import routes from './routes.json'
import type { Routes } from './routes.types.ts'

export type ProfileData = Routes['profile']['data']
export type MembersData = Routes['members']['data']

/** Builds the app's URLs from routes.json (SPEC D23): link fields only take what this returns. */
export const href = hrefs<Routes>(routes)

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

function followerCount(network: Network, handle: string, person: Person): number {
  return person.followersElsewhere + countFollows(network, (_, followed) => followed === handle)
}

/** `?as=` for links that keep who is looking; nothing when nobody is signed in. */
function asQuery(viewer: string | null): { as?: string } {
  return viewer === null ? {} : { as: viewer }
}

/**
 * The adapter (P3): one person's profile as `viewer` sees it, shaped exactly like the profile view's
 * data, so the view never computes anything. `viewer` null means nobody is signed in, and the view
 * then gets no `viewer` at all. Null when there's no such person. Fields a person left empty are left
 * out, so the view shows its fallbacks. The contract test checks the output against the view's schema.
 */
export function toViewModel(network: Network, handle: string, viewer: string | null): ProfileData | null {
  const person = network.people.get(handle)
  if (person === undefined) return null
  const followers = followerCount(network, handle, person)
  const following = person.followingElsewhere + countFollows(network, (follower) => follower === handle)
  const data: ProfileData = {
    membersUrl: href('members', {}, asQuery(viewer)),
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

/** One row of the members page. */
type MemberRow = MembersData['members'][number]

/**
 * The members page as `viewer` sees it: everyone, by handle, so the order is stable across loads, each
 * with a link to their profile that keeps who is looking. The list is keyed by handle in the view's
 * schema, so a row keeps its element when its follower count changes.
 */
export function toMembersModel(network: Network, viewer: string | null): MembersData {
  const member = (handle: string, person: Person): MemberRow => {
    const followers = followerCount(network, handle, person)
    return {
      name: person.name,
      handle,
      initials: initials(person.name),
      followers: `${countLabel(followers)} ${followers === 1 ? 'follower' : 'followers'}`,
      url: href('profile', { handle }, asQuery(viewer)),
    }
  }
  const handles = [...network.people.keys()].sort()
  return { members: handles.map((handle) => member(handle, network.people.get(handle)!)) }
}

export type FollowResult = { ok: true; data: ProfileData } | { ok: false; status: 400 | 404; error: string }

/** `follower` starts or stops following `handle`; answers with the profile as the follower now sees it. */
export function setFollow(network: Network, handle: string, follower: string, follow: boolean): FollowResult {
  for (const name of [handle, follower]) {
    if (!network.people.has(name)) return { ok: false, status: 404, error: `no profile named '${name}'` }
  }
  if (handle === follower) return { ok: false, status: 400, error: "people can't follow themselves" }
  const pair = `${follower}>${handle}`
  if (follow) network.follows.add(pair)
  else network.follows.delete(pair)
  return { ok: true, data: toViewModel(network, handle, follower)! }
}
