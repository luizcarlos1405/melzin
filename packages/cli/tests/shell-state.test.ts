// Pure helpers of the shell UI: devices, zoom, URL state, formatters and the frame protocol.

import { describe, expect, test } from 'bun:test'
import {
  FRAME_SOURCE,
  SHELL_SOURCE,
  frameMessage,
  isFrameMessage,
  isShellMessage,
  setDataMessage,
  setRouteMessage,
} from '../shell/protocol.ts'
import {
  DEFAULT_DEVICE,
  DEVICE_CHOICES,
  DEVICE_PRESETS,
  ZOOM_MAX,
  ZOOM_MIN,
  clampZoom,
  defaultShellState,
  deviceLabel,
  deviceName,
  devicesLabel,
  formatData,
  formatDevice,
  formatDevices,
  formatPayload,
  formatTime,
  PAYLOAD_MAX,
  frameUrl,
  parseDataJson,
  parseDevice,
  parseDevices,
  parseShellState,
  parseZoom,
  routeCardUrl,
  serializeShellState,
  snapshotRows,
  stepZoom,
  stylesUrl,
  viewFileUrl,
  viewFileName,
  viewName,
  viewVersions,
  zoomLabel,
} from '../shell/state.ts'
import { CURRENT_VERSION } from 'melzin/core'

describe('devices', () => {
  test('the presets are the three POC sizes, phone first', () => {
    expect(DEVICE_PRESETS.map((device) => [device.label, device.width, device.height])).toEqual([
      ['Phone', 375, 812],
      ['Tablet', 768, 1024],
      ['Desktop', 1280, 800],
    ])
    expect(DEFAULT_DEVICE.id).toBe('phone')
  })

  test('parseDevice reads WxH in several spellings and preset ids', () => {
    expect(parseDevice('375x812')).toEqual({ width: 375, height: 812 })
    expect(parseDevice(' 768 × 1024 ')).toEqual({ width: 768, height: 1024 })
    expect(parseDevice('1280X800')).toEqual({ width: 1280, height: 800 })
    expect(parseDevice('500x700')).toEqual({ width: 500, height: 700 })
    expect(parseDevice('tablet')).toEqual({ width: 768, height: 1024 })
    expect(parseDevice('Desktop')).toEqual({ width: 1280, height: 800 })
  })

  test('parseDevice rejects garbage and out-of-range sizes', () => {
    for (const value of [null, undefined, '', 'x', '375', '375x', 'x812', '375x812x2', '-375x812', '37.5x812', '10x10', '99999x800', 'watch']) {
      expect(parseDevice(value)).toBeNull()
    }
  })

  test('formatDevice and deviceLabel', () => {
    expect(formatDevice({ width: 375, height: 812 })).toBe('375x812')
    expect(deviceLabel({ width: 375, height: 812 })).toBe('Phone 375×812')
    expect(deviceLabel({ width: 500, height: 700 })).toBe('Custom 500×700')
    expect(deviceName({ width: 1280, height: 800 })).toBe('Desktop')
    expect(deviceName({ width: 500, height: 700 })).toBe('500×700')
  })

  test('parseDevices reads one or several devices, drops repeats, and rejects a list with a bad entry', () => {
    const phone = { width: 375, height: 812 }
    const desktop = { width: 1280, height: 800 }
    expect(parseDevices('phone')).toEqual([phone])
    expect(parseDevices('phone,desktop')).toEqual([phone, desktop])
    expect(parseDevices(' 375x812 , 1280×800 ,phone')).toEqual([phone, desktop])
    for (const value of [null, undefined, '', ',', 'phone,', 'phone,watch', 'phone,,desktop']) expect(parseDevices(value)).toBeNull()
  })

  test('device lists: URL form, labels and the picker\'s choices', () => {
    const phone = { width: 375, height: 812 }
    const desktop = { width: 1280, height: 800 }
    expect(formatDevices([phone, desktop])).toBe('375x812,1280x800')
    expect(devicesLabel([phone])).toBe('Phone 375×812')
    expect(devicesLabel([phone, desktop])).toBe('Phone + Desktop')
    expect(devicesLabel([phone, { width: 500, height: 700 }])).toBe('Phone + 500×700')
    expect(DEVICE_CHOICES.map(devicesLabel)).toEqual(['Phone 375×812', 'Tablet 768×1024', 'Desktop 1280×800', 'Phone + Desktop', 'Phone + Tablet + Desktop'])
  })
})

