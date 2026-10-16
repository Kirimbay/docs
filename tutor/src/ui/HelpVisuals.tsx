import type { AltBeat } from '../lib/expr'

export type HelpTopic =
  | 'order'
  | 'cubes'
  | 'chairs'
  | 'trees'
  | 'apples'
  | 'cloaks'
  | 'fabric'
  | 'multiply'
  | 'geometry'
  | 'shapes'
  | 'kite'
  | 'rebus'
  | 'schemes'

function Dots({ n, fade = 0, color = '#e07a3d' }: { n: number; fade?: number; color?: string }) {
  const show = Math.max(0, Math.min(n, 20))
  const goneFrom = Math.max(0, show - Math.min(fade, show))
  return (
    <div className="dots" aria-hidden="true">
      {Array.from({ length: show }, (_, i) => (
        <i key={i} className={i >= goneFrom ? 'gone' : ''} style={{ background: color, animationDelay: `${i * 25}ms` }} />
      ))}
    </div>
  )
}

function Rows({ count, rows, color = '#e07a3d' }: { count: number; rows: number; color?: string }) {
  const r = Math.max(1, Math.min(rows, 4))
  const c = Math.max(1, Math.min(count, 10))
  return (
    <div className="dot-rows" aria-hidden="true">
      {Array.from({ length: r }, (_, row) => (
        <div key={row} className="dot-row">
          {Array.from({ length: c }, (_, i) => (
            <i key={i} style={{ background: color, animationDelay: `${(row * c + i) * 20}ms` }} />
          ))}
        </div>
      ))}
    </div>
  )
}

function Eq({ text, bad = false, live }: { text: string; bad?: boolean; live?: boolean }) {
  const on = live ?? !bad
  return <div className={`badge ${bad ? 'bad' : ''} ${on ? 'spot' : ''}`}>{text}</div>
}

export function ExprAltPicture({ beat }: { beat: AltBeat | undefined }) {
  if (!beat) return null
  if (beat.picture === 'intro') {
    return (
      <div className="help-pic spot">
        <div className="stairs">
          <div className="stair on"><b>1</b><span>Сначала скобки</span></div>
          <div className="stair on"><b>2</b><span>Потом умножение и деление</span></div>
          <div className="stair on"><b>3</b><span>Потом сложение и вычитание</span></div>
        </div>
      </div>
    )
  }
  if (beat.picture === 'rows') {
    return (
      <div className="help-pic">
        <div className="spot">
          <Rows count={beat.a} rows={beat.b} />
        </div>
        <Eq text={`${beat.a} · ${beat.b} = ${beat.value}`} live />
      </div>
    )
  }
  if (beat.picture === 'split') {
    return (
      <div className="help-pic">
        <div className="spot">
          <Rows count={beat.value} rows={beat.b} color="#2f7dbe" />
        </div>
        <Eq text={`${beat.a} : ${beat.b} = ${beat.value}`} live />
      </div>
    )
  }
  if (beat.picture === 'fade') {
    return (
      <div className="help-pic">
        <div className="spot">
          <Dots n={beat.a} fade={beat.b} />
        </div>
        <Eq text={`${beat.a} − ${beat.b} = ${beat.value}`} live />
      </div>
    )
  }
  if (beat.picture === 'dots') {
    return (
      <div className="help-pic">
        <div className="spot">
          <Dots n={beat.a} color="#f0b429" />
        </div>
        <div className="spot">
          <Dots n={beat.b} color="#e85d4c" />
        </div>
        <Eq text={`${beat.a} + ${beat.b} = ${beat.value}`} live />
      </div>
    )
  }
  if (beat.picture === 'unwrap') {
    return (
      <div className="help-pic">
        <Eq text={`(${beat.value}) = ${beat.value}`} live />
      </div>
    )
  }
  return (
    <div className="help-pic">
      <div className="badge big-ans spot">{beat.value}</div>
    </div>
  )
}

function MiniSquare() {
  return (
    <svg className="mini-geo" viewBox="0 0 120 120" aria-hidden="true">
      <rect x="20" y="20" width="80" height="80" fill="#fff" stroke="#5b6ee1" strokeWidth="4" />
      <rect className="walk" x="20" y="20" width="80" height="80" fill="none" stroke="#e07a3d" strokeWidth="6" />
    </svg>
  )
}

function MiniRect() {
  return (
    <svg className="mini-geo" viewBox="0 0 160 90" aria-hidden="true">
      <rect x="16" y="18" width="128" height="54" fill="#fff" stroke="#5b6ee1" strokeWidth="4" />
      <line x1="20" y1="22" x2="140" y2="68" stroke="#e86a45" strokeWidth="3" strokeDasharray="6 4" />
    </svg>
  )
}

export function HelpPicture({ topic, step }: { topic: HelpTopic; step: number }) {
  return <div className="help-pic">{scene(topic, step)}</div>
}

export function PracticePicture({ topic }: { topic: HelpTopic }) {
  return <div className="help-pic">{practiceScene(topic)}</div>
}

