import { atom, read, update } from 'claude-code'
import type { EngineInterface, Register, Timer } from 'claude-code'

import type { Config, Day, Entry, Row, Running, Snap } from '../types'

import { meterSvg, pulseSvg } from './motion'

// The ledger format is the one an optional timelog/timelog.py writes, so
// the script, its Excel report and this mod all read and write the same files.
const TOOL = 'mcp__deskbar__timer'
const PANE = 'deskbar-timer'
const SLIM = 14
const WIDE = 48
const MAX_SANE_HOURS = 10
const GREEN = '#5fcfa7'
const AMBER = '#f0a45d'
const GREY = '#9fb1b6'
const WEEKDAYS = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun']
const CELLS = 10

const snap = atom({ plugin: 'deskbar', key: 'snap' } as const, null)
const isOpen = atom({ plugin: 'deskbar', key: 'isOpen' } as const, false)
// When the table was opened (0 while closed). the desk row keeps the same
// for its dropdowns, and each mod reads the other's: only the one opened last
// is drawn, so one dropdown shows at a time across both.
const openAt = atom({ plugin: 'deskbar', key: 'openAt' } as const, 0)
// The side panel is the view; the band above the prompt is opt-in (/timer show).
const isHidden = atom({ plugin: 'deskbar', key: 'timerHidden' } as const, false)

type Context = { dir: string; config: Config; hasScript: boolean }

let ctx: Context | null = null
let ledger: Entry[] = []
let ledgerStamp = ''
let expenses = 0
let ticks = 0
let isBusy = false
let lastKey = ''
let lastStatus: string | undefined
let wasOverCap: boolean | undefined
let ticker: Timer | undefined

const pad = (n: number) => String(n).padStart(2, '0')
const round2 = (n: number) => Math.round(n * 100) / 100

function hms(seconds: number) {
  const s = Math.max(0, Math.floor(seconds))

  return `${Math.floor(s / 3600)}:${pad(Math.floor((s % 3600) / 60))}:${pad(s % 60)}`
}

// Ledger times are local wall-clock times with no zone, as Python wrote them.
function localIso(ms: number, offset: number) {
  return new Date(ms + offset * 60000).toISOString().slice(0, 19)
}

function parseLocal(iso: string, offset: number) {
  return Date.parse(`${iso.slice(0, 19)}Z`) - offset * 60000
}

function money(hours: number, s: Snap) {
  return s.rate > 0 ? `  ${s.currency}${(hours * s.rate).toFixed(2)}` : ''
}

function clip(text: string, max: number) {
  return text.length > max ? `${text.slice(0, Math.max(1, max - 1))}…` : text
}

function view(s: Snap) {
  const run = s.running
  const gross = run === null ? 0 : (s.nowMs - s.startMs) / 1000
  const net = run === null ? 0 : Math.max(0, gross - run.idle)
  const live = run !== null && run.billable ? net / 3600 : 0
  const today = s.todayBase + live
  const week = s.weekBase + live
  const isOver = s.cap > 0 && week > s.cap
  const pill = run === null ? 'STOPPED' : run.billable ? 'RUNNING' : 'CALL, NOT BILLED'
  const color = run === null ? GREY : run.billable ? GREEN : AMBER
  const filled = s.cap > 0 ? Math.max(0, Math.min(CELLS, Math.round((week / s.cap) * CELLS))) : 0

  return { net, live, today, week, isOver, pill, color, filled }
}

function summary(s: Snap) {
  const v = view(s)
  const run = s.running
  const head =
    run === null
      ? 'Timer stopped.'
      : `${v.pill} ${hms(v.net)}  ${run.task} (started ${run.start.slice(11, 16)})`
  const week = s.cap > 0 ? `${v.week.toFixed(2)} of ${s.cap} h` : `${v.week.toFixed(2)} h`
  const unbilled =
    s.unbilledHours > 0
      ? ` Unbilled ${s.unbilledHours.toFixed(2)} h${money(s.unbilledHours, s)} since ${s.unbilledFrom}.`
      : ''

  return `${head} Today ${v.today.toFixed(2)} h${money(v.today, s)}. This week ${week}${v.isOver ? ', over the cap' : ''}.${unbilled}`
}

// Scheduled-task sessions (the daily backup pull and the like) run with
// nobody watching: the mod stays out of them. Such a session opens with a
// prompt that carries a <scheduled-task ...> tag.
let isUnattended = false

async function checkUnattended($: EngineInterface) {
  try {
    const messages = await $.session.messages()
    const first = Array.isArray(messages) ? messages.find(m => m.role === 'user') : undefined

    if (first !== undefined && String(first.text ?? '').includes('<scheduled-task')) {
      isUnattended = true
    }
  } catch {
    // an unreadable transcript counts as an ordinary session
  }

  return isUnattended
}

// The desk is off in a session until /desk on (the desk's command) turns
// it on there; the choice is in deskbar-data/desk-on.json, by session id.
let deskOn = false
let hasTool = false
// Whether this build's desktop app runs surface modules (2.1.287 on); the
// terminal always does.
let hasDesktopModules = false
let hasSounds = true
// The data folder, under the user's own ~/.claude wherever the plugin is installed.
let claudeHome = ''

