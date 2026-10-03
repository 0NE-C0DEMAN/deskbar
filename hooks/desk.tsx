import { atom, read, update } from 'claude-code'
import type { EngineInterface, Register, Timer } from 'claude-code'

import { meterSvg, pulseSvg } from './motion'

import type { Desk, Inbox, Meeting, Music, Note, Reading, Task, Todo, TodoSession } from '../types'

const readings = atom({ plugin: 'deskbar', key: 'readings' } as const, [] as Reading[])
const hidden = atom({ plugin: 'deskbar', key: 'isHidden' } as const, false)
const desk = atom({ plugin: 'deskbar', key: 'desk' } as const, {
  inbox: null,
  events: [],
  calendarError: '',
  nowMs: 0,
} as Desk)
// Which dropdown is open under the row: '', 'mail' or 'calendar'.
const panel = atom({ plugin: 'deskbar', key: 'panel' } as const, '')
// When that dropdown was opened (0 while none is). The work timer keeps the
// same for its table, and each mod reads the other's: only the one opened
// last is drawn, so one dropdown shows at a time across both.
const panelAt = atom({ plugin: 'deskbar', key: 'panelAt' } as const, 0)
// Counts changes of the settings, so a drawing that reads it is drawn again.
const settingsAt = atom({ plugin: 'deskbar', key: 'settingsAt' } as const, 0)
// What is playing on this machine and the speaker's spectrum, as the music
// helper last wrote them; null until the music dropdown has been opened.
const music = atom({ plugin: 'deskbar', key: 'music' } as const, null as Music | null)
// Notes are one list for every session, kept in the plugin's own store.
const notes = atom({ plugin: 'deskbar', key: 'notes' } as const, [] as Note[])
// The task lists Claude keeps per session (~/.claude/tasks/<session>/<n>.json),
// read as they are: no model call. `open` is this session's count, -1 for none.
const todo = atom({ plugin: 'deskbar', key: 'todo' } as const, {
  sessions: [],
  selected: '',
  tasks: [],
  open: -1,
  isLoading: false,
  query: '',
  pageOpen: 0,
  pageDone: 0,
} as Todo)

// Gmail and Calendar are read through the app's own connectors, every few
// minutes; the minute tick only moves the meeting countdown.
// Gmail's own Primary tab, newest first (a bare `category:primary` search is
// what the tab shows; promotions, social, updates and forums are not in it).
const MAIL_QUERY = 'category:primary in:inbox'
const MAIL_ROWS = 10
// A sender that is a program, not a person: listed after people in the table.
const MACHINE =
  /(^|[._-])(no-?reply|do-?not-?reply|notifications?|info|team|services?|support|alerts?|billing|accounts?|admin|bounce|statements?|security)([._-]|@)|@([\w-]+\.)*(mail|custcomm|customer)\./i
// Build-robot mail nobody reads here: GitHub Actions run results.
const NOISE = /^\[[^\]]+\] (Run (failed|cancelled|succeeded|skipped)|PR run failed)|workflow run/i
const POLL_MS = 3 * 60 * 1000
const AMBER = '#eda100'
const RED = '#e34948'
const BLUE = '#2a78d6'
const GREEN = '#1baf7a'
const EDGE = '#2f4149'
const HEAD_BG = '#22333b'
const STRIPE_BG = '#172229'
const MUTED = '#8fa3aa'
const ICON = '#c3d0d5'
const DAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat']
const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec']

let isPolling = false
// the meetings (by start time) the ten-minute chime has already rung for
let chimed: number[] = []
let hasTimers = false

const BARS = ['▁', '▂', '▃', '▄', '▅', '▆', '▇', '█']

const weather = (percent: number) => {
  if (percent < 25) return 'Clear'
  if (percent < 50) return 'Cloudy'
  if (percent < 70) return 'Showers'
  if (percent < 85) return 'Storm'
  return 'Hurricane'
}

const tone = (percent: number) => {
  if (percent < 25) return '#1baf7a'
  if (percent < 50) return '#2a78d6'
  if (percent < 70) return '#eda100'
  if (percent < 85) return '#eb6834'
  return '#e34948'
}

const icon = (percent: number) => {
  if (percent < 25) return '☀️'
  if (percent < 50) return '⛅'
  if (percent < 70) return '🌧️'
  if (percent < 85) return '⛈️'
  return '🌀'
}

// Line icons, drawn as SVG where the surface has the element (the desktop app);
// the terminal gets the emoji instead. 24-unit grid, 2-unit round strokes.
const ICONS: Record<string, string> = {
  clear:
    '<circle cx="12" cy="12" r="4"/><path d="M12 2v2M12 20v2M4.93 4.93l1.41 1.41M17.66 17.66l1.41 1.41M2 12h2M20 12h2M4.93 19.07l1.41-1.41M17.66 6.34l1.41-1.41"/>',
  cloudy: '<path d="M17.5 19a4.5 4.5 0 1 0-1.2-8.84A6 6 0 1 0 6 16.5V17a2 2 0 0 0 2 2z"/>',
  showers:
    '<path d="M20 16.2A4.5 4.5 0 0 0 17.5 8h-1.8A7 7 0 1 0 4 14.9"/><path d="M16 14v6M8 14v6M12 16v6"/>',
  storm: '<path d="M19 16.9A5 5 0 0 0 18 7h-1.26a8 8 0 1 0-11.62 9"/><path d="M13 11l-4 6h6l-4 6"/>',
  hurricane: '<path d="M9.59 4.59A2 2 0 1 1 11 8H2M12.59 19.41A2 2 0 1 0 14 16H2M17.73 7.73A2.5 2.5 0 1 1 19.5 12H2"/>',
  mail: '<rect x="2" y="4" width="20" height="16" rx="2"/><path d="M22 7l-10 6L2 7"/>',
  calendar: '<rect x="3" y="4" width="18" height="18" rx="2"/><path d="M16 2v4M8 2v4M3 10h18"/>',
  tasks: '<path d="M9 11l3 3L22 4"/><path d="M21 12v7a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h11"/>',
  notes: '<path d="M12 20h9"/><path d="M16.5 3.5a2.12 2.12 0 0 1 3 3L7 19l-4 1 1-4z"/>',
  search: '<circle cx="11" cy="11" r="7"/><path d="M21 21l-4.3-4.3"/>',
}

// Full-colour icons on the same 24-unit grid, each element carrying its own
// fill: a four-colour mail envelope, a calendar page with today's date on it,
// a green tick box, a yellow sticky note, and the weather in colour.
function colorIcon(name: string, day: number) {
  const cloud = (fill: string) => `<path d="M17.5 19a4.5 4.5 0 1 0-1.2-8.84A6 6 0 1 0 6 16.5V17a2 2 0 0 0 2 2z" fill="${fill}"/>`
  const art: Record<string, string> = {
    mail:
      '<rect x="2" y="4" width="20" height="16" rx="2" fill="#ffffff"/>' +
      '<path d="M2 6v12a2 2 0 0 0 2 2h2V9.5z" fill="#4285F4"/>' +
      '<path d="M22 6v12a2 2 0 0 1-2 2h-2V9.5z" fill="#34A853"/>' +
      '<path d="M2 6a2 2 0 0 1 2-2h.6L6 5.2v4.3z" fill="#C5221F"/>' +
      '<path d="M22 6a2 2 0 0 0-2-2h-.6L18 5.2v4.3z" fill="#FBBC04"/>' +
      '<path d="M6 9.5V5.2l6 4.6 6-4.6v4.3l-6 4.6z" fill="#EA4335"/>',
    calendar:
      '<rect x="3" y="3" width="18" height="18" rx="3" fill="#ffffff"/>' +
      '<path d="M3 6a3 3 0 0 1 3-3h12a3 3 0 0 1 3 3v3H3z" fill="#4285F4"/>' +
      '<circle cx="8" cy="6" r="1" fill="#ffffff"/><circle cx="16" cy="6" r="1" fill="#ffffff"/>' +
      `<text x="12" y="18.4" text-anchor="middle" font-family="Segoe UI, Arial, sans-serif" font-size="9" font-weight="700" fill="#4285F4">${day}</text>`,
    tasks:
      '<rect x="3" y="3" width="18" height="18" rx="5" fill="#1baf7a"/>' +
      '<path d="M7.5 12.5l3 3 6-7" fill="none" stroke="#ffffff" stroke-width="2.6" stroke-linecap="round" stroke-linejoin="round"/>',
    music:
      '<circle cx="12" cy="12" r="10" fill="#FF0033"/>' +
      '<circle cx="12" cy="12" r="5.6" fill="none" stroke="#ffffff" stroke-width="1.3"/>' +
      '<path d="M10.3 9.2v5.6l4.8-2.8z" fill="#ffffff"/>',
    notes:
      '<path d="M4 3h16a1 1 0 0 1 1 1v11l-6 6H4a1 1 0 0 1-1-1V4a1 1 0 0 1 1-1z" fill="#FFD54A"/>' +
      '<path d="M15 21v-5a1 1 0 0 1 1-1h5z" fill="#E0A800"/>' +
      '<path d="M7 8h10M7 12h7" fill="none" stroke="#8a6d00" stroke-width="1.7" stroke-linecap="round"/>',
    clear:
      '<circle cx="12" cy="12" r="5" fill="#FDB813"/>' +
      '<path d="M12 2v2.5M12 19.5V22M4.2 4.2l1.8 1.8M18 18l1.8 1.8M2 12h2.5M19.5 12H22M4.2 19.8L6 18M18 6l1.8-1.8" fill="none" stroke="#FDB813" stroke-width="2" stroke-linecap="round"/>',
    cloudy: `<circle cx="8.5" cy="8.5" r="4.5" fill="#FDB813"/>${cloud('#dfe8ec')}`,
    showers: `${cloud('#b9c6cd').replace('M17.5 19', 'M17.5 16').replace('6 16.5V17a2 2 0 0 0 2 2z', '6 13.5V14a2 2 0 0 0 2 2z').replace('-8.84', '-8.84')}<path d="M9 18.5l-1 3M13 18.5l-1 3M17 18.5l-1 3" fill="none" stroke="#4aa3ff" stroke-width="2" stroke-linecap="round"/>`,
    storm: `${cloud('#8a98a3').replace('M17.5 19', 'M17.5 16').replace('6 16.5V17a2 2 0 0 0 2 2z', '6 13.5V14a2 2 0 0 0 2 2z')}<path d="M13 13l-4 5h3l-1.5 4.5 5-6h-3.2z" fill="#FFD54A"/>`,
    hurricane:
      '<path d="M9.59 4.59A2 2 0 1 1 11 8H2M12.59 19.41A2 2 0 1 0 14 16H2M17.73 7.73A2.5 2.5 0 1 1 19.5 12H2" fill="none" stroke="#e34948" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"/>',
  }

  return art[name] ?? ''
}

const EMOJI: Record<string, string> = { mail: '📧', calendar: '📅', tasks: '✅', notes: '📝', music: '🎵' }

const MAIL_OPEN =
  '<path d="M21.2 8.4c.5.38.8.97.8 1.6v10a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V10a2 2 0 0 1 .8-1.6l8-6a2 2 0 0 1 2.4 0z"/><path d="M22 10l-8.97 5.7a1.94 1.94 0 0 1-2.06 0L2 10"/>'

// A chip's icon with its count on it: the line icon (mail shows an open
// envelope while its dropdown is open) and a small filled circle at the
// corner with the number; no circle at zero.
function chipSvg(name: string, count: string, isOpen: boolean, tint: string, badge: string, day: number) {
  const dot =
    count === '' || count === '0' || count === '…' || count === '–'
      ? ''
      : `<circle cx="22" cy="5" r="7" fill="${badge}" stroke="#1b1f22" stroke-width="1.5"/><text x="22" y="8.2" text-anchor="middle" font-family="Segoe UI, Arial, sans-serif" font-size="${count.length > 1 ? 8 : 10}" font-weight="700" fill="#ffffff">${count}</text>`
  const ring = isOpen ? `<rect x="0" y="1" width="24" height="22" rx="5" fill="none" stroke="${tint}" stroke-width="1.5" opacity="0.9"/>` : ''
  const scale = isOpen ? '<g transform="translate(2.4 2.4) scale(0.8)">' : '<g>'

  return `<svg xmlns="http://www.w3.org/2000/svg" width="22" height="20" viewBox="-1 -3 31 27">${ring}${scale}${colorIcon(name, day)}</g>${dot}</svg>`
}

function svg(name: string, color: string) {
  return `<svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="${color}" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">${ICONS[name] ?? ''}</svg>`
}

