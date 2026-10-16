import { useEffect, useState, type ReactNode } from 'react'

type Pt = { x: number; y: number }
type Kind = 'square' | 'tri' | 'rect'
type Mode = 'peri' | 'axes'

type Side = { a: Pt; b: Pt; name: string }
type Axis = { a: Pt; b: Pt; half: Pt[]; rest: Pt[]; ok: boolean; name: string }
type Figure = {
  kind: Kind
  sides: Side[]
  axes: Axis[]
  rule: string
  axesCount: string
}

const CORAL = '#e86a45'
const LEAF = '#2f9e6b'
const PHOTO = { w: 890, h: 308, src: '/figures/geometry.jpg' }
const ZOOM: Record<Kind | 'all', string> = {
  all: '0 0 890 308',
  square: '50 50 300 258',
  tri: '300 40 360 268',
  rect: '600 80 280 228',
}

function mid(a: Pt, b: Pt): Pt {
  return { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 }
}

function lerp(a: Pt, b: Pt, t: number): Pt {
  return { x: a.x + (b.x - a.x) * t, y: a.y + (b.y - a.y) * t }
}

function reflect(p: Pt, a: Pt, b: Pt): Pt {
  const dx = b.x - a.x
  const dy = b.y - a.y
  const len2 = dx * dx + dy * dy
  const t = ((p.x - a.x) * dx + (p.y - a.y) * dy) / len2
  const qx = a.x + t * dx
  const qy = a.y + t * dy
  return { x: 2 * qx - p.x, y: 2 * qy - p.y }
}

function poly(points: Pt[]): string {
  return points.map((p) => `${p.x},${p.y}`).join(' ')
}

function smooth(t: number): number {
  const x = Math.min(1, Math.max(0, t))
  return x * x * (3 - 2 * x)
}

function square(): Figure {
  const A = { x: 128, y: 272 }
  const B = { x: 128, y: 118 }
  const C = { x: 278, y: 118 }
  const D = { x: 278, y: 272 }
  const top = mid(B, C)
  const bottom = mid(A, D)
  const left = mid(A, B)
  const right = mid(C, D)
  return {
    kind: 'square',
    sides: [
      { a: A, b: B, name: 'AB' },
      { a: B, b: C, name: 'BC' },
      { a: C, b: D, name: 'CD' },
      { a: D, b: A, name: 'DA' },
    ],
    axes: [
      { a: top, b: bottom, half: [B, top, bottom, A], rest: [top, C, D, bottom], ok: true, name: 'сверху вниз' },
      { a: left, b: right, half: [B, C, right, left], rest: [left, right, D, A], ok: true, name: 'слева направо' },
      { a: A, b: C, half: [A, B, C], rest: [A, D, C], ok: true, name: 'из угла в угол' },
      { a: B, b: D, half: [B, C, D], rest: [B, A, D], ok: true, name: 'из другого угла в угол' },
    ],
    rule: '4 равные стороны. Периметр = сторона · 4',
    axesCount: 'Осей симметрии: 4',
  }
}

function triangle(): Figure {
  const K = { x: 354, y: 276 }
  const L = { x: 478, y: 113 }
  const M = { x: 600, y: 276 }
  const km = mid(K, M)
  const lm = mid(L, M)
  const kl = mid(K, L)
  return {
    kind: 'tri',
    sides: [
      { a: K, b: L, name: 'KL' },
      { a: L, b: M, name: 'LM' },
      { a: M, b: K, name: 'MK' },
    ],
    axes: [
      { a: L, b: km, half: [L, K, km], rest: [L, M, km], ok: true, name: 'из верхнего угла' },
      { a: K, b: lm, half: [K, L, lm], rest: [K, M, lm], ok: true, name: 'из левого угла' },
      { a: M, b: kl, half: [M, L, kl], rest: [M, K, kl], ok: true, name: 'из правого угла' },
    ],
    rule: '3 равные стороны. Периметр = сторона · 3',
    axesCount: 'Осей симметрии: 3',
  }
}

function rectangle(): Figure {
  const N = { x: 664, y: 276 }
  const O = { x: 664, y: 154 }
  const P = { x: 830, y: 154 }
  const T = { x: 830, y: 276 }
  const top = mid(O, P)
  const bottom = mid(N, T)
  const left = mid(N, O)
  const right = mid(P, T)
  return {
    kind: 'rect',
    sides: [
      { a: N, b: O, name: 'NO' },
      { a: O, b: P, name: 'OP' },
      { a: P, b: T, name: 'PT' },
      { a: T, b: N, name: 'TN' },
    ],
    axes: [
      { a: top, b: bottom, half: [O, top, bottom, N], rest: [top, P, T, bottom], ok: true, name: 'сверху вниз' },
      { a: left, b: right, half: [O, P, right, left], rest: [left, right, T, N], ok: true, name: 'слева направо' },
      { a: N, b: P, half: [N, O, P], rest: [N, T, P], ok: false, name: 'из угла в угол' },
    ],
    rule: '(длина + ширина) · 2',
    axesCount: 'Осей симметрии: 2',
  }
}

