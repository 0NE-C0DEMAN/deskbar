import { expect, mock, test } from 'claude-code/testing'

// the sounds the mod asked to play
const sounds: string[] = []

const DIR = 'C:/proj/timelog'
const TOOL = 'mcp__deskbar__timer'
// Friday 2 Oct 2026, 09:30 in India (UTC+5:30)
const NOW = Date.UTC(2026, 9, 2, 4, 0, 0)
const SURFACES = ['desktop', 'terminal'] as const
const BAND = { hasSurvey: false, isWorking: false, maxRows: 20, bodyColumns: 160 }

const norm = (path: string) => path.replace(/\\/g, '/')

const ENTRIES = [
  { id: 1, date: '2026-09-29', start: '2026-09-29T10:00:00', end: '2026-09-29T12:00:00', hours: 2, task: 'Kentucky notices', note: '', evidence: '', billable: true, invoice: null },
  { id: 2, date: '2026-10-02', start: '2026-10-02T08:00:00', end: '2026-10-02T08:30:00', hours: 0.5, task: 'Report page', note: '', evidence: '', billable: true, invoice: null },
  { id: 3, date: '2026-10-02', start: '2026-10-02T08:40:00', end: '2026-10-02T09:00:00', hours: 0.33, task: 'Call with Dana', note: '', evidence: '', billable: false, invoice: null },
]
  .map(e => JSON.stringify(e))
  .join('\n')

// What the other half of the plugin is told: the tools registered, and the
// context size (undefined keeps the desk's row from drawing).
let registered: string[] = []
let usage: number | undefined

// The desk's per-session switch, as deskbar-data/desk-on.json holds it.
let deskFile = '{"sess-t": true}'

// What the session's transcript opens with, as `$.session.messages()` answers.
let opening: unknown[] = []

function world(on: any, files: Map<string, string>) {
  const state = new Map<string, { value: unknown; version: number }>()
  const log: string[] = []

  on('session.start', (_$: any, e: any) => ({ cwd: e.cwd }))
  on('session.root', () => ({ value: 'C:\\proj' }))
  on('fs.exists', (_$: any, e: any) => ({ value: files.has(norm(e.path)) }))
  on('session.id', () => ({ value: 'sess-t' }))
  on('fs.read', (_$: any, e: any) => {
    if (norm(e.path).endsWith('/deskbar-data/desk-on.json')) return { value: deskFile }
    const text = files.get(norm(e.path))

    if (text === undefined) {
      return norm(e.path).endsWith('/rules.md') ? { value: 'RULES TEXT' } : { deny: 'ENOENT' }
    }

    return { value: text }
  })
  on('fs.write', (_$: any, e: any) => {
    files.set(norm(e.path), e.text)

    return { value: undefined }
  })
  on('fs.stat', (_$: any, e: any) => {
    const text = files.get(norm(e.path))

    if (text === undefined) {
      return { deny: 'ENOENT' }
    }

    return { value: { kind: 'file', size: text.length, mtimeMs: text.length, isLink: false } }
  })
  on('state.get', (_$: any, e: any) => ({
    value: state.get(`${e.plugin}/${e.key}`) ?? { value: undefined, version: 0 },
  }))
  on('state.set', (_$: any, e: any) => {
    const key = `${e.plugin}/${e.key}`
    const version = (state.get(key)?.version ?? 0) + 1
    state.set(key, { value: e.value, version })

    return { value: { isSet: true, version } }
  })
  on('tool.register', (_$: any, e: any) => {
    registered.push(`${e.name}: ${e.description}`)

    return { value: { tool: `mcp__deskbar__${e.name}` } }
  })
  mock.store(on)
  mock.env(on, { USERPROFILE: 'C:\\Users\\me' })
  on('session.usage', () => ({ value: { context: { tokens: usage, window: 1000000, percent: usage === undefined ? undefined : 33 } } }))
  on('tool.list', () => ({ value: [] }))
  on('mcp.call', () => ({ value: { isError: false, content: [{ type: 'text', text: '{}' }] } }))
  on('fs.list', () => ({ value: [] }))
  on('ui.invalidate', () => ({ value: undefined }))
  on('session.version', () => ({ value: { version: '2.1.286', base: '2.1.286' } }))
  on('audio.play', (_$: any, e: any) => {
    sounds.push(e.clip.asset)

    return { value: undefined }
  })
  on('prompt.submit', (_$: any, e: any) => ({ text: e.text }))
  on('command.register', (_$: any, e: any) => ({ value: { command: e.name } }))
  on('ui.status', (_$: any, e: any) => {
    log.push(`status ${JSON.stringify(e)}`)

    return { value: undefined }
  })
  on('ui.toast', (_$: any, e: any) => {
    log.push(`toast ${JSON.stringify(e)}`)

    return { value: undefined }
  })
  on('process.run', (_$: any, e: any) => {
    log.push(`run ${e.argv.join(' ')}`)
    files.delete(`${DIR}/running.json`)

    return { value: { exitCode: 0, stdout: 'Stopped. 1.50 h  from python', stderr: '' } }
  })
  on('prompt.context', (_$: any, e: any) => ({ blocks: e.blocks }))
  on('ui.render', () => ({ type: 'engine', ref: 0 }))
  on('session.messages', () => ({ value: opening }))
  on('ui.open', () => ({ value: { isPlaced: true } }))

  return { log, clock: mock.clock(on, { now: NOW }) }
}