const CELLS = 10
const filled = (percent: number) => Math.max(0, Math.min(CELLS, Math.round((percent / 100) * CELLS)))

const k = (n: number) => {
  if (n >= 1000000) return `${(n / 1000000).toFixed(n % 1000000 === 0 ? 0 : 1)}M`
  if (n >= 1000) return `${Math.round(n / 1000)}k`
  return `${n}`
}

// The short text: the status line, where the band does not draw.
function brief(history: Reading[]) {
  const now = history[history.length - 1]

  return now === undefined ? undefined : `${weather(now.percent)} ${now.percent}% ${k(now.tokens)}/${k(now.window)}`
}

// The long text: what /weather prints.
function detail(history: Reading[]) {
  const now = history[history.length - 1]

  if (now === undefined) {
    return undefined
  }

  const top = Math.max(...history.map(r => r.tokens), 1)
  const spark = history.map(r => BARS[Math.min(7, Math.floor((r.tokens / top) * 7))]).join('')
  const prev = history[history.length - 2]
  const delta = prev === undefined ? 0 : now.tokens - prev.tokens
  const move = delta === 0 ? '' : `  ${delta > 0 ? '+' : '-'}${k(Math.abs(delta))} last turn`
  const n = filled(now.percent)

  return `${weather(now.percent)} ${'█'.repeat(n)}${'░'.repeat(CELLS - n)} ${now.percent}%  ${k(now.tokens)} / ${k(now.window)}  ${spark}${move}`
}

const pad = (n: number) => String(n).padStart(2, '0')

const clip = (text: string, max: number) => (text.length > max ? `${text.slice(0, max - 1)}…` : text)