const FIGURES: Record<Kind, Figure> = {
  square: square(),
  tri: triangle(),
  rect: rectangle(),
}

function useNow(active: boolean) {
  const [now, setNow] = useState(0)
  useEffect(() => {
    if (!active) return
    let raf = 0
    const start = performance.now()
    const tick = (t: number) => {
      setNow(Math.max(0, t - start))
      raf = requestAnimationFrame(tick)
    }
    raf = requestAnimationFrame(tick)
    return () => cancelAnimationFrame(raf)
  }, [active])
  return now
}

function useReduceMotion() {
  const [reduce, setReduce] = useState(false)
  useEffect(() => {
    const media = window.matchMedia('(prefers-reduced-motion: reduce)')
    const apply = () => setReduce(media.matches)
    apply()
    media.addEventListener('change', apply)
    return () => media.removeEventListener('change', apply)
  }, [])
  return reduce
}

export function GeoVisual({ step }: { step: number }) {
  if (step <= 0) return <Trio />
  const plan: { kind: Kind; mode: Mode }[] = [
    { kind: 'square', mode: 'peri' },
    { kind: 'square', mode: 'axes' },
    { kind: 'tri', mode: 'peri' },
    { kind: 'tri', mode: 'axes' },
    { kind: 'rect', mode: 'peri' },
    { kind: 'rect', mode: 'axes' },
  ]
  const item = plan[step - 1] ?? plan[0]
  return <AnimatedFigure key={`${item.kind}-${item.mode}`} kind={item.kind} mode={item.mode} />
}

function BookPhoto({ box, children }: { box: string; children?: ReactNode }) {
  return (
    <svg className="geo-svg" viewBox={box} role="img" aria-label="Фигуры из учебника">
      <image href={PHOTO.src} x="0" y="0" width={PHOTO.w} height={PHOTO.h} />
      {children}
    </svg>
  )
}

function Trio() {
  return (
    <div className="geo-card">
      <BookPhoto box={ZOOM.all} />
      <p className="geo-status spot">Буквы стоят на углах, как в учебнике.</p>
      <p className="geo-rule">1. Периметр — сумма сторон. 2. Ось симметрии — две одинаковые половины.</p>
    </div>
  )
}

function AnimatedFigure({ kind, mode }: { kind: Kind; mode: Mode }) {
  const fig = FIGURES[kind]
  const reduce = useReduceMotion()
  const now = useNow(!reduce)
  const frame = mode === 'peri' ? periFrame(fig, now, reduce) : axesFrame(fig, now, reduce)
  return (
    <div className="geo-card">
      <BookPhoto box={ZOOM[kind]}>
        <defs>
          <marker id="geo-arrow" markerUnits="userSpaceOnUse" markerWidth="22" markerHeight="22" refX="18" refY="11" orient="auto">
            <path d="M1,3 L20,11 L1,19 Z" fill={CORAL} />
          </marker>
        </defs>
        {mode === 'peri' && <PerimeterDraw fig={fig} frame={frame} />}
        {mode === 'axes' && <AxesDraw fig={fig} frame={frame} />}
      </BookPhoto>
      <p className={`geo-status spot ${frame.tone}`}>{frame.status}</p>
      <p className="geo-rule">{mode === 'peri' ? fig.rule : fig.axesCount}</p>
    </div>
  )
}

type Frame = {
  side: number
  along: number
  done: boolean
  axis: number
  fold: number
  status: string
  tone: '' | 'ok' | 'bad'
}

function periFrame(fig: Figure, now: number, reduce: boolean): Frame {
  const slot = 1200
  const n = fig.sides.length
  if (reduce) {
    return { side: n, along: 1, done: true, axis: 0, fold: 0, status: fig.rule, tone: 'ok' }
  }
  const turn = (n + 1) * slot
  const local = ((now % turn) + turn) % turn
  const index = Math.min(n, Math.max(0, Math.floor(local / slot)))
  if (index >= n) {
    return { side: n, along: 1, done: true, axis: 0, fold: 0, status: `Все стороны пройдены. ${fig.rule}`, tone: 'ok' }
  }
  return {
    side: index,
    along: (local % slot) / slot,
    done: false,
    axis: 0,
    fold: 0,
    status: `Сторона ${index + 1} из ${n}. Полоска идёт по рисунку из учебника.`,
    tone: '',
  }
}

