import { useMemo, useState } from 'react'
import {
  appleBeats,
  chairBeats,
  cloakBeats,
  cubeBeats,
  fabricIntro,
  fabricRows,
  geoBeats,
  kiteBeats,
  multCols,
  rebusBeats,
  ruleBeats,
  ruleExample,
  schemeIntro,
  schemes,
  shapeSpeech,
  shapes,
  shapesIntro,
  treeBeats,
} from '../content'
import { exprTwin, helpBeats, practices, ruleTwin } from '../extra'
import { exprAltBeats, exprFinal, exprIntro, parse, practiceSpeech, resultOf, solve } from '../lib/expr'
import { AnswerBox, MarkSpeech, PracticeView, Stepper, TaskGate, Tokens, WithHelp } from './Bits'
import { GeoMeasure, GeoVisual } from './GeoAnim'
import { ExprAltPicture, HelpPicture, PracticePicture, type HelpTopic } from './HelpVisuals'
import { useNarration, useVoice } from './voice'

function helpOf(topic: HelpTopic) {
  return (step: number) => <HelpPicture topic={topic} step={step} />
}

export function RuleTask({ onDone }: { onDone: () => void }) {
  const [showExample, setShowExample] = useState(false)
  if (!showExample) {
    return (
      <WithHelp beats={helpBeats.order} render={helpOf('order')}>
        <Stepper
          steps={ruleBeats}
          render={(index) => <RuleVisual step={index} />}
          doneLabel="Разобрать пример"
          onDone={() => setShowExample(true)}
        />
      </WithHelp>
    )
  }
  return (
    <div className="stage">
      <ExpressionLesson expr={ruleExample} twin={ruleTwin} intro={exprIntro(ruleExample)} onSolved={onDone} />
    </div>
  )
}

function RuleVisual({ step }: { step: number }) {
  const rules = [
    { n: '1', t: 'Вначале скобки' },
    { n: '2', t: 'Следующее: умножение и деление, слева направо' },
    { n: '3', t: 'Потом сложение и вычитание, слева направо' },
  ]
  return (
    <div className="stairs">
      <p className={`rule-lead ${step === 0 ? 'spot' : ''}`}>Нельзя выполнять действия как захочется.</p>
      {rules.map((rule, index) => (
        <div key={rule.n} className={`stair ${step === index + 1 ? 'spot' : ''} ${step > index + 1 ? 'on' : ''}`}>
          <b>{rule.n}</b>
          <span>{rule.t}</span>
        </div>
      ))}
      {step >= 4 && (
        <div className="rule-check spot">
          <p>12 + 6 : 2 − 7 · 2</p>
          <p>Как захочется: 4. По правилам: 1.</p>
        </div>
      )}
    </div>
  )
}

export function ExpressionSet({
  exprs,
  intro,
  solved,
  onSolve,
  onDone,
}: {
  exprs: string[]
  intro: string
  solved: string[]
  onSolve: (expr: string) => void
  onDone: () => void
}) {
  const [current, setCurrent] = useState<string | null>(null)
  const { speak } = useVoice()
  const finished = exprs.every((e) => solved.includes(e))

  return (
    <div className="stage">
      <div className="chip-grid">
        {exprs.map((expr) => (
          <button
            key={expr}
            type="button"
            className={`chip ${current === expr ? 'on' : ''} ${solved.includes(expr) ? 'ok' : ''}`}
            onClick={() => {
              speak(exprIntro(expr))
              setCurrent(expr)
            }}
          >
            {expr}
          </button>
        ))}
      </div>
      {current ? (
        <ExpressionLesson key={current} expr={current} intro={exprIntro(current)} onSolved={() => onSolve(current)} />
      ) : (
        <WithHelp beats={helpBeats.order} render={helpOf('order')}>
          <p className="bubble-text">{intro}</p>
          <Say text={intro} />
        </WithHelp>
      )}
      {finished && (
        <button type="button" className="btn" onClick={onDone}>
          Все примеры разобраны
        </button>
      )}
    </div>
  )
}