async function dataRoot($: EngineInterface) {
  if (claudeHome === '') {
    const home = (await $.env.get('USERPROFILE')) ?? (await $.env.get('HOME')) ?? ''
    claudeHome = home === '' ? '' : `${home.replace(/\\/g, '/').replace(/\/+$/, '')}/.claude`
  }

  return `${claudeHome}/deskbar-data`
}

async function readOn($: EngineInterface) {
  try {
    const map = JSON.parse(await $.fs.read(`${await dataRoot($)}/desk-on.json`))
    deskOn = !isUnattended && map[await $.session.id()] === true
  } catch {
    deskOn = false
  }

  if (deskOn) {
    try {
      const saved = JSON.parse(await $.fs.read(`${await dataRoot($)}/settings.json`))
      deskOn = saved?.show?.timer !== false
      hasSounds = saved?.sounds !== false
    } catch {
      // no settings file: the timer shows
    }
  }

  return deskOn
}

async function locate($: EngineInterface) {
  const root = (await $.session.root()).replace(/[\\/]+$/, '')
  const dir = `${root}/timelog`
  const hasLedger = await $.fs.exists(`${dir}/entries.jsonl`)
  const hasConfig = await $.fs.exists(`${dir}/config.json`)

  if (!hasLedger && !hasConfig) {
    ctx = null

    return null
  }

  const hasScript = await $.fs.exists(`${dir}/timelog.py`)
  let config: Config = {
    client: root.split(/[\\/]/).pop() ?? 'Client',
    rate: 0,
    weeklyCap: 0,
    currency: '$',
    utcOffsetMinutes: -new Date().getTimezoneOffset(),
  }

  if (hasConfig) {
    try {
      config = { ...config, ...JSON.parse(await $.fs.read(`${dir}/config.json`)) }
    } catch {
      // a broken config keeps the defaults
    }
  } else if (hasScript) {
    try {
      const source = await $.fs.read(`${dir}/timelog.py`)
      const rate = /^RATE\s*=\s*([\d.]+)/m.exec(source)
      const cap = /^WEEKLY_CAP\s*=\s*([\d.]+)/m.exec(source)
      config = { ...config, rate: Number(rate?.[1] ?? 0), weeklyCap: Number(cap?.[1] ?? 0) }
    } catch {
      // no rate or cap shown
    }
  }

  ctx = { dir, config, hasScript }

  return ctx
}

async function readRunning($: EngineInterface, dir: string): Promise<Running | null> {
  try {
    if (!(await $.fs.exists(`${dir}/running.json`))) {
      return null
    }

    const raw = JSON.parse(await $.fs.read(`${dir}/running.json`))

    if (raw === null || typeof raw.start !== 'string') {
      return null
    }

    return {
      task: String(raw.task ?? ''),
      start: raw.start,
      billable: raw.billable !== false,
      idle: Number(raw.idle) || 0,
    }
  } catch {
    return null
  }
}

async function readLines($: EngineInterface, path: string) {
  if (!(await $.fs.exists(path))) {
    return []
  }

  const text = await $.fs.read(path)
  const rows: Record<string, unknown>[] = []

  for (const line of text.split(/\r?\n/)) {
    if (line.trim() !== '') {
      try {
        rows.push(JSON.parse(line))
      } catch {
        // a damaged line is skipped, never rewritten
      }
    }
  }

  return rows
}

async function loadLedger($: EngineInterface, dir: string, isForced: boolean) {
  const path = `${dir}/entries.jsonl`
  const stat = await $.fs.stat(path).catch(() => undefined)
  const stamp = stat === undefined ? 'none' : `${stat.mtimeMs}:${stat.size}`

  if (stamp === ledgerStamp && !isForced) {
    return ledger
  }

  ledgerStamp = stamp
  ledger = (await readLines($, path)) as Entry[]
  const paid = await readLines($, `${dir}/expenses.jsonl`).catch(() => [])
  expenses = paid.filter(x => !x.invoice).reduce((sum, x) => sum + (Number(x.amount) || 0), 0)

  return ledger
}

