import { useMemo, useState } from 'react'
import {
  expr24,
  expr24Intro,
  expr25,
  expr25Intro,
  greeting,
  openingSpeech,
  tasks,
} from './content'
import { loadProgress, saveProgress, type Progress } from './lib/progress'
import { Misha } from './ui/Misha'
import {
  AppleTask,
  ChairTask,
  CloakTask,
  CubeTask,
  ExpressionSet,
  FabricTask,
  GeometryTask,
  KiteTask,
  MultiplyTask,
  RebusTask,
  RuleTask,
  SchemeTask,
  ShapesTask,
  TreeTask,
} from './ui/screens'
import { useVoice, VoiceProvider } from './ui/voice'

type Screen = { name: 'home' } | { name: 'map' } | { name: 'task'; id: string }

export function App() {
  return (
    <VoiceProvider>
      <Shell />
    </VoiceProvider>
  )
}

function Shell() {
  const [screen, setScreen] = useState<Screen>({ name: 'home' })
  const [progress, setProgress] = useState<Progress>(() => loadProgress())
  const voice = useVoice()
  const task = screen.name === 'task' ? tasks.find((item) => item.id === screen.id) : undefined

  function patch(next: Progress) {
    saveProgress(next)
    setProgress(next)
  }

  function mark(id: string) {
    if (progress.done.includes(id)) return
    patch({ ...progress, done: [...progress.done, id] })
  }

  function markExpr(expr: string) {
    if (progress.exprs.includes(expr)) return
    patch({ ...progress, exprs: [...progress.exprs, expr] })
  }

  const doneCount = progress.done.length

  return (
    <div className="app">
      <header className="top">
        <button type="button" className="brand" onClick={() => setScreen({ name: 'home' })}>
          <Misha speaking={voice.speaking} mood={screen.name === 'home' ? 'cheer' : 'calm'} />
          <span>
            <strong>Миша</strong>
            <small>добрый репетитор</small>
          </span>
        </button>
        <div className="top-actions">
          <span className="stars" aria-label={`звёзд ${doneCount}`}>
            ★ {doneCount}
          </span>
          <button
            type="button"
            className={`btn ghost small ${voice.enabled ? '' : 'off'}`}
            onClick={() => voice.setEnabled(!voice.enabled)}
          >
            {voice.enabled ? 'Голос включён' : 'Голос выключен'}
          </button>
          {screen.name !== 'home' && (
            <button
              type="button"
              className="btn ghost small"
              onClick={() => setScreen(screen.name === 'task' ? { name: 'map' } : { name: 'home' })}
            >
              Назад
            </button>
          )}
        </div>
      </header>

      {screen.name === 'home' && (
        <Home
          onStart={() => {
            voice.unlock()
            setScreen({ name: 'map' })
          }}
        />
      )}
      {screen.name === 'map' && (
        <Map
          done={progress.done}
          exprDone={progress.exprs}
          onOpen={(id) => {
            voice.unlock()
            voice.speak(openingSpeech(id))
            setScreen({ name: 'task', id })
          }}
        />
      )}
      {screen.name === 'task' && task && (
        <section className="lesson">
          <div className="lesson-grid">
            <aside className="tutor">
              <Misha speaking={voice.speaking} mood="calm" />
            </aside>
            <div>
              <div className="lesson-head">
                <p>
                  Страница {task.page} · {task.title}
                </p>
                <h1>{task.blurb}</h1>
              </div>
              <TaskBody id={task.id} progress={progress} onDone={() => mark(task.id)} onSolve={markExpr} />
            </div>
          </div>
        </section>
      )}
    </div>
  )
}