function scene(topic: HelpTopic, step: number) {
  switch (topic) {
    case 'order':
      return orderScene(step)
    case 'cubes':
      return cubeScene(step)
    case 'chairs':
      return chairScene(step)
    case 'trees':
      return treeScene(step)
    case 'apples':
      return appleScene(step)
    case 'cloaks':
      return cloakScene(step)
    case 'fabric':
      return fabricScene(step)
    case 'multiply':
      return multScene(step)
    case 'geometry':
      return geoScene(step)
    case 'shapes':
      return shapeScene(step)
    case 'kite':
      return kiteScene(step)
    case 'rebus':
      return rebusScene(step)
    case 'schemes':
      return schemeScene(step)
  }
}

function orderScene(step: number) {
  if (step <= 0) {
    return (
      <>
        <Eq text="8 + 6 : 2 − 3 · 2" />
        <div className="compare">
          <Eq text="как захочется: 8" bad />
          <Eq text="по правилам: 5" />
        </div>
      </>
    )
  }
  if (step === 1) return (<><Rows count={3} rows={2} color="#2f7dbe" /><Eq text="6 : 2 = 3" /></>)
  if (step === 2) return (<><Rows count={3} rows={2} /><Eq text="3 · 2 = 6" /><Eq text="8 + 3 − 6" /></>)
  if (step === 3) return (<><Eq text="8 + 3 = 11" /><Eq text="11 − 6 = 5" /></>)
  return (
    <div className="compare">
      <Eq text="8" bad />
      <div className="badge big-ans spot">5</div>
    </div>
  )
}

function cubeScene(step: number) {
  if (step <= 1) return (<><Rows count={3} rows={2} color="#f0b429" /><Eq text="3 · 2 = 6 жёлтых" /></>)
  if (step === 2) return (<><Rows count={3} rows={2} color="#f0b429" /><Dots n={4} color="#e85d4c" /><Eq text="6 + 4 = 10" /></>)
  if (step === 3) return (<><Rows count={8} rows={2} color="#f0b429" /><Eq text="8 + 8 = 16" /></>)
  return <Eq text="16 + 16 = 32" />
}

function chairScene(step: number) {
  if (step <= 1) return (<><Rows count={4} rows={3} color="#2f7dbe" /><Eq text="12 : 3 = 4" /></>)
  if (step === 2) return (<><Eq text="два ряда: 8" /><Eq text="десять рядов: 40" /></>)
  if (step === 3) return (<><Rows count={8} rows={1} color="#2f7dbe" /><Eq text="24 на 3 = 8" /></>)
  return (<><Eq text="два ряда: 16" /><Eq text="десять рядов: 80" /></>)
}

function treeScene(step: number) {
  const small = step < 3
  return (
    <div className="bars">
      <div className="bar" style={{ height: small ? 120 : 150 }}>{small ? '10' : '15'}</div>
      {step === 1 || step === 3 ? <span className="gap-note">{small ? 'на 8' : 'на 12'}</span> : null}
      {(step === 2 || step >= 4) && <span className="gap-note">{small ? 'в 5 раз' : 'в 5 раз'}</span>}
      <div className="bar short" style={{ height: small ? 36 : 42 }}>{small ? '2' : '3'}</div>
    </div>
  )
}

function appleScene(step: number) {
  if (step <= 0) return <Eq text="было 8, взяли 1, добавили 3" />
  if (step === 1) return <Eq text="8 − 1 = 7, затем 7 + 3 = 10" />
  if (step === 2) return <Eq text="10 : 2 = 5" />
  if (step === 3) return <Eq text="5 − 3 = 2 и 5 + 1 = 6" />
  return <Eq text="в задании сначала 9 и 4" />
}

function Vase({ n, label }: { n: number; label: string }) {
  return (
    <div className="vase">
      <div className="apples">
        {Array.from({ length: n }, (_, i) => (
          <i key={i} />
        ))}
      </div>
      <b>{label}</b>
    </div>
  )
}

function cloakScene(step: number) {
  const book = step >= 3
  const count = book ? 4 : 2
  return (
    <>
      <div className="cloaks">
        {Array.from({ length: count }, (_, i) => (
          <span key={i} className="cloak on">{book ? '3 м' : '4 м'}</span>
        ))}
      </div>
      <Eq text={book ? '12 + 38 = 50' : step >= 2 ? '8 + 10 = 18' : '2 · 4 = 8'} />
    </>
  )
}

function fabricScene(step: number) {
  return (
    <>
      <div className="cloth">
        <span className="suit" />
        <span className="suit" />
        <b>{step >= 3 ? 'в учебнике 3 м и 2 костюма' : '4 м и 2 костюма'}</b>
      </div>
      <Eq text={step <= 1 ? '4 · 2 = 8' : step === 2 ? '8 : 2 = 4' : '6 м, 3 м, 2 костюма'} />
    </>
  )
}

function multScene(step: number) {
  if (step <= 1) return (<><Rows count={4} rows={3} /><Eq text="4 · 3 = 12" /></>)
  if (step === 2) return <Eq text="4 · ? = 12, в клетке 3" />
  return (<><Eq text="? · 3 = 12, в клетке 4" /><Eq text="в учебнике 8 · 3 = 24" /></>)
}

