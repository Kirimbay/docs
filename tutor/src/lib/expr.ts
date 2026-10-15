import { say } from './russian'

export type Op = '+' | '−' | '·' | ':'

export type Tok =
  | { k: 'n'; v: number }
  | { k: 'op'; v: Op }
  | { k: 'lp' }
  | { k: 'rp' }

export type SolveStep = {
  before: Tok[]
  after: Tok[]
  from: number
  to: number
  why: string
  caption: string
  speech: string
}

function isMul(op: Op): boolean {
  return op === '·' || op === ':'
}

export function parse(input: string): Tok[] {
  const s = input.replace(/\s+/g, '')
  const out: Tok[] = []
  let i = 0
  while (i < s.length) {
    const ch = s[i]
    if (ch >= '0' && ch <= '9') {
      let j = i + 1
      while (j < s.length && s[j] >= '0' && s[j] <= '9') j++
      out.push({ k: 'n', v: Number(s.slice(i, j)) })
      i = j
      continue
    }
    if (ch === '(') {
      out.push({ k: 'lp' })
      i++
      continue
    }
    if (ch === ')') {
      out.push({ k: 'rp' })
      i++
      continue
    }
    if (ch === '+') {
      out.push({ k: 'op', v: '+' })
      i++
      continue
    }
    if (ch === '−' || ch === '-') {
      out.push({ k: 'op', v: '−' })
      i++
      continue
    }
    if (ch === '·' || ch === '*' || ch === '×' || ch === 'x' || ch === 'X') {
      out.push({ k: 'op', v: '·' })
      i++
      continue
    }
    if (ch === ':' || ch === '/' || ch === '÷') {
      out.push({ k: 'op', v: ':' })
      i++
      continue
    }
    throw new Error(`Не понял знак «${ch}» в примере ${input}`)
  }
  return out
}

export function glyph(tok: Tok): string {
  if (tok.k === 'n') return String(tok.v)
  if (tok.k === 'lp') return '('
  if (tok.k === 'rp') return ')'
  return tok.v
}

function cap(s: string): string {
  return s.charAt(0).toUpperCase() + s.slice(1)
}

/** How many times, with the right Russian ending: «три раза», «пять раз». */
function times(n: number): string {
  const n10 = n % 10
  const n100 = n % 100
  const word = n10 === 1 && n100 !== 11 ? 'раз' : n10 >= 2 && n10 <= 4 && (n100 < 12 || n100 > 14) ? 'раза' : 'раз'
  return `${say(n)} ${word}`
}

function picture(op: Op, a: number, b: number, value: number): string {
  if (op === '+') return `${cap(say(a))} и ещё ${say(b)} — вместе ${say(value)}.`
  if (op === '−') return `От ${say(a)} отнимаем ${say(b)}, как будто убрали. Останется ${say(value)}.`
  if (op === '·') return `${cap(say(a))} взять ${times(b)}. Получится ${say(value)}.`
  return `Смотрим, сколько раз по ${say(b)} умещается в числе ${say(a)}. ${cap(times(value))}.`
}

function findInnermost(tokens: Tok[]): { start: number; end: number } | null {
  const stack: number[] = []
  for (let i = 0; i < tokens.length; i++) {
    const t = tokens[i]
    if (t.k === 'lp') stack.push(i)
    else if (t.k === 'rp') {
      const start = stack.pop()
      if (start === undefined) throw new Error('Лишняя скобка')
      const inner = tokens.slice(start + 1, i)
      if (!inner.some((x) => x.k === 'lp' || x.k === 'rp')) return { start, end: i }
    }
  }
  if (stack.length) throw new Error('Не закрыта скобка')
  return null
}

function replaceRange(tokens: Tok[], from: number, to: number, value: number): Tok[] {
  return [...tokens.slice(0, from), { k: 'n' as const, v: value }, ...tokens.slice(to + 1)]
}

function nextFlat(
  tokens: Tok[],
  lo: number,
  hi: number,
): { from: number; to: number; op: Op; a: number; b: number } | null {
  const opIdx: number[] = []
  for (let i = lo; i <= hi; i++) {
    if (tokens[i].k === 'op') opIdx.push(i)
  }
  if (!opIdx.length) return null
  const mul = opIdx.find((i) => tokens[i].k === 'op' && isMul(tokens[i].v))
  const idx = mul ?? opIdx[0]
  const opTok = tokens[idx]
  const left = tokens[idx - 1]
  const right = tokens[idx + 1]
  if (!opTok || opTok.k !== 'op' || !left || left.k !== 'n' || !right || right.k !== 'n') {
    throw new Error('Пример записан неполно')
  }
  return { from: idx - 1, to: idx + 1, op: opTok.v, a: left.v, b: right.v }
}

