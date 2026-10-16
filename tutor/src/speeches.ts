import {
  appleBeats,
  chairBeats,
  cloakBeats,
  correctSpeech,
  cubeBeats,
  expr24,
  expr24Bottom,
  expr24BottomIntro,
  expr24Intro,
  expr25,
  expr25Bottom,
  expr25BottomIntro,
  expr25Intro,
  fabricIntro,
  fabricRows,
  geoBeats,
  greeting,
  kiteBeats,
  kiteIntro,
  multCols,
  rebusBeats,
  rebusIntro,
  revealSpeech,
  ruleBeats,
  ruleExample,
  schemeIntro,
  schemes,
  shapeSpeech,
  shapesIntro,
  treeBeats,
  wrongSpeech,
} from './content'
import { geoHelp, geoPractice } from './extra'
import { exprFinal, exprIntro, solve } from './lib/expr'

function add(bag: Set<string>, text: string) {
  if (text.trim()) bag.add(text)
}

export function allSpeeches(): string[] {
  const bag = new Set<string>()
  add(bag, greeting)
  add(bag, correctSpeech)
  add(bag, wrongSpeech)
  add(bag, revealSpeech)
  add(bag, expr24Intro)
  add(bag, expr24BottomIntro)
  add(bag, expr25Intro)
  add(bag, expr25BottomIntro)
  add(bag, schemeIntro)
  add(bag, fabricIntro)
  add(bag, shapesIntro)
  add(bag, kiteIntro)
  add(bag, rebusIntro)
  for (const beat of [...ruleBeats, ...geoBeats, ...geoHelp, ...cubeBeats, ...chairBeats, ...treeBeats, ...appleBeats, ...cloakBeats, ...kiteBeats, ...rebusBeats]) {
    add(bag, beat.speech)
  }
  add(bag, geoPractice.speech)
  for (const row of fabricRows) add(bag, row.speech)
  for (const col of multCols) add(bag, col.speech)
  for (const scheme of schemes) add(bag, scheme.speech)
  for (const speech of Object.values(shapeSpeech)) add(bag, speech)
  add(bag, 'Таблица заполнена. В каждой клетке теперь видно, какие два числа перемножили и что получилось.')

  const exprs = new Set<string>([
    ...expr24,
    ...expr24Bottom,
    ...expr25,
    ...expr25Bottom,
    ruleExample,
    ...schemes.map((s) => s.example),
  ])
  for (const expr of exprs) {
    add(bag, exprIntro(expr))
    add(bag, exprFinal(expr))
    for (const step of solve(expr)) add(bag, step.speech)
  }
  return [...bag]
}
