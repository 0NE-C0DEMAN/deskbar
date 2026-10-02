export type Reading = { tokens: number; window: number; percent: number }

export type Mail = { id: string; from: string; subject: string; atMs: number; url: string; isUnread: boolean }

export type Inbox = { count: number; other: number; list: Mail[]; error: string }

export type Meeting = { title: string; startMs: number; endMs: number; url: string; people: number }

export type Desk = { inbox: Inbox | null; events: Meeting[]; calendarError: string; nowMs: number }

export type Note = {
  id: number
  text: string
  createdMs: number
  dueMs: number | null
  doneMs: number | null
  notifiedMs: number | null
}

export type Task = { id: string; subject: string; status: string }

export type TodoSession = { id: string; name: string; count: number }

export type Todo = { sessions: TodoSession[]; selected: string; tasks: Task[]; open: number; isLoading: boolean; query: string; pageOpen: number; pageDone: number }

export type Music = {
  at: number
  bars: number[]
  has: boolean
  title: string
  artist: string
  app: string
  playing: boolean
  now: number
  duration: number
  error: string
  coverKey: string
}

export type Config = {
  client: string
  rate: number
  weeklyCap: number
  currency: string
  utcOffsetMinutes: number
}

export type Running = { task: string; start: string; billable: boolean; idle: number }

export type Entry = {
  id: number
  date: string
  start: string | null
  end: string | null
  hours: number
  task: string
  note: string
  evidence: string
  billable: boolean
  invoice: string | null
}

export type Row = { from: string; to: string; hours: number; task: string; billable: boolean }

export type Day = { label: string; date: string; hours: number }

export type Snap = {
  client: string
  rate: number
  cap: number
  currency: string
  offset: number
  nowMs: number
  running: Running | null
  startMs: number
  todayBase: number
  weekBase: number
  today: Row[]
  week: Day[]
  unbilledHours: number
  unbilledFrom: string
  unbilledDays: number
  expenses: number
  last: { task: string; end: string } | null
}

declare module 'claude-code' {
  interface PluginState {
    deskbar: {
      readings: Reading[]
      isHidden: boolean
      desk: Desk
      panel: string
      panelAt: number
      settingsAt: number
      notes: Note[]
      todo: Todo
      music: Music | null
      snap: Snap | null
      isOpen: boolean
      timerHidden: boolean
      openAt: number
    }
  }
}
