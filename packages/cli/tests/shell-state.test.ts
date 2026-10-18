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
  DEVICE_PRESETS,
  ZOOM_MAX,
  ZOOM_MIN,
  clampZoom,
  defaultShellState,
  deviceLabel,
  formatData,
  formatDevice,
  formatTime,
  frameUrl,
  parseDataJson,
  parseDevice,
  parseShellState,
  parseZoom,
  routeCardUrl,
  serializeShellState,
  stepZoom,
  viewFileUrl,
  viewFileName,
  viewName,
  zoomLabel,
} from '../shell/state.ts'

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
  test('defaults: first view, phone, 100%, every snapshot, chrome on', () => {
    expect(parseShellState('')).toEqual(defaultShellState())
    expect(defaultShellState()).toEqual({ route: null, view: null, device: { width: 375, height: 812 }, zoom: 1, snapshot: null, chrome: true })
  })

  test('reads every parameter', () => {
    expect(parseShellState('?view=counter&device=768x1024&zoom=0.5&snapshot=a+few+clicks&chrome=0')).toEqual({
      route: null,
      view: 'counter',
      device: { width: 768, height: 1024 },
      zoom: 0.5,
      snapshot: 'a few clicks',
      chrome: false,
    })
  })

  test('accepts a file name for view and falls back on bad values', () => {
    const state = parseShellState('?view=profile-card.mel.html&device=huge&zoom=abc&snapshot=&chrome=1')
    expect(state).toEqual({ ...defaultShellState(), view: 'profile-card' })
    expect(parseShellState('?chrome=false').chrome).toBe(false)
    expect(parseShellState('?chrome=yes').chrome).toBe(true)
  })

  test('serializes in a stable order and round-trips', () => {
    const state = { route: null, view: 'counter', device: { width: 375, height: 812 }, zoom: 1, snapshot: null, chrome: true }
    expect(serializeShellState(state)).toBe('?view=counter&device=375x812&zoom=1')
    const solo = { ...state, snapshot: 'a few clicks', chrome: false, zoom: 0.67 }
    expect(serializeShellState(solo)).toBe('?view=counter&device=375x812&zoom=0.67&snapshot=a+few+clicks&chrome=0')
    expect(parseShellState(serializeShellState(solo))).toEqual(solo)
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
    expect(frameUrl('counter.mel.html', 'a few clicks')).toBe('/frame?view=counter.mel.html&snapshot=a+few+clicks')
    expect(frameUrl('hello.mel.html', null)).toBe('/frame?view=hello.mel.html')
    expect(frameUrl('profile.mel.html', 'me', 'profile')).toBe('/frame?view=profile.mel.html&snapshot=me&route=profile')
    expect(new URLSearchParams(frameUrl('x.mel.html', 'a&b=c').split('?')[1]).get('snapshot')).toBe('a&b=c')
    expect(viewFileUrl('my view.mel.html')).toBe('/views/my%20view.mel.html')
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
})

describe('frame protocol', () => {
  test('builders produce messages the guards accept', () => {
    expect(isFrameMessage(frameMessage({ type: 'ready', title: 'Counter' }))).toBe(true)
    expect(isFrameMessage(frameMessage({ type: 'event', name: 'increment', time: 1 }))).toBe(true)
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