const config = JSON.stringify({ client: 'Acme', rate: 15, weeklyCap: 15, utcOffsetMinutes: 330 })

test('start, run, draw and stop without a script', async ($: any, on: any) => {
  const files = new Map([
    [`${DIR}/entries.jsonl`, `${ENTRIES}\n`],
    [`${DIR}/config.json`, config],
  ])
  const { log, clock } = world(on, files)
  await $.session.start({ cwd: 'C:\\proj', surface: 'desktop', isInteractive: true })

  await $.command.run({ command: 'timer', args: 'show' })
  const status = await $.tool.call({ tool: TOOL, action: 'status' })
  expect(status.result).toContain('Timer stopped')
  expect(status.result).toContain('Today 0.50 h')
  expect(status.result).toContain('This week 2.50 of 15 h')

  const started = await $.tool.call({ tool: TOOL, action: 'start', task: 'Parser fix' })
  expect(started.result).toContain('Started 09:30 [billable] Parser fix')
  expect(JSON.parse(files.get(`${DIR}/running.json`) ?? '{}').start).toBe('2026-10-02T09:30:00')

  files.set(`${DIR}/running.json`, JSON.stringify({ task: 'Parser fix', start: '2026-10-02T08:00:00', billable: true, idle: 0 }))
  await clock.advance(1000)

  for (const surface of SURFACES) {
    const ui = await $.ui.mount({ plugin: 'deskbar', surface, component: 'AbovePrompt', props: BAND })
    const shown = (await ui.findAll({ type: 'Text' })).map((t: any) => t.text).join('')
    expect(surface === 'desktop' ? (await ui.find({ key: 'stop' }))?.text : shown).toContain('1:30:01')
    expect(await ui.find({ key: 'stop' })).toBeTruthy()
    await ui.unmount()
  }

  const ui = await $.ui.mount({ plugin: 'deskbar', surface: 'desktop', component: 'AbovePrompt', props: BAND })
  await ui.press({ key: 'toggle' })
  await ui.redraw(BAND)
  const open = (await ui.findAll({ type: 'Text' })).map((x: any) => x.text).join('|')
  expect(open).toContain('Today, Fri 02 Oct')
  expect(open).toContain('08:00 - 08:30|0.50|$7.50|Report page')
  expect(open).toContain('Total|2.00|$30.00')
  expect(open).toContain('Tue 29 Sep|2.00|$30.00')
  expect(open).toContain('Total|4.00|$60.00|11.00 h left of 15')
  expect(open).toContain('since Tue 29 Sep')
  await ui.press({ key: 'stop' })
  const lines = (files.get(`${DIR}/entries.jsonl`) ?? '').trim().split('\n')
  const last = JSON.parse(lines[lines.length - 1] ?? '{}')
  expect(lines).toHaveLength(4)
  expect(last).toMatchObject({ id: 4, date: '2026-10-02', hours: 1.5, task: 'Parser fix', billable: true, end: '2026-10-02T09:30:01' })
  expect(files.get(`${DIR}/running.json`)).toBe('{}')
  expect(log.join('\n')).toContain('Stopped. 1.50 h')

  await ui.redraw(BAND)
  const after = (await ui.findAll({ type: 'Text' })).map((t: any) => t.text).join('\n')
  expect((await ui.find({ key: 'resume' }))?.text).toContain('h')
  expect(after).toContain('Today, Fri 02 Oct')
})