export function ExpressionLesson({
  expr,
  intro,
  onSolved,
  twin,
}: {
  expr: string
  intro?: string
  onSolved: () => void
  twin?: string
}) {
  const practiceExpr = twin ?? exprTwin[expr]
  const steps = useMemo(() => solve(expr), [expr])
  const [index, setIndex] = useState(intro ? -1 : 0)
  const [nonce, setNonce] = useState(0)
  const [check, setCheck] = useState(false)
  const { speak } = useVoice()
  const done = index >= steps.length
  const helpExpr = check && practiceExpr ? practiceExpr : expr
  const help = useMemo(() => exprAltBeats(helpExpr), [helpExpr])
  const text = check ? '' : index < 0 ? intro || exprIntro(expr) : done ? exprFinal(expr) : steps[index].speech
  useNarration(text, nonce)

  function go(next: number) {
    const spoken =
      next < 0 ? intro || exprIntro(expr) : next >= steps.length ? exprFinal(expr) : steps[next].speech
    speak(spoken)
    setIndex(next)
  }
  const answer = steps[steps.length - 1].after[0]
  const answerValue = answer && answer.k === 'n' ? String(answer.v) : ''

  return (
    <WithHelp beats={help} render={(i) => <ExprAltPicture beat={help[i]} />}>
    <div className="expr-lesson">
      {index < 0 && <Tokens tokens={parse(expr)} hotFrom={steps[0]?.from} hotTo={steps[0]?.to} />}
      {index >= 0 && !done && !check && (
        <>
          <div className="why">{steps[index].why}</div>
          <Tokens tokens={steps[index].before} hotFrom={steps[index].from} hotTo={steps[index].to} />
          <div className="caption spot">{steps[index].caption}</div>
          <Tokens tokens={steps[index].after} hotFrom={steps[index].from} hotTo={steps[index].from} />
        </>
      )}
      {done && answer && answer.k === 'n' && !check && (
        <>
          <Tokens tokens={parse(expr)} />
          <div className="caption big spot">= {answer.v}</div>
        </>
      )}
      {text && (
        <p className="bubble-text">
          <MarkSpeech
            text={text}
            caption={index < 0 ? expr : done ? answerValue : steps[index]?.caption}
          />
        </p>
      )}
      {!check && (
        <div className="row">
          <button type="button" className="btn ghost" disabled={index <= (intro ? -1 : 0)} onClick={() => go(index - 1)}>
            Шаг назад
          </button>
          <button type="button" className="btn ghost" onClick={() => setNonce((n) => n + 1)}>
            Слушать ещё раз
          </button>
          {!done && (
            <button type="button" className="btn" onClick={() => go(index + 1)}>
              {index < 0 ? 'Показать шаг' : 'Дальше'}
            </button>
          )}
        </div>
      )}
      {done && !check && (
        <AnswerBox
          fields={[{ label: 'ответ', answer: answerValue }]}
          onCorrect={() => (practiceExpr ? setCheck(true) : onSolved())}
        />
      )}
      {check && practiceExpr && (
        <PracticeView
          expr={practiceExpr}
          practice={{
            speech: practiceSpeech(practiceExpr),
            fields: [{ label: 'ответ', answer: String(resultOf(practiceExpr)) }],
          }}
          onDone={onSolved}
        />
      )}
      {!check && (
        <p className="step-count">{done ? 'Ответ' : index < 0 ? 'Начало' : `Шаг ${index + 1} из ${steps.length}`}</p>
      )}
    </div>
    </WithHelp>
  )
}

export function CubeTask({ onDone }: { onDone: () => void }) {
  return (
    <TaskGate
      help={helpBeats.cubes}
      helpRender={helpOf('cubes')}
      practice={practices.cubes}
      practicePicture={<PracticePicture topic="cubes" />}
      onDone={onDone}
    >
      {(finishBook) => (
        <Stepper
          steps={cubeBeats}
          render={(i) => <Cubes phase={i} />}
          after={<AnswerBox fields={[{ label: 'кубиков в коробке', answer: '32' }]} onCorrect={finishBook} />}
        />
      )}
    </TaskGate>
  )
}

