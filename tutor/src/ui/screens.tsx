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
import { shots } from '../clips'
import { AnswerBox, MarkSpeech, PracticeView, Stepper, TaskGate, Tokens, WithHelp } from './Bits'
import { BookClip } from './BookClip'
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
      <WithHelp beats={helpBeats.order} render={helpOf('order')} plate={<BookClip shot={shots.rule} active="banner" />}>
        <Stepper
          steps={ruleBeats}
          plate={<BookClip shot={shots.rule} active="banner" />}
          render={(index) => <RuleVisual step={index} />}
          doneLabel="Разобрать пример"
          onDone={() => setShowExample(true)}
        />
      </WithHelp>
    )
  }
  return (
    <div className="stage">
      <BookClip shot={shots.expr24} active={ruleExample} />
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
  shot,
}: {
  exprs: string[]
  intro: string
  solved: string[]
  onSolve: (expr: string) => void
  onDone: () => void
  shot: (typeof shots)['expr24']
}) {
  const [current, setCurrent] = useState<string | null>(null)
  const { speak } = useVoice()
  const finished = exprs.every((e) => solved.includes(e))

  return (
    <div className="stage">
      <BookClip shot={shot} active={current} />
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
      plate={<BookClip shot={shots.cubes} />}
      onDone={onDone}
    >
      {(finishBook) => (
        <Stepper
          steps={cubeBeats}
          render={(i) => (
            <>
              <BookClip shot={shots.cubes} active={[['rows', 'eight', 'red'], ['rows', 'eight'], ['red'], ['ask']][i]} />
              {i === 1 && <div className="badge spot">8 · 2 = 16 жёлтых</div>}
              {i === 2 && <div className="badge spot">красных уже 16</div>}
              {i === 3 && <div className="badge spot">16 + 16 = 32</div>}
            </>
          )}
          after={<AnswerBox fields={[{ label: 'кубиков в коробке', answer: '32' }]} onCorrect={finishBook} />}
        />
      )}
    </TaskGate>
  )
}