function axesFrame(fig: Figure, now: number, reduce: boolean): Frame {
  const slot = 2400
  const n = fig.axes.length
  if (reduce) {
    return { side: 0, along: 0, done: false, axis: 0, fold: 1, status: fig.axesCount, tone: 'ok' }
  }
  const index = ((Math.floor(now / slot) % n) + n) % n
  const local = (((now % slot) + slot) % slot) / slot
  const fold = local < 0.18 ? 0 : local < 0.62 ? smooth((local - 0.18) / 0.44) : 1
  const axis = fig.axes[index]
  const settled = fold > 0.92
  const status = !settled
    ? `Линия ${axis.name}. Смотри, ляжет ли половина на другую.`
    : axis.ok
      ? 'Половины совпали. Это ось симметрии.'
      : 'Половины не совпали. Это не ось симметрии.'
  return {
    side: 0,
    along: 0,
    done: false,
    axis: index,
    fold,
    status,
    tone: settled ? (axis.ok ? 'ok' : 'bad') : '',
  }
}

function PerimeterDraw({ fig, frame }: { fig: Figure; frame: Frame }) {
  const moving = frame.done ? null : fig.sides[frame.side]
  const walker = moving ? lerp(moving.a, moving.b, frame.along) : fig.sides[0].a
  return (
    <g>
      {fig.sides.map((side, index) => {
        if (!frame.done && index > frame.side) return null
        const tip = !frame.done && index === frame.side
        const end = tip ? walker : side.b
        return (
          <line
            key={side.name}
            x1={side.a.x}
            y1={side.a.y}
            x2={end.x}
            y2={end.y}
            stroke={CORAL}
            strokeWidth={tip ? 8 : 6}
            strokeLinecap="round"
            markerEnd={tip ? 'url(#geo-arrow)' : undefined}
          />
        )
      })}
      {moving && <circle cx={walker.x} cy={walker.y} r="5" fill="#fff" stroke={CORAL} strokeWidth="3" />}
    </g>
  )
}

function AxesDraw({ fig, frame }: { fig: Figure; frame: Frame }) {
  const showAll = frame.status.startsWith('Осей')
  if (showAll) {
    return (
      <g>
        {fig.axes
          .filter((line) => line.ok)
          .map((line) => (
            <line
              key={line.name}
              x1={line.a.x}
              y1={line.a.y}
              x2={line.b.x}
              y2={line.b.y}
              stroke={LEAF}
              strokeWidth="5"
              strokeDasharray="10 8"
            />
          ))}
      </g>
    )
  }
  const axis = fig.axes[frame.axis]
  const moved = axis.half.map((p) => lerp(p, reflect(p, axis.a, axis.b), frame.fold))
  return (
    <g>
      <polygon points={poly(axis.rest)} fill="rgba(47,158,107,0.28)" />
      <polygon points={poly(moved)} fill={axis.ok ? 'rgba(47,158,107,0.72)' : 'rgba(232,106,69,0.72)'} />
      <line
        x1={axis.a.x}
        y1={axis.a.y}
        x2={axis.b.x}
        y2={axis.b.y}
        stroke={axis.ok ? LEAF : CORAL}
        strokeWidth="5"
        strokeDasharray="10 8"
      />
    </g>
  )
}

export function GeoMeasure({ onContinue }: { onContinue: () => void }) {
  const [side, setSide] = useState('')
  const [tri, setTri] = useState('')
  const [length, setLength] = useState('')
  const [width, setWidth] = useState('')
  const sq = Number(side)
  const tr = Number(tri)
  const ln = Number(length)
  const wd = Number(width)
  return (
    <div className="geo-measure">
      <p className="geo-rule">Измерь линейкой в учебнике и впиши. Здесь посчитается периметр.</p>
      <div className="answer">
        <Field label="квадрат, сторона, см" value={side} onChange={setSide} />
        {sq > 0 && <div className="caption">Периметр {sq} · 4 = {sq * 4} см. Осей: 4.</div>}
        <Field label="треугольник, сторона, см" value={tri} onChange={setTri} />
        {tr > 0 && <div className="caption">Периметр {tr} · 3 = {tr * 3} см. Осей: 3.</div>}
        <Field label="прямоугольник, длина, см" value={length} onChange={setLength} />
        <Field label="прямоугольник, ширина, см" value={width} onChange={setWidth} />
        {ln > 0 && wd > 0 && (
          <div className="caption">
            Периметр ({ln} + {wd}) · 2 = {(ln + wd) * 2} см. Осей: {ln === wd ? 4 : 2}.
          </div>
        )}
      </div>
      <button type="button" className="btn" onClick={onContinue}>
        К проверочному заданию
      </button>
    </div>
  )
}

function Field({ label, value, onChange }: { label: string; value: string; onChange: (value: string) => void }) {
  return (
    <label>
      <span>{label}</span>
      <input inputMode="numeric" value={value} onChange={(e) => onChange(e.target.value.replace(/[^\d]/g, ''))} />
    </label>
  )
}
