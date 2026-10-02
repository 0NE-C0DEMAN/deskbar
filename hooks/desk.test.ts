import { expect, mock, test } from 'claude-code/testing'

// the sounds the mod asked to play
const sounds: string[] = []

const PROPS = { hasSurvey: false, isWorking: false, maxRows: 20, bodyColumns: 120 }

test('the band draws an icon and hides the counts until hover', async ($: any, on: any) => {
  const state = new Map<string, { value: unknown; version: number }>()
  const calls: string[] = []
  let onFile = '{}'
  // the settings as the mod last saved them, read back like the real file
  let settingsText = ''
  const sent: string[] = []
  let isRead = false
  const prompts: string[] = []
  on('prompt.submit', (_$: any, e: any) => {
    prompts.push(e.text)

    return { text: e.text }
  })
  on('session.start', (_$: any, e: any) => ({ cwd: e.cwd }))
  on('session.usage', () => ({ value: { context: { tokens: 330000, window: 1000000, percent: 33 } } }))
  on('command.register', (_$: any, e: any) => ({ value: { command: e.name } }))
  on('ui.status', () => ({ value: undefined }))
  on('ui.invalidate', () => ({ value: undefined }))
  on('session.version', () => ({ value: { version: '2.1.286', base: '2.1.286' } }))
  on('audio.play', (_$: any, e: any) => {
    sounds.push(e.clip.asset)

    return { value: undefined }
  })
  on('ui.render', () => ({ type: 'engine', ref: 0 }))
  on('session.messages', () => ({ value: [] }))
  mock.store(on)
  const toasts: string[] = []
  on('ui.toast', (_$: any, e: any) => {
    toasts.push(JSON.stringify(e))

    return { value: undefined }
  })
  on('session.id', () => ({ value: 'sess-b' }))
  // the timer half looks for a timelog in the project: there is none here
  on('session.root', () => ({ value: 'C:\\proj' }))
  mock.env(on, { USERPROFILE: 'C:\\Users\\me' })
  on('fs.exists', () => ({ value: false }))
  on('fs.stat', () => ({ deny: 'ENOENT' }))
  on('ui.open', () => ({ value: { isPlaced: true } }))
  on('tool.register', (_$: any, e: any) => ({ value: { tool: `mcp__deskbar__${e.name}` } }))
  on('prompt.context', (_$: any, e: any) => ({ blocks: e.blocks }))
  const dirs: Record<string, { name: string; kind: string; size: number; mtimeMs: number; isLink: boolean }[]> = {
    '/.claude/projects': [{ name: 'D--Acme', kind: 'dir', size: 0, mtimeMs: 0, isLink: false }, { name: 'D--Kaggle', kind: 'dir', size: 0, mtimeMs: 0, isLink: false }],
    '/.claude/projects/D--Acme': [{ name: 'sess-a.jsonl', kind: 'file', size: 1, mtimeMs: 1, isLink: false }],
    '/.claude/projects/D--Kaggle': [{ name: 'sess-b.jsonl', kind: 'file', size: 1, mtimeMs: 1, isLink: false }],
    '/.claude/tasks': [{ name: 'sess-a', kind: 'dir', size: 0, mtimeMs: 0, isLink: false }, { name: 'sess-b', kind: 'dir', size: 0, mtimeMs: 0, isLink: false }],
    '/.claude/tasks/sess-a': [{ name: '1.json', kind: 'file', size: 1, mtimeMs: 5, isLink: false }],
    '/.claude/tasks/sess-b': [{ name: '1.json', kind: 'file', size: 1, mtimeMs: 9, isLink: false }, { name: '2.json', kind: 'file', size: 1, mtimeMs: 9, isLink: false }],
  }
  const tail = (path: string) => path.replace(/\\/g, '/').replace(/^.*(?=\/\.claude\/)/, '')
  on('fs.list', (_$: any, e: any) => ({ value: dirs[tail(e.path)] ?? [] }))
  on('fs.read', (_$: any, e: any) => {
    const at = tail(e.path)
    if (at === '/.claude/deskbar-data/desk-on.json') return { value: onFile }
    if (at === '/.claude/deskbar-data/settings.json' && settingsText !== '') return { value: settingsText }
    const tasks: Record<string, unknown> = {
      '/.claude/tasks/sess-a/1.json': { id: '1', subject: 'Parser fix', status: 'pending' },
      '/.claude/tasks/sess-b/1.json': { id: '1', subject: 'Train baseline', status: 'completed' },
      '/.claude/tasks/sess-b/2.json': { id: '2', subject: 'Submit to leaderboard', status: 'in_progress' },
    }

    return tasks[at] === undefined ? { deny: 'ENOENT' } : { value: JSON.stringify(tasks[at]) }
  })
  const written: string[] = []
  on('fs.write', (_$: any, e: any) => {
    written.push(`${tail(e.path)}=${e.text}`)
    if (tail(e.path) === '/.claude/deskbar-data/desk-on.json') onFile = e.text
    if (tail(e.path) === '/.claude/deskbar-data/settings.json') settingsText = e.text

    return { value: undefined }
  })
  on('process.run', () => ({ value: { exitCode: 0, stdout: '', stderr: '' } }))
  on('process.spawn', async function* () {
    return { code: 0, signal: null }
  })
  const NOW = Date.UTC(2026, 9, 2, 4, 0, 0)
  on('clock.now', () => ({ value: NOW }))
  on('clock.every', () => ({ value: undefined }))
  on('clock.sleep', () => ({ value: undefined }))
  on('tool.list', () => ({
    value: [
      { name: 'mcp__ccd_session_mgmt__list_events', description: '' },
      { name: 'mcp__abc-1__search_threads', description: '' },
      { name: 'mcp__abc-1__get_thread', description: '' },
      { name: 'mcp__abc-2__list_events', description: '' },
      { name: 'mcp__abc-2__list_calendars', description: '' },
    ],
  }))
  on('mcp.call', (_$: any, e: any) => {
    calls.push(`${e.server}/${e.tool}`)
    sent.push(`${e.tool} ${JSON.stringify(e.args)}`)
    if (e.tool === 'unlabel_thread') isRead = true
    const data =
      e.tool === 'search_threads'
        ? { resultCountEstimate: '7', threads: [{ id: 't1', viewUrl: 'https://mail.google.com/mail/?authuser=me@gmail.com#all/t1', messages: [{ sender: 'Dana Lee <dana@x.com>', subject: 'Weekly call', labelIds: isRead ? ['INBOX'] : ['UNREAD', 'INBOX'], date: '2026-10-02T03:30:00Z' }] }, { messages: [{ sender: 'store-news@amazon.in', subject: 'Deals' }] }, { messages: [{ sender: 'notifications@github.com', subject: 'Run failed' }] }, { messages: [{ sender: 'nike@official.nike.in', subject: 'Sale' }] }, { messages: [{ sender: 'team@emails.hostinger.com', subject: 'x' }] }, { messages: [{ sender: 'services@custcomm.icici.bank.in', subject: 'x' }] }, { messages: [{ sender: 'lee@acme.example', subject: 'Keep skip' }] }] }
        : { events: [{ summary: 'Acme Dev Weekly Meeting', status: 'confirmed', start: { dateTime: new Date(NOW + 25 * 60000).toISOString() }, end: { dateTime: new Date(NOW + 55 * 60000).toISOString() }, conferenceUrl: 'https://meet.google.com/x', attendees: [{}, {}, {}] }] }

    return { value: { isError: false, content: [{ type: 'text', text: JSON.stringify(data) }] } }
  })
  on('state.get', (_$: any, e: any) => ({ value: state.get(`${e.plugin}/${e.key}`) ?? { value: undefined, version: 0 } }))
  on('state.set', (_$: any, e: any) => {
    const key = `${e.plugin}/${e.key}`
    const version = (state.get(key)?.version ?? 0) + 1
    state.set(key, { value: e.value, version })

    return { value: { isSet: true, version } }
  })
  await $.session.start({ cwd: 'C:\proj', surface: 'desktop', isInteractive: true })

  // off until the session asks for it: nothing drawn, nothing fetched
  const quiet = await $.ui.mount({ plugin: 'deskbar', surface: 'desktop', component: 'AbovePrompt', props: PROPS })
  expect(await quiet.findAll({ type: 'Button' })).toHaveLength(0)
  expect(calls).toHaveLength(0)
  await quiet.unmount()
  expect((await $.command.run({ command: 'desk', args: 'on' })).text).toContain('on for this session')
  expect(onFile).toContain('"sess-b": true')

  for (const surface of ['desktop', 'terminal'] as const) {
    const ui = await $.ui.mount({ plugin: 'deskbar', surface, component: 'AbovePrompt', props: PROPS })
    await ui.redraw(PROPS)
    const shown = (await ui.findAll({ type: 'Text' })).map((t: any) => t.text).join('|')
    // the weather is its icon and its percentage, nothing between them
    // six of the row's own, and the timer's stopwatch, which shows in every project
    expect(surface === 'desktop' ? (await ui.findAll({ type: 'Svg' })).length : 7).toBe(7)
    expect((await ui.findAll({ type: 'Client' })).map((c: any) => c.key)).not.toContain('context-meter')
    if (surface === 'desktop') expect((await ui.findAll({ type: 'Svg' })).map((s: any) => s.props.alt).join('|')).toContain('calendar in 25m|tasks 1|notes ')
    if (surface === 'terminal') expect(shown).toContain('⛅')
    expect(shown).toContain('33%')
    if (surface === 'desktop') expect((await ui.findAll({ type: 'Svg' })).some((s: any) => s.props.alt === 'mail 1' && s.props.source.includes('>1</text>'))).toBe(true)
    else expect((await ui.find({ key: 'mail' }))?.text).toContain('📧 ')
    expect(shown).toContain('Acme Dev Weekly Meeting in 25m')
    await ui.press({ key: 'mail' })
    await ui.redraw(PROPS)
    const mail = (await ui.findAll({ type: 'Text' })).map((x: any) => x.text).join('|')
    expect(mail).toContain('Primary, latest 7: 1 unread')
    expect(mail).not.toContain('Actions')
    expect(mail).toContain('Dana Lee')
    expect(mail).toContain('30m ago')
    const links = (await ui.findAll({ type: 'Link' })).map((x: any) => `${x.props.label}=${x.props.href}`)
    expect(links).toContain('Weekly call=https://mail.google.com/mail/?authuser=me%40gmail.com#all/t1')
    await ui.press({ key: 'calendar' })
    await ui.redraw(PROPS)
    const cal = (await ui.findAll({ type: 'Text' })).map((x: any) => x.text).join('|')
    expect(cal).toContain('Upcoming meetings')
    if (surface === 'desktop') {
      await ui.input({ key: 'event', text: 'call with Tom tomorrow 6pm for 45m' })
      // the day depends on the machine's time zone; the clock time and the length do not
      const made = sent.filter(line => line.startsWith('create_event ')).pop() ?? ''
      expect(made).toContain('"summary":"Call with Tom"')
      expect(made).toContain('T18:00:00')
      expect(made).toContain('T18:45:00')
      expect(made).toContain('"addGoogleMeetUrl":true')
    }
    expect(cal).toContain('in 25m|Acme Dev Weekly Meeting|3')
    expect(calls).toContain('abc-1/search_threads')
    expect(calls).toContain('abc-2/list_events')
    expect((await ui.find({ type: 'Link' }))?.props.href).toBe('https://meet.google.com/x')
    await ui.press({ key: 'calendar' })

    // tasks: this session's list first, then another session's
    if (surface === 'terminal') expect((await ui.find({ key: 'todo' }))?.text).toContain('✅ 1')
    await ui.press({ key: 'todo' })
    await ui.redraw(PROPS)
    await ui.press({ key: 'todo-mine' })
    await ui.redraw(PROPS)
    let tasks = (await ui.findAll({ type: 'Text' })).map((x: any) => x.text).join('|')
    expect(tasks).toContain('Kaggle')
    expect(tasks).toContain('1 of 2')
    if (surface === 'terminal') {
      expect((await ui.findAll({ type: 'Client' })).map((c: any) => c.key)).toContain('tasks-meter')
      await ui.advance(200, { in: 'tasks-meter' })
    }
    expect(tasks).toContain('TO DO| 1')
    expect(tasks).toContain('● Submit to leaderboard')
    expect(tasks).toContain('DONE| 1')
    expect(tasks).toContain('Train baseline')
    await ui.press({ key: 'todo-pick-sess-a' })
    await ui.redraw(PROPS)
    tasks = (await ui.findAll({ type: 'Text' })).map((x: any) => x.text).join('|')
    expect(tasks).toContain('Acme')
    expect(tasks).toContain('○ Parser fix')
    await ui.input({ key: 'todo-search', text: 'kag' })
    await ui.redraw(PROPS)
    tasks = (await ui.findAll({ type: 'Text' })).map((x: any) => x.text).join('|')
    expect(tasks).toContain('Kaggle')
    expect(tasks).toContain('1 of 1 found')
    expect(tasks).toContain('● Submit to leaderboard')
    await ui.input({ key: 'todo-search', text: '' })
    await ui.press({ key: 'todo' })

    // notes: saved from the field, ticked done, cleared
    await ui.press({ key: 'notes' })
    await ui.redraw(PROPS)
    await ui.input({ key: 'note', text: `ping Sam in 30m (${surface})` })
    await ui.redraw(PROPS)
    let noted = (await ui.findAll({ type: 'Text' })).map((x: any) => x.text).join('|')
    expect(noted).toContain(`ping Sam in 30m (${surface})`)
    expect(noted).toContain('due in 30m')
    const made = (await ui.findAll({ type: 'Button' })).find((b: any) => String(b.key).startsWith('note-done-'))
    await ui.press({ key: made.key })
    await ui.redraw(PROPS)
    noted = (await ui.findAll({ type: 'Text' })).map((x: any) => x.text).join('|')
    expect(noted).toContain('no open notes')
    await ui.press({ key: 'notes-clear' })
    await ui.press({ key: 'notes' })
    // music: the deck draws, and a control reaches the helper's command file
    await ui.press({ key: 'music' })
    await ui.redraw(PROPS)
    expect((await ui.findAll({ type: 'Button' })).map((b: any) => b.key).join(',')).toContain('music-prev,music-toggle,music-stop,music-next,music-voldown,music-volup,music-sync,music-open')
    if (surface === 'desktop') expect((await ui.findAll({ type: 'Svg' })).some((x: any) => x.props.source.includes('STARTING'))).toBe(true)
    // the smooth bars: a region of their own, which animates and asks for data by itself
    if (surface === 'terminal') {
      expect((await ui.findAll({ type: 'Client' })).map((c: any) => c.key)).toContain('spectrum')
      await ui.advance(300, { in: 'spectrum' })
    }
    await ui.press({ key: 'music-next' })
    expect(written.some(line => line.startsWith('/.claude/deskbar-data/music/cmd.txt=') && line.endsWith(' next'))).toBe(true)
    await ui.press({ key: 'music' })
    await ui.unmount()
  }

  // demo mode: made-up mail, meetings, tasks and notes
  expect((await $.command.run({ command: 'desk', args: 'demo' })).text).toContain('Demo mode on')
  const demo = await $.ui.mount({ plugin: 'deskbar', surface: 'desktop', component: 'AbovePrompt', props: PROPS })
  await demo.press({ key: 'mail' })
  await demo.redraw(PROPS)
  expect((await demo.findAll({ type: 'Text' })).map((x: any) => x.text).join('|')).toContain('Maya Chen')
  await demo.press({ key: 'todo' })
  await demo.redraw(PROPS)
  expect((await demo.findAll({ type: 'Text' })).map((x: any) => x.text).join('|')).toContain('Polish the onboarding screens')
  await demo.press({ key: 'todo' })
  await demo.unmount()
  expect((await $.command.run({ command: 'desk', args: 'demo' })).text).toContain('Demo mode off')

  // a narrow band: fewer columns, shorter labels
  const slim = { ...PROPS, bodyColumns: 70 }
  const narrow = await $.ui.mount({ plugin: 'deskbar', surface: 'desktop', component: 'AbovePrompt', props: slim })
  await narrow.press({ key: 'calendar' })
  await narrow.redraw(slim)
  const heads = (await narrow.findAll({ type: 'Text' })).map((x: any) => x.text).join('|')
  expect(heads).toContain('When|Meeting|Link')
  expect(heads).not.toContain('People')
  await narrow.press({ key: 'mail' })
  await narrow.redraw(slim)
  expect((await narrow.findAll({ type: 'Text' })).map((x: any) => x.text).join('|')).toContain('From|Subject|When')
  await narrow.press({ key: 'mail' })
  await narrow.unmount()

  const listed = await $.tool.call({ tool: 'mcp__deskbar__notes', action: 'add', text: 'invoice Acme tomorrow' })
  expect(listed.result).toContain('saved')
  const context = await $.prompt.context({ blocks: [] })
  expect(context.blocks[0].text).toContain('invoice Acme tomorrow')
})