function Home({ onStart }: { onStart: () => void }) {
  const { speak, speaking, unlock } = useVoice()
  return (
    <section className="home">
      <div className="hero">
        <Misha speaking={speaking} mood="cheer" />
        <div>
          <p className="eyebrow">Страницы 24–25</p>
          <h1>Разберём учебник по шагам</h1>
          <p className="lead">
            Нажми на задание. Миша расскажет спокойным голосом, что делать и почему, и покажет это на картинке.
          </p>
          <div className="row">
            <button type="button" className="btn" onClick={onStart}>
              Открыть задания
            </button>
            <button type="button" className="btn ghost" onClick={() => { unlock(); speak(greeting) }}>
              Пусть Миша поздоровается
            </button>
          </div>
        </div>
      </div>
      <ol className="howto">
        <li>Выбери задание на странице.</li>
        <li>Слушай Мишу и смотри, что загорается.</li>
        <li>Запиши ответ на больших кнопках.</li>
      </ol>
    </section>
  )
}

function Map({
  done,
  exprDone,
  onOpen,
}: {
  done: string[]
  exprDone: string[]
  onOpen: (id: string) => void
}) {
  const pages = [24, 25] as const
  const exprProgress = useMemo(
    () => ({
      expr24: expr24.filter((e) => exprDone.includes(e)).length,
      expr25: expr25.filter((e) => exprDone.includes(e)).length,
    }),
    [exprDone],
  )
  return (
    <section className="map">
      <div className="map-intro">
        <h1>Порядок действий</h1>
        <p>Пятнадцать заданий с этих двух страниц. Звезда появляется, когда задание дослушано и ответ записан.</p>
      </div>
      {pages.map((page) => (
        <div key={page} className="page-block">
          <h2>Страница {page}</h2>
          <div className="cards">
            {tasks
              .filter((task) => task.page === page)
              .map((task) => {
                const extra =
                  task.id === 'expr24'
                    ? `${exprProgress.expr24}/${expr24.length}`
                    : task.id === 'expr25'
                      ? `${exprProgress.expr25}/${expr25.length}`
                      : null
                return (
                  <button
                    key={task.id}
                    type="button"
                    className={`task-card ${done.includes(task.id) ? 'done' : ''}`}
                    style={{ background: task.tint }}
                    onClick={() => onOpen(task.id)}
                  >
                    <span className="ico">{task.icon}</span>
                    <strong>{task.title}</strong>
                    <em>{task.blurb}</em>
                    {extra && <small>{extra}</small>}
                    {done.includes(task.id) && <span className="star">★</span>}
                  </button>
                )
              })}
          </div>
        </div>
      ))}
      <figure className="photo">
        <img src="/textbook.jpg" alt="Разворот учебника, страницы 24 и 25" />
        <figcaption>Так эти страницы выглядят в учебнике. Задания те же, только здесь их можно нажимать.</figcaption>
      </figure>
    </section>
  )
}

function TaskBody({
  id,
  progress,
  onDone,
  onSolve,
}: {
  id: string
  progress: Progress
  onDone: () => void
  onSolve: (expr: string) => void
}) {
  if (id === 'rule') return <RuleTask onDone={onDone} />
  if (id === 'expr24') {
    return (
      <ExpressionSet
        exprs={expr24}
        intro={expr24Intro}
        solved={progress.exprs}
        onSolve={onSolve}
        onDone={onDone}
      />
    )
  }
  if (id === 'expr25') {
    return (
      <ExpressionSet
        exprs={expr25}
        intro={expr25Intro}
        solved={progress.exprs}
        onSolve={onSolve}
        onDone={onDone}
      />
    )
  }
  if (id === 'multiply') return <MultiplyTask onDone={onDone} />
  if (id === 'cubes') return <CubeTask onDone={onDone} />
  if (id === 'chairs') return <ChairTask onDone={onDone} />
  if (id === 'trees') return <TreeTask onDone={onDone} />
  if (id === 'geometry') return <GeometryTask onDone={onDone} />
  if (id === 'apples') return <AppleTask onDone={onDone} />
  if (id === 'rebus') return <RebusTask onDone={onDone} />
  if (id === 'schemes') return <SchemeTask onDone={onDone} />
  if (id === 'fabric') return <FabricTask onDone={onDone} />
  if (id === 'cloaks') return <CloakTask onDone={onDone} />
  if (id === 'shapes') return <ShapesTask onDone={onDone} />
  if (id === 'kite') return <KiteTask onDone={onDone} />
  return null
}