describe('zoom', () => {
  test('parseZoom reads factors and percentages, clamped to 25%–200%', () => {
    expect(parseZoom('1')).toBe(1)
    expect(parseZoom('0.5')).toBe(0.5)
    expect(parseZoom('75%')).toBe(0.75)
    expect(parseZoom('0.1')).toBe(ZOOM_MIN)
    expect(parseZoom('5')).toBe(ZOOM_MAX)
    expect(parseZoom('400%')).toBe(ZOOM_MAX)
    for (const value of [null, undefined, '', '%', 'abc', '0', '-1', 'NaN', 'Infinity']) expect(parseZoom(value)).toBeNull()
  })

  test('clampZoom, zoomLabel and stepZoom', () => {
    expect(clampZoom(0)).toBe(0.25)
    expect(clampZoom(3)).toBe(2)
    expect(zoomLabel(0.67)).toBe('67%')
    expect(zoomLabel(1)).toBe('100%')
    expect(stepZoom(1, 1)).toBe(1.25)
    expect(stepZoom(1, -1)).toBe(0.9)
    expect(stepZoom(0.8, 1)).toBe(0.9)
    expect(stepZoom(0.8, -1)).toBe(0.75)
    expect(stepZoom(2, 1)).toBe(2)
    expect(stepZoom(0.25, -1)).toBe(0.25)
  })
})

describe('URL state', () => {
  test('defaults: first view, phone, 100%, every snapshot, every version, chrome on', () => {
    expect(parseShellState('')).toEqual(defaultShellState())
    expect(defaultShellState()).toEqual({ route: null, view: null, devices: [{ width: 375, height: 812 }], zoom: 1, snapshot: null, alt: null, chrome: true })
  })

  test('reads every parameter', () => {
    expect(parseShellState('?view=counter&device=768x1024,desktop&zoom=0.5&snapshot=a+few+clicks&alt=night&chrome=0')).toEqual({
      route: null,
      view: 'counter',
      devices: [
        { width: 768, height: 1024 },
        { width: 1280, height: 800 },
      ],
      zoom: 0.5,
      snapshot: 'a few clicks',
      alt: 'night',
      chrome: false,
    })
    expect(parseShellState('?alt=current').alt).toBe(CURRENT_VERSION)
    expect(parseShellState('?alt=+').alt).toBeNull()
  })

  test('accepts a file name for view and falls back on bad values', () => {
    const state = parseShellState('?view=profile-card.mel.html&device=huge&zoom=abc&snapshot=&alt=&chrome=1')
    expect(state).toEqual({ ...defaultShellState(), view: 'profile-card' })
    expect(parseShellState('?chrome=false').chrome).toBe(false)
    expect(parseShellState('?chrome=yes').chrome).toBe(true)
  })

  test('serializes in a stable order and round-trips', () => {
    const state = { ...defaultShellState(), view: 'counter' }
    expect(serializeShellState(state)).toBe('?view=counter&device=375x812&zoom=1')
    const solo = { ...state, snapshot: 'a few clicks', chrome: false, zoom: 0.67 }
    expect(serializeShellState(solo)).toBe('?view=counter&device=375x812&zoom=0.67&snapshot=a+few+clicks&chrome=0')
    expect(parseShellState(serializeShellState(solo))).toEqual(solo)
    const compared = { ...state, devices: [{ width: 375, height: 812 }, { width: 1280, height: 800 }], alt: 'night' }
    expect(serializeShellState(compared)).toBe('?view=counter&device=375x812,1280x800&zoom=1&alt=night')
    const named = { ...state, snapshot: 'a, b & c' }
    expect(serializeShellState(named)).toBe('?view=counter&device=375x812&zoom=1&snapshot=a,+b+%26+c')
    expect(parseShellState(serializeShellState(named))).toEqual(named)
    expect(parseShellState(serializeShellState(compared))).toEqual(compared)
    expect(serializeShellState(defaultShellState())).toBe('?device=375x812&zoom=1')
  })

  test('a route wins over a view', () => {
    expect(parseShellState('?route=profile&view=counter&snapshot=s')).toEqual({ ...defaultShellState(), route: 'profile', snapshot: 's' })
    const state = { ...defaultShellState(), route: 'profile', view: 'profile' }
    expect(serializeShellState(state)).toBe('?route=profile&device=375x812&zoom=1')
  })

  test('frame and view file URLs', () => {
    expect(viewName('counter.mel.html')).toBe('counter')
    expect(viewName('counter')).toBe('counter')
    expect(viewFileName('counter')).toBe('counter.mel.html')
    expect(viewFileName('counter.mel.html')).toBe('counter.mel.html')
    expect(viewFileName('')).toBe('')
    expect(frameUrl('counter.mel.html', { snapshot: 'a few clicks' })).toBe('/frame?view=counter.mel.html&snapshot=a+few+clicks')
    expect(frameUrl('hello.mel.html', { snapshot: null })).toBe('/frame?view=hello.mel.html')
    expect(frameUrl('hello.mel.html')).toBe('/frame?view=hello.mel.html')
    expect(frameUrl('profile.mel.html', { snapshot: 'me', route: 'profile' })).toBe('/frame?view=profile.mel.html&snapshot=me&route=profile')
    expect(frameUrl('profile.mel.html', { snapshot: 'me', alt: 'night' })).toBe('/frame?view=profile.mel.html&snapshot=me&alt=night')
    expect(frameUrl('profile.mel.html', { theme: 'night' })).toBe('/frame?view=profile.mel.html&theme=night')
    expect(new URLSearchParams(frameUrl('x.mel.html', { snapshot: 'a&b=c' }).split('?')[1]).get('snapshot')).toBe('a&b=c')
    expect(viewFileUrl('my view.mel.html')).toBe('/views/my%20view.mel.html')
    expect(viewFileUrl('my view.mel.html', 'dark mode')).toBe('/explore/dark%20mode/my%20view.mel.html')
    expect(stylesUrl()).toBe('/__melzin/styles.css')
    expect(stylesUrl('dark mode')).toBe('/__melzin/styles.css?alt=dark%20mode')
  })
})

