// A surface module: one animated progress bar, drawn on the app's own drawing
// thread. Its fill glides to a new value instead of jumping, and while the
// thing it measures is under way (`active`) a bright band sweeps along it.
// Settled and not active, it stops ticking its own redraws.

type Props = { value?: number; active?: boolean; tint?: string }
type State = { shown: number; n: number }

const TRACK = '#22333b'
const EIGHTHS = ['', '▏', '▎', '▍', '▌', '▋', '▊', '▉']

// the newest props of each instance, for its timer to read
const latest = new WeakMap<object, Props>()

export default function Meter(props: Props, surface: any) {
  const { Box, Text } = surface.elements
  latest.set(surface, props ?? {})

  if (surface.state === undefined) {
    surface.setState({ shown: 0, n: 0 })
    surface.post({ hello: 'meter' }) // lets the hooks module note that this surface draws modules
    surface.every(60, () => {
      const s: State = surface.state ?? { shown: 0, n: 0 }
      const now = latest.get(surface) ?? {}
      const want = Math.max(0, Math.min(1, Number(now.value) || 0))
      const isSettled = Math.abs(want - s.shown) < 0.003

      if (isSettled && now.active !== true) {
        if (s.shown !== want) {
          surface.setState({ shown: want, n: s.n })
        }

        return
      }

      surface.setState({ shown: isSettled ? want : s.shown + (want - s.shown) * 0.16, n: s.n + 1 })
    })
  }

  const s: State = surface.state ?? { shown: 0, n: 0 }
  const cells = Math.max(4, surface.columns || 16)
  const tint = props?.tint ?? '#1baf7a'
  const exact = s.shown * cells
  const whole = Math.floor(exact)
  const part = EIGHTHS[Math.round((exact - whole) * 8) % 8] ?? ''
  const fill = '█'.repeat(whole) + part
  const rest = '░'.repeat(Math.max(0, cells - whole - (part === '' ? 0 : 1)))

  // the sweeping band: three cells, running the length of the fill and a little past
  const at = props?.active === true && whole > 2 ? Math.floor((s.n * 0.5) % (whole + 8)) - 4 : -99
  const from = Math.max(0, Math.min(whole, at))
  const to = Math.max(0, Math.min(whole, at + 3))

  return (
    <Box>
      <Text color={tint}>{fill.slice(0, from)}</Text>
      <Text color="#ffffff">{fill.slice(from, to)}</Text>
      <Text color={tint}>{fill.slice(to)}</Text>
      <Text color={TRACK}>{rest}</Text>
    </Box>
  )
}
