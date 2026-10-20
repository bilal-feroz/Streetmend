// Canvas-drawn marker icons (consistent, small, non-colour-only).
// Repair states use distinct glyphs: bar = blocked, check = repaired,
// ? = uncertain, letter = recommended / labelled candidate.

export type RepairState = 'blocked' | 'candidate' | 'recommended' | 'repaired' | 'unknown'
export type PlaceKind = 'origin' | 'healthcare' | 'transit' | 'education'

export const PALETTE = {
  ink: '#22342d',
  muted: '#687870',
  ok: '#198568',
  bad: '#d85e51',
  unk: '#dca344',
  sel: '#3568c8',
  white: '#ffffff',
  line: '#e4e9e3',
}

const S = 96 // canvas resolution (device px)

function canvas() {
  const c = document.createElement('canvas')
  c.width = S
  c.height = S
  return c
}

function circle(ctx: CanvasRenderingContext2D, r: number, fill: string, stroke?: string, lw = 0, dashed = false) {
  ctx.beginPath()
  ctx.arc(S / 2, S / 2, r, 0, Math.PI * 2)
  ctx.fillStyle = fill
  ctx.fill()
  if (stroke && lw) {
    ctx.setLineDash(dashed ? [7, 5] : [])
    ctx.lineWidth = lw
    ctx.strokeStyle = stroke
    ctx.stroke()
    ctx.setLineDash([])
  }
}

function shadow(ctx: CanvasRenderingContext2D) {
  ctx.shadowColor = 'rgba(20, 40, 30, 0.28)'
  ctx.shadowBlur = 8
  ctx.shadowOffsetY = 2
}

function noShadow(ctx: CanvasRenderingContext2D) {
  ctx.shadowColor = 'transparent'
  ctx.shadowBlur = 0
  ctx.shadowOffsetY = 0
}

export function repairIcon(state: RepairState, label: string | null, selected: boolean, hypothetical: boolean): HTMLCanvasElement {
  const c = canvas()
  const ctx = c.getContext('2d')!
  if (selected) {
    circle(ctx, 47, 'rgba(53, 104, 200, 0.2)')
    circle(ctx, 44, 'rgba(0,0,0,0)', PALETTE.sel, 4)
  }
  shadow(ctx)
  const r = selected ? 33 : 38
  if (state === 'repaired') circle(ctx, r, PALETTE.ok, PALETTE.white, 5)
  else if (state === 'recommended') circle(ctx, r, PALETTE.sel, PALETTE.white, 5)
  else if (state === 'unknown') circle(ctx, r, PALETTE.unk, PALETTE.white, 5)
  else if (state === 'candidate') circle(ctx, r, PALETTE.white, PALETTE.bad, 5, hypothetical)
  else circle(ctx, r, PALETTE.white, PALETTE.bad, 6, hypothetical)
  noShadow(ctx)
  ctx.lineCap = 'round'
  ctx.lineJoin = 'round'
  const k = r / 28 // glyphs were drawn for r = 28
  ctx.translate(S / 2, S / 2)
  ctx.scale(k, k)
  ctx.translate(-S / 2, -S / 2)
  const showLabel = label && label.length <= 2
  if (state === 'repaired') {
    ctx.strokeStyle = PALETTE.white
    ctx.lineWidth = 7
    ctx.beginPath()
    ctx.moveTo(35, 49)
    ctx.lineTo(44, 58)
    ctx.lineTo(62, 39)
    ctx.stroke()
  } else if (showLabel) {
    ctx.fillStyle = state === 'blocked' || state === 'candidate' ? PALETTE.bad : PALETTE.white
    ctx.font = '700 30px Inter, "Segoe UI", system-ui, sans-serif'
    ctx.textAlign = 'center'
    ctx.textBaseline = 'middle'
    ctx.fillText(label!, S / 2, S / 2 + 1.5)
  } else if (state === 'unknown') {
    ctx.fillStyle = PALETTE.white
    ctx.font = '800 32px Inter, system-ui, sans-serif'
    ctx.textAlign = 'center'
    ctx.textBaseline = 'middle'
    ctx.fillText('?', S / 2, S / 2 + 1)
  } else {
    // barrier bar
    ctx.strokeStyle = state === 'recommended' ? PALETTE.white : PALETTE.bad
    ctx.lineWidth = 7
    ctx.beginPath()
    ctx.moveTo(36, 48)
    ctx.lineTo(60, 48)
    ctx.stroke()
  }
  resetT(ctx)
  return c
}

