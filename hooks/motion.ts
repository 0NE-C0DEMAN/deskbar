// Motion for surfaces that do not run surface modules (the desktop app, at the
// time of writing): small SVGs that animate by themselves with SMIL. Drawn
// with `isInteractive`, the app puts each in a script-less frame where the
// animation plays; while its markup stays the same it is not reloaded.

// A progress bar: the fill grows to its value when drawn, and a bright band
// sweeps along it while the thing it measures is under way.
export function meterSvg(value: number, isActive: boolean, tint: string, width: number) {
  const h = 10
  const fill = (Math.max(0, Math.min(1, Number(value) || 0)) * width).toFixed(1)
  const sweep =
    isActive && Number(fill) > 8
      ? `<rect x="-16" y="0" width="16" height="${h}" fill="#ffffff" opacity="0.5"><animate attributeName="x" from="-16" to="${fill}" dur="1.3s" repeatCount="indefinite"/></rect>`
      : ''

  return `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${h}" viewBox="0 0 ${width} ${h}"><defs><clipPath id="fill"><rect x="0" y="0" width="${fill}" height="${h}" rx="3"><animate attributeName="width" from="0" to="${fill}" dur="0.7s" fill="freeze"/></rect></clipPath></defs><rect width="${width}" height="${h}" rx="3" fill="#22333b"/><g clip-path="url(#fill)"><rect width="${width}" height="${h}" fill="${tint}"/>${sweep}</g></svg>`
}

// A dot that breathes: one breath every two seconds, or every second when urgent.
export function pulseSvg(tint: string, isFast: boolean) {
  return `<svg xmlns="http://www.w3.org/2000/svg" width="12" height="12" viewBox="0 0 12 12"><circle cx="6" cy="6" r="5" fill="${tint}" opacity="0.25"><animate attributeName="r" values="3;5.5;3" dur="${isFast ? '1s' : '2s'}" repeatCount="indefinite"/></circle><circle cx="6" cy="6" r="3" fill="${tint}"><animate attributeName="opacity" values="1;0.45;1" dur="${isFast ? '1s' : '2s'}" repeatCount="indefinite"/></circle></svg>`
}

// The music deck's analyser where the row cannot be redrawn for every reading
// (the desktop app before surface modules): 24 LED bars that dance by
// themselves, in a frame of their own, so the row and its buttons stay still.
// `level` is how loud the music is, 0 (silent) to 3: it sets how high they
// dance, and the picture only changes when it does.
export function spectrumSvg(level: number, width: number) {
  const W = Math.max(160, Math.round(width))
  const tall = [0, 0.62, 0.84, 1][Math.max(0, Math.min(3, Math.round(level)))] ?? 0
  let seed = 7
  const next = () => {
    seed = (seed * 1103515245 + 12345) % 2147483648

    return seed / 2147483648
  }
  let bars = ''

  for (let i = 0; i < 24; i += 1) {
    // bass at the left stands taller than the highs at the right
    const reach = tall * (1 - 0.45 * (i / 23)) * 69
    const x = (2 + i * 4.02).toFixed(2)

    if (reach < 1) {
      bars += `<rect x="${x}%" y="81.5" width="3%" height="4.1" fill="#3ddc5a" opacity="0.35"/>`
      continue
    }

    // twelve heights a loop, a new one every twentieth of a second or so: quick, like a real analyser
    const steps = Array.from({ length: 12 }, () => Math.max(4.1, reach * (0.18 + 0.82 * next() ** 0.8)))
    const heights = [...steps, steps[0]].map(h => h.toFixed(1)).join(';')
    const tops = [...steps, steps[0]].map(h => (85.6 - (h ?? 0)).toFixed(1)).join(';')
    const dur = (0.55 + next() * 0.45).toFixed(2)
    bars +=
      `<rect x="${x}%" width="3%" fill="url(#led)"><animate attributeName="height" values="${heights}" dur="${dur}s" repeatCount="indefinite"/>` +
      `<animate attributeName="y" values="${tops}" dur="${dur}s" repeatCount="indefinite"/></rect>`
  }

  let gaps = ''

  for (let k = 0; k < 13; k += 1) {
    gaps += `<rect x="0" y="${(85.6 - k * 5.75).toFixed(2)}" width="100%" height="1.65" fill="#060b08"/>`
  }

  // A plain picture (not a frame of its own, which the app reloads on every
  // redraw of the row): while its markup stays the same it keeps playing.
  return (
    `<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="96" viewBox="0 0 ${W} 96">` +
    `<defs><linearGradient id="led" gradientUnits="userSpaceOnUse" x1="0" y1="86" x2="0" y2="16"><stop offset="0" stop-color="#3ddc5a"/><stop offset="0.56" stop-color="#3ddc5a"/><stop offset="0.6" stop-color="#ffc93c"/><stop offset="0.82" stop-color="#ffc93c"/><stop offset="0.86" stop-color="#ff4d4d"/><stop offset="1" stop-color="#ff4d4d"/></linearGradient></defs>` +
    `<rect x="0.5" y="0.5" width="${W - 1}" height="95" rx="9" fill="#1b1e21" stroke="#3b4146"/>` +
    `<rect x="6" y="9" width="${W - 12}" height="78" rx="5" fill="#060b08" stroke="#0e2a14"/>` +
    `<svg x="12" y="0" width="${W - 24}" height="96" overflow="hidden">${bars}${gaps}</svg></svg>`
  )
}