async function refresh($: EngineInterface, isForced = false) {
  if (ctx === null) {
    return
  }

  const { dir, config } = ctx
  const offset = config.utcOffsetMinutes
  const nowMs = await $.clock.now()
  const running = await readRunning($, dir)
  const entries = await loadLedger($, dir, isForced)
  const today = localIso(nowMs, offset).slice(0, 10)
  const weekday = (new Date(nowMs + offset * 60000).getUTCDay() + 6) % 7
  const mondayMs = nowMs - weekday * 86400000
  const week: Day[] = WEEKDAYS.map((label, i) => {
    const date = localIso(mondayMs + i * 86400000, offset).slice(0, 10)
    const hours = entries.filter(e => e.billable && e.date === date).reduce((sum, e) => sum + e.hours, 0)

    return { label, date, hours: round2(hours) }
  })
  const rows: Row[] = entries
    .filter(e => e.date === today)
    .map(e => ({
      from: e.start === null ? '' : e.start.slice(11, 16),
      to: e.end === null ? '' : e.end.slice(11, 16),
      hours: e.hours,
      task: e.task,
      billable: e.billable,
    }))
  const unbilled = entries.filter(e => e.billable && !e.invoice)
  const closed = [...entries].reverse().find(e => e.end !== null)
  const next: Snap = {
    client: config.client,
    rate: config.rate,
    cap: config.weeklyCap,
    currency: config.currency,
    offset,
    nowMs,
    running,
    startMs: running === null ? 0 : parseLocal(running.start, offset),
    todayBase: round2(week[weekday]?.hours ?? 0),
    weekBase: round2(week.reduce((sum, d) => sum + d.hours, 0)),
    today: rows,
    week,
    unbilledHours: round2(unbilled.reduce((sum, e) => sum + e.hours, 0)),
    unbilledFrom: unbilled[0]?.date ?? '',
    unbilledDays: new Set(unbilled.map(e => e.date)).size,
    expenses: round2(expenses),
    last: closed === undefined || closed.end === null ? null : { task: closed.task, end: closed.end },
  }
  const key = JSON.stringify({ ...next, nowMs: 0 })

  if (running === null && key === lastKey && !isForced) {
    return
  }

  lastKey = key
  await update($, snap, () => next)

  const v = view(next)
  const status =
    running === null
      ? `timer stopped, today ${v.today.toFixed(2)} h`
      : `${running.billable ? 'timer' : 'call'} ${hms(v.net).slice(0, -3)} ${clip(running.task, 28)}`

  if (status !== lastStatus) {
    lastStatus = status
    $.ui.status(status)
  }

  if (wasOverCap === false && v.isOver) {
    $.ui.toast(`${next.client}: this week is over the ${next.cap} h cap (${v.week.toFixed(1)} h)`)
  }

  wasOverCap = v.isOver
}

async function tick($: EngineInterface) {
  if (isBusy || isUnattended || ctx === null) {
    return
  }

  isBusy = true

  try {
    ticks += 1

    // every few seconds: has this session been switched on or off?
    if (ticks % 4 === 1) {
      const was = deskOn

      if ((await readOn($)) !== was) {
        lastKey = ''
        lastStatus = undefined
        $.ui.status(undefined)
        $.ui.invalidate('ui.render')
      }
    }

    if (!deskOn) {
      return
    }

    if (!hasTool) {
      await registerTool($)
    }

    const current = await read($, snap)

    // A stopped timer has nothing moving: look at the files every 3 seconds.
    if (current === null || current.running !== null || ticks % 3 === 0) {
      await refresh($)
    }
  } catch {
    // one failed read is retried on the next tick
  } finally {
    isBusy = false
  }
}

function startTicking($: EngineInterface) {
  if (ticker === undefined) {
    ticker = $.clock.every(1000, () => {
      void tick($)
    })
  }
}

// A short sound of the mod's own (fx/<name>.wav), when sounds are on.
function play($: EngineInterface, name: 'start' | 'done') {
  if (hasSounds) {
    void $.audio.play({ asset: `fx/${name}.wav` }).catch(() => undefined)
  }
}

async function startTimer($: EngineInterface, task: string, isCall: boolean) {
  if (ctx === null) {
    return 'No timelog in this project. Set one up with /timer setup <rate> <weekly cap>.'
  }

  if (task.trim() === '') {
    return 'Give the task a short name, e.g. start "Publish button end to end".'
  }

  const { dir, config } = ctx
  const running = await readRunning($, dir)

  if (running !== null) {
    const hours = ((await $.clock.now()) - parseLocal(running.start, config.utcOffsetMinutes)) / 3600000

    return `Already running: "${running.task}" (${hours.toFixed(2)} h so far). Stop it first, or use switch.`
  }

  const start = localIso(await $.clock.now(), config.utcOffsetMinutes)
  await $.fs.write(
    `${dir}/running.json`,
    JSON.stringify({ task: task.trim(), start, billable: !isCall, idle: 0 }),
  )
  await refresh($, true)
  play($, 'start')

  return `Started ${start.slice(11, 16)} [${isCall ? 'call, not billable' : 'billable'}] ${task.trim()}`
}

