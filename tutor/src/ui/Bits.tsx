import { useState, type ReactNode } from 'react'
import type { Tok } from '../lib/expr'
import { glyph, parse } from '../lib/expr'
import type { Beat } from '../content'
import type { Practice } from '../extra'
import { correctSpeech, revealSpeech, wrongSpeech } from '../content'
import { NarrationPause, useNarration, useVoice } from './voice'

export function Tokens({ tokens, hotFrom, hotTo }: { tokens: Tok[]; hotFrom?: number; hotTo?: number }) {
  return (
    <div className="expr" aria-label="пример">
      {tokens.map((tok, i) => {
        const hot = hotFrom !== undefined && hotTo !== undefined && i >= hotFrom && i <= hotTo
        const op = tok.k === 'op' || tok.k === 'lp' || tok.k === 'rp'
        return (
          <span key={`${glyph(tok)}-${i}`} className={`tok ${op ? 'op' : 'num'} ${hot ? 'hot' : ''}`}>
            {glyph(tok)}
          </span>
        )
      })}
    </div>
  )
}

export function Confetti() {
  return (
    <div className="confetti" aria-hidden="true">
      {Array.from({ length: 16 }, (_, i) => (
        <i key={i} style={{ ['--i' as string]: String(i) }} />
      ))}
    </div>
  )
}

export function AnswerBox({
  fields,
  onCorrect,
}: {
  fields: { label: string; answer: string }[]
  onCorrect: () => void
}) {
  const { speak, praiseNow } = useVoice()
  const [values, setValues] = useState(() => fields.map(() => ''))
  const [focus, setFocus] = useState(0)
  const [shake, setShake] = useState(false)
  const [misses, setMisses] = useState(0)
  const [done, setDone] = useState(false)

  function setDigit(d: string) {
    setValues((prev) => prev.map((v, i) => (i === focus ? (v + d).slice(0, 6) : v)))
  }

  function check() {
    if (done) return
    const ok = fields.every((field, i) => normalize(values[i]) === field.answer)
    if (ok) {
      setDone(true)
      speak(correctSpeech)
      praiseNow()
      onCorrect()
      return
    }
    setShake(true)
    window.setTimeout(() => setShake(false), 450)
    const next = misses + 1
    setMisses(next)
    speak(next >= 2 ? revealSpeech : wrongSpeech)
  }

  const revealed = misses >= 2 && !done

  return (
    <div className={`answer ${shake ? 'shake' : ''} ${done ? 'is-ok' : ''}`}>
      {done && <Confetti />}
      <p className="answer-title">{done ? 'Сошлось' : 'Запиши ответ'}</p>
      <div className="fields">
        {fields.map((field, i) => (
          <label key={field.label} className={focus === i ? 'on' : ''}>
            <span>{field.label}</span>
            <input
              inputMode="numeric"
              value={revealed ? field.answer : values[i]}
              readOnly={revealed || done}
              onFocus={() => setFocus(i)}
              onChange={(e) =>
                setValues((prev) => prev.map((v, idx) => (idx === i ? e.target.value.replace(/[^\d]/g, '') : v)))
              }
            />
          </label>
        ))}
      </div>
      {!done && !revealed && (
        <div className="pad">
          {['1', '2', '3', '4', '5', '6', '7', '8', '9', '0'].map((d) => (
            <button key={d} type="button" onClick={() => setDigit(d)}>
              {d}
            </button>
          ))}
          <button
            type="button"
            onClick={() => setValues((prev) => prev.map((v, i) => (i === focus ? v.slice(0, -1) : v)))}
            aria-label="стереть"
          >
            ⌫
          </button>
          <button type="button" className="go" onClick={check}>
            Проверить
          </button>
        </div>
      )}
      {revealed && (
        <button
          type="button"
          className="btn"
          onClick={() => {
            setDone(true)
            onCorrect()
          }}
        >
          Запомнить и дальше
        </button>
      )}
    </div>
  )
}

function normalize(raw: string): string | null {
  const t = raw.trim()
  if (!/^\d+$/.test(t)) return null
  return String(Number(t))
}

export function Replay({ text }: { text: string }) {
  const { speak, speaking } = useVoice()
  return (
    <button type="button" className="btn ghost" onClick={() => speak(text)}>
      {speaking ? 'Кукузя говорит…' : 'Слушать ещё раз'}
    </button>
  )
}

export function Stepper({
  steps,
  render,
  after,
  onDone,
  doneLabel = 'Я понял',
}: {
  steps: { speech: string; caption: string }[]
  render?: (index: number) => ReactNode
  after?: ReactNode
  onDone?: () => void
  doneLabel?: string
}) {
  const [index, setIndex] = useState(0)
  const [nonce, setNonce] = useState(0)
  const { speak } = useVoice()
  const step = steps[index]
  useNarration(step.speech, nonce)
  const last = index === steps.length - 1

  function go(next: number) {
    const target = steps[next]
    if (!target) return
    speak(target.speech)
    setIndex(next)
  }

  return (
    <div className="stage">
      <div className="why">{step.caption}</div>
      {render?.(index)}
      <p className="bubble-text">{step.speech}</p>
      <div className="row">
        <button type="button" className="btn ghost" disabled={index === 0} onClick={() => go(index - 1)}>
          Шаг назад
        </button>
        <button type="button" className="btn ghost" onClick={() => setNonce((n) => n + 1)}>
          Слушать ещё раз
        </button>
        {!last && (
          <button type="button" className="btn" onClick={() => go(index + 1)}>
            Дальше
          </button>
        )}
        {last && onDone && !after && (
          <button type="button" className="btn" onClick={onDone}>
            {doneLabel}
          </button>
        )}
      </div>
      {last && after}
      <p className="step-count">
        Шаг {index + 1} из {steps.length}
      </p>
    </div>
  )
}

export function WithHelp({
  beats,
  render,
  children,
}: {
  beats: Beat[]
  render?: (index: number) => ReactNode
  children: ReactNode
}) {
  const [open, setOpen] = useState(false)
  return (
    <>
      <NarrationPause paused={open}>
        <div hidden={open}>{children}</div>
      </NarrationPause>
      {open ? (
        <Stepper steps={beats} render={render} doneLabel="Вернуться к заданию" onDone={() => setOpen(false)} />
      ) : (
        <button type="button" className="btn stuck" onClick={() => setOpen(true)}>
          Ничего непонятно
        </button>
      )}
    </>
  )
}

export function PracticeView({ practice, expr, onDone }: { practice: Practice; expr?: string; onDone: () => void }) {
  useNarration(practice.speech)
  return (
    <div className="practice">
      <div className="why">Проверочное задание</div>
      {expr && <Tokens tokens={parse(expr)} />}
      <p className="bubble-text">{practice.speech}</p>
      <AnswerBox fields={practice.fields} onCorrect={onDone} />
    </div>
  )
}

export function TaskGate({
  help,
  helpRender,
  practice,
  onDone,
  children,
}: {
  help: Beat[]
  helpRender?: (index: number) => ReactNode
  practice: Practice
  onDone: () => void
  children: (finishBook: () => void) => ReactNode
}) {
  const [phase, setPhase] = useState<'book' | 'check'>('book')
  return (
    <WithHelp beats={help} render={helpRender}>
      {phase === 'book' ? (
        children(() => setPhase('check'))
      ) : (
        <PracticeView practice={practice} onDone={onDone} />
      )}
    </WithHelp>
  )
}