function Cubes({ phase }: { phase: number }) {
  const yellow = phase >= 1 ? 8 : 0
  const red = phase >= 2 ? 16 : 0
  return (
    <div className="scene">
      <div className={`box ${phase === 0 ? 'spot' : ''}`}>
        <Row count={yellow} color="y" spot={phase === 1} dim={phase > 1} />
        <Row count={yellow} color="y" spot={phase === 1} dim={phase > 1} />
        <Row count={Math.min(red, 8)} color="r" spot={phase === 2} />
        {red > 8 && <Row count={red - 8} color="r" spot={phase === 2} />}
      </div>
      {phase >= 3 && <div className="badge spot">16 + 16 = 32</div>}
    </div>
  )
}

function Row({ count, color, spot, dim }: { count: number; color: 'y' | 'r'; spot?: boolean; dim?: boolean }) {
  return (
    <div className={`cube-row ${spot ? 'spot' : ''} ${dim ? 'dim' : ''}`}>
      {Array.from({ length: count }, (_, i) => (
        <i key={i} className={`cube ${color}`} style={{ animationDelay: `${i * 40}ms` }} />
      ))}
    </div>
  )
}

export function ChairTask({ onDone }: { onDone: () => void }) {
  return (
    <TaskGate
      help={helpBeats.chairs}
      helpRender={helpOf('chairs')}
      practice={practices.chairs}
      practicePicture={<PracticePicture topic="chairs" />}
      onDone={onDone}
    >
      {(finish) => (
        <Stepper
          steps={chairBeats}
          render={(i) => <Chairs phase={i} />}
          after={
            <AnswerBox
              fields={[
                { label: 'в одном ряду', answer: '8' },
                { label: 'в двух рядах', answer: '16' },
                { label: 'в десяти рядах', answer: '80' },
              ]}
              onCorrect={finish}
            />
          }
        />
      )}
    </TaskGate>
  )
}

function Chairs({ phase }: { phase: number }) {
  const rows = phase === 2 ? 2 : phase >= 1 ? 1 : 3
  const shown = phase === 0 ? 0 : 8
  return (
    <div className="scene">
      <div className={`chair-rows ${phase === 1 || phase === 2 ? 'spot' : ''} ${phase === 3 ? 'dim' : ''}`}>
        {Array.from({ length: phase === 0 ? 3 : rows }, (_, r) => (
          <div key={r} className="chair-row">
            {Array.from({ length: shown }, (_, i) => (
              <span key={i} className="chair" style={{ animationDelay: `${(r * 8 + i) * 25}ms` }} />
            ))}
          </div>
        ))}
      </div>
      {phase === 2 && <div className="badge spot">два ряда — 16</div>}
      {phase === 3 && <div className="badge spot">десять рядов по 8 — 80</div>}
    </div>
  )
}

export function TreeTask({ onDone }: { onDone: () => void }) {
  return (
    <TaskGate
      help={helpBeats.trees}
      helpRender={helpOf('trees')}
      practice={practices.trees}
      practicePicture={<PracticePicture topic="trees" />}
      onDone={onDone}
    >
      {(finish) => (
        <Stepper
          steps={treeBeats}
          render={(i) => <Trees phase={i} />}
          after={
            <AnswerBox
              fields={[
                { label: 'на сколько метров', answer: '12' },
                { label: 'во сколько раз', answer: '5' },
              ]}
              onCorrect={finish}
            />
          }
        />
      )}
    </TaskGate>
  )
}