async function stopTimer($: EngineInterface, note: string, hours: number | undefined) {
  if (ctx === null) {
    return 'No timelog in this project.'
  }

  const { dir, config, hasScript } = ctx
  const running = await readRunning($, dir)

  if (running === null) {
    return 'No timer running.'
  }

  // The project's own script closes the entry where there is one: it also
  // removes running.json and rewrites the Excel report.
  if (hasScript) {
    const argv = ['python', 'timelog.py', 'stop', '--note', note]

    if (hours !== undefined) {
      argv.push('--hours', String(hours))
    }

    try {
      const ran = await $.process.run(argv, { cwd: dir, timeoutMs: 90000 })
      await refresh($, true)
      play($, 'done')

      return (ran.stdout + ran.stderr).trim().slice(0, 600) || `timelog.py exited ${ran.exitCode}`
    } catch {
      return `The mod could not run timelog.py here. Run it in the terminal: python "${dir}/timelog.py" stop`
    }
  }

  const nowMs = await $.clock.now()
  const measured = (nowMs - parseLocal(running.start, config.utcOffsetMinutes)) / 3600000

  if (hours === undefined && measured > MAX_SANE_HOURS) {
    return `That timer has been running ${measured.toFixed(1)} h, which looks like it was left open. Stop again with the real hours.`
  }

  const entries = await loadLedger($, dir, true)
  const entry: Entry = {
    id: entries.reduce((max, e) => Math.max(max, e.id), 0) + 1,
    date: running.start.slice(0, 10),
    start: running.start,
    end: localIso(nowMs, config.utcOffsetMinutes),
    hours: round2(hours ?? measured),
    task: running.task,
    note,
    evidence: '',
    billable: running.billable,
    invoice: null,
  }
  const path = `${dir}/entries.jsonl`
  const before = (await $.fs.exists(path)) ? await $.fs.read(path) : ''
  const joint = before === '' || before.endsWith('\n') ? '' : '\n'
  await $.fs.write(path, `${before}${joint}${JSON.stringify(entry)}\n`)
  await $.fs.write(`${dir}/running.json`, '{}')
  await refresh($, true)
  play($, 'done')
  const current = await read($, snap)
  const total = current === null ? '' : ` Unbilled so far: ${current.unbilledHours.toFixed(2)} h${money(current.unbilledHours, current)}.`

  return `Stopped. ${entry.hours.toFixed(2)} h  ${entry.task}${entry.billable ? '' : '  [call, not billable]'}.${total}`
}

async function act(
  $: EngineInterface,
  action: string,
  task: string,
  isCall: boolean,
  note: string,
  hours: number | undefined,
) {
  if (action === 'start') {
    return startTimer($, task, isCall)
  }

  if (action === 'stop') {
    return stopTimer($, note, hours)
  }

  if (action === 'switch') {
    const stopped = await stopTimer($, note, hours)
    const started = await startTimer($, task, isCall)

    return `${stopped}\n${started}`
  }

  await refresh($, true)
  const current = await read($, snap)

  return current === null ? 'No timelog in this project.' : summary(current)
}

async function setUp($: EngineInterface, rate: number, cap: number, client: string) {
  const root = (await $.session.root()).replace(/[\\/]+$/, '')
  const dir = `${root}/timelog`
  const config: Config = {
    client: client || (root.split(/[\\/]/).pop() ?? 'Client'),
    rate,
    weeklyCap: cap,
    currency: '$',
    utcOffsetMinutes: -new Date().getTimezoneOffset(),
  }
  await $.fs.write(`${dir}/config.json`, `${JSON.stringify(config, null, 2)}\n`)

  if (!(await $.fs.exists(`${dir}/entries.jsonl`))) {
    await $.fs.write(`${dir}/entries.jsonl`, '')
  }

  await activate($)

  return `Timer set up for ${config.client} in ${dir}: ${config.currency}${rate}/h, cap ${cap} h a week.`
}

async function registerTool($: EngineInterface) {
  hasTool = true
  // the rules of use travel with the tool: the model reads them wherever it reads the tool
  const guide = await rules($).catch(() => null)
  await $.tool.register({
    name: 'timer',
    description: `The billable-hours timer of this project (ledger in timelog/entries.jsonl). start begins timing a task, stop closes the entry, switch closes it and starts another, status reports the running timer with today, week and unbilled totals.${guide === null ? '' : `\n\n${guide}`}`,
    inputSchema: {
      type: 'object',
      properties: {
        action: { type: 'string', enum: ['start', 'stop', 'switch', 'status'] },
        task: { type: 'string', description: 'Short task name for start and switch' },
        call: { type: 'boolean', description: 'A client call: recorded, never billed' },
        note: { type: 'string', description: 'What got done, for stop and switch' },
        hours: { type: 'number', description: 'Override the measured time on stop' },
      },
      required: ['action'],
    },
  })
}

async function activate($: EngineInterface) {
  const found = await locate($)

  if (found === null) {
    return false
  }

  if (await readOn($)) {
    await registerTool($)
    await refresh($, true)
  }

  // the ticker runs either way: it is what notices /desk on
  startTicking($)

  return true
}

async function rules($: EngineInterface) {
  if (ctx === null) {
    return null
  }

  const own = `${ctx.dir}/rules.md`
  const path = (await $.fs.exists(own)) ? own : `${$.plugin.root}/rules.md`
  const text = await $.fs.read(path).catch(() => '')
  const { client, rate, weeklyCap, currency } = ctx.config
  const terms = `Client: ${client}. Rate: ${rate > 0 ? `${currency}${rate}/h` : 'not set'}. Weekly cap: ${weeklyCap > 0 ? `${weeklyCap} h` : 'none'}.`

  return text === '' ? null : `${terms}\n\n${text}`
}

// Whether the table is the dropdown to draw: open, and opened after any of
// the desk's.
async function isShown($: EngineInterface) {
  const theirs = await $.state.get({ plugin: 'deskbar', key: 'panelAt' }).catch(() => undefined)

  const mine = await read($, openAt)

  // Their stamp is negative for a close: either way, anything they did after
  // this table was opened leaves it shut.
  return (await read($, isOpen)) && mine > 0 && mine >= Math.abs(Number(theirs?.value) || 0)
}

