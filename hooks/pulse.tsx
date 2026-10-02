// A surface module: one dot that breathes, for the few things that want
// attention now (a meeting about to start, a note that is due, a timer that
// is running). It fades between its colour and a dim version of it, on the
// app's own drawing thread.

type Props = { tint?: string; fast?: boolean }
type State = { n: number }

const latest = new WeakMap<object, Props>()

const hex = (v: number) => Math.max(0, Math.min(255, Math.round(v))).toString(16).padStart(2, '0')

// `tint` at `part` of its strength over the dark of the row
function fade(tint: string, part: number) {
  const r = parseInt(tint.slice(1, 3), 16)
  const g = parseInt(tint.slice(3, 5), 16)
  const b = parseInt(tint.slice(5, 7), 16)
  const mix = (c: number, dark: number) => dark + (c - dark) * part

  return `#${hex(mix(r, 0x26))}${hex(mix(g, 0x2c))}${hex(mix(b, 0x30))}`
}

export default function Pulse(props: Props, surface: any) {
  const { Text } = surface.elements
  latest.set(surface, props ?? {})

  if (surface.state === undefined) {
    surface.setState({ n: 0 })
    surface.every(70, () => {
      const s: State = surface.state ?? { n: 0 }
      surface.setState({ n: s.n + 1 })
    })
  }

  const s: State = surface.state ?? { n: 0 }
  const tint = /^#[0-9a-fA-F]{6}$/.test(props?.tint ?? '') ? (props?.tint as string) : '#1baf7a'
  // one breath every two seconds, or every second when it is urgent
  const beat = (s.n * 70) / (props?.fast === true ? 1000 : 2000)
  const part = 0.35 + 0.65 * (0.5 + 0.5 * Math.cos(beat * 2 * Math.PI))

  return <Text color={fade(tint, part)}>●</Text>
}