test('a project with timelog.py stops through the script and reads its rate', async ($: any, on: any) => {
  const files = new Map([
    [`${DIR}/entries.jsonl`, `${ENTRIES}\n`],
    [`${DIR}/timelog.py`, 'RATE = 15.00   # $/hr\nWEEKLY_CAP = 15\n'],
  ])
  const { log } = world(on, files)
  await $.session.start({ cwd: 'C:\\proj', surface: 'desktop', isInteractive: true })
  await $.tool.call({ tool: TOOL, action: 'start', task: 'Call with Dana', call: true })
  expect(JSON.parse(files.get(`${DIR}/running.json`) ?? '{}').billable).toBe(false)

  const stopped = await $.tool.call({ tool: TOOL, action: 'stop', note: 'done', hours: 0 })
  expect(stopped.result).toContain('from python')
  expect(log.join('\n')).toContain('run python timelog.py stop --note done --hours 0')

  // the rules of use and the client's terms travel on the tool's description
  const tool = registered.filter(line => line.startsWith('timer: ')).pop() ?? ''
  expect(tool).toContain('Rate: $15/h')
  expect(tool).toContain('RULES TEXT')
})

test('a project with no timelog stays quiet', async ($: any, on: any) => {
  world(on, new Map())
  await $.session.start({ cwd: 'C:\\proj', surface: 'desktop', isInteractive: true })
  const context = await $.prompt.context({ blocks: [] })
  expect(context.blocks).toHaveLength(0)
})

test('the side panel draws', async ($: any, on: any) => {
  const files = new Map([
    [`${DIR}/entries.jsonl`, `${ENTRIES}\n`],
    [`${DIR}/config.json`, config],
    [`${DIR}/running.json`, JSON.stringify({ task: 'Parser fix', start: '2026-10-02T08:00:00', billable: true, idle: 0 })],
  ])
  world(on, files)
  await $.session.start({ cwd: 'C:\proj', surface: 'desktop', isInteractive: true })

  for (const surface of SURFACES) {
    const ui = await $.ui.mount({ plugin: 'deskbar', surface, component: 'Pane', requestId: 'deskbar-timer', props: { placement: 'dock' } })
    const shown = (await ui.findAll({ type: 'Text' })).map((t: any) => t.text).join('\n')
    expect(shown).toContain('On')
    expect(shown).toContain('1:30:00')
    await ui.press({ key: 'expand' })
    await ui.redraw({ placement: 'dock' })
    expect((await ui.findAll({ type: 'Text' })).map((x: any) => x.text).join('|')).toContain('This week')
    await ui.press({ key: 'collapse' })
    await ui.redraw({ placement: 'dock' })
    expect(await ui.find({ key: 'pane-stop' })).toBeTruthy()
  }
})

test('a scheduled-task session gets no timer', async ($: any, on: any) => {
  const files = new Map([
    [`${DIR}/entries.jsonl`, `${ENTRIES}\n`],
    [`${DIR}/config.json`, config],
  ])
  opening = [{ role: 'user', text: '<scheduled-task name="cs2-daily-backup-pull">run</scheduled-task>', toolUses: [] }]
  world(on, files)
  await $.session.start({ cwd: 'C:\\proj', surface: 'desktop', isInteractive: true })
  const context = await $.prompt.context({ blocks: [] })
  expect(context.blocks).toHaveLength(0)
  const ui = await $.ui.mount({ plugin: 'deskbar', surface: 'desktop', component: 'AbovePrompt', props: BAND })
  expect(await ui.findAll({ type: 'Text' })).toHaveLength(0)
  opening = []
})