async function pressToggle($: EngineInterface) {
  const isOpening = !(await isShown($))
  await update($, isOpen, () => isOpening)
  // later than anything the desk's dropdowns were stamped with, even in the same instant
  const theirs = Math.abs(Number((await $.state.get({ plugin: 'deskbar', key: 'panelAt' }).catch(() => undefined))?.value) || 0)
  const stamp = Math.max(await $.clock.now(), theirs + 1)
  await update($, openAt, () => (isOpening ? stamp : -stamp))
}

async function pressStop($: EngineInterface) {
  $.ui.toast(await stopTimer($, '', undefined))
}

async function pressResume($: EngineInterface) {
  const current = await read($, snap)

  if (current !== null && current.last !== null) {
    $.ui.toast(await startTimer($, current.last.task, false))
  }
}

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec']

// "2026-10-02" as "Fri 02 Oct"
function dayName(date: string) {
  const at = new Date(`${date.slice(0, 10)}T00:00:00Z`)

  return `${WEEKDAYS[(at.getUTCDay() + 6) % 7]} ${date.slice(8, 10)} ${MONTHS[at.getUTCMonth()]}`
}

// Table colours, for the dark theme the app runs in.
const EDGE = '#2f4149'
const HEAD_BG = '#22333b'
const STRIPE_BG = '#172229'
const TOTAL_BG = '#1b3a31'
const MUTED = '#8fa3aa'

type Look = { color?: string; bold?: boolean; dimColor?: boolean }
type Line = { cells: string[]; look?: Look; bg?: string; bar?: number }

// One card: a rounded frame, a tinted header row, striped rows, a tinted
// total row. Numbers sit right-aligned in fixed columns; the last column fills.
function card(Box: any, Text: any, title: string, head: string[], lines: Line[], widths: number[]) {
  const cells = (line: Line, isHead: boolean) =>
    line.cells.map((text, c) => {
      const isNumber = c === 1 || c === 2
      const look = isHead ? { bold: true, color: MUTED } : (line.look ?? {})

      return (
        <Box
          width={widths[c]}
          flexGrow={widths[c] === undefined ? 1 : 0}
          justifyContent={isNumber ? 'flex-end' : 'flex-start'}
          paddingRight={isNumber ? 2 : 0}
        >
          {line.bar !== undefined && c === line.cells.length - 1 ? (
            <Text color={GREEN}>{line.bar === 0 ? ' ' : '▇'.repeat(line.bar)}</Text>
          ) : (
            <Text {...look}>{text === '' ? ' ' : text}</Text>
          )}
        </Box>
      )
    })

  return (
    <Box flexDirection="column" flexGrow={1} borderStyle="round" borderColor={EDGE}>
      <Box paddingX={1}>
        <Text bold>{title}</Text>
      </Box>
      <Box paddingX={1} backgroundColor={HEAD_BG}>
        {cells({ cells: head }, true)}
      </Box>
      {lines.map((line, r) => (
        <Box paddingX={1} backgroundColor={line.bg ?? (r % 2 === 1 ? STRIPE_BG : undefined)}>
          {cells(line, false)}
        </Box>
      ))}
    </Box>
  )
}

