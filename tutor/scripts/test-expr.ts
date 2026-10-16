import { resultOf, solve } from '../src/lib/expr.ts'

const cases: [string, number][] = [
  ['30 + 15 − 6', 39],
  ['60 − 7 + 18', 71],
  ['70 : (3 + 7) + 24', 31],
  ['60 : 6 · 3 − 18', 12],
  ['18 : 3 + 4 · 3', 18],
  ['2 · 8 + 21 : 7', 19],
  ['100 − (24 − 18) · 3', 82],
  ['100 − (72 − 67) · 2', 90],
  ['12 + 6 : 2 − 7 · 2', 1],
  ['37 + 9 − 6 : 2 · 3', 37],
  ['72 − (47 − 20) : 3', 63],
  ['21 : (15 − 8) · 9', 27],
  ['18 : (11 − 5) + 47', 50],
  ['2 · 9 − 6 · 3', 0],
  ['24 : 3 + 9 · 3', 35],
  ['7 · 3 − (16 + 4)', 1],
  ['12 : (3 · 2) − 2', 0],
  ['18 : 9 + 27 : 3', 11],
  ['15 − 6 + 4', 13],
  ['24 : 3 · 2', 16],
  ['20 − 3 · 4', 8],
  ['19 − 12 : 3', 15],
  ['7 + 6 · 3', 25],
  ['11 + 18 : 3', 17],
  ['30 − (8 + 4) : 3', 26],
  ['5 + 4 · (9 − 6)', 17],
  ['3 · (4 + 2) + 5', 23],
]

let failed = 0
for (const [expr, answer] of cases) {
  const got = resultOf(expr)
  const steps = solve(expr)
  if (got !== answer) {
    failed++
    console.error('FAIL', expr, 'got', got, 'want', answer)
  } else if (!steps.length || !steps.every((s) => s.speech && s.caption)) {
    failed++
    console.error('EMPTY', expr)
  }
}

if (failed) {
  console.error(failed, 'failed')
  process.exit(1)
}
console.log(`ok ${cases.length} expressions`)
