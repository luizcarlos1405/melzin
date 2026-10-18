// Where the profile app's data comes from (SPEC D20). Both sources fill the same contract, typed by
// routes.types.ts: the remote source asks the server's API, and the local source runs the same adapter
// on the device, as an offline-first app would on top of IndexedDB. The app picks one in client.ts;
// the tests run the whole app on the local one.

import type { Page, RouteOf, Source } from 'melzin'
import { type MembersData, type Network, type ProfileData, href, setFollow, toMembersModel, toViewModel } from './model.ts'
import type { Routes } from './routes.types.ts'

/** Who "Sign in to follow" signs in as. There are no accounts in this example. */
export const DEMO_VIEWER = 'ana'

type ProfilePage = Page<ProfileData, RouteOf<Routes, 'profile'>>

/** Signing in reopens the same profile as the demo viewer: a handler that navigates (SPEC D25). */
function signIn(_payload: undefined, page: ProfilePage): Promise<void> {
  return page.navigate(href('profile', { handle: page.route.params.handle }, { as: DEMO_VIEWER }))
}

/** The server's API (server.ts). */
export function remoteSource(base = ''): Source<Routes> {
  const request = async <T>(path: string, init?: RequestInit): Promise<T> => {
    const response = await fetch(`${base}${path}`, { cache: 'no-store', ...init })
    if (!response.ok) throw new Error(`${init?.method ?? 'GET'} ${path}: HTTP ${response.status}`)
    return (await response.json()) as T
  }
  const as = (viewer: string | undefined): string => (viewer ? `?as=${encodeURIComponent(viewer)}` : '')

  // The server answers a follow or an unfollow with the profile as the viewer now sees it. Only the
  // newest answer is applied, so quick clicks can't leave an older state on screen.
  let latest = 0
  const changeFollow = async (page: ProfilePage, method: 'PUT' | 'DELETE'): Promise<void> => {
    const viewer = page.route.query.as
    if (!viewer) return
    const sequence = ++latest
    const path = `/api/profiles/${encodeURIComponent(page.route.params.handle)}/followers/${encodeURIComponent(viewer)}`
    const data = await request<ProfileData>(path, { method })
    if (sequence === latest) page.update(data)
  }

  return {
    members: {
      load: ({ query }, { signal }) => request<MembersData>(`/api/members${as(query.as)}`, { signal }),
    },
    profile: {
      load: ({ params, query }, { signal }) => request<ProfileData>(`/api/profiles/${encodeURIComponent(params.handle)}${as(query.as)}`, { signal }),
      on: {
        follow: (_payload, page) => changeFollow(page, 'PUT'),
        unfollow: (_payload, page) => changeFollow(page, 'DELETE'),
        signIn,
      },
    },
  }
}

/** The same screens computed on the device from `network`, which this source changes in place. */
export function localSource(network: Network): Source<Routes> {
  const viewerOf = (as: string | undefined): string | null => (as && network.people.has(as) ? as : null)
  const changeFollow = (page: ProfilePage, follow: boolean): void => {
    const viewer = viewerOf(page.route.query.as)
    if (viewer === null) return
    const result = setFollow(network, page.route.params.handle, viewer, follow)
    if (!result.ok) throw new Error(result.error)
    page.update(result.data)
  }
  return {
    members: {
      load: ({ query }) => toMembersModel(network, viewerOf(query.as)),
    },
    profile: {
      load: ({ params, query }) => {
        const data = toViewModel(network, params.handle, viewerOf(query.as))
        if (data === null) throw new Error(`no profile named '${params.handle}'`)
        return data
      },
      on: {
        follow: (_payload, page) => changeFollow(page, true),
        unfollow: (_payload, page) => changeFollow(page, false),
        signIn,
      },
    },
  }
}