// `rows` is how many table rows each card may show under its title and header
// (the band has few; the side panel has plenty).
function details(Box: any, Text: any, s: Snap, rows = 20, isNarrow = false, Client?: any, Svg?: any) {
  const v = view(s)
  const run = s.running
  const top = Math.max(...s.week.map(d => d.hours), v.today, 0.01)
  const today = localIso(s.nowMs, s.offset).slice(0, 10)
  const cost = (hours: number) => (s.rate > 0 ? `${s.currency}${(hours * s.rate).toFixed(2)}` : '')

  const todayLines: Line[] = s.today.slice(-Math.max(1, Math.min(8, rows - (s.running === null ? 1 : 2)))).map(e => ({
    cells: [e.from === '' ? 'added' : `${e.from} - ${e.to}`, e.hours.toFixed(2), e.billable ? cost(e.hours) : 'call', clip(e.task, 40)],
    look: e.billable ? {} : { dimColor: true },
  }))

  if (run !== null) {
    todayLines.push({
      cells: [`${run.start.slice(11, 16)} - now`, (v.net / 3600).toFixed(2), run.billable ? cost(v.net / 3600) : 'call', clip(run.task, 40)],
      look: { color: v.color, bold: true },
    })
  }

  if (todayLines.length === 0) {
    todayLines.push({ cells: ['nothing logged yet', '', '', ''], look: { dimColor: true } })
  }

  todayLines.push({ cells: ['Total', v.today.toFixed(2), cost(v.today), ''], look: { bold: true }, bg: TOTAL_BG })

  const weekLines: Line[] = s.week
    // when rows are short, only the days that have hours, the latest kept
    .filter(day => rows >= 8 || day.hours > 0 || day.date === today)
    .slice(-Math.max(1, rows - 1))
    .map(day => {
    const hours = day.hours + (day.date === today ? v.live : 0)
    const isToday = day.date === today

    return {
      cells: [dayName(day.date), hours === 0 ? '-' : hours.toFixed(2), hours === 0 ? '' : cost(hours), ''],
      look: hours === 0 ? { dimColor: true } : isToday ? { bold: true, color: GREEN } : {},
      bar: hours > 0 ? Math.max(1, Math.round((hours / top) * 12)) : 0,
    }
  })
  const left = s.cap > 0 ? (v.isOver ? `over the ${s.cap} h cap` : `${Math.max(0, s.cap - v.week).toFixed(2)} h left of ${s.cap}`) : ''
  weekLines.push({
    cells: ['Total', v.week.toFixed(2), cost(v.week), left],
    look: { bold: true, color: v.isOver ? AMBER : undefined },
    bg: TOTAL_BG,
  })

  const idle = run !== null && run.idle > 0 ? `, idle ${hms(run.idle)} not counted` : ''
  const about =
    run === null
      ? s.last === null
        ? s.client
        : `${s.client}  ·  last entry ended ${s.last.end.slice(11, 16)}, ${dayName(s.last.end)}`
      : `${s.client}  ·  started ${run.start.slice(11, 16)}${idle}`
  const unbilled = s.unbilledHours + v.live

  return (
    <Box flexDirection="column" width="100%" marginTop={1}>
      <Box width="100%" justifyContent="space-between" paddingX={1}>
        <Box alignItems="center">
          <Text color={MUTED}>{about}</Text>
          {/* the week against its cap: a bar that glides, and sweeps while the timer runs */}
          {(Client !== undefined || Svg !== undefined) && s.cap > 0 && <Text color={MUTED}>{'   week '}</Text>}
          {Client !== undefined && s.cap > 0 && (
            <Client
              key="week-meter"
              module="./meter.tsx"
              props={{ value: v.week / s.cap, active: run !== null && run.billable, tint: v.isOver ? AMBER : GREEN }}
              width={isNarrow ? 8 : 14}
              height={1}
            />
          )}
          {Client === undefined && Svg !== undefined && s.cap > 0 && (
            <Svg
              source={meterSvg(v.week / s.cap, run !== null && run.billable, v.isOver ? AMBER : GREEN, isNarrow ? 56 : 98)}
              alt="this week against the cap"
              width={isNarrow ? 56 : 98}
              height={10}
              isInteractive
            />
          )}
        </Box>
        <Box>
          <Text color={MUTED}>Unbilled </Text>
          <Text bold>
            {unbilled.toFixed(2)} h{money(unbilled, s)}
          </Text>
          <Text color={MUTED}>
            {s.unbilledFrom === '' ? '' : `  since ${dayName(s.unbilledFrom)}`}
            {s.expenses > 0 ? `  ·  expenses ${s.currency}${s.expenses.toFixed(2)}` : ''}
          </Text>
        </Box>
      </Box>
      {isNarrow ? (
        // too narrow for two cards side by side: today's, and the week as a line
        <Box flexDirection="column" width="100%">
          {card(Box, Text, `Today, ${dayName(today)}`, ['Time', 'Hours', 'Amount', 'Task'], todayLines.slice(-Math.max(2, rows - 1)), [14, 7, 9])}
          <Box paddingX={1}>
            <Text bold color={v.isOver ? AMBER : GREEN}>
              This week {v.week.toFixed(2)} h{cost(v.week) === '' ? '' : `  ${cost(v.week)}`}
            </Text>
            <Text color={MUTED}>{left === '' ? '' : `  ${left}`}</Text>
          </Box>
        </Box>
      ) : (
        <Box width="100%" columnGap={1}>
          {card(Box, Text, `Today, ${dayName(today)}`, ['Time', 'Hours', 'Amount', 'Task'], todayLines, [15, 9, 11])}
          {card(Box, Text, 'This week', ['Day', 'Hours', 'Amount', left === '' ? '' : 'Share'], weekLines, [13, 9, 11])}
        </Box>
      )}
    </Box>
  )
}

async function openPanel($: EngineInterface) {
  const wide = await read($, isOpen)
  await $.ui.open({ id: PANE, title: 'Timer', columns: wide ? WIDE : SLIM })
}

async function setWide($: EngineInterface, wide: boolean) {
  await update($, isOpen, () => wide)
  await openPanel($)
}

// Leaves a note of the band's last draw where it can be read from outside
// the app: the hook ran and returned a tree, or it threw and why.
let traced = ''

async function trace($: EngineInterface, note: string) {
  if (note === traced) {
    return
  }

  traced = note
  await $.fs.write(`${await dataRoot($)}/trace-timer.txt`, `${new Date().toISOString()} ${note}\n`).catch(() => undefined)
}