// "Dana Lee <dana@x.com>" as "Dana Lee"; a bare program address such as
// "no-reply@amazonpay.in" as its company, "Amazonpay"; a person's bare address
// as the part before the @.
function who(sender: string) {
  const name = sender.replace(/<.*>/, '').replace(/"/g, '').trim()

  if (name !== '' && !name.includes('@')) {
    return clip(name, 18)
  }

  const [local = '', domain = ''] = (name === '' ? sender.replace(/[<>]/g, '') : name).split('@')

  if (!MACHINE.test(`${local}@${domain}`) && !/^(welcome|hello|team|news)$/i.test(local)) {
    return clip(local, 18)
  }

  const parts = domain.split('.').filter(part => !/^(com|in|co|io|org|net|bank|so|ai|app)$/i.test(part))
  const company = parts[parts.length - 1] ?? domain

  return clip(company.charAt(0).toUpperCase() + company.slice(1), 18)
}

// When the meeting is, as short as it can be said: "in 25m", "now",
// "today 18:30", "Wed 07 Oct 18:30".
function when(meeting: Meeting, nowMs: number) {
  const minutes = Math.round((meeting.startMs - nowMs) / 60000)

  if (minutes <= 0) {
    return 'now'
  }

  if (minutes < 60) {
    return `in ${minutes}m`
  }

  const at = new Date(meeting.startMs)
  const time = `${pad(at.getHours())}:${pad(at.getMinutes())}`
  const isToday = new Date(nowMs).toDateString() === at.toDateString()

  return isToday
    ? `today ${time}${minutes < 180 ? ` (in ${Math.floor(minutes / 60)}h ${minutes % 60}m)` : ''}`
    : `${DAYS[at.getDay()]} ${pad(at.getDate())} ${MONTHS[at.getMonth()]} ${time}`
}

// The connector that has both `tool` and `sibling`, as the engine names it.
// One tool name is not enough: the app's own session tools also have a
// `list_events`, so the calendar is the server that has `list_calendars` too.
async function serverOf($: EngineInterface, tool: string, sibling: string, fallback: string) {
  const names = (await $.tool.list()).map(t => t.name).filter(name => name.startsWith('mcp__'))
  const servers = names
    .filter(name => name.endsWith(`__${tool}`))
    .map(name => name.slice(5, name.length - tool.length - 2))

  return servers.find(server => names.includes(`mcp__${server}__${sibling}`)) ?? fallback
}

async function ask($: EngineInterface, tool: string, sibling: string, fallback: string, args: Record<string, unknown>) {
  const server = await serverOf($, tool, sibling, fallback)
  let result = await $.mcp.call(server, tool, args)

  // Google answers "currently unavailable" now and then: one more try.
  if (result.isError) {
    await $.clock.sleep(1500)
    result = await $.mcp.call(server, tool, args)
  }

  const text = result.content.map(block => ('text' in block ? String(block.text) : '')).join('')

  if (result.isError) {
    throw new Error(text.slice(0, 160) || 'connector error')
  }

  return JSON.parse(text === '' ? '{}' : text)
}

// A Link refuses its whole tree over an address it does not take: https
// only, printable ASCII, no raw "@" (Gmail's has `authuser=me@gmail.com`).
function href(url: string) {
  try {
    const clean = new URL(url).href.replace(/@/g, '%40').replace(/\|/g, '%7C')

    return clean.startsWith('https://') && clean.length <= 2048 && /^[!-~]+$/.test(clean) ? clean : ''
  } catch {
    return ''
  }
}

// "25m ago", "3h ago", "Tue 29 Sep"
function ago(atMs: number, nowMs: number) {
  const minutes = Math.max(0, Math.round((nowMs - atMs) / 60000))

  if (minutes < 60) {
    return `${minutes}m ago`
  }

  if (minutes < 24 * 60) {
    return `${Math.floor(minutes / 60)}h ago`
  }

  const at = new Date(atMs)

  return `${DAYS[at.getDay()]} ${pad(at.getDate())} ${MONTHS[at.getMonth()]}`
}

async function readInbox($: EngineInterface): Promise<Inbox> {
  try {
    const found = await ask($, 'search_threads', 'get_thread', 'claude.ai Gmail', { query: MAIL_QUERY, pageSize: 20 })
    const threads: { id?: string; viewUrl?: string; messages?: { sender?: string; subject?: string; date?: string; labelIds?: string[] }[] }[] =
      found.threads ?? []
    const all = threads.map(thread => {
      const messages = thread.messages ?? []
      const last = messages[messages.length - 1]
      const sender = last?.sender ?? ''
      const subject = (last?.subject ?? '(no subject)').trim()

      return {
        isNoise: /github\.com/i.test(sender) && NOISE.test(subject),
        isPromo: false,
        mail: {
          id: thread.id ?? '',
          from: who(sender),
          subject: clip(subject, 58),
          atMs: Date.parse(last?.date ?? '') || 0,
          url: href(thread.viewUrl ?? ''),
          isUnread: messages.some(m => (m.labelIds ?? []).includes('UNREAD')),
        },
      }
    })
    const list = all
      .filter(one => !one.isPromo && !one.isNoise)
      .map(one => one.mail)
      .sort((a, b) => b.atMs - a.atMs)
      .slice(0, MAIL_ROWS)

    return { count: list.filter(m => m.isUnread).length, other: all.filter(one => one.isPromo).length, list, error: '' }
  } catch (error) {
    return { count: 0, other: 0, list: [], error: String(error).slice(0, 160) }
  }
}

// ------------------------------------------------------------------ calendar: add an event

// "2026-10-03T18:00:00+02:00": the machine's own time with its offset.
function isoLocal(ms: number) {
  const at = new Date(ms)
  const off = -at.getTimezoneOffset()
  const sign = off >= 0 ? '+' : '-'

  return `${at.getFullYear()}-${pad(at.getMonth() + 1)}-${pad(at.getDate())}T${pad(at.getHours())}:${pad(at.getMinutes())}:00${sign}${pad(Math.floor(Math.abs(off) / 60))}:${pad(Math.abs(off) % 60)}`
}

// A typed or dictated line as an event, with no model: a clock time ("6pm",
// "at 18:30", "at 6") is needed; a day ("today", "tomorrow", "friday") and a
// length ("for 45m", "for 1h") are optional; the rest is the title.
function eventOf(text: string, nowMs: number) {
  let rest = ` ${text.trim()} `
  const take = (re: RegExp) => {
    const hit = re.exec(rest)

    if (hit !== null) {
      rest = rest.replace(hit[0], ' ')
    }

    return hit
  }
  const length = take(/\bfor (\d+(?:\.\d+)?)\s*(m|min|mins|minutes?|h|hr|hrs|hours?)\b/i)
  const clock =
    take(/\b(?:at\s+)?(\d{1,2})(?::(\d{2}))?\s*(am|pm)\b/i) ?? take(/\bat\s+(\d{1,2})(?::(\d{2}))?\b/i) ?? take(/\b(\d{1,2}):(\d{2})\b/)

  if (clock === null) {
    return null
  }

  const day = take(/\b(?:on\s+|this\s+|next\s+)?(today|tomorrow|tmrw|mon(?:day)?|tue(?:s|sday)?|wed(?:nesday)?|thu(?:r|rs|rsday)?|fri(?:day)?|sat(?:urday)?|sun(?:day)?)\b/i)
  let hour = Number(clock[1])
  const half = (clock[3] ?? '').toLowerCase()

  if (half === 'pm' && hour < 12) {
    hour += 12
  } else if (half === 'am' && hour === 12) {
    hour = 0
  } else if (half === '' && hour >= 1 && hour <= 7) {
    hour += 12 // "at 6" in a working day means the evening
  }

  if (hour > 23) {
    return null
  }

  const start = new Date(nowMs)
  start.setHours(hour, Number(clock[2] ?? 0), 0, 0)
  const word = (day?.[1] ?? '').toLowerCase()

  if (word === 'tomorrow' || word === 'tmrw') {
    start.setDate(start.getDate() + 1)
  } else if (word !== '' && word !== 'today') {
    const want = ['sun', 'mon', 'tue', 'wed', 'thu', 'fri', 'sat'].indexOf(word.slice(0, 3))
    let ahead = (want - start.getDay() + 7) % 7

    if (ahead === 0 && start.getTime() <= nowMs) {
      ahead = 7
    }

    start.setDate(start.getDate() + ahead)
  } else if (word === '' && start.getTime() <= nowMs) {
    start.setDate(start.getDate() + 1)
  }

  const title = rest.replace(/\s+/g, ' ').replace(/\b(at|on)\s*$/i, '').trim()
  const minutes = length === null ? 30 : Math.round(Number(length[1]) * (length[2]?.toLowerCase().startsWith('h') ? 60 : 1))

  return { title: title === '' ? 'Meeting' : title.charAt(0).toUpperCase() + title.slice(1), startMs: start.getTime(), minutes: Math.max(5, minutes) }
}

// What is typed in the new-event field and not added yet.
let draftEvent = ''
// how many pages each tasks column has, as last drawn
let pagesOpen = 1
let pagesDone = 1

async function addEvent($: EngineInterface, text: string) {
  const line = text.trim()
  draftEvent = ''

  if (line === '') {
    return
  }

  const nowMs = await $.clock.now()
  const event = eventOf(line, nowMs)

  // No clock time to be read from it: the model works it out, and asks if unsure.
  if (event === null) {
    $.ui.toast('No time found in that, so Claude will add it')
    void $.prompt.submit({ text: `Add this to my Google Calendar (ask me only if the day or time is unclear): ${line}` })

    return
  }

  try {
    await ask($, 'create_event', 'list_calendars', 'claude.ai Google Calendar', {
      summary: event.title,
      startTime: isoLocal(event.startMs),
      endTime: isoLocal(event.startMs + event.minutes * 60000),
      addGoogleMeetUrl: /\b(call|meet|meeting|sync|standup|interview)\b/i.test(line),
    })
    $.ui.toast(`Added: ${event.title}, ${when({ title: '', startMs: event.startMs, endMs: event.startMs, url: '', people: 0 }, nowMs).replace(/ \(.*\)$/, '')}`)
    await poll($, 0)
  } catch (error) {
    $.ui.toast(`Calendar did not take that: ${String(error).slice(0, 90)}`)
  }

  $.ui.invalidate('ui.render')
}

async function readEvents($: EngineInterface, nowMs: number): Promise<{ events: Meeting[]; error: string }> {
  try {
    const found = await ask($, 'list_events', 'list_calendars', 'claude.ai Google Calendar', { pageSize: 15, orderBy: 'startTime' })
    const raw: Record<string, any>[] = found.events ?? []
    const events = raw
      .filter(e => e.status !== 'cancelled' && typeof e.start?.dateTime === 'string')
      .map(e => ({
        title: String(e.summary ?? 'Meeting'),
        startMs: Date.parse(e.start.dateTime),
        endMs: Date.parse(e.end?.dateTime ?? e.start.dateTime),
        url: href(String(e.conferenceUrl ?? e.htmlLink ?? '')),
        people: Array.isArray(e.attendees) ? e.attendees.length : 0,
      }))
      .filter(e => e.endMs > nowMs)
      .sort((a, b) => a.startMs - b.startMs)
      .slice(0, 15)

    return { events, error: '' }
  } catch (error) {
    return { events: [], error: String(error).slice(0, 160) }
  }
}

// One dropdown card: a rounded frame, a tinted header row, striped rows.
// `cells` are plain strings or elements; the last column fills.
function card(Box: any, Text: any, title: string, head: string[], rows: unknown[][], widths: (number | undefined)[]) {
  const line = (cells: unknown[], isHead: boolean) =>
    cells.map((cell, c) => (
      <Box
        width={widths[c]}
        flexGrow={widths[c] === undefined ? 1 : 0}
        flexShrink={widths[c] === undefined ? 1 : 0}
        minWidth={widths[c] === undefined ? 0 : widths[c]}
        overflow="hidden"
      >
        {typeof cell === 'string' ? (
          <Text bold={isHead} color={isHead ? MUTED : undefined}>
            {cell === '' ? ' ' : cell}
          </Text>
        ) : (
          cell
        )}
      </Box>
    ))

  return (
    <Box flexDirection="column" width="100%" borderStyle="round" borderColor={EDGE}>
      <Box paddingX={1}>
        <Text bold>{title}</Text>
      </Box>
      {head.length > 0 && (
        <Box paddingX={1} backgroundColor={HEAD_BG}>
          {line(head, true)}
        </Box>
      )}
      {rows.map((cells, r) => (
        <Box paddingX={1} backgroundColor={r % 2 === 1 ? STRIPE_BG : undefined}>
          {line(cells, false)}
        </Box>
      ))}
    </Box>
  )
}

// ------------------------------------------------------------------ notes

const NOTES_TOOL = 'mcp__deskbar__notes'

// A reminder time said in the note itself: "in 30m", "in 2 hours", "at 5pm",
// "at 17:30", "tomorrow" (9:00 unless a time is given). No model reads it.
function dueOf(text: string, nowMs: number) {
  const lower = text.toLowerCase()
  const after = /\bin (\d+)\s*(m|min|mins|minutes?|h|hr|hrs|hours?)\b/.exec(lower)

  if (after !== null) {
    return nowMs + Number(after[1]) * (after[2]?.startsWith('h') ? 3600000 : 60000)
  }

  const at = /\bat (\d{1,2})(?::(\d{2}))?\s*(am|pm)?\b/.exec(lower)
  const isTomorrow = /\btomorrow\b/.test(lower)

  if (at === null && !isTomorrow) {
    return null
  }

  const due = new Date(nowMs)
  let hour = at === null ? 9 : Number(at[1])

  if (at !== null && at[3] === 'pm' && hour < 12) {
    hour += 12
  }

  if (at !== null && at[3] === 'am' && hour === 12) {
    hour = 0
  }

  due.setHours(hour, at === null ? 0 : Number(at[2] ?? 0), 0, 0)

  if (isTomorrow || due.getTime() <= nowMs) {
    due.setDate(due.getDate() + 1)
  }

  return due.getTime()
}

async function storedNotes($: EngineInterface): Promise<Note[]> {
  const saved = await $.store.get('notes').catch(() => undefined)

  return Array.isArray(saved) ? (saved as Note[]) : []
}

async function showNotes($: EngineInterface, list: Note[]) {
  const current = await read($, notes)

  if (JSON.stringify(current) !== JSON.stringify(list)) {
    await update($, notes, () => list)
  }
}

async function saveNotes($: EngineInterface, list: Note[]) {
  await $.store.set('notes', list)
  await showNotes($, list)
}

async function addNote($: EngineInterface, text: string) {
  const clean = text.trim()

  if (clean === '') {
    return 'Nothing to save.'
  }

  const nowMs = await $.clock.now()
  const list = await storedNotes($)
  const note: Note = {
    id: list.reduce((max, n) => Math.max(max, n.id), 0) + 1,
    text: clean,
    createdMs: nowMs,
    dueMs: dueOf(clean, nowMs),
    doneMs: null,
    notifiedMs: null,
  }
  await saveNotes($, [...list, note])

  return `Note ${note.id} saved${note.dueMs === null ? '' : `, reminder ${ago(note.dueMs, nowMs).replace(' ago', '')} from now`}.`
}

// What is typed in the note field and not saved yet: the Save button reads
// it, and a redraw puts it back in the field.
let draftNote = ''

async function saveDraft($: EngineInterface, text: string) {
  draftNote = ''
  await addNote($, text)
  play($, 'tick')
  $.ui.invalidate('ui.render')
}

async function noteToEvent($: EngineInterface, id: number) {
  const note = (await storedNotes($)).find(n => n.id === id)

  if (note !== undefined) {
    await addEvent($, note.text)
  }
}

// Hands a note to the session as a task of its own; the note is ticked off
// by the notes tool once the work is done.
async function noteToClaude($: EngineInterface, id: number) {
  const note = (await storedNotes($)).find(n => n.id === id)

  if (note === undefined) {
    return
  }

  $.ui.toast('Handed to Claude in this session')
  void $.prompt.submit({
    text: `From my notes: ${note.text}\n\nPlease do this now. When it is handled, mark note ${id} done with the ${NOTES_TOOL} tool.`,
  })
}

async function finishNote($: EngineInterface, id: number) {
  const nowMs = await $.clock.now()
  const list = await storedNotes($)
  await saveNotes($, list.map(n => (n.id === id && n.doneMs === null ? { ...n, doneMs: nowMs } : n)))

  return list.some(n => n.id === id) ? `Note ${id} marked done.` : `No note ${id}.`
}

async function clearDone($: EngineInterface) {
  await saveNotes($, (await storedNotes($)).filter(n => n.doneMs === null))
}

// Once a minute: pick up notes other sessions wrote, and toast what is due.
async function remind($: EngineInterface, nowMs: number) {
  const list = await storedNotes($)
  const due = list.filter(n => n.doneMs === null && n.dueMs !== null && n.dueMs <= nowMs && n.notifiedMs === null)

  if (due.length === 0) {
    await showNotes($, list)

    return
  }

  for (const note of due) {
    $.ui.toast(`Reminder: ${note.text}`, { timeoutMs: 15000 })
    play($, 'chime')
  }

  await saveNotes($, list.map(n => (due.some(d => d.id === n.id) ? { ...n, notifiedMs: nowMs } : n)))
}

function notesText(list: Note[], nowMs: number) {
  const open = list.filter(n => n.doneMs === null)

  return open.length === 0
    ? 'No open notes.'
    : open
        .map(n => `${n.id}. ${n.text}${n.dueMs === null ? '' : n.dueMs <= nowMs ? ' (due now)' : ` (due ${new Date(n.dueMs).toString().slice(0, 21)})`}`)
        .join('\n')
}

async function notesTool($: EngineInterface, action: string, text: string, id: number) {
  if (action === 'add') {
    return addNote($, text)
  }

  if (action === 'done') {
    return finishNote($, id)
  }

  return notesText(await storedNotes($), await $.clock.now())
}

// ------------------------------------------------------------------ tasks

let sessionNames: Map<string, { name: string; size: number }> | undefined
const taskCache = new Map<string, { stamp: number; task: Task }>()

// The user's own ~/.claude, found once at the start of the session: the data
// folder sits there wherever the plugin itself is installed.
let claudeHome = ''

async function findHome($: EngineInterface) {
  const home = (await $.env.get('USERPROFILE')) ?? (await $.env.get('HOME')) ?? ''

  if (home !== '') {
    claudeHome = `${home.replace(/\\/g, '/').replace(/\/+$/, '')}/.claude`
  }
}

function claudeDir($: EngineInterface) {
  if (claudeHome !== '') {
    return claudeHome
  }

  const root = $.plugin.root.replace(/\\/g, '/')
  const at = root.indexOf('/.claude/')

  return at < 0 ? '' : root.slice(0, at + 8)
}

// Which project each session belongs to, from the transcripts' folders.
async function namesOf($: EngineInterface, dir: string) {
  if (sessionNames !== undefined) {
    return sessionNames
  }

  const names = new Map<string, { name: string; size: number }>()
  const projects = await $.fs.list(`${dir}/projects`).catch(() => [])

  for (const project of projects.filter(entry => entry.kind === 'dir')) {
    const files = await $.fs.list(`${dir}/projects/${project.name}`).catch(() => [])

    for (const file of files) {
      if (file.name.endsWith('.jsonl')) {
        names.set(file.name.slice(0, -6), { name: project.name.replace(/^[A-Za-z]--/, '').replace(/-/g, ' '), size: file.size })
      }
    }
  }

  sessionNames = names

  return names
}

async function loadTasks($: EngineInterface, session: string): Promise<Task[]> {
  const dir = `${claudeDir($)}/tasks/${session}`
  const files = (await $.fs.list(dir).catch(() => [])).filter(entry => entry.name.endsWith('.json'))
  const tasks: Task[] = []

  for (const file of files) {
    const path = `${dir}/${file.name}`
    const cached = taskCache.get(path)

    if (cached !== undefined && cached.stamp === file.mtimeMs) {
      tasks.push(cached.task)
      continue
    }

    try {
      const raw = JSON.parse(await $.fs.read(path))
      const task = { id: String(raw.id ?? file.name.slice(0, -5)), subject: String(raw.subject ?? ''), status: String(raw.status ?? 'pending') }
      taskCache.set(path, { stamp: file.mtimeMs, task })
      tasks.push(task)
    } catch {
      // a task file being written is read on the next pass
    }
  }

  return tasks.sort((a, b) => Number(a.id) - Number(b.id))
}

const isOpenTask = (task: Task) => task.status !== 'completed' && task.status !== 'deleted'

// This session's open count, for the chip.
async function countTasks($: EngineInterface) {
  if (isUnattended || !deskOn || claudeDir($) === '') {
    return
  }

  const mine = await $.session.id()
  const tasks = await loadTasks($, mine)
  const open = tasks.length === 0 ? -1 : tasks.filter(isOpenTask).length
  const current = await read($, todo)

  if (current.open !== open || current.selected === mine) {
    await update($, todo, state => ({ ...state, open, tasks: state.selected === mine ? tasks : state.tasks }))
  }
}

async function loadSessions($: EngineInterface): Promise<TodoSession[]> {
  const dir = claudeDir($)
  const names = await namesOf($, dir)
  const folders = (await $.fs.list(`${dir}/tasks`).catch(() => [])).filter(entry => entry.kind === 'dir')
  const found: { session: TodoSession; newest: number; size: number }[] = []

  // every session's folder is listed at once, not one after another
  const listings = await Promise.all(folders.map(folder => $.fs.list(`${dir}/tasks/${folder.name}`).catch(() => [])))

  for (const [at, folder] of folders.entries()) {
    const files = (listings[at] ?? []).filter(entry => entry.name.endsWith('.json'))

    if (files.length > 0) {
      found.push({
        session: { id: folder.name, name: names.get(folder.name)?.name ?? folder.name.slice(0, 8), count: files.length },
        newest: Math.max(...files.map(file => file.mtimeMs)),
        size: names.get(folder.name)?.size ?? 0,
      })
    }
  }

  // One entry per project: its main session, the one with the longest
  // transcript. Side sessions (forks, scheduled runs, short one-offs) are left out.
  const mine = await $.session.id()
  const main = new Map<string, { session: TodoSession; newest: number; size: number }>()

  for (const one of found) {
    const kept = main.get(one.session.name)

    if (kept === undefined || one.session.id === mine || (kept.session.id !== mine && one.size > kept.size)) {
      main.set(one.session.name, one)
    }
  }

  return [...main.values()].sort((a, b) => b.newest - a.newest).map(one => one.session)
}

async function pickSession($: EngineInterface, session: string) {
  if (settings.demo) {
    await update($, todo, state => ({ ...state, selected: session }))

    return
  }

  await update($, todo, state => ({ ...state, selected: session, tasks: [], isLoading: true, pageOpen: 0, pageDone: 0 }))
  const tasks = await loadTasks($, session)
  await update($, todo, state => (state.selected === session ? { ...state, tasks, isLoading: false } : state))
}

async function toggleTodo($: EngineInterface) {
  if (!(await setPanel($, 'todo'))) {
    return
  }

  const sessions = await loadSessions($)
  const mine = await $.session.id()
  const current = await read($, todo)
  const selected = sessions.some(s => s.id === current.selected) ? current.selected : sessions.some(s => s.id === mine) ? mine : (sessions[0]?.id ?? '')
  await update($, todo, state => ({ ...state, sessions }))

  if (selected !== '') {
    await pickSession($, selected)
  }
}

// The sessions the search field leaves: every word typed must be in the name.
function matching(sessions: TodoSession[], query: string) {
  const words = (query ?? '').toLowerCase().split(/\s+/).filter(word => word !== '')

  return words.length === 0 ? sessions : sessions.filter(s => words.every(word => s.name.toLowerCase().includes(word)))
}

async function stepSession($: EngineInterface, by: number) {
  const { sessions, selected, query } = await read($, todo)
  const list = matching(sessions, query)

  if (list.length === 0) {
    return
  }

  const at = Math.max(0, list.findIndex(s => s.id === selected))
  await pickSession($, list[(at + by + list.length) % list.length]?.id ?? selected)
}

// Enter in the search field: keep the words, and show the first session found.
async function searchSessions($: EngineInterface, query: string) {
  const clean = query.trim()
  await update($, todo, state => ({ ...state, query: clean }))
  const { sessions, selected } = await read($, todo)
  const list = matching(sessions, clean)

  if (list.length > 0 && !list.some(s => s.id === selected)) {
    await pickSession($, list[0]?.id ?? selected)
  }
}

// The "more" button of a column: on to its next page of tasks, and from the
// last page back to the first. The list turns in place; nothing scrolls.
async function turnPage($: EngineInterface, isDone: boolean, pages: number) {
  await update($, todo, state =>
    isDone
      ? { ...state, pageDone: ((state.pageDone ?? 0) + 1) % Math.max(1, pages) }
      : { ...state, pageOpen: ((state.pageOpen ?? 0) + 1) % Math.max(1, pages) },
  )
}

async function pickMine($: EngineInterface) {
  await update($, todo, state => ({ ...state, query: '' }))
  await pickSession($, await $.session.id())
}

// ------------------------------------------------------------------ music

// A mod cannot hear the speaker or reach Windows' media session, so a small
// Python helper does (helper/music_helper.py, its files in the data folder): it writes state.json
// twelve times a second, takes play / next / prev from cmd.txt, and lives only
// while alive.txt is touched, which this does while the dropdown is open.
let musicTimer: Timer | undefined
let isHelperUp = false
let isFraming = false
let frames = 0
let peaks: number[] = []
let cover = { key: '', uri: '' }
// The moving bars cost a redraw of the whole row five times a second, which
// can make a hovered button flicker; with them off the row redraws once a second.
// Surface modules (regions that animate by themselves) run in the terminal,
// and in the desktop app from Claude Code 2.1.287; an older desktop build
// keeps their room and draws nothing in it. The version is read once.
let engine = [0, 0, 0]

async function readEngine($: EngineInterface) {
  const { base, version } = await $.session.version().catch(() => ({ base: undefined, version: '' }))
  const found = /(\d+)\.(\d+)\.(\d+)/.exec(base ?? version ?? '')
  engine = found === null ? [0, 0, 0] : [Number(found[1]), Number(found[2]), Number(found[3])]
}

function runsModules(surface: string) {
  const [major = 0, minor = 0, patch = 0] = engine

  return surface === 'terminal' || major > 2 || (major === 2 && (minor > 1 || (minor === 1 && patch >= 287)))
}

// whether this surface runs surface modules, as the last drawing found it
let hasModules = false

const isClassic = () => settings.bars !== 'off' && !hasModules
// After a press the display already shows the new state: what the helper wrote
// before it acted is not allowed to flip it back for a moment.
let holdUntil = 0

const musicDir = ($: EngineInterface) => `${claudeDir($)}/deskbar-data/music`

async function frame($: EngineInterface) {
  if (isFraming) {
    return
  }

  isFraming = true

  try {
    if (!deskOn || (await shown($)) !== 'music') {
      musicTimer?.cancel()
      musicTimer = undefined

      return
    }

    frames += 1
    const dir = musicDir($)

    if (frames % 5 === 1) {
      await $.fs.write(`${dir}/alive.txt`, String(await $.clock.now()))
    }

    const raw = JSON.parse(await $.fs.read(`${dir}/state.json`))
    const next: Music = {
      at: Number(raw.at) || 0,
      bars: isClassic() && Array.isArray(raw.bars) ? raw.bars.map((v: unknown) => Number(v) || 0) : [],
      has: raw.has === true,
      title: String(raw.title ?? ''),
      artist: String(raw.artist ?? ''),
      app: String(raw.app ?? ''),
      playing: Date.now() < holdUntil ? ((await read($, music))?.playing ?? raw.playing === true) : raw.playing === true,
      now: Number(raw.now) || 0,
      duration: Number(raw.duration) || 0,
      error: String(raw.spectrumError ?? raw.error ?? ''),
      coverKey: String(raw.coverKey ?? ''),
    }

    // a new song: its cover, a small JPEG the helper wrote once
    if (next.coverKey !== cover.key) {
      const art = JSON.parse(await $.fs.read(`${dir}/cover.json`))

      if (art.key === next.coverKey) {
        cover = { key: next.coverKey, uri: typeof art.jpeg === 'string' && art.jpeg !== '' ? `data:image/jpeg;base64,${art.jpeg}` : '' }
      }
    }
    // peak caps: jump up with a bar, then fall one step every few frames
    peaks = next.bars.map((bar, i) => Math.max(bar, (peaks[i] ?? 0) - (frames % 3 === 0 ? 1 : 0)))
    const current = await read($, music)

    // without the bars only a new song, play or pause, or the next second redraws
    const same = (m: Music) => JSON.stringify(isClassic() ? { ...m, at: 0 } : { ...m, at: 0, now: Math.floor(m.now) })

    if (current === null || same(current) !== same(next)) {
      await update($, music, () => next)
    }
  } catch {
    // the helper is between two writes, or not up yet: the next frame reads
  } finally {
    isFraming = false
  }

  // The helper stops when a newer one is saved, or if it crashed: start it again.
  if (!isHelperUp && musicTimer !== undefined && frames % 10 === 0) {
    startMusic($)
  }
}

function startMusic($: EngineInterface) {
  const dir = musicDir($)

  if (!isHelperUp) {
    isHelperUp = true
    void (async () => {
      try {
        await $.fs.write(`${dir}/alive.txt`, String(await $.clock.now()))
        const helper = $.process.spawn({
          argv: [`${dir}/.venv/Scripts/python.exe`, `${$.plugin.root}/helper/music_helper.py`, dir],
          cwd: dir,
        })

        for await (const _ of helper) {
          // it prints nothing; the loop only keeps it alive
        }
      } catch {
        // no helper: the display says so
      } finally {
        isHelperUp = false
      }
    })()
  }

  if (musicTimer === undefined) {
    musicTimer = $.clock.every(200, () => {
      void frame($)
    })
  }
}

// What the smooth bars' own region asks for, several times a second: the
// speaker's latest bar heights, straight from the helper's file. Answering
// its message with props redraws that region alone, never the row.
async function liveBars($: EngineInterface) {
  try {
    const raw = JSON.parse(await $.fs.read(`${musicDir($)}/state.json`))
    const isFresh = Date.now() / 1000 - (Number(raw.at) || 0) < 3

    return { bars: Array.isArray(raw.bars) ? raw.bars : [], live: isFresh && raw.has === true && raw.playing === true }
  } catch {
    return { bars: [], live: false }
  }
}

async function toggleMusic($: EngineInterface) {
  if (await setPanel($, 'music')) {
    startMusic($)
  }
}

async function sendMusic($: EngineInterface, action: string) {
  // the helper first: it watches this file fifty times a second
  await $.fs.write(`${musicDir($)}/cmd.txt`, `${Date.now()} ${action}`)

  // then the display, without waiting to hear back: play and pause flip at once
  if (action === 'toggle' || action === 'stop') {
    await update($, music, m => (m === null ? m : { ...m, playing: action === 'toggle' ? !m.playing : false }))
    holdUntil = Date.now() + 700
  }
}

async function openYouTubeMusic($: EngineInterface) {
  await $.process.run(['cmd', '/c', 'start', '', 'https://music.youtube.com']).catch(() => undefined)
  startMusic($)
}

const xml = (text: string) => text.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;')

const mmss = (seconds: number) => `${Math.floor(Math.max(0, seconds) / 60)}:${pad(Math.floor(Math.max(0, seconds) % 60))}`

// The retro deck: a dark hi-fi faceplate with a green phosphor display (track,
// artist, time and a progress line) and an LED spectrum analyser, nine
// segments a bar, green then amber then red, with falling peak caps.
function deck(m: Music | null, nowMs: number, width: number, art: string, hasBars: boolean) {
  const isLive = m !== null && nowMs / 1000 - m.at < 3
  // with the bars in a region of their own, the picture is the display alone
  const W_ = hasBars ? Math.max(420, width) : Math.max(300, Math.round(width * 0.54))
  const H_ = 96
  const split = hasBars ? Math.round(W_ * 0.52) : W_ - 6
  const phosphor = '#7dff6b'
  const dimmed = '#2f6b33'
  const title = !isLive ? 'STARTING…' : !m.has ? 'NO MUSIC PLAYING' : m.title === '' ? 'UNTITLED' : m.title
  const artist = !isLive ? 'waking the deck' : !m.has ? 'open YouTube Music and press play' : m.artist
  // the cover (or an empty record sleeve) takes the left of the display
  const left = 92
  const chars = Math.max(10, Math.floor((split - left - 46) / 9.2))
  const part = isLive && m.has && m.duration > 0 ? Math.max(0, Math.min(1, m.now / m.duration)) : 0
  const barsLeft = split + 16
  const barsWide = W_ - barsLeft - 16
  const n = 24
  const step = barsWide / n
  const led = (i: number) => (i >= 8 ? '#ff4d4d' : i >= 6 ? '#ffc93c' : '#3ddc5a')
  let leds = ''

  for (let b = 0; b < n; b += 1) {
    const height = isLive ? Math.max(0, Math.min(9, m.bars[b] ?? 0)) : 0
    const peak = isLive ? Math.max(0, Math.min(9, peaks[b] ?? 0)) : 0
    const x = (barsLeft + b * step + 1).toFixed(1)
    const w = Math.max(3, step - 3).toFixed(1)

    for (let i = 0; i < 9; i += 1) {
      const y = 80 - i * 7.6
      const isOn = i < height
      leds += `<rect x="${x}" y="${y.toFixed(1)}" width="${w}" height="5.6" rx="1" fill="${isOn ? led(i) : '#13251a'}"${isOn ? '' : ' opacity="0.9"'}/>`
    }

    if (peak > 0 && peak >= height) {
      leds += `<rect x="${x}" y="${(80 - (peak - 1) * 7.6 - 2.4).toFixed(1)}" width="${w}" height="1.8" fill="#eafff0"/>`
    }
  }

  const state = !isLive || !m.has ? '■' : m.playing ? '▶' : '❚❚'

  return `<svg xmlns="http://www.w3.org/2000/svg" width="${W_}" height="${H_}" viewBox="0 0 ${W_} ${H_}">
<defs><linearGradient id="face" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#2b2f33"/><stop offset="1" stop-color="#15181b"/></linearGradient>
<pattern id="scan" width="4" height="3" patternUnits="userSpaceOnUse"><rect width="4" height="1" fill="#000000" opacity="0.28"/></pattern></defs>
<rect x="0.5" y="0.5" width="${W_ - 1}" height="${H_ - 1}" rx="9" fill="url(#face)" stroke="#3b4146"/>
<rect x="10" y="9" width="${split - 14}" height="78" rx="5" fill="#07130a" stroke="#0e2a14"/>
<clipPath id="sleeve"><rect x="20" y="17" width="62" height="62" rx="6"/></clipPath>
<rect x="20" y="17" width="62" height="62" rx="6" fill="#0d2413" stroke="#1c4a26"/>
<circle cx="51" cy="48" r="22" fill="none" stroke="#1c4a26" stroke-width="8"/><circle cx="51" cy="48" r="4" fill="#2f6b33"/>
${art === '' || !isLive || !m.has ? '' : `<image href="${art}" x="20" y="17" width="62" height="62" clip-path="url(#sleeve)" preserveAspectRatio="xMidYMid slice"/>`}
<text x="${left}" y="33" font-family="Consolas, 'Courier New', monospace" font-size="15" font-weight="700" fill="${phosphor}">${state}</text>
<text x="${left + 26}" y="33" font-family="Consolas, 'Courier New', monospace" font-size="15" font-weight="700" fill="${phosphor}">${xml(clip(title.toUpperCase(), chars))}</text>
<text x="${left + 26}" y="52" font-family="Consolas, 'Courier New', monospace" font-size="12" fill="${dimmed}" style="fill:#4fbf55">${xml(clip(artist, chars + 8))}</text>
<rect x="${left}" y="64" width="${split - left - 86}" height="4" rx="2" fill="#12301a"/>
<rect x="${left}" y="64" width="${((split - left - 86) * part).toFixed(1)}" height="4" rx="2" fill="${phosphor}"/>
<text x="${split - 12}" y="70" text-anchor="end" font-family="Consolas, 'Courier New', monospace" font-size="11" fill="${phosphor}">${isLive && m.has ? `${mmss(m.now)}${m.duration > 0 ? `/${mmss(m.duration)}` : ''}` : '-:--'}</text>
<rect x="10" y="9" width="${split - 14}" height="78" rx="5" fill="url(#scan)"/>
${hasBars ? `<rect x="${split + 6}" y="9" width="${W_ - split - 16}" height="78" rx="5" fill="#060b08" stroke="#0e2a14"/>\n${leds}` : ''}
</svg>`
}

// ------------------------------------------------------------------ mail and calendar

// `maxAgeMs` is how old a kept answer may be before Google is asked again:
// the background timer accepts a full period, a click or a finished turn
// wants it fresh.
async function poll($: EngineInterface, maxAgeMs = POLL_MS - 10000) {
  if (isPolling || isUnattended || !deskOn) {
    return
  }

  isPolling = true

  try {
    const nowMs = await $.clock.now()
    // Every open session runs this timer; only the first one in a period asks
    // Google, the others take what it kept in the plugin's store.
    const kept = (await $.store.get('desk').catch(() => undefined)) as (Desk & { atMs?: number }) | undefined

    if (kept !== undefined && typeof kept.atMs === 'number' && nowMs - kept.atMs < maxAgeMs && kept.inbox !== null && kept.inbox.error === '') {
      await update($, desk, () => ({ inbox: kept.inbox, events: kept.events ?? [], calendarError: kept.calendarError ?? '', nowMs }))

      return
    }

    const inbox = await readInbox($)
    const { events, error } = await readEvents($, nowMs)
    await $.store.set('desk', { inbox, events, calendarError: error, nowMs, atMs: nowMs }).catch(() => undefined)
    await update($, desk, () => ({ inbox, events, calendarError: error, nowMs }))
  } finally {
    isPolling = false
  }
}

async function minute($: EngineInterface) {
  if (!deskOn) {
    return
  }

  const nowMs = await $.clock.now()
  await readSettings($) // another session may have changed them

  // a chime ten minutes before a meeting, once for each
  const soon = (await read($, desk)).events?.find(event => event.startMs - nowMs > 0 && event.startMs - nowMs <= 10 * 60000)

  if (soon !== undefined && !chimed.includes(soon.startMs)) {
    chimed = [...chimed, soon.startMs].slice(-20)
    $.ui.toast(`${soon.title} starts in ${Math.max(1, Math.round((soon.startMs - nowMs) / 60000))} minutes`, { timeoutMs: 15000 })
    play($, 'chime')
  }

  await update($, desk, d => ({ ...d, events: Array.isArray(d.events) ? d.events : [], nowMs }))
  await remind($, nowMs).catch(() => undefined)
}

// Opens `name`, or closes it when it is the one open; answers whether it is
// open now.
async function setPanel($: EngineInterface, name: string) {
  const isOpening = (await read($, panel)) !== name || (await shown($)) === ''
  await update($, panel, () => (isOpening ? name : ''))
  // A close is stamped too, as a negative time: the timer's table, opened
  // before it, then stays shut instead of coming back.
  // later than anything the timer's table was stamped with, even in the same instant
  const theirs = Math.abs(Number((await $.state.get({ plugin: 'deskbar', key: 'openAt' }).catch(() => undefined))?.value) || 0)
  const stamp = Math.max(await $.clock.now(), theirs + 1)
  await update($, panelAt, () => (isOpening ? stamp : -stamp))

  return isOpening
}

// The dropdown to draw: none while the work timer's table was opened later.
async function shown($: EngineInterface) {
  const name = await read($, panel)
  const mine = await read($, panelAt)
  const theirs = await $.state.get({ plugin: 'deskbar', key: 'openAt' }).catch(() => undefined)

  return name !== '' && mine > 0 && mine >= Math.abs(Number(theirs?.value) || 0) ? name : ''
}

// Every click on the mail or calendar chip, to open or to close, asks Google
// again right then, whatever the age of the answer in hand.
async function openFresh($: EngineInterface, name: string) {
  await setPanel($, name)
  // not waited for: the dropdown is already open, the answer redraws it
  void poll($, 0).catch(() => undefined)
}

function startDesk($: EngineInterface) {
  if (hasTimers) {
    return
  }

  hasTimers = true
  void poll($).catch(() => undefined)
  void storedNotes($).then(list => showNotes($, list)).catch(() => undefined)
  void countTasks($).catch(() => undefined)
  deskTimers.push(
    // looked at every minute; Google is asked only once the kept answer is
    // older than the interval chosen in the settings
    $.clock.every(60000, () => {
      void poll($, settings.mailMinutes * 60000 - 10000).catch(() => undefined)
    }),
    $.clock.every(60000, () => {
      void minute($).catch(() => undefined)
    }),
  )
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

// ------------------------------------------------------------------ on and off

// The whole desk (this mod's chips and the work timer's) is off in a session
// until that session turns it on with /desk on. The choice is kept per
// session in deskbar-data/desk-on.json, which the work timer reads as well.
// ------------------------------------------------------------------ demo data

// What the dropdowns show in demo mode (/desk demo): made up, so the row can be
// shown and recorded without anyone's real inbox, calendar, tasks or notes.
function demoInbox(nowMs: number): Inbox {
  const at = (minutes: number) => nowMs - minutes * 60000
  const list = [
    { id: 'd1', from: 'Maya Chen', subject: 'Re: Q4 launch plan, final draft attached', atMs: at(8), url: '', isUnread: true },
    { id: 'd2', from: 'Github', subject: '[deskbar] Release v1.0.0 published', atMs: at(42), url: '', isUnread: true },
    { id: 'd3', from: 'Stripe', subject: 'Your payout of $2,480.00 is on the way', atMs: at(130), url: '', isUnread: false },
    { id: 'd4', from: 'Alex Rivera', subject: 'Coffee next week?', atMs: at(320), url: '', isUnread: false },
    { id: 'd5', from: 'Notion', subject: 'Weekly digest: 12 pages updated', atMs: at(1500), url: '', isUnread: false },
  ]

  return { count: list.filter(m => m.isUnread).length, other: 0, list, error: '' }
}

function demoEvents(nowMs: number): Meeting[] {
  const day = new Date(nowMs)
  const at = (days: number, hour: number, mins: number) => {
    const when = new Date(day)
    when.setDate(when.getDate() + days)
    when.setHours(hour, mins, 0, 0)

    return when.getTime()
  }
  const soon = Math.ceil((nowMs + 25 * 60000) / 300000) * 300000

  return [
    { title: 'Design review', startMs: soon, endMs: soon + 30 * 60000, url: 'https://meet.google.com/', people: 4 },
    { title: 'Client sync, Acme', startMs: at(1, 16, 0), endMs: at(1, 16, 45), url: 'https://meet.google.com/', people: 3 },
    { title: 'Sprint planning', startMs: at(2, 10, 30), endMs: at(2, 11, 30), url: 'https://meet.google.com/', people: 6 },
  ]
}

function demoTodo(selected: string): Todo {
  const sessions = [
    { id: 'demo-web', name: 'Website redesign', count: 9 },
    { id: 'demo-app', name: 'Mobile app', count: 7 },
    { id: 'demo-data', name: 'Data pipeline', count: 5 },
  ]
  const lists: Record<string, Task[]> = {
    'demo-web': [
      { id: '1', subject: 'Set up the CI pipeline', status: 'completed' },
      { id: '2', subject: 'Design the new pricing page', status: 'completed' },
      { id: '3', subject: 'Migrate sign-in to OAuth', status: 'completed' },
      { id: '4', subject: 'Write the launch blog post', status: 'completed' },
      { id: '5', subject: 'Compress hero images', status: 'completed' },
      { id: '6', subject: 'Polish the onboarding screens', status: 'in_progress' },
      { id: '7', subject: 'Fix the mobile nav overflow', status: 'pending' },
      { id: '8', subject: 'Write the release notes', status: 'pending' },
      { id: '9', subject: 'Run the accessibility audit', status: 'pending' },
    ],
    'demo-app': [
      { id: '1', subject: 'Push notifications', status: 'completed' },
      { id: '2', subject: 'Offline mode', status: 'in_progress' },
      { id: '3', subject: 'App store screenshots', status: 'pending' },
    ],
    'demo-data': [
      { id: '1', subject: 'Nightly import job', status: 'completed' },
      { id: '2', subject: 'Deduplicate customer records', status: 'pending' },
    ],
  }
  const pick = sessions.some(s => s.id === selected) ? selected : 'demo-web'

  return { sessions, selected: pick, tasks: lists[pick] ?? [], open: 4, isLoading: false, query: '', pageOpen: 0, pageDone: 0 }
}

function demoNotes(nowMs: number): Note[] {
  const at = (hour: number) => {
    const when = new Date(nowMs)
    when.setHours(hour, 0, 0, 0)

    return when.getTime() > nowMs ? when.getTime() : when.getTime() + 86400000
  }

  return [
    { id: 1, text: 'Send the invoice to Acme', createdMs: nowMs - 3600000, dueMs: at(17), doneMs: null, notifiedMs: null },
    { id: 2, text: 'Ask Maya for the final launch copy', createdMs: nowMs - 7200000, dueMs: null, doneMs: null, notifiedMs: null },
    { id: 3, text: 'Renew the domain before Friday', createdMs: nowMs - 86400000, dueMs: null, doneMs: null, notifiedMs: null },
    { id: 4, text: 'Book the team offsite venue', createdMs: nowMs - 172800000, dueMs: null, doneMs: nowMs - 3600000, notifiedMs: null },
  ]
}

// ------------------------------------------------------------------ settings

// One file for every session (deskbar-data/settings.json): which chips show,
// how often Gmail and Calendar are checked, and a line added to the prompt
// that asks for a drafted reply (a house style, a skill to use).
type Settings = { show: Record<string, boolean>; mailMinutes: number; replyStyle: string; bars: string; sounds: boolean; demo: boolean }

const DEFAULTS: Settings = {
  show: { weather: true, mail: true, calendar: true, tasks: true, notes: true, music: true, timer: true },
  mailMinutes: 3,
  replyStyle: '',
  // the music bars, 'on' or 'off': how they are drawn is the surface's to say
  bars: 'on',
  sounds: true,
  demo: false,
}
const CHIPS = ['weather', 'mail', 'calendar', 'tasks', 'notes', 'music', 'timer']

let settings: Settings = DEFAULTS
let replyStyle = ''

const settingsFile = ($: EngineInterface) => `${claudeDir($)}/deskbar-data/settings.json`

// counts saves: a re-read that started before a save must not undo it
let saves = 0

async function readSettings($: EngineInterface) {
  const savesBefore = saves
  let next = DEFAULTS

  try {
    const raw = JSON.parse(await $.fs.read(settingsFile($)))
    next = {
      show: { ...DEFAULTS.show, ...(raw.show ?? {}) },
      mailMinutes: Math.max(1, Math.min(60, Number(raw.mailMinutes) || DEFAULTS.mailMinutes)),
      replyStyle: typeof raw.replyStyle === 'string' ? raw.replyStyle : '',
      bars: raw.bars === 'off' ? 'off' : 'on',
      sounds: raw.sounds !== false,
      demo: raw.demo === true,
    }
  } catch {
    // no file yet: the defaults
  }

  // a save landed while this read was under way: what it saved is newer
  if (saves !== savesBefore) {
    return
  }

  const hasChanged = JSON.stringify(next) !== JSON.stringify(settings)
  settings = next
  replyStyle = next.replyStyle

  if (hasChanged) {
    await update($, settingsAt, n => n + 1)
  }
}

async function saveSettings($: EngineInterface, next: Settings) {
  saves += 1
  settings = next
  replyStyle = next.replyStyle
  await $.fs.write(settingsFile($), `${JSON.stringify(next, null, 2)}\n`)
  await update($, settingsAt, n => n + 1)
}

async function toggleChip($: EngineInterface, name: string) {
  await saveSettings($, { ...settings, show: { ...settings.show, [name]: settings.show[name] === false } })
}

async function setMailMinutes($: EngineInterface, minutes: number) {
  await saveSettings($, { ...settings, mailMinutes: minutes })
}

async function setBars($: EngineInterface, bars: string) {
  peaks = []
  await saveSettings($, { ...settings, bars })
}

async function toggleSounds($: EngineInterface) {
  await saveSettings($, { ...settings, sounds: !settings.sounds })
  play($, 'tick')
}

// A short sound of the mod's own (fx/<name>.wav), when sounds are on. A
// surface that cannot play one says so by rejecting: that is not an error here.
function play($: EngineInterface, name: 'chime' | 'tick' | 'start' | 'done') {
  if (settings.sounds) {
    void $.audio.play({ asset: `fx/${name}.wav` }).catch(() => undefined)
  }
}

let deskOn = false
let deskTimers: Timer[] = []

const onFile = ($: EngineInterface) => `${claudeDir($)}/deskbar-data/desk-on.json`

async function readOnMap($: EngineInterface): Promise<Record<string, boolean>> {
  try {
    return JSON.parse(await $.fs.read(onFile($)))
  } catch {
    return {}
  }
}

async function readOn($: EngineInterface) {
  deskOn = !isUnattended && (await readOnMap($))[await $.session.id()] === true

  return deskOn
}

async function startAll($: EngineInterface) {
  await measure($)
  startDesk($)
  await $.tool
    .register({
      name: 'notes',
      description:
        "The user's own notes and to-dos, one list shared by every session (added from the notes widget). list shows the open ones, add saves a new one (a time such as 'in 30m', 'at 5pm' or 'tomorrow' in the text sets a reminder), done marks one finished by its id. Remind the user of an open note when the work touches it, and mark it done when it is.",
      inputSchema: {
        type: 'object',
        properties: {
          action: { type: 'string', enum: ['list', 'add', 'done'] },
          text: { type: 'string', description: 'The note, for add' },
          id: { type: 'number', description: 'The note id, for done' },
        },
        required: ['action'],
      },
    })
    .catch(() => undefined)
}

async function setOn($: EngineInterface, isOn: boolean) {
  const map = await readOnMap($)
  const id = await $.session.id()

  if (isOn) {
    map[id] = true
  } else {
    delete map[id]
  }

  await $.fs.write(onFile($), `${JSON.stringify(map, null, 2)}\n`)
  deskOn = isOn && !isUnattended

  if (deskOn) {
    await startAll($)
  } else {
    for (const timer of deskTimers) {
      timer.cancel()
    }

    deskTimers = []
    hasTimers = false
    musicTimer?.cancel()
    musicTimer = undefined
    await update($, panel, () => '')
    $.ui.status(undefined)
  }

  $.ui.invalidate('ui.render')
}

async function measure($: EngineInterface) {
  if (isUnattended || !deskOn) {
    return
  }

  const { context } = await $.session.usage()
  const tokens = context.tokens

  if (tokens === undefined || context.window <= 0) {
    return
  }

  const percent = context.percent ?? Math.round((tokens / context.window) * 100)
  await update($, readings, h => [...h, { tokens, window: context.window, percent }].slice(-12))
  $.ui.status((await read($, hidden)) ? undefined : brief(await read($, readings)))
  $.ui.invalidate('ui.render')
}


async function band($: EngineInterface, e: any, below: any): Promise<any> {
  {
    const history = await read($, readings)
    const now = history[history.length - 1]

    // a session's first reading comes after its first turn: until then the
    // row shows without the weather
    if (isUnattended || !deskOn || e.props.hasSurvey || (await read($, hidden))) {
      return below
    }

    const table = $.ui.resolve(e)
    const { Box, Button, Input, Link, Text } = table
    // The terminal cannot paint an SVG: it keeps the emoji.
    const Svg = e.surface === 'terminal' ? undefined : (table as { Svg?: any }).Svg
    const Client = runsModules(e.surface) ? (table as { Client?: any }).Client : undefined
    hasModules = Client !== undefined
    // A moving piece, by what the surface can run: a surface module in the
    // terminal, a self-animating SVG where SVG is drawn, nothing otherwise.
    const meter = (key: string, value: number, isActive: boolean, tint: string, cells: number) =>
      Client !== undefined ? (
        <Client key={key} module="./meter.tsx" props={{ value, active: isActive, tint }} width={cells} height={1} />
      ) : Svg !== undefined ? (
        <Svg source={meterSvg(value, isActive, tint, cells * 7)} alt={`${Math.round(value * 100)} percent`} width={cells * 7} height={10} />
      ) : null
    const pulse = (key: string, tint: string, isFast: boolean) =>
      Client !== undefined ? (
        <Client key={key} module="./pulse.tsx" props={{ tint, fast: isFast }} width={1} height={1} />
      ) : Svg !== undefined ? (
        <Svg source={pulseSvg(tint, isFast)} alt="now" width={12} height={12} />
      ) : null
    const percent = now?.percent ?? 0
    const color = tone(percent)
    const art = (name: string, tint: string, fallback: string) =>
      Svg === undefined ? (
        <Text>{fallback} </Text>
      ) : (
        <Box marginRight={1} alignItems="center">
          <Svg
            source={
              colorIcon(name, 0) === ''
                ? svg(name, tint)
                : `<svg xmlns="http://www.w3.org/2000/svg" width="18" height="18" viewBox="0 0 24 24">${colorIcon(name, 0)}</svg>`
            }
            alt={fallback === '' ? name : fallback}
            width={18}
            height={18}
          />
        </Box>
      )
    // Values kept from an older version of this mod may lack newer fields.
    const kept = await read($, desk)
    const d = {
      ...kept,
      events: (Array.isArray(kept.events) ? kept.events : []).map(event => ({ ...event, url: href(event.url) })),
      inbox:
        kept.inbox !== null && Array.isArray(kept.inbox.list)
          ? { ...kept.inbox, list: kept.inbox.list.map(m => ({ ...m, url: href(m.url) })) }
          : null,
      calendarError: kept.calendarError ?? '',
      nowMs: kept.nowMs ?? 0,
    }

    if (settings.demo) {
      const at = d.nowMs || Date.now()
      d.inbox = demoInbox(at)
      d.events = demoEvents(at)
      d.calendarError = ''
    }
    const open = await shown($)
    const nowMs = d.nowMs
    const events = d.events.filter(event => event.endMs > nowMs)
    const meeting = events[0]
    const minutes = meeting === undefined ? 9999 : Math.round((meeting.startMs - nowMs) / 60000)
    const meetColor = minutes <= 2 ? RED : minutes <= 10 ? AMBER : undefined
    const unread = d.inbox?.count ?? 0
    const mailLabel = d.inbox === null ? '…' : d.inbox.error !== '' ? '?' : unread > 99 ? '99+' : String(unread)
    const toggle = (name: string) => () => setPanel($, name)
    const allNotes = settings.demo ? demoNotes(nowMs || Date.now()) : await read($, notes)
    const openNotes = allNotes.filter(n => n.doneMs === null)
    const doneNotes = allNotes.filter(n => n.doneMs !== null).sort((x, y) => (y.doneMs ?? 0) - (x.doneMs ?? 0))
    const dueNotes = openNotes.filter(n => n.dueMs !== null && n.dueMs <= nowMs).length
    const realTasks = await read($, todo)
    const tasksNow = settings.demo ? demoTodo(realTasks.selected) : realTasks
    await read($, settingsAt) // drawn again when a setting changes
    const playing = await read($, music)

    // One chip per widget. On the desktop it is the icon, with its count on
    // it, painted over the left of a button whose label is only the arrow (a
    // click on the picture itself does not reach the button, so the arrow side
    // is the target); the terminal gets an emoji and the count as text.
    const widget = (key: string, name: string, count: string, tint: string, badge: string, text: string, onPress: () => unknown) => {
      if (settings.show[name] === false) {
        return null
      }

      const isOn = open === key
      const arrow = isOn ? '▾' : '▸'

      return Svg === undefined ? (
        <Button key={key} label={`${EMOJI[name]} ${text} ${arrow}`} onPress={onPress} />
      ) : (
        <Box position="relative" alignItems="center">
          <Button key={key} label={`   ${arrow}`} onPress={onPress} />
          <Box position="absolute" top={0} left={1} height="100%" alignItems="center">
            <Svg source={chipSvg(name, count, isOn, BLUE, badge, new Date(nowMs || Date.now()).getDate())} alt={`${name} ${text}`} width={22} height={20} />
          </Box>
        </Box>
      )
    }
    // The calendar's badge: meetings still to come this week (through Sunday).
    const weekEnd = new Date(nowMs || Date.now())
    weekEnd.setDate(weekEnd.getDate() + ((7 - weekEnd.getDay()) % 7))
    weekEnd.setHours(23, 59, 59, 999)
    const soon = events.filter(event => event.startMs <= weekEnd.getTime()).length


    // The row: weather (icon and percent; /weather prints the counts), then the chips. The calendar
    // says its next meeting on hover, and by itself once it is under an hour away.
    const mine = (
      <Box alignItems="center">
        <Box key="weather" alignItems="center" display={settings.show.weather === false || now === undefined ? 'none' : 'flex'}>
          {art(weather(percent).toLowerCase(), color, icon(percent))}
          <Text bold color={color}>
            {percent}%
          </Text>
        </Box>
        <Box marginLeft={2} alignItems="center">
          {widget('mail', 'mail', mailLabel, unread > 0 ? '#e8eef0' : ICON, mailLabel === '?' ? AMBER : RED, mailLabel, () => openFresh($, 'mail'))}
        </Box>
        <Box key="calendar-chip" marginLeft={1} alignItems="center">
          {widget(
            'calendar',
            'calendar',
            d.calendarError !== '' ? '?' : String(soon),
            meetColor ?? ICON,
            minutes <= 10 ? RED : AMBER,
            meeting === undefined ? (d.calendarError !== '' ? '?' : 'free') : when(meeting, nowMs),
            () => openFresh($, 'calendar'),
          )}
          {settings.show.calendar !== false && meeting !== undefined && minutes <= 10 && (
            <Box marginLeft={1} alignItems="center">
              {pulse('meeting-pulse', minutes <= 2 ? RED : AMBER, minutes <= 2)}
            </Box>
          )}
          {settings.show.calendar !== false && meeting !== undefined && minutes <= 60 && (
            <Text bold color={meetColor}>
              {' '}
              {clip(meeting.title, 24)} {when(meeting, nowMs)}
            </Text>
          )}
          {settings.show.calendar !== false && meeting !== undefined && minutes <= 15 && meeting.url !== '' && <Text> </Text>}
          {settings.show.calendar !== false && meeting !== undefined && minutes <= 15 && meeting.url !== '' && <Link href={meeting.url} label="Join" />}
        </Box>
        <Box marginLeft={1} alignItems="center">
          {widget(
            'todo',
            'tasks',
            tasksNow.open < 0 ? '–' : String(tasksNow.open),
            ICON,
            GREEN,
            tasksNow.open < 0 ? '–' : String(tasksNow.open),
            () => toggleTodo($),
          )}
        </Box>
        <Box marginLeft={1} alignItems="center">
          {widget(
            'notes',
            'notes',
            String(openNotes.length),
            dueNotes > 0 ? AMBER : ICON,
            dueNotes > 0 ? AMBER : BLUE,
            `${openNotes.length}${dueNotes > 0 ? ' !' : ''}`,
            toggle('notes'),
          )}
          {settings.show.notes !== false && dueNotes > 0 && (
            <Box marginLeft={1} alignItems="center">
              {pulse('notes-pulse', AMBER, false)}
            </Box>
          )}
        </Box>
        <Box marginLeft={1} alignItems="center">
          {widget('music', 'music', '', ICON, GREEN, playing !== null && playing.has && playing.playing ? 'playing' : '', () => toggleMusic($))}
        </Box>
        <Box marginLeft={1} alignItems="center">
          <Button key="settings" label={open === 'settings' ? '⚙ ▾' : '⚙'} onPress={toggle('settings')} />
        </Box>
      </Box>
    )

    // The band scrolls once its content is taller than the app allows, and the
    // row of chips scrolls away with it: a dropdown shows only the rows that fit
    // (the row, the card's frame, title and header take five).
    const tall = Number(e.props.maxRows) || 12
    const cols = Number(e.props.bodyColumns) || 96
    const isNarrow = cols < 84
    const mailSubject = Math.max(14, cols - (isNarrow ? 14 + 11 : 20 + 12) - 8)
    const room = Math.max(3, Math.min(MAIL_ROWS, tall - 7))
    const inbox = d.inbox
    // Unread rows stand out (a blue dot, bold); read ones are grey. The
    // subject is a link that opens the thread in Gmail.
    // Unread rows stand out (a blue dot, bold); read ones are grey. The
    // subject opens the thread in Gmail.
    const mailRows =
      inbox === null
        ? []
        : inbox.list.slice(0, room).map(m => [
            <Text bold={m.isUnread} color={m.isUnread ? BLUE : MUTED}>
              {m.isUnread ? '● ' : '  '}
              {m.from}
            </Text>,
            m.url === '' ? (
              <Text bold={m.isUnread} color={m.isUnread ? undefined : MUTED}>
                {clip(m.subject, mailSubject)}
              </Text>
            ) : (
              <Link href={m.url} label={clip(m.subject, mailSubject)} />
            ),
            <Text color={m.isUnread ? undefined : MUTED}>{ago(m.atMs, nowMs)}</Text>,
          ])
    const mailCard =
      open !== 'mail' || inbox === null
        ? undefined
        : inbox.error !== ''
          ? card(Box, Text, 'Gmail', ['Could not read the inbox'], [[inbox.error]], [])
          : card(
              Box,
              Text,
              `Primary, latest ${Math.min(room, inbox.list.length)}: ${inbox.count} unread`,
              ['From', isNarrow ? 'Subject' : 'Subject (click to open)', 'When'],
              mailRows.length === 0 ? [['', 'Primary is empty', '']] : mailRows,
              isNarrow ? [14, undefined, 11] : [20, undefined, 12],
            )
    const calendarCard =
      open !== 'calendar' ? undefined : (
        <Box flexDirection="column" width="100%">
          <Box width="100%" paddingX={1} alignItems="center" justifyContent="space-between">
            <Box flexGrow={1} alignItems="center">
              <Text bold color={BLUE}>
                New event{'  '}
              </Text>
              <Input
                key="event"
                value={draftEvent}
                placeholder="call with Tom tomorrow 6pm for 45m"
                submitLabel="Enter"
                onInput={(value: string) => {
                  draftEvent = value
                }}
                onSubmit={(value: string) => addEvent($, value)}
              />
            </Box>
            <Button key="event-add" label="Add" variant="primary" onPress={() => addEvent($, draftEvent)} />
          </Box>
          {card(
            Box,
            Text,
            d.calendarError !== '' ? `Calendar: ${d.calendarError}` : 'Upcoming meetings',
            isNarrow ? ['When', 'Meeting', 'Link'] : ['When', 'Meeting', 'People', 'Link'],
            events.length === 0
              ? [isNarrow ? ['', 'nothing scheduled this week', ''] : ['', 'nothing scheduled in the next 7 days', '', '']]
              : events.slice(0, Math.max(2, room - 1)).map((event, i) => [
                  <Text bold={i === 0} color={i === 0 ? (meetColor ?? GREEN) : undefined}>
                    {when(event, nowMs)}
                  </Text>,
                  clip(event.title, Math.max(14, cols - (isNarrow ? 20 + 6 : 22 + 8 + 6) - 8)),
                  ...(isNarrow ? [] : [event.people > 0 ? String(event.people) : '']),
                  event.url === '' ? '' : <Link href={event.url} label={event.url.includes('meet.google') ? 'Join' : 'Open'} />,
                ]),
            isNarrow ? [20, undefined, 6] : [22, undefined, 8, 6],
          )}
        </Box>
      )
    // Tasks: a search field and a picker for the session, then two cards
    // side by side: what is still open on the left, what is done on the right.
    const found = matching(tasksNow.sessions, tasksNow.query)
    const picked = tasksNow.sessions.find(s => s.id === tasksNow.selected)
    const at = found.findIndex(s => s.id === tasksNow.selected)
    const openTasks = tasksNow.tasks.filter(isOpenTask)
    const doneTasks = tasksNow.tasks.filter(task => !isOpenTask(task)).reverse()
    // Rows the band has: chips, gap, the search bar (three with its frame), a
    // gap, the session pills and a heading in each column make eight; the rest
    // are tasks, the last of them the button that turns the page.
    const fit = Math.max(2, tall - 9)
    // A task takes one line: cut to what half the band holds.
    const wide = Math.max(24, Math.floor(((Number(e.props.bodyColumns) || 96) - 10) / 2))
    const column = (title: string, tint: string, all: Task[], page: number, isDone: boolean, empty: string, draw: (task: Task) => unknown) => {
      const pages = Math.max(1, Math.ceil(all.length / fit))

      if (isDone) {
        pagesDone = pages
      } else {
        pagesOpen = pages
      }

      const at = Math.min(page ?? 0, pages - 1)
      const lines = all.slice(at * fit, at * fit + fit)
      const left = all.length - (at * fit + lines.length)

      return (
        <Box flexDirection="column" width="50%" backgroundColor={STRIPE_BG} paddingX={1}>
          <Box alignItems="center" justifyContent="space-between">
            <Box>
              <Text bold color={tint}>
                {title}
              </Text>
              <Text bold> {all.length}</Text>
            </Box>
            {pages > 1 && (
              <Text color={MUTED}>
                {at * fit + 1}-{at * fit + lines.length} of {all.length}
              </Text>
            )}
          </Box>
          {lines.length === 0 && <Text color={MUTED}>{empty}</Text>}
          {lines.map(draw)}
          {pages > 1 && (
            <Box>
              <Button
                key={isDone ? 'todo-more-done' : 'todo-more-open'}
                label={left > 0 ? `▾ ${left} more` : '▴ back to the first'}
                onPress={() => turnPage($, isDone, pages)}
              />
            </Box>
          )}
        </Box>
      )
    }
    const todoCard =
      open !== 'todo' ? undefined : (
        <Box flexDirection="column" width="100%">
          <Box width="100%" borderStyle="round" borderColor={BLUE} paddingX={1} alignItems="center" justifyContent="space-between">
            <Box alignItems="center">
              {Svg === undefined ? <Text>🔍 </Text> : art('search', BLUE, 'search')}
              <Text bold color={BLUE}>
                Sessions{'  '}
              </Text>
              <Input
                key="todo-search"
                value={tasksNow.query ?? ''}
                placeholder="search by project name, then Enter"
                submitLabel="find"
                onSubmit={(value: string) => searchSessions($, value)}
              />
            </Box>
            <Box alignItems="center">
              <Text color={MUTED}>
                {found.length === 0
                  ? `nothing matches "${tasksNow.query}"`
                  : `${at < 0 ? '-' : at + 1} of ${found.length}${found.length < tasksNow.sessions.length ? ' found' : ''}`}
                {'  '}
              </Text>
              <Button key="todo-mine" label="This session" onPress={() => pickMine($)} />
            </Box>
          </Box>
          <Box width="100%" paddingX={1} marginTop={1} alignItems="center">
            <Button key="todo-prev" label="◂" onPress={() => stepSession($, -1)} />
            <Text> </Text>
            {found.slice(0, isNarrow ? 3 : 5).map(session => (
              <Box marginRight={1}>
                <Button
                  key={`todo-pick-${session.id}`}
                  label={clip(session.name, 20)}
                  variant={session.id === tasksNow.selected ? 'primary' : 'secondary'}
                  onPress={() => pickSession($, session.id)}
                />
              </Box>
            ))}
            <Button key="todo-next" label="▸" onPress={() => stepSession($, 1)} />
            <Text bold>
              {'   '}
              {picked === undefined ? '' : picked.name}
              {'  '}
            </Text>
            {/* how far the session's list is: a bar that glides, and sweeps while a task is under way */}
            {tasksNow.tasks.length > 0 &&
              meter(
                'tasks-meter',
                doneTasks.length / tasksNow.tasks.length,
                tasksNow.tasks.some(task => task.status === 'in_progress'),
                GREEN,
                isNarrow ? 10 : 18,
              )}
            <Text color={MUTED}>
              {tasksNow.isLoading ? '  reading…' : tasksNow.tasks.length === 0 ? '' : `  ${doneTasks.length}/${tasksNow.tasks.length}`}
            </Text>
          </Box>
          <Box width="100%" columnGap={1}>
            {column(
              'TO DO',
              AMBER,
              openTasks,
              tasksNow.pageOpen,
              false,
              tasksNow.isLoading ? ' ' : tasksNow.tasks.length === 0 ? 'this session has no task list' : 'all done',
              task => (
                <Text bold={task.status === 'in_progress'} color={task.status === 'in_progress' ? AMBER : undefined}>
                  {task.status === 'in_progress' ? '● ' : '○ '}
                  {clip(task.subject, wide)}
                </Text>
              ),
            )}
            {column('DONE', GREEN, doneTasks, tasksNow.pageDone, true, 'nothing done yet', task => (
              <Text color={MUTED}>
                <Text color={GREEN}>✓ </Text>
                {clip(task.subject, wide)}
              </Text>
            ))}
          </Box>
        </Box>
      )

    // Notes: a field to type or dictate into, the open notes with a tick
    // button each, then the last few done.
    // chips, gap, frame, title and the field in its own frame: eight rows
    const noteRows = Math.max(2, tall - 9)
    const shownOpen = openNotes.slice(-noteRows).reverse()
    const shownDone = doneNotes.slice(0, Math.max(0, noteRows - Math.max(1, shownOpen.length)))
    const notesCard =
      open !== 'notes' ? undefined : (
        <Box flexDirection="column" width="100%" borderStyle="round" borderColor={EDGE}>
          <Box paddingX={1} justifyContent="space-between">
            <Text bold>
              Notes: {openNotes.length} open{dueNotes > 0 ? `, ${dueNotes} due` : ''}
            </Text>
            {doneNotes.length > 0 && <Button key="notes-clear" label={`Clear ${doneNotes.length} done`} onPress={() => clearDone($)} />}
          </Box>
          <Box width="100%" borderStyle="round" borderColor={BLUE} paddingX={1} alignItems="center" justifyContent="space-between">
            <Box flexGrow={1} alignItems="center">
              {Svg === undefined ? <Text>📝 </Text> : art('notes', AMBER, 'note')}
              <Box flexGrow={1}>
                <Input
                  key="note"
                  value={draftNote}
                  placeholder="Write or dictate a note here. 'in 30m', 'at 5pm' or 'tomorrow' sets a reminder"
                  submitLabel="Enter"
                  onInput={(value: string) => {
                    draftNote = value
                  }}
                  onSubmit={(value: string) => saveDraft($, value)}
                />
              </Box>
            </Box>
            <Button key="note-save" label="Save" variant="primary" onPress={() => saveDraft($, draftNote)} />
          </Box>
          {shownOpen.length === 0 && (
            <Box paddingX={1}>
              <Text color={MUTED}>no open notes</Text>
            </Box>
          )}
          {shownOpen.map((note, r) => (
            <Box paddingX={1} alignItems="center" backgroundColor={r % 2 === 1 ? STRIPE_BG : undefined}>
              <Button key={`note-done-${note.id}`} label="✓" onPress={() => finishNote($, note.id)} />
              <Text> </Text>
              <Button key={`note-cal-${note.id}`} label={isNarrow ? '+Cal' : '+ Calendar'} onPress={() => noteToEvent($, note.id)} />
              <Text> </Text>
              <Button key={`note-do-${note.id}`} label={isNarrow ? '→AI' : '→ Claude'} onPress={() => noteToClaude($, note.id)} />
              <Box flexGrow={1} flexShrink={1} overflow="hidden" marginLeft={1}>
                <Text bold={note.dueMs !== null && note.dueMs <= nowMs} color={note.dueMs !== null && note.dueMs <= nowMs ? AMBER : undefined}>
                  {clip(note.text, 96)}
                </Text>
              </Box>
              <Box width={isNarrow ? 11 : 16} justifyContent="flex-end">
                <Text color={MUTED}>
                  {note.dueMs === null ? ago(note.createdMs, nowMs) : note.dueMs <= nowMs ? 'due now' : `due ${when({ title: '', startMs: note.dueMs, endMs: note.dueMs, url: '', people: 0 }, nowMs).replace(/ \(.*\)$/, '')}`}
                </Text>
              </Box>
            </Box>
          ))}
          {shownDone.map(note => (
            <Box paddingX={1}>
              <Text color={MUTED} strikethrough>
                {clip(note.text, 100)}
              </Text>
            </Box>
          ))}
        </Box>
      )
    const isLive = playing !== null && nowMs > 0 && playing.has
    const musicCard =
      open !== 'music' ? undefined : (
        <Box flexDirection="column" width="100%">
          <Box width="100%" alignItems="center">
            {Svg === undefined ? (
              <Text>
                {playing === null || !playing.has ? 'nothing is playing' : `${playing.playing ? '▶' : '❚❚'} ${playing.title}  ${playing.artist}  ${mmss(playing.now)}`}
              </Text>
            ) : (
              <Svg
                source={deck(playing, Date.now(), Math.round((Number(e.props.bodyColumns) || 96) * 7.6), cover.uri, isClassic())}
                alt={playing === null || !playing.has ? 'music deck, nothing playing' : `playing ${playing.title} by ${playing.artist}`}
              />
            )}
            {settings.bars !== 'off' && Client !== undefined && (
              <Box flexGrow={1} marginLeft={1}>
                <Client key="spectrum" module="./spectrum.tsx" props={{ bars: [], live: false }} height={5} flexGrow={1} />
              </Box>
            )}
          </Box>
          <Box width="100%" alignItems="center" justifyContent="space-between" paddingX={1}>
            <Box alignItems="center">
              <Button key="music-prev" label={isNarrow ? '⏮' : '⏮ Back'} hotkey="b" onPress={() => sendMusic($, 'prev')} />
              <Text> </Text>
              <Button
                key="music-toggle"
                label={isLive && playing.playing ? (isNarrow ? '⏸' : '⏸ Pause') : isNarrow ? '▶' : '▶ Play'}
                hotkey="p"
                variant="primary"
                onPress={() => sendMusic($, 'toggle')}
              />
              <Text> </Text>
              <Button key="music-stop" label={isNarrow ? '⏹' : '⏹ Stop'} hotkey="s" onPress={() => sendMusic($, 'stop')} />
              <Text> </Text>
              <Button key="music-next" label={isNarrow ? '⏭' : 'Next ⏭'} hotkey="n" onPress={() => sendMusic($, 'next')} />
              <Text>   </Text>
              <Button key="music-voldown" label={isNarrow ? '🔉' : '🔉 −'} onPress={() => sendMusic($, 'voldown')} />
              <Text> </Text>
              <Button key="music-volup" label={isNarrow ? '🔊' : '🔊 +'} onPress={() => sendMusic($, 'volup')} />
            </Box>
            <Box alignItems="center">
              <Text color={MUTED}>{!isNarrow && playing !== null && playing.has ? `${playing.app.replace(/\.exe$/i, '')}  ` : ''}</Text>
              <Button key="music-sync" label={isNarrow ? '↻' : '↻ Sync'} onPress={() => startMusic($)} />
              <Text> </Text>
              <Button key="music-open" label={isNarrow ? 'YT Music' : 'Open YouTube Music'} onPress={() => openYouTubeMusic($)} />
            </Box>
          </Box>
        </Box>
      )
    // Settings: a heading with this session's switch, then one line per group,
    // a muted label and a row of pills (the lit pill is the one in force).
    const group = (label: string, pills: unknown, hint: string) => (
      <Box alignItems="center" marginTop={1}>
        <Box width={isNarrow ? 9 : 13}>
          <Text bold color={MUTED}>
            {label}
          </Text>
        </Box>
        {pills}
        <Text color={MUTED}>{isNarrow ? '' : hint}</Text>
      </Box>
    )
    const pill = (key: string, label: string, isLit: boolean, onPress: () => unknown) => (
      <Box marginRight={1}>
        <Button key={key} label={label} variant={isLit ? 'primary' : 'secondary'} onPress={onPress} />
      </Box>
    )
    const settingsCard =
      open !== 'settings' ? undefined : (
        <Box flexDirection="column" width="100%" borderStyle="round" borderColor={EDGE} paddingX={2}>
          <Box alignItems="center" justifyContent="space-between">
            <Box alignItems="center">
              <Text bold color={BLUE}>
                Settings
              </Text>
              <Text color={MUTED}>{isNarrow ? '' : '   shared by every session'}</Text>
            </Box>
            <Button key="set-off" label={isNarrow ? 'Desk off here' : 'Turn the desk off in this session'} onPress={() => setOn($, false)} />
          </Box>
          {group(
            'WIDGETS',
            CHIPS.map(name => pill(`set-${name}`, `${name.charAt(0).toUpperCase()}${name.slice(1)}`, settings.show[name] !== false, () => toggleChip($, name))),
            '',
          )}
          {group(
            isNarrow ? 'MAIL' : 'MAIL CHECK',
            [1, 3, 5, 10].map(minutes => pill(`set-mail-${minutes}`, `${minutes} min`, settings.mailMinutes === minutes, () => setMailMinutes($, minutes))),
            ' and on every click of the icon',
          )}
          {group(
            isNarrow ? 'BARS' : 'MUSIC BARS',
            [
              pill('set-bars-on', 'On', settings.bars !== 'off', () => setBars($, 'on')),
              pill('set-bars-off', 'Off', settings.bars === 'off', () => setBars($, 'off')),
              <Box width={isNarrow ? 8 : 10} marginLeft={2}>
                <Text bold color={MUTED}>
                  SOUNDS
                </Text>
              </Box>,
              pill('set-sounds', settings.sounds ? 'On' : 'Off', settings.sounds, () => toggleSounds($)),
            ],
            '',
          )}
        </Box>
      )
    const opened = mailCard ?? calendarCard ?? todoCard ?? notesCard ?? musicCard ?? settingsCard
    const drop =
      opened === undefined ? undefined : (
        <Box width="100%" marginTop={1}>
          {opened}
        </Box>
      )

    // Alone, or the first in the band: the work timer above places this row
    // at the left of its own, and keeps a dropdown under the row.
    if (below.type === 'engine') {
      return drop === undefined ? (
        mine
      ) : (
        <Box flexDirection="column" width="100%">
          {mine}
          {drop}
        </Box>
      )
    }

    // The work timer drew beneath: its tree is a full-width row (the chip
    // pushed right) or a column whose first child is that row. Put the weather
    // at the left of that row and keep the rest as it is.
    const kids = (below as { children?: unknown[] }).children ?? []
    const isColumn = (below as { props?: { flexDirection?: string } }).props?.flexDirection === 'column'
    const [first, ...rest] = isColumn ? kids : [below]
    const inner = (first as { children?: unknown[] } | undefined)?.children
    const chip = Array.isArray(inner) && inner.length > 0 ? inner : [first]

    return (
      <Box flexDirection="column" width="100%">
        <Box width="100%" justifyContent="space-between" alignItems="center">
          {mine}
          {chip}
        </Box>
        {drop}
        {rest}
      </Box>
    )
  }
}

// The buttons inside the dropdowns, by their keys. A press is answered here and
// not by the closure the drawing gave its button: while the row is redrawn
// often (music playing) the drawing a closure belongs to may already be gone.
// Answers false for a key it does not know.
async function pressKey($: EngineInterface, key: string) {
  const id = Number(key.slice(key.lastIndexOf('-') + 1))

  if (key === 'event-add') {
    await addEvent($, draftEvent)
  } else if (key === 'todo-more-open' || key === 'todo-more-done') {
    await turnPage($, key === 'todo-more-done', key === 'todo-more-done' ? pagesDone : pagesOpen)
  } else if (key === 'todo-mine') {
    await pickMine($)
  } else if (key === 'todo-prev' || key === 'todo-next') {
    await stepSession($, key === 'todo-prev' ? -1 : 1)
  } else if (key.startsWith('todo-pick-')) {
    await pickSession($, key.slice('todo-pick-'.length))
  } else if (key === 'notes-clear') {
    await clearDone($)
  } else if (key === 'note-save') {
    await saveDraft($, draftNote)
  } else if (key.startsWith('note-done-')) {
    await finishNote($, id)
  } else if (key.startsWith('note-cal-')) {
    await noteToEvent($, id)
  } else if (key.startsWith('note-do-')) {
    await noteToClaude($, id)
  } else if (key === 'set-off') {
    await setOn($, false)
  } else if (key === 'set-bars-on' || key === 'set-bars-off') {
    await setBars($, key === 'set-bars-on' ? 'on' : 'off')
  } else if (key === 'set-sounds') {
    await toggleSounds($)
  } else if (key.startsWith('set-mail-')) {
    await setMailMinutes($, id)
  } else if (key.startsWith('set-') && CHIPS.includes(key.slice(4))) {
    await toggleChip($, key.slice(4))
  } else {
    return false
  }

  return true
}

export const registerDesk: Register = on => {
  on('session.start', async ($, e, next) => {
    const result = await next(e)
    $.command.register({
      name: 'desk',
      description: 'Desk widgets (weather, mail, calendar, tasks, notes, music, timer) for this session: on, off, or status',
      argumentHint: 'on | off',
    })
    $.command.register({ name: 'weather', description: 'Print the context usage in detail' })
    await findHome($)
    await readEngine($)
    await checkUnattended($)
    await readSettings($)

    if (await readOn($)) {
      await startAll($)
    } else {
      $.ui.status(undefined)
    }

    return result
  })

  on('command.run', { command: 'desk' }, async ($, e) => {
    const word = e.args.trim().toLowerCase()

    if (isUnattended) {
      return { text: 'Desk widgets stay off in scheduled sessions.' }
    }

    if (word === 'demo') {
      // the answer goes by what was asked, not by `settings`: a re-read of the
      // file running at the same moment can still hold the old value
      const isDemo = !settings.demo
      await saveSettings($, { ...settings, demo: isDemo })

      return { text: isDemo ? 'Demo mode on: made-up mail, meetings, tasks and notes, for screenshots. /desk demo again turns it off.' : 'Demo mode off: your real data is back.' }
    }

    if (word === 'on' || word === 'off' || word === '') {
      const isOn = word === '' ? !deskOn : word === 'on'
      await setOn($, isOn)

      return {
        text: isOn
          ? 'Desk widgets are on for this session. /desk off turns them off.'
          : 'Desk widgets are off for this session. /desk on brings them back.',
      }
    }

    return { text: `Desk widgets are ${deskOn ? 'on' : 'off'} for this session. Use /desk on or /desk off.` }
  })

  on('tool.call', { tool: NOTES_TOOL }, async ($, e) => ({
    result: await notesTool($, String(e.action ?? 'list'), String(e.text ?? ''), Number(e.id)),
  }))

  on('prompt.context', async ($, e, next) => {
    const result = await next(e)

    if (isUnattended || !deskOn) {
      return result
    }

    const open = (await storedNotes($)).filter(n => n.doneMs === null)

    if (open.length === 0) {
      return result
    }

    const text = `The user keeps these notes in the notes widget, shared by all sessions. Mention one when the work touches it, and mark it done with the ${NOTES_TOOL} tool once it is handled.\n\n${notesText(open, await $.clock.now())}`

    return { ...result, blocks: [...result.blocks.filter(b => b.name !== 'sidNotes'), { name: 'sidNotes', text }] }
  })

  on('prompt.submit', async ($, e, next) => {
    if (String(e.text ?? '').includes('<scheduled-task')) {
      isUnattended = true
      $.ui.status(undefined)
      $.ui.invalidate('ui.render')
    }

    return next(e)
  })

  // The smooth bars' region posts for its next frame of data; the answer's
  // props reach that region alone.
  on('ui.message', async ($, e, next) => {
    if (e.element !== 'spectrum') {
      return {}
    }

    return { props: await liveBars($) }
  })

  // The row's buttons, answered by their key. While the music deck is open
  // the band is redrawn several times a second, and a click that lands
  // between two drawings no longer finds the closure it was drawn with: the
  // key is still the same, so the press is taken here instead.
  on('ui.press', async ($, e, next) => {
    if (e.plugin !== 'deskbar' || e.component !== 'AbovePrompt') {
      return next(e)
    }

    const sends: Record<string, string> = {
      'music-prev': 'prev',
      'music-toggle': 'toggle',
      'music-stop': 'stop',
      'music-next': 'next',
      'music-voldown': 'voldown',
      'music-volup': 'volup',
    }
    const send = sends[e.element]

    if (send !== undefined) {
      await sendMusic($, send)
    } else if (e.element === 'music') {
      await toggleMusic($)
    } else if (e.element === 'music-sync') {
      startMusic($)
    } else if (e.element === 'music-open') {
      await openYouTubeMusic($)
    } else if (e.element === 'mail' || e.element === 'calendar') {
      await openFresh($, e.element)
    } else if (e.element === 'todo') {
      await toggleTodo($)
    } else if (e.element === 'notes' || e.element === 'settings') {
      await setPanel($, e.element)
    } else if (!(await pressKey($, e.element))) {
      return next(e)
    }

    return { element: e.element }
  })

  on('command.run', { command: 'weather' }, async $ => ({
    text: deskOn ? (detail(await read($, readings)) ?? 'No reading yet.') : 'Desk widgets are off for this session. /desk on turns them on.',
  }))

  on('turn.complete', async ($, e, next) => {
    const result = await next(e)
    await measure($)
    await countTasks($).catch(() => undefined)
    void poll($, 45000).catch(() => undefined)

    return result
  })

  on('ui.render', { component: 'AbovePrompt' }, async ($, e, next) => {
    const below = await next(e)

    try {
      return await band($, e, below)
    } catch {
      return below
    }
  })
}