function geoScene(step: number) {
  if (step <= 1) return (<><MiniSquare /><Eq text="3 + 3 + 3 + 3 = 12" /></>)
  if (step === 2) {
    return (
      <div className="help-row">
        <div className="fold v" style={{ width: 72, height: 72 }}><i /></div>
        <div className="fold h" style={{ width: 72, height: 72 }}><i /></div>
        <Eq text="4 оси" />
      </div>
    )
  }
  if (step === 3) return (<><MiniRect /><Eq text="(6 + 2) · 2 = 16" /></>)
  return (<><div className="fold bad d" style={{ width: 120, height: 56 }}><i /></div><Eq text="из угла в угол — не ось" /></>)
}

function shapeScene(step: number) {
  if (step <= 1) {
    return (
      <div className="blobs">
        <i className="blob circle" />
        <i className="blob circle" />
        <i className={`blob tri ${step === 1 ? 'on' : ''}`} />
        <i className="blob circle" />
      </div>
    )
  }
  if (step === 2) {
    return (
      <div className="blobs">
        <i className="blob sq" />
        <i className="blob sq" />
        <i className="blob fill on" />
        <i className="blob sq" />
      </div>
    )
  }
  return <Eq text="углы, закраска или как стоит" />
}

function kiteScene(step: number) {
  if (step <= 1) {
    return (
      <div className="ladder">
        {[
          ['2', ''],
          ['5', '+3'],
          ['9', '+4'],
          ['14', '+5'],
          ['20', '+6'],
          ['27', '+7'],
        ].map(([n, add]) => (
          <div key={n} className="ladder-step" style={{ height: 36 + Number(add.slice(1) || 1) * 6 }}>
            <b>{n}</b>
            {add && <small>{add}</small>}
          </div>
        ))}
      </div>
    )
  }
  return (
    <div className="ladder">
      {[
        ['1', ''],
        ['6', '+5'],
        ['12', '+6'],
        ['19', '+7'],
        ['27', '+8'],
        ['36', '+9'],
        ['46', '+10'],
        ['57', '+11'],
      ].map(([n, add], i) => (
        <div key={n} className="ladder-step" style={{ height: 28 + i * 8 }}>
          <b>{n}</b>
          {add && <small>{add}</small>}
        </div>
      ))}
    </div>
  )
}

function rebusScene(step: number) {
  if (step <= 0) return <div className="rebus-card">* * + 20 = 55</div>
  if (step === 1) return <Eq text="55 − 20 = 35" />
  if (step === 2) return <Eq text="43 − 29 = 14" />
  if (step === 3) return <Eq text="83 − 37 = 46" />
  return <Eq text="65 − 29 = 36" />
}

function schemeScene(step: number) {
  if (step <= 0) return <Eq text="10 − 2 · 3" />
  if (step === 1) return <Eq text="сначала минус: 24" bad />
  if (step === 2) return (<><Rows count={3} rows={2} /><Eq text="2 · 3 = 6, потом 10 − 6 = 4" /></>)
  if (step === 3) return <Eq text="(10 − 2) · 3 = 24" />
  return <Eq text="9 − 4 + 2 = 7" />
}

function practiceScene(topic: HelpTopic) {
  switch (topic) {
    case 'order':
      return <Eq text="15 + 10 : 2 − 4 · 3" />
    case 'cubes':
      return (<><Rows count={5} rows={3} color="#f0b429" /><Dots n={10} color="#e85d4c" /></>)
    case 'chairs':
      return <Eq text="30 стульев, 5 одинаковых рядов" />
    case 'trees':
      return (
        <div className="bars">
          <div className="bar" style={{ height: 140 }}>20</div>
          <div className="bar short" style={{ height: 40 }}>4</div>
        </div>
      )
    case 'apples':
      return (
        <div className="vases">
          <Vase n={4} label="?" />
          <Vase n={4} label="?" />
        </div>
      )
    case 'cloaks':
      return (
        <div className="cloaks">
          {Array.from({ length: 5 }, (_, i) => (
            <span key={i} className="cloak on">2 м</span>
          ))}
        </div>
      )
    case 'fabric':
      return <Eq text="4 м, 3 костюма, всего 12 м" />
    case 'multiply':
      return (<><Rows count={6} rows={4} /><Eq text="6 · 4 = ?" /></>)
    case 'geometry':
      return (<><MiniSquare /><Eq text="сторона 6 см" /></>)
    case 'shapes':
      return (
        <div className="blobs">
          <i className="blob circle" />
          <i className="blob circle" />
          <i className="blob tri" />
          <i className="blob circle" />
        </div>
      )
    case 'kite':
      return <Eq text="2, 5, 9, 14, ?, ?" />
    case 'rebus':
      return <Eq text="* * + 25 = 61" />
    case 'schemes':
      return (<><Eq text="16 − 3 · 4" /><Eq text="(12 + 6) : 3" /></>)
  }
}