async function band($: EngineInterface, e: any, below: any): Promise<any> {
  {
    const s = await read($, snap)

    if (isUnattended || !deskOn || e.props.hasSurvey || s === null || (await read($, isHidden))) {
      return below
    }

    const table = $.ui.resolve(e)
    const { Box, Button, Text } = table
    // The terminal cannot paint an SVG: it keeps a dot.
    const Svg = e.surface === 'terminal' ? undefined : (table as { Svg?: any }).Svg
    // surface modules run in the terminal; elsewhere the motion is an SVG that animates by itself
    const Client = e.surface === 'terminal' || hasDesktopModules ? (table as { Client?: any }).Client : undefined
    const v = view(s)
    const run = s.running
    const open = await isShown($)
    const clock = run === null ? `${v.today.toFixed(2)}h` : hms(v.net)
    // The stopwatch's hand points at the running second, so it ticks round
    // the dial once a minute as the band redraws; at rest it points up.
    const angle = run === null ? 0 : (Math.floor(v.net) % 60) * 6
    const stopwatch = `<svg xmlns="http://www.w3.org/2000/svg" width="20" height="20" viewBox="0 0 24 24"><path d="M9.5 2h5M12 2v3M18.5 6.5l1.5-1.5" fill="none" stroke="${v.color}" stroke-width="2.2" stroke-linecap="round"/><circle cx="12" cy="14" r="8.5" fill="${v.color}"/><circle cx="12" cy="14" r="6.2" fill="#10181c"/><path d="M12 14V9.4" fill="none" stroke="#ffffff" stroke-width="2" stroke-linecap="round" transform="rotate(${angle} 12 14)"/><circle cx="12" cy="14" r="1.3" fill="#ffffff"/></svg>`
    // Start is a green tile with a play mark, stop a red one with a square.
    const tile = (fill: string, mark: string) =>
      `<svg xmlns="http://www.w3.org/2000/svg" width="20" height="20" viewBox="0 0 24 24"><rect x="2" y="2" width="20" height="20" rx="6" fill="${fill}"/>${mark}</svg>`
    const playTile = tile('#1baf7a', '<path d="M9.5 7.2v9.6a.6.6 0 0 0 .92.5l7.2-4.8a.6.6 0 0 0 0-1l-7.2-4.8a.6.6 0 0 0-.92.5z" fill="#ffffff"/>')
    const stopTile = tile('#e34948', '<rect x="7.5" y="7.5" width="9" height="9" rx="1.8" fill="#ffffff"/>')
    // A chip as the desk row draws its own: the icon painted over the left of
    // a button, whose label (the part that takes the click) follows it.
    const iconChip = (key: string, source: string, alt: string, label: string, onPress: () => unknown) => (
      <Box position="relative" alignItems="center">
        <Button key={key} label={`   ${label}`} onPress={onPress} />
        <Box position="absolute" top={0} left={1} height="100%" alignItems="center">
          <Svg source={source} alt={alt} width={20} height={20} />
        </Box>
      </Box>
    )

    // The chip at the right end of the band: the stopwatch with the arrow that
    // opens the table, then start (green) or stop (red) with the clock beside
    // it. Nothing appears on hover; the task is in the table the arrow opens.
    const chip = (
      <Box key="timer-chip" alignItems="center">
        {Svg === undefined ? (
          <Box alignItems="center">
            <Text bold color={v.color}>
              ● {clock}{' '}
            </Text>
            {run !== null && <Button key="stop" label="■ Stop" onPress={() => pressStop($)} />}
            {run === null && s.last !== null && <Button key="resume" label="▶ Start" onPress={() => pressResume($)} />}
            <Text> </Text>
            <Button key="toggle" label={open ? '▾' : '▸'} onPress={() => pressToggle($)} />
          </Box>
        ) : (
          <Box alignItems="center">
            {/* a breathing dot while the timer records */}
            {run !== null && (
              <Box marginRight={1} alignItems="center">
                {Client !== undefined ? (
                  <Client key="timer-pulse" module="./pulse.tsx" props={{ tint: v.color }} width={1} height={1} />
                ) : (
                  <Svg source={pulseSvg(v.color, false)} alt="recording" width={12} height={12} isInteractive />
                )}
              </Box>
            )}
            {iconChip('toggle', stopwatch, 'timer', open ? '▾' : '▸', () => pressToggle($))}
            <Box marginLeft={1} alignItems="center">
              {run !== null
                ? iconChip('stop', stopTile, 'stop', clock, () => pressStop($))
                : s.last !== null
                  ? iconChip('resume', playTile, 'start', clock, () => pressResume($))
                  : <Text dimColor>{clock}</Text>}
            </Box>
          </Box>
        )}
      </Box>
    )
    // What sits beneath (the desk row): a row, or a column of its row and a
    // dropdown. The chip joins that row at the right; the rest stays below.
    const isColumn = below.type !== 'engine' && (below as { props?: { flexDirection?: string } }).props?.flexDirection === 'column'
    const kids = isColumn ? ((below as { children?: unknown[] }).children ?? []) : []
    const left = below.type === 'engine' ? undefined : isColumn ? kids[0] : below
    const rest = kids.slice(1)
    const top =
      left === undefined ? (
        <Box width="100%" justifyContent="flex-end">
          {chip}
        </Box>
      ) : (
        <Box width="100%" justifyContent="space-between" alignItems="center">
          {left}
          {chip}
        </Box>
      )

    if (!open && rest.length === 0) {
      return top
    }

    return (
      <Box flexDirection="column" width="100%">
        {top}
        {rest}
        {open && details(Box, Text, s, Math.max(3, (Number(e.props.maxRows) || 12) - 8), (Number(e.props.bodyColumns) || 96) < 84, Client, Svg)}
      </Box>
    )
  }
}