function Trees({ phase }: { phase: number }) {
  return (
    <div className="trees">
      <div className={`tree birch ${phase <= 1 ? 'spot' : ''}`}>
        <div className="crown" />
        <div className="trunk" />
        <b>15 м</b>
      </div>
      <div className="gap">
        {phase >= 1 && <em className={phase === 1 ? 'spot' : ''}>на 12 м</em>}
        {phase >= 2 && <em className="spot">в 5 раз</em>}
      </div>
      <div className={`tree rowan ${phase === 0 || phase === 2 ? 'spot' : ''}`}>
        <div className="crown" />
        <div className="trunk" />
        <b>3 м</b>
      </div>
    </div>
  )
}

export function AppleTask({ onDone }: { onDone: () => void }) {
  return (
    <TaskGate
      help={helpBeats.apples}
      helpRender={helpOf('apples')}
      practice={practices.apples}
      practicePicture={<PracticePicture topic="apples" />}
      onDone={onDone}
    >
      {(finish) => (
        <Stepper
          steps={appleBeats}
          render={(i) => <Apples phase={i} />}
          after={
            <AnswerBox
              fields={[
                { label: 'ваза, из которой взяли', answer: '9' },
                { label: 'ваза, куда добавили', answer: '4' },
              ]}
              onCorrect={finish}
            />
          }
        />
      )}
    </TaskGate>
  )
}

function Apples({ phase }: { phase: number }) {
  const start = phase >= 4
  const equal = phase >= 2 && !start
  const leftCount = start ? 9 : equal ? 7 : phase >= 1 ? 6 : 5
  const rightCount = start ? 4 : equal ? 7 : phase >= 1 ? 7 : 5
  const leftLabel = start ? 'сначала 9' : equal ? 'стало 7' : '?'
  const rightLabel = start ? 'сначала 4' : equal ? 'стало 7' : '?'
  return (
    <div className="vases">
      <Vase count={leftCount} label={leftLabel} spot={phase === 0 || phase >= 2} />
      <div className="gap">
        {phase === 1 && <em className="spot">13 − 2 + 3 = 14</em>}
        {equal && <em className="spot">по 7</em>}
        {start && <em className="spot">9 и 4</em>}
      </div>
      <Vase count={rightCount} label={rightLabel} spot={phase === 0 || phase >= 2} />
    </div>
  )
}

function Vase({ count, label, fly, spot }: { count: number; label: string; fly?: 'out' | 'in'; spot?: boolean }) {
  return (
    <div className={`vase ${fly ?? ''} ${spot ? 'spot' : ''}`}>
      <div className="apples">
        {Array.from({ length: count }, (_, i) => (
          <i key={i} />
        ))}
      </div>
      <b>{label}</b>
    </div>
  )
}

export function CloakTask({ onDone }: { onDone: () => void }) {
  return (
    <TaskGate
      help={helpBeats.cloaks}
      helpRender={helpOf('cloaks')}
      practice={practices.cloaks}
      practicePicture={<PracticePicture topic="cloaks" />}
      onDone={onDone}
    >
      {(finish) => (
        <Stepper
          steps={cloakBeats}
          render={(i) => (
            <div className="scene cloaks">
              {Array.from({ length: 4 }, (_, n) => (
            <span key={n} className={`cloak ${i >= 1 ? 'on' : ''} ${i === 1 ? 'spot' : ''}`} style={{ animationDelay: `${n * 80}ms` }}>
              3 м
            </span>
          ))}
          {i >= 1 && <div className={`badge ${i === 1 ? 'spot' : ''}`}>ушло 12 м</div>}
          {i >= 2 && <div className="badge mint spot">осталось 38 м → было 50 м</div>}
            </div>
          )}
          after={<AnswerBox fields={[{ label: 'метров сначала', answer: '50' }]} onCorrect={finish} />}
        />
      )}
    </TaskGate>
  )
}

const tableDone = 'Таблица заполнена. В каждой клетке теперь видно, какие два числа перемножили и что получилось.'