function apply(op: Op, a: number, b: number): number {
  if (op === '+') return a + b
  if (op === '−') return a - b
  if (op === '·') return a * b
  if (b === 0) throw new Error('На ноль делить нельзя')
  if (a % b !== 0) throw new Error(`Деление ${a} : ${b} не целое`)
  return a / b
}

export function solve(input: string): SolveStep[] {
  let tokens = parse(input)
  const steps: SolveStep[] = []
  for (let guard = 0; tokens.length > 1 && guard < 40; guard++) {
    const paren = findInnermost(tokens)
    if (paren) {
      const innerCount = paren.end - paren.start - 1
      const only = tokens[paren.start + 1]
      if (innerCount === 1 && only.k === 'n') {
        const value = only.v
        const after = replaceRange(tokens, paren.start, paren.end, value)
        steps.push({
          before: tokens,
          after,
          from: paren.start,
          to: paren.end,
          why: 'Скобки уже ничего не прячут.',
          caption: `(${value}) = ${value}`,
          speech: `В скобках осталось одно число, ${say(value)}. Коробочка пустая, её можно снять, число не меняется.`,
        })
        tokens = after
        continue
      }
      const hit = nextFlat(tokens, paren.start + 1, paren.end - 1)
      if (!hit) throw new Error('В скобках пусто')
      const value = apply(hit.op, hit.a, hit.b)
      const after = replaceRange(tokens, hit.from, hit.to, value)
      steps.push({
        before: tokens,
        after,
        from: hit.from,
        to: hit.to,
        why: 'Сначала коробочка — скобки.',
        caption: `${hit.a} ${hit.op} ${hit.b} = ${value}`,
        speech: `Скобки — это коробочка. Снаружи пока не трогаем, считаем только внутри. ${picture(hit.op, hit.a, hit.b, value)}`,
      })
      tokens = after
      continue
    }

    const hit = nextFlat(tokens, 0, tokens.length - 1)
    if (!hit) break
    const value = apply(hit.op, hit.a, hit.b)
    const hasAdd = tokens.some((t) => t.k === 'op' && !isMul(t.v))
    let why: string
    let lead: string
    if (isMul(hit.op) && hasAdd) {
      why = 'Группы считаем раньше плюса и минуса.'
      lead = 'Плюс и минус пока не трогаем. Умножение и деление сильнее: они про целые группы, поэтому их делают раньше.'
    } else if (isMul(hit.op)) {
      why = 'Кто левее, тот первый.'
      lead = 'Умножение и деление здесь одной силы. Не перескакиваем к правому знаку.'
    } else {
      why = 'Плюс и минус — шаги слева направо.'
      lead = 'Группы уже посчитаны. Плюс не важнее минуса: идём слева направо.'
    }
    const after = replaceRange(tokens, hit.from, hit.to, value)
    steps.push({
      before: tokens,
      after,
      from: hit.from,
      to: hit.to,
      why,
      caption: `${hit.a} ${hit.op} ${hit.b} = ${value}`,
      speech: `${lead} ${picture(hit.op, hit.a, hit.b, value)}`,
    })
    tokens = after
  }
  if (tokens.length !== 1 || tokens[0].k !== 'n') {
    throw new Error(`Не смог досчитать пример ${input}`)
  }
  return steps
}

export function resultOf(input: string): number {
  const steps = solve(input)
  const last = steps[steps.length - 1].after
  const tok = last[0]
  if (!tok || tok.k !== 'n') throw new Error(input)
  return tok.v
}

export function readExpr(input: string): string {
  return parse(input)
    .map((t) => {
      if (t.k === 'n') return say(t.v)
      if (t.k === 'lp') return 'открываем скобку'
      if (t.k === 'rp') return 'закрываем скобку'
      if (t.v === '+') return 'плюс'
      if (t.v === '−') return 'минус'
      if (t.v === '·') return 'умножить на'
      return 'разделить на'
    })
    .join(', ')
}

export function exprIntro(input: string): string {
  return `Сначала прочитаю пример: ${readExpr(input)}. Потом скажу, почему первое действие именно это, а не соседнее.`
}

export function exprFinal(input: string): string {
  return `Вот и всё. В ответе ${say(resultOf(input))}. Запиши число, чтобы оно запомнилось.`
}