export const registerTimer: Register = on => {
  // The desk half of this plugin has the plain session.start hook, and an
  // event takes one hook without a matcher per plugin: this one states both
  // values of a flag instead, which comes to the same thing.
  for (const flag of [true, false]) {
    on('session.start', { isInteractive: flag }, async ($, e, next) => {
      const result = await next(e)
      await $.command.register({
        name: 'timer',
        description: 'Work timer: start <task>, call <task>, stop [note], switch <task>, status, panel, setup <rate> <cap> [client]',
        argumentHint: 'start <task> | stop [note] | status | panel',
      })

      const built = await $.session.version().catch(() => ({ base: undefined, version: '' }))
      const found = /(\d+)\.(\d+)\.(\d+)/.exec(built.base ?? built.version ?? '')
      hasDesktopModules =
        found !== null &&
        (Number(found[1]) > 2 || (Number(found[1]) === 2 && (Number(found[2]) > 1 || (Number(found[2]) === 1 && Number(found[3]) >= 287))))

      if (!(await checkUnattended($))) {
        await activate($).catch(() => false)
      }

      return result
    })
  }

  on('tool.call', { tool: TOOL }, async ($, e) => {
    const text = await act(
      $,
      String(e.action ?? 'status'),
      String(e.task ?? ''),
      e.call === true,
      String(e.note ?? ''),
      typeof e.hours === 'number' ? e.hours : undefined,
    )

    return { result: text }
  })

  on('command.run', { command: 'timer' }, async ($, e) => {
    const [verb = 'status', ...rest] = e.args.trim().split(/\s+/)
    const tail = rest.join(' ')

    if (verb === 'setup') {
      return { text: await setUp($, Number(rest[0]) || 0, Number(rest[1]) || 0, rest.slice(2).join(' ')) }
    }

    if (verb === 'more' || verb === 'less') {
      await update($, isOpen, () => verb === 'more')
      await update($, openAt, await $.clock.now().then(now => () => (verb === 'more' ? now : -now)))

      return { text: verb === 'more' ? 'Timer expanded.' : 'Timer collapsed.' }
    }

    if (verb === 'panel') {
      await openPanel($)

      return { text: 'Timer panel opened.' }
    }

    if (verb === 'hide' || verb === 'show') {
      await update($, isHidden, () => verb === 'hide')

      return { text: verb === 'hide' ? 'Timer bar above the prompt hidden. /timer panel opens the side panel.' : 'Timer bar shown above the prompt.' }
    }

    if (verb === 'start' || verb === 'call') {
      const current = await read($, snap)
      const task = tail !== '' ? tail : (current?.last?.task ?? 'Work session')
      return { text: await startTimer($, task, verb === 'call') }
    }

    if (verb === 'stop') {
      const hours = /^--hours\s+([\d.]+)\s*(.*)$/.exec(tail)

      return {
        text: await stopTimer($, hours === null ? tail : (hours[2] ?? ''), hours === null ? undefined : Number(hours[1])),
      }
    }

    if (verb === 'switch') {
      return { text: await act($, 'switch', tail, false, '', undefined) }
    }

    return { text: await act($, 'status', '', false, '', undefined) }
  })

  on('ui.render', { component: 'Pane', requestId: PANE }, async ($, e) => {
    const { Box, Button, Text } = $.ui.resolve(e)
    const s = await read($, snap)

    if (s === null) {
      return <Text dimColor>No timelog in this project. /timer setup starts one.</Text>
    }

    const v = view(s)
    const run = s.running
    const wide = await read($, isOpen)

    // Slim: a narrow strip on the edge of the chat. Open: the whole breakdown.
    if (!wide) {
      return (
        <Box flexDirection="column">
          <Text bold color={v.color}>
            ● {run === null ? 'Off' : run.billable ? 'On' : 'Call'}
          </Text>
          <Text bold>{hms(v.net)}</Text>
          <Text dimColor>{v.today.toFixed(2)}h today</Text>
          <Text dimColor>
            {v.week.toFixed(1)}
            {s.cap > 0 ? `/${s.cap}` : ''}h week
          </Text>
          {run !== null && <Button key="pane-stop" label="Stop" onPress={() => pressStop($)} />}
          <Button key="expand" label="Open" onPress={() => setWide($, true)} />
        </Box>
      )
    }

    return (
      <Box flexDirection="column">
        <Text bold color={v.color}>
          ● {v.pill}
        </Text>
        <Text bold>{hms(v.net)}</Text>
        <Text>{run === null ? 'No timer running' : run.task}</Text>
        <Box>
          {run !== null && <Button key="pane-stop" label="Stop" onPress={() => pressStop($)} />}
          {run === null && s.last !== null && <Button key="pane-resume" label="Resume last" onPress={() => pressResume($)} />}
          <Text> </Text>
          <Button key="collapse" label="Collapse" onPress={() => setWide($, false)} />
        </Box>
        {details(Box, Text, s)}
      </Box>
    )
  })

  on('ui.render', { component: 'AbovePrompt' }, async ($, e, next) => {
    const below = await next(e)

    try {
      const drawn = await band($, e, below)
      await trace($, `drew ${JSON.stringify(drawn).length} chars over ${below.type}, surface ${e.surface}, survey ${e.props.hasSurvey}`)

      return drawn
    } catch (error) {
      await trace($, `threw ${String(error)}`)

      return below
    }
  })
}

