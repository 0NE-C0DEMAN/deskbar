// A surface module: drawn on the app's own drawing thread, at its frame rate,
// with no `$`. It animates by itself, so the row above the prompt is not
// redrawn for every frame of the music bars (and its buttons stop flickering).
//
// The hooks module hands it the latest bar heights whenever it asks (a `post`
// answered with `{ props }`); between two answers it eases every bar toward
// its target, fast on the way up and slow on the way down, with a peak cap
// that hangs and then falls.

type Props = { bars?: number[]; live?: boolean }
type State = { shown: number[]; peaks: number[]; n: number }

const BARS = 24
const TOP = 9 // the helper's bar heights run 0 to 9
const GLYPHS = [' ', '▁', '▂', '▃', '▄', '▅', '▆', '▇', '█']
const GREEN = '#3ddc5a'
const AMBER = '#ffc93c'
const RED = '#ff4d4d'
const CAP = '#eafff0'
const DARK = '#060b08'

let target: number[] = []

export default function Spectrum(props: Props, surface: any) {
  const { Box, Text } = surface.elements
  target = props?.live === true && Array.isArray(props.bars) ? props.bars : []

  if (surface.state === undefined) {
    surface.setState({ shown: [], peaks: [], n: 0 })
    surface.every(50, () => {
      const s: State = surface.state ?? { shown: [], peaks: [], n: 0 }
      const shown: number[] = []
      const peaks: number[] = []

      for (let i = 0; i < BARS; i += 1) {
        const want = target[i] ?? 0
        const now = s.shown[i] ?? 0
        const next = now + (want - now) * (want > now ? 0.65 : 0.22)
        shown.push(next < 0.05 ? 0 : next)
        peaks.push(Math.max(next, (s.peaks[i] ?? 0) - 0.14))
      }

      surface.setState({ shown, peaks, n: s.n + 1 })

      // every tick: ask the hooks module for the speaker's latest bars
      surface.post({ want: 'bars' })
    })
  }

  const s: State = surface.state ?? { shown: [], peaks: [], n: 0 }
  const rows = Math.max(2, surface.rows || 5)
  const columns = Math.max(BARS, surface.columns || 48)
  const wide = Math.max(1, Math.floor((columns - 2) / BARS) - 1)
  const lines = []

  for (let r = rows - 1; r >= 0; r -= 1) {
    let text = ' '

    for (let i = 0; i < BARS; i += 1) {
      const level = ((s.shown[i] ?? 0) / TOP) * rows - r
      const peak = Math.floor(((s.peaks[i] ?? 0) / TOP) * rows * 0.999)
      const fill = Math.max(0, Math.min(8, Math.round(level * 8)))
      const glyph = fill === 0 && peak === r && (s.peaks[i] ?? 0) > 0.4 ? '▔' : GLYPHS[fill]
      text += `${(glyph ?? ' ').repeat(wide)} `
    }

    const tone = r >= rows - 1 ? RED : r >= rows - 2 ? AMBER : GREEN
    lines.push(
      <Text color={text.includes('▔') && !/[▁-█]/.test(text) ? CAP : tone} backgroundColor={DARK}>
        {text.padEnd(columns)}
      </Text>,
    )
  }

  return (
    <Box flexDirection="column" backgroundColor={DARK}>
      {lines}
    </Box>
  )
}