describe('versions of a view (SPEC D31)', () => {
  const alternatives = [
    { name: 'cards', theme: false, views: [{ name: 'settings' }, { name: 'profile' }] },
    { name: 'night', theme: true, views: [{ name: 'profile' }] },
    { name: 'list', theme: false, views: [{ name: 'other' }] },
  ]

  test('the one in views/, then each alternative with its own file or a theme to show it in', () => {
    expect(viewVersions('profile', true, alternatives)).toEqual([
      { key: 'current', alt: null, own: false, theme: false },
      { key: 'cards', alt: 'cards', own: true, theme: false },
      { key: 'night', alt: 'night', own: true, theme: true },
    ])
    // A theme reaches the views it doesn't redesign too: promoting it would restyle them.
    expect(viewVersions('home', true, alternatives)).toEqual([
      { key: 'current', alt: null, own: false, theme: false },
      { key: 'night', alt: 'night', own: false, theme: true },
    ])
    // A screen still being explored has no current version, so a theme alone has nothing to show.
    expect(viewVersions('settings', false, alternatives)).toEqual([{ key: 'cards', alt: 'cards', own: true, theme: false }])
    expect(viewVersions('nope', false, alternatives)).toEqual([])
  })

  test('comparison rows: snapshot names in order of first appearance, no data first', () => {
    expect(snapshotRows([['typical', 'empty'], ['typical', 'long'], ['empty']])).toEqual(['typical', 'empty', 'long'])
    expect(snapshotRows([[], ['typical']])).toEqual([null, 'typical'])
    expect(snapshotRows([[], []])).toEqual([null])
    expect(snapshotRows([])).toEqual([])
  })
})

describe('formatters', () => {
  test('formatTime is HH:MM:SS.mmm in local time', () => {
    expect(formatTime(new Date(2026, 0, 2, 3, 4, 5, 6))).toBe('03:04:05.006')
    expect(formatTime(new Date(2026, 0, 2, 23, 59, 59, 999))).toBe('23:59:59.999')
  })

  test('parseDataJson accepts objects only and reports parse errors', () => {
    expect(parseDataJson('{ "count": 3 }')).toEqual({ ok: true, data: { count: 3 } })
    const bad = parseDataJson('{ "count": ')
    expect(bad.ok).toBe(false)
    if (!bad.ok) expect(bad.message.length).toBeGreaterThan(0)
    for (const text of ['[]', '3', 'null', '"x"']) {
      expect(parseDataJson(text)).toEqual({ ok: false, message: 'data must be a JSON object, like { "count": 0 }' })
    }
  })

  test('formatData pretty-prints with two spaces', () => {
    expect(formatData({ user: { name: 'Ada' } })).toBe('{\n  "user": {\n    "name": "Ada"\n  }\n}')
  })

  test('formatPayload is compact JSON in the emit\'s field order', () => {
    expect(formatPayload({ optionId: 'pizza' })).toEqual({ text: '{"optionId":"pizza"}' })
    expect(formatPayload({ label: 'Ana "A"', count: 3, open: false })).toEqual({ text: '{"label":"Ana \\"A\\"","count":3,"open":false}' })
    expect(formatPayload({})).toEqual({ text: '{}' })
    // Markup stays text: the shell sets it with textContent.
    expect(formatPayload({ label: '<img src=x onerror=alert(1)>' }).text).toBe('{"label":"<img src=x onerror=alert(1)>"}')
    // A field named like a prototype property is a plain field.
    expect(formatPayload(JSON.parse('{"__proto__":"x"}') as Record<string, unknown>)).toEqual({ text: '{"__proto__":"x"}' })
  })

  test('formatPayload cuts long payloads at PAYLOAD_MAX characters, keeping the whole JSON', () => {
    const fits = { note: 'x'.repeat(PAYLOAD_MAX - '{"note":""}'.length) }
    expect(formatPayload(fits)).toEqual({ text: JSON.stringify(fits) })
    const long = { note: 'x'.repeat(PAYLOAD_MAX) }
    const shown = formatPayload(long)
    expect(shown.full).toBe(JSON.stringify(long))
    expect(Array.from(shown.text)).toHaveLength(PAYLOAD_MAX)
    expect(shown.text.endsWith('x…')).toBe(true)
    expect(formatPayload({ optionId: 'pizza' }, 10)).toEqual({ text: '{"optionI…', full: '{"optionId":"pizza"}' })
  })

  test('formatPayload never cuts an emoji in half', () => {
    const shown = formatPayload({ emoji: '🍕🌮🍣🍔' }, 12)
    expect(shown.text).toBe('{"emoji":"🍕…')
    expect(shown.text.isWellFormed()).toBe(true)
  })
})