function resetT(ctx: CanvasRenderingContext2D) {
  ctx.setTransform(1, 0, 0, 1, 0, 0)
}

function roundRect(ctx: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, r: number) {
  ctx.beginPath()
  ctx.moveTo(x + r, y)
  ctx.arcTo(x + w, y, x + w, y + h, r)
  ctx.arcTo(x + w, y + h, x, y + h, r)
  ctx.arcTo(x, y + h, x, y, r)
  ctx.arcTo(x, y, x + w, y, r)
  ctx.closePath()
}

/** Places: rounded square, category glyph. `ring` marks a journey endpoint. */
export function placeIcon(kind: PlaceKind, ring: string | null, dim: boolean): HTMLCanvasElement {
  const c = canvas()
  const ctx = c.getContext('2d')!
  ctx.globalAlpha = dim ? 0.75 : 1
  if (ring) {
    roundRect(ctx, 2, 2, 92, 92, 24)
    ctx.fillStyle = ring
    ctx.fill()
  }
  shadow(ctx)
  roundRect(ctx, 9, 9, 78, 78, 18)
  ctx.fillStyle = PALETTE.white
  ctx.fill()
  noShadow(ctx)
  ctx.lineWidth = 2.5
  ctx.strokeStyle = '#c9d2cb'
  ctx.stroke()
  ctx.translate(S / 2, S / 2)
  ctx.scale(1.12, 1.12)
  ctx.translate(-S / 2, -S / 2)
  const ink = kind === 'healthcare' ? '#b5473c' : kind === 'transit' ? '#2c5fa8' : kind === 'education' ? '#7a5a12' : PALETTE.ink
  ctx.strokeStyle = ink
  ctx.fillStyle = ink
  ctx.lineWidth = 6
  ctx.lineCap = 'round'
  ctx.lineJoin = 'round'
  ctx.beginPath()
  if (kind === 'healthcare') {
    ctx.moveTo(48, 31); ctx.lineTo(48, 65)
    ctx.moveTo(31, 48); ctx.lineTo(65, 48)
    ctx.lineWidth = 9
    ctx.stroke()
  } else if (kind === 'transit') {
    roundRect(ctx, 32, 28, 32, 34, 7)
    ctx.stroke()
    ctx.beginPath()
    ctx.moveTo(32, 46); ctx.lineTo(64, 46)
    ctx.moveTo(37, 66); ctx.lineTo(37, 69)
    ctx.moveTo(59, 66); ctx.lineTo(59, 69)
    ctx.stroke()
  } else if (kind === 'education') {
    ctx.moveTo(26, 42); ctx.lineTo(48, 32); ctx.lineTo(70, 42); ctx.lineTo(48, 52); ctx.closePath()
    ctx.stroke()
    ctx.beginPath()
    ctx.moveTo(36, 47); ctx.lineTo(36, 58); ctx.quadraticCurveTo(48, 66, 60, 58); ctx.lineTo(60, 47)
    ctx.stroke()
  } else {
    ctx.moveTo(30, 47); ctx.lineTo(48, 31); ctx.lineTo(66, 47)
    ctx.moveTo(35, 43); ctx.lineTo(35, 65); ctx.lineTo(61, 65); ctx.lineTo(61, 43)
    ctx.stroke()
  }
  resetT(ctx)
  return c
}