export function ChairTask({ onDone }: { onDone: () => void }) {
  return (
    <TaskGate
      help={helpBeats.chairs}
      helpRender={helpOf('chairs')}
      practice={practices.chairs}
      practicePicture={<PracticePicture topic="chairs" />}
      plate={<BookClip shot={shots.chairs} />}
      onDone={onDone}
    >
      {(finish) => (
        <Stepper
          steps={chairBeats}
          render={(i) => (
            <>
              <BookClip shot={shots.chairs} active={[['rows', 'total'], ['q1a', 'q1b'], ['q2a', 'q2b'], ['q3']][i]} />
              {i === 1 && <div className="badge spot">24 : 3 = 8 в ряду</div>}
              {i === 2 && <div className="badge spot">8 · 2 = 16</div>}
              {i === 3 && <div className="badge spot">8 · 10 = 80</div>}
            </>
          )}
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

export function TreeTask({ onDone }: { onDone: () => void }) {
  return (
    <TaskGate
      help={helpBeats.trees}
      helpRender={helpOf('trees')}
      practice={practices.trees}
      practicePicture={<PracticePicture topic="trees" />}
      plate={<BookClip shot={shots.trees} />}
      onDone={onDone}
    >
      {(finish) => (
        <Stepper
          steps={treeBeats}
          render={(i) => (
            <>
              <BookClip shot={shots.trees} active={[['birch', 'rowan'], ['q1a', 'q1b'], ['q2a', 'q2b']][i]} />
              {i === 1 && <div className="badge spot">15 − 3 = 12 метров</div>}
              {i === 2 && <div className="badge spot">15 : 3 = 5 раз</div>}
            </>
          )}
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

export function AppleTask({ onDone }: { onDone: () => void }) {
  return (
    <TaskGate
      help={helpBeats.apples}
      helpRender={helpOf('apples')}
      practice={practices.apples}
      practicePicture={<PracticePicture topic="apples" />}
      plate={<BookClip shot={shots.apples} />}
      onDone={onDone}
    >
      {(finish) => (
        <Stepper
          steps={appleBeats}
          render={(i) => (
            <>
              <BookClip
                shot={shots.apples}
                active={[['was', 'took', 'adda', 'addb', 'equal'], ['took', 'adda', 'addb'], ['equal'], ['aska', 'askb'], ['was']][i]}
              />
              {i === 1 && <div className="badge spot">13 − 2 + 3 = 14</div>}
              {i === 2 && <div className="badge spot">14 : 2 = 7</div>}
              {i === 3 && <div className="badge spot">7 − 3 = 4 и 7 + 2 = 9</div>}
              {i === 4 && <div className="badge spot">9 + 4 = 13</div>}
            </>
          )}
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

export function CloakTask({ onDone }: { onDone: () => void }) {
  return (
    <TaskGate
      help={helpBeats.cloaks}
      helpRender={helpOf('cloaks')}
      practice={practices.cloaks}
      practicePicture={<PracticePicture topic="cloaks" />}
      plate={<BookClip shot={shots.cloaks} />}
      onDone={onDone}
    >
      {(finish) => (
        <Stepper
          steps={cloakBeats}
          render={(i) => (
            <>
              <BookClip shot={shots.cloaks} active={[['n4', 'n3'], ['n4', 'n3'], ['n38', 'ask1', 'ask2']][i]} />
              {i === 1 && <div className="badge spot">4 · 3 = 12 метров ушло</div>}
              {i === 2 && <div className="badge spot">12 + 38 = 50 метров было</div>}
            </>
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
      plate={<BookClip shot={shots.multiply} />}
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
      <BookClip shot={shots.multiply} active={finished ? null : String(col)} />
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
      plate={<BookClip shot={shots.fabric} />}
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
      <BookClip
        shot={shots.fabric}
        active={row === null ? null : [['a0', 'b0', 'c0'], ['a1', 'b1', 'c1'], ['a2', 'b2', 'c2']][row]}
        onPick={(id) => {
          const next = Number(id.slice(1))
          if (!fabricRows[next]) return
          speak(fabricRows[next].speech)
          setRow(next)
        }}
      />
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
          <div className="badge spot">{['3 · 2 = 6', '6 : 2 = 3', '6 : 3 = 2'][row]}</div>
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

export function SchemeTask({ onDone }: { onDone: () => void }) {
  return (
    <TaskGate
      help={helpBeats.schemes}
      helpRender={helpOf('schemes')}
      practice={practices.schemes}
      practicePicture={<PracticePicture topic="schemes" />}
      plate={<BookClip shot={shots.schemes} />}
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
      <BookClip
        shot={shots.schemes}
        active={id}
        onPick={(next) => {
          const picked = schemes.find((item) => item.id === next)
          if (!picked) return
          speak(picked.speech)
          setId(picked.id)
        }}
      />
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
      plate={<BookClip shot={shots.geometry} active={['square', 'tri', 'rect']} />}
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
      plate={<BookClip shot={shots.shapes} />}
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
      <BookClip shot={shots.shapes} active={picked} onPick={pick} />
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

export function KiteTask({ onDone }: { onDone: () => void }) {
  return (
    <TaskGate
      help={helpBeats.kite}
      helpRender={helpOf('kite')}
      practice={practices.kite}
      practicePicture={<PracticePicture topic="kite" />}
      plate={<BookClip shot={shots.kite} />}
      onDone={onDone}
    >
      {(finish) => (
      <Stepper
        steps={kiteBeats}
        render={(step) => (
          <>
          <BookClip
            shot={shots.kite}
            active={step >= 2 ? ['q1', 'q2'] : ['1', '6', '12', '19', '27', '36']}
          />
          {step === 1 && <div className="badge spot">прибавляем 5, 6, 7, 8, 9</div>}
          {step >= 2 && <div className="badge spot">36 + 10 = 46, затем 46 + 11 = 57</div>}
          </>
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
      plate={<BookClip shot={shots.rebus} active="house" />}
      onDone={onDone}
    >
      {(finish) => (
    <Stepper
      steps={rebusBeats}
      render={(step) => (
        <>
        <BookClip shot={shots.rebus} active={step === 0 ? 'house' : step === 1 ? 'top' : 'bot'} />
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
        </>
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