describe('frame protocol', () => {
  test('builders produce messages the guards accept', () => {
    expect(isFrameMessage(frameMessage({ type: 'ready', title: 'Counter' }))).toBe(true)
    expect(isFrameMessage(frameMessage({ type: 'event', name: 'increment', time: 1 }))).toBe(true)
    expect(isFrameMessage(frameMessage({ type: 'event', name: 'vote', time: 1, payload: { optionId: 'pizza', votes: 3, open: true } }))).toBe(true)
    expect(isFrameMessage(frameMessage({ type: 'event', name: 'vote', time: 1, payload: {} }))).toBe(true)
    expect(isFrameMessage(frameMessage({ type: 'event', name: 'increment', time: 1, payload: undefined }))).toBe(true)
    expect(isFrameMessage(frameMessage({ type: 'link', href: '/orders/42', time: 1 }))).toBe(true)
    expect(isFrameMessage({ source: 'melzin-frame', type: 'link', href: 1, time: 1 })).toBe(false)
    expect(isFrameMessage(frameMessage({ type: 'warning', message: 'w' }))).toBe(true)
    expect(isFrameMessage(frameMessage({ type: 'warning', message: 'w', update: true }))).toBe(true)
    expect(isFrameMessage(frameMessage({ type: 'error', message: 'e' }))).toBe(true)
    expect(isShellMessage(setDataMessage({ count: 1 }))).toBe(true)
    expect(isShellMessage(setRouteMessage({ name: 'profile', params: { handle: 'ana' } }))).toBe(true)
    expect(isShellMessage({ source: SHELL_SOURCE, type: 'set-route', route: 'x' })).toBe(false)
    expect(setDataMessage({ count: 1 })).toEqual({ source: SHELL_SOURCE, type: 'set-data', data: { count: 1 } })
  })

  test('guards reject foreign or malformed messages', () => {
    for (const value of [
      null,
      'ready',
      { type: 'ready', title: 'x' },
      { source: 'webpack', type: 'ready', title: 'x' },
      { source: FRAME_SOURCE, type: 'event', name: 'x' },
      // A payload is an object of string, number or boolean fields, as the runtime builds it.
      { source: FRAME_SOURCE, type: 'event', name: 'x', time: 1, payload: 'pizza' },
      { source: FRAME_SOURCE, type: 'event', name: 'x', time: 1, payload: null },
      { source: FRAME_SOURCE, type: 'event', name: 'x', time: 1, payload: ['pizza'] },
      { source: FRAME_SOURCE, type: 'event', name: 'x', time: 1, payload: { option: { id: 'pizza' } } },
      { source: FRAME_SOURCE, type: 'event', name: 'x', time: 1, payload: { optionId: null } },
      { source: FRAME_SOURCE, type: 'warning', message: 'x', update: 'yes' },
      { source: FRAME_SOURCE, type: 'nope' },
      setDataMessage({}),
    ]) {
      expect(isFrameMessage(value)).toBe(false)
    }
    expect(isShellMessage({ source: SHELL_SOURCE, type: 'set-data', data: [] })).toBe(false)
    expect(isShellMessage({ source: SHELL_SOURCE, type: 'set-data' })).toBe(false)
    expect(isShellMessage(frameMessage({ type: 'ready', title: '' }))).toBe(false)
  })
})

describe('route card URLs', () => {
  test('the path with the snapshot\'s params and declared query', () => {
    expect(routeCardUrl('/u/:handle', { handle: 'ana b' }, { as: 'bruno', other: 'x' }, ['as'])).toBe('/u/ana%20b?as=bruno')
    expect(routeCardUrl('/u/:handle/posts/:id', { handle: 'ana' })).toBe('/u/ana/posts/:id')
    expect(routeCardUrl('/')).toBe('/')
  })
})