test('a session that has not turned the desk on gets no timer', async ($: any, on: any) => {
  const files = new Map([
    [`${DIR}/entries.jsonl`, `${ENTRIES}\n`],
    [`${DIR}/config.json`, config],
  ])
  deskFile = '{}'
  world(on, files)
  await $.session.start({ cwd: 'C:\\proj', surface: 'desktop', isInteractive: true })
  const context = await $.prompt.context({ blocks: [] })
  expect(context.blocks).toHaveLength(0)
  const ui = await $.ui.mount({ plugin: 'deskbar', surface: 'desktop', component: 'AbovePrompt', props: BAND })
  expect(await ui.findAll({ type: 'Text' })).toHaveLength(0)
  deskFile = '{"sess-t": true}'
})

test('the desk row and the timer share the band, one dropdown at a time', async ($: any, on: any) => {
  const files = new Map([
    [`${DIR}/entries.jsonl`, `${ENTRIES}\n`],
    [`${DIR}/config.json`, config],
    [`${DIR}/running.json`, JSON.stringify({ task: 'Parser fix', start: '2026-10-02T08:00:00', billable: true, idle: 0 })],
  ])
  usage = 330000
  world(on, files)
  await $.session.start({ cwd: 'C:\\proj', surface: 'desktop', isInteractive: true })
  const ui = await $.ui.mount({ plugin: 'deskbar', surface: 'desktop', component: 'AbovePrompt', props: BAND })
  const texts = async () => (await ui.findAll({ type: 'Text' })).map((t: any) => t.text).join('|')
  const keys = async () => (await ui.findAll({ type: 'Button' })).map((b: any) => b.key).join(',')
  expect(await texts()).toContain('33%')
  expect(await keys()).toContain('mail,calendar,todo,notes,music,settings')
  expect(await keys()).toContain('toggle,stop')
  // the live pieces: the context meter in the row, a breathing dot on the running timer
  // one moving piece in the row: the dot on the running timer
  // the moving pieces are plain pictures (a frame of its own is reloaded on every redraw and flickers)
  expect((await ui.findAll({ type: 'Svg' })).filter((x: any) => x.props.isInteractive === true).length).toBe(0)
  expect((await ui.findAll({ type: 'Svg' })).some((x: any) => String(x.props.source).includes('<animate'))).toBe(true)

  // the timer's table opens, then the notes dropdown takes its place
  await ui.press({ key: 'toggle' })
  await ui.redraw(BAND)
  expect(await texts()).toContain('This week')
  expect((await ui.findAll({ type: 'Svg' })).some((x: any) => x.props.alt === 'this week against the cap')).toBe(true)
  await ui.press({ key: 'notes' })
  await ui.redraw(BAND)
  expect(await texts()).toContain('Notes: 0 open')
  expect(await texts()).not.toContain('This week')

  // closing it leaves the row alone: the timer's table does not come back
  await ui.press({ key: 'notes' })
  await ui.redraw(BAND)
  expect(await texts()).not.toContain('Notes: 0 open')
  expect(await texts()).not.toContain('This week')

  // settings: hiding the music chip, then the timer
  await ui.press({ key: 'settings' })
  await ui.redraw(BAND)
  await ui.press({ key: 'set-music' })
  await ui.redraw(BAND)
  expect(await keys()).not.toContain(',music,')
  await ui.press({ key: 'set-music' })
  await ui.redraw(BAND)
  expect(await keys()).toContain(',music,')
  await ui.press({ key: 'set-bars-off' })
  await ui.press({ key: 'set-bars-on' })
  await ui.press({ key: 'set-sounds' })
  await ui.press({ key: 'set-sounds' })
  expect(sounds).toContain('fx/tick.wav')
  usage = undefined
})