export function MultiplyTask({ onDone }: { onDone: () => void }) {
  return (
    <TaskGate
      help={helpBeats.multiply}
      helpRender={helpOf('multiply')}
      practice={practices.multiply}
      practicePicture={<PracticePicture topic="multiply" />}
      onDone={onDone}
    >
      {(finish) => <MultiplyWork onDone={finish} />}
    </TaskGate>
  )
}

function MultiplyWork({ onDone }: { onDone: () => void }) {
  const [col, setCol] = useState(0)
  const [nonce, setNonce] = useState(0)
  const [filled, setFilled] = useState<string[]>(() => multCols.map(() => ''))
  const finished = col >= multCols.length
  const current = multCols[Math.min(col, multCols.length - 1)]
  const speech = finished ? tableDone : current.speech
  useNarration(speech, `${col}:${nonce}`)

  return (
    <div className="stage">
      <table className="mult">
        <tbody>
          <tr>
            <th>Множитель</th>
            {multCols.map((c, i) => (
              <td key={i} className={!finished && i === col ? 'on' : ''}>
                {cell(c.a, c.blank === 'a', filled[i])}
              </td>
            ))}
          </tr>
          <tr>
            <th>Множитель</th>
            {multCols.map((c, i) => (
              <td key={i} className={!finished && i === col ? 'on' : ''}>
                {cell(c.b, c.blank === 'b', filled[i])}
              </td>
            ))}
          </tr>
          <tr>
            <th>Произведение</th>
            {multCols.map((c, i) => (
              <td key={i} className={!finished && i === col ? 'on' : ''}>
                {cell(c.p, c.blank === 'p', filled[i])}
              </td>
            ))}
          </tr>
        </tbody>
      </table>
      <p className="bubble-text">{speech}</p>
      {!finished && (
        <>
          <button type="button" className="btn ghost" onClick={() => setNonce((n) => n + 1)}>
            Слушать ещё раз
          </button>
          {!filled[col] ? (
            <AnswerBox
              key={col}
              fields={[{ label: 'пустая клетка', answer: current.answer }]}
              onCorrect={() => setFilled((prev) => prev.map((v, i) => (i === col ? current.answer : v)))}
            />
          ) : (
            <button type="button" className="btn" onClick={() => setCol((c) => c + 1)}>
              Следующий столбик
            </button>
          )}
        </>
      )}
      {finished && (
        <button type="button" className="btn" onClick={onDone}>
          К проверочному заданию
        </button>
      )}
    </div>
  )
}

function cell(printed: string, blank: boolean, value: string) {
  if (!blank) return printed
  return value || '?'
}

export function FabricTask({ onDone }: { onDone: () => void }) {
  return (
    <TaskGate
      help={helpBeats.fabric}
      helpRender={helpOf('fabric')}
      practice={practices.fabric}
      practicePicture={<PracticePicture topic="fabric" />}
      onDone={onDone}
    >
      {(finish) => <FabricWork onDone={finish} />}
    </TaskGate>
  )
}

function FabricWork({ onDone }: { onDone: () => void }) {
  const [row, setRow] = useState<number | null>(null)
  const [doneRows, setDoneRows] = useState<number[]>([])
  const { speak } = useVoice()
  const all = doneRows.length === fabricRows.length
  return (
    <div className="stage">
      <p className="bubble-text">{row === null ? fabricIntro : fabricRows[row].speech}</p>
      <Say text={row === null ? fabricIntro : fabricRows[row].speech} />
      <div className="chip-grid">
        {fabricRows.map((item, i) => (
          <button
            key={item.title}
            type="button"
            className={`chip ${doneRows.includes(i) ? 'ok' : ''} ${row === i ? 'spot' : ''}`}
            onClick={() => {
              speak(item.speech)
              setRow(i)
            }}
          >
            {item.title}
            <small>
              {item.known}. {item.ask}
            </small>
          </button>
        ))}
      </div>
      {row !== null && (
        <div className="scene">
          <Cloth meters={row === 0 ? 6 : 6} suits={row === 2 ? 2 : 2} />
          <AnswerBox
            key={row}
            fields={[{ label: fabricRows[row].label, answer: fabricRows[row].answer }]}
            onCorrect={() =>
              setDoneRows((prev) => (prev.includes(row) ? prev : [...prev, row]))
            }
          />
        </div>
      )}
      {all && (
        <button type="button" className="btn" onClick={onDone}>
          К проверочному заданию
        </button>
      )}
    </div>
  )
}

