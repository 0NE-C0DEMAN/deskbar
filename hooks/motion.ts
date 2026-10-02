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