function Cloth({ meters, suits }: { meters: number; suits: number }) {
  return (
    <div className="cloth">
      {Array.from({ length: suits }, (_, i) => (
        <span key={i} className="suit" />
      ))}
      <b>{meters} м ткани</b>
    </div>
  )
}

export function SchemeTask({ onDone }: { onDone: () => void }) {
  return (
    <TaskGate
      help={helpBeats.schemes}
      helpRender={helpOf('schemes')}
      practice={practices.schemes}
      practicePicture={<PracticePicture topic="schemes" />}
      onDone={onDone}
    >
      {(finish) => <SchemeWork onDone={finish} />}
    </TaskGate>
  )
}

function SchemeWork({ onDone }: { onDone: () => void }) {
  const [id, setId] = useState<string | null>(null)
  const [cleared, setCleared] = useState<string[]>([])
  const { speak } = useVoice()
  const scheme = schemes.find((s) => s.id === id) ?? null
  const ready = cleared.length >= 3
  return (
    <div className="stage">
      {!scheme && (
        <>
          <p className="bubble-text">{schemeIntro}</p>
          <Say text={schemeIntro} />
        </>
      )}
      <div className="chip-grid">
        {schemes.map((s) => (
          <button
            key={s.id}
            type="button"
            className={`chip ${cleared.includes(s.id) ? 'ok' : ''} ${id === s.id ? 'spot' : ''}`}
            onClick={() => {
              speak(s.speech)
              setId(s.id)
            }}
          >
            {s.pattern}
          </button>
        ))}
      </div>
      {scheme && (
        <div className="scheme">
          <div className="why">{scheme.order}</div>
          <p className="pattern spot">{scheme.pattern}</p>
          <p className="bubble-text">{scheme.speech}</p>
          <ExpressionLesson
            key={scheme.id}
            expr={scheme.example}
            intro={scheme.speech}
            onSolved={() => setCleared((prev) => (prev.includes(scheme.id) ? prev : [...prev, scheme.id]))}
          />
        </div>
      )}
      {ready && (
        <button type="button" className="btn" onClick={onDone}>
          К проверочному заданию
        </button>
      )}
      {!ready && <p className="step-count">Посчитай три разные схемы. Сейчас {cleared.length} из 3.</p>}
    </div>
  )
}

export function GeometryTask({ onDone }: { onDone: () => void }) {
  return (
    <TaskGate
      help={helpBeats.geometry}
      helpRender={helpOf('geometry')}
      practice={practices.geometry}
      practicePicture={<PracticePicture topic="geometry" />}
      onDone={onDone}
    >
      {(finish) => (
        <Stepper
          steps={geoBeats}
          render={(index) => <GeoVisual step={index} />}
          after={<GeoMeasure onContinue={finish} />}
        />
      )}
    </TaskGate>
  )
}

export function ShapesTask({ onDone }: { onDone: () => void }) {
  return (
    <TaskGate
      help={helpBeats.shapes}
      helpRender={helpOf('shapes')}
      practice={practices.shapes}
      practicePicture={<PracticePicture topic="shapes" />}
      onDone={onDone}
    >
      {(finish) => <ShapesWork onDone={finish} />}
    </TaskGate>
  )
}

function ShapesWork({ onDone }: { onDone: () => void }) {
  const { praiseNow } = useVoice()
  const [picked, setPicked] = useState<string | null>(null)
  const [found, setFound] = useState<string[]>([])
  const speech = picked ? shapeSpeech[picked] : shapesIntro
  useNarration(speech, picked ?? 'intro')
  return (
    <div className="stage">
      <div className="shape-board">
        <Shape id="p1" className={`s1 ${picked === 'p1' ? 'spot' : ''}`} label="1" onPick={pick} />
        <Shape id="p2" className={`s2 ${picked === 'p2' ? 'spot' : ''}`} label="2" onPick={pick} />
        <Shape id="p3" className={`s3 ${picked === 'p3' ? 'spot' : ''}`} label="3" onPick={pick} />
        <Shape id="p4" className={`s4 ${picked === 'p4' ? 'spot' : ''}`} label="4" onPick={pick} />
        <Shape id="p5" className={`s5 ${picked === 'p5' ? 'spot' : ''}`} label="5" onPick={pick} />
        <Shape id="p6" className={`s6 ${picked === 'p6' ? 'spot' : ''}`} label="6" onPick={pick} />
        <Shape id="p7" className={`s7 ${picked === 'p7' ? 'spot' : ''}`} label="7" onPick={pick} />
      </div>
      <p className="bubble-text">{speech}</p>
      <p className="step-count">Найдено способов: {found.length}. Нужно хотя бы 3.</p>
      {found.length >= 3 && (
        <button type="button" className="btn" onClick={onDone}>
          К проверочному заданию
        </button>
      )}
    </div>
  )

  function pick(id: string) {
    setPicked(id)
    const shape = shapes.find((s) => s.id === id)
    if (shape?.valid && !found.includes(id)) {
      praiseNow()
      setFound((prev) => (prev.includes(id) ? prev : [...prev, id]))
    }
  }
}

function Shape({ id, className, label, onPick }: { id: string; className: string; label: string; onPick: (id: string) => void }) {
  return (
    <button type="button" className={`shape ${className}`} onClick={() => onPick(id)}>
      <i />
      <span>{label}</span>
    </button>
  )
}

export function KiteTask({ onDone }: { onDone: () => void }) {
  return (
    <TaskGate
      help={helpBeats.kite}
      helpRender={helpOf('kite')}
      practice={practices.kite}
      practicePicture={<PracticePicture topic="kite" />}
      onDone={onDone}
    >
      {(finish) => (
      <Stepper
        steps={kiteBeats}
        render={(step) => (
          <div className="kite">
            {[1, 6, 12, 19, 27, 36].map((n, i) => (
              <span key={n} className={step === 0 ? 'spot' : ''} style={{ animationDelay: `${i * 90}ms` }}>
                {n}
              </span>
            ))}
            <span className={`ask ${step >= 1 ? 'spot' : ''}`}>?</span>
            <span className={`ask ${step >= 2 ? 'spot' : ''}`}>?</span>
          </div>
        )}
        after={
          <AnswerBox
            fields={[
              { label: 'следующее число', answer: '46' },
              { label: 'число после него', answer: '57' },
            ]}
            onCorrect={finish}
          />
        }
      />
      )}
    </TaskGate>
  )
}

export function RebusTask({ onDone }: { onDone: () => void }) {
  return (
    <TaskGate
      help={helpBeats.rebus}
      helpRender={helpOf('rebus')}
      practice={practices.rebus}
      practicePicture={<PracticePicture topic="rebus" />}
      onDone={onDone}
    >
      {(finish) => (
    <Stepper
      steps={rebusBeats}
      render={(step) => (
        <div className="rebuses">
          <pre className={step === 2 ? 'dim' : 'spot'}>{`  * *
+ 3 7
─────
  8 3`}</pre>
          <pre className={step === 1 ? 'dim' : 'spot'}>{`  * 5
− 2 *
─────
  3 6`}</pre>
        </div>
      )}
      after={
        <AnswerBox
          fields={[
            { label: 'первое число', answer: '46' },
            { label: 'число, из которого отнимали', answer: '65' },
            { label: 'какое число отняли', answer: '29' },
          ]}
          onCorrect={finish}
        />
      }
    />
      )}
    </TaskGate>
  )
}

function Say({ text }: { text: string }) {
  useNarration(text)
  return null
}
