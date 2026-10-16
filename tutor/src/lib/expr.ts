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

function picture(op: Op, a: number, b: number, value: number): string {
  if (op === '+') return `${cap(say(a))} плюс ${say(b)} — ${say(value)}.`
  if (op === '−') return `${cap(say(a))} минус ${say(b)} — ${say(value)}.`
  if (op === '·') return `${cap(say(a))} умножить на ${say(b)} — ${say(value)}.`
  return `${cap(say(a))} разделить на ${say(b)} — ${say(value)}.`
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
          why: 'Скобки уже посчитаны.',
          caption: `(${value}) = ${value}`,
          speech: `В скобках осталось одно число, ${say(value)}. Скобки больше не нужны: ставим это число.`,
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
        why: 'Вначале — действие в скобках.',
        caption: `${hit.a} ${hit.op} ${hit.b} = ${value}`,
        speech: `Вначале считаем в скобках. Снаружи пока не трогаем. ${picture(hit.op, hit.a, hit.b, value)}`,
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
      why = 'Следующее — умножение и деление.'
      lead = 'Сложение и вычитание ещё рано. По правилу сначала умножение и деление.'
    } else if (isMul(hit.op)) {
      why = 'Слева направо.'
      lead = 'Умножение и деление идут слева направо. Сначала левый знак.'
    } else {
      why = 'Потом сложение и вычитание.'
      lead = 'Скобки, умножение и деление уже сделаны. Сложение и вычитание идут слева направо.'
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

/** Which rule this expression follows, told slowly, before the steps. */
export function ruleSpeech(input: string): string {
  const tokens = parse(input)
  const ops = tokens.flatMap((t) => (t.k === 'op' ? [t.v] : []))
  const hasParen = tokens.some((t) => t.k === 'lp')
  const hasMul = ops.some((op) => isMul(op))
  const hasAdd = ops.some((op) => !isMul(op))
  const parts = [`Нельзя считать как захочется. Смотрим, что делается вначале, а что следующее. Пример: ${readExpr(input)}.`]
  if (hasParen) {
    parts.push('Вначале действия в скобках. Снаружи не считаем, пока внутри не останется одно число.')
  }
  if (hasMul && hasAdd) {
    parts.push('Следующее: умножение и деление. Их делают раньше сложения и вычитания.')
  } else if (hasMul) {
    parts.push('Здесь умножение и деление. Скобок нет, идём слева направо: сначала левый знак.')
  }
  if (hasAdd && !hasMul && !hasParen) {
    parts.push('Здесь только сложение и вычитание. Они равны между собой. Идём слева направо: сначала левый знак, потом следующий.')
  } else if (hasAdd) {
    parts.push('Потом сложение и вычитание, слева направо.')
  }
  parts.push('Сейчас пройду эти шаги по порядку.')
  return parts.join(' ')
}

export type AltPicture = 'intro' | 'dots' | 'rows' | 'split' | 'fade' | 'unwrap' | 'answer'

export type AltBeat = {
  caption: string
  speech: string
  picture: AltPicture
  a: number
  b: number
  value: number
}

function stepAction(step: SolveStep): { kind: Op | 'unwrap'; a: number; b: number; value: number } {
  const slice = step.before.slice(step.from, step.to + 1)
  const valueTok = step.after[step.from]
  const value = valueTok && valueTok.k === 'n' ? valueTok.v : 0
  if (slice[0]?.k === 'lp' && slice.at(-1)?.k === 'rp' && slice.length === 3) {
    const n = slice[1]
    return { kind: 'unwrap', a: n && n.k === 'n' ? n.v : value, b: 0, value }
  }
  const opTok = slice.find((t) => t.k === 'op')
  const nums = slice.filter((t) => t.k === 'n')
  if (!opTok || opTok.k !== 'op' || nums.length < 2 || !nums[0] || !nums[1]) {
    return { kind: 'unwrap', a: value, b: 0, value }
  }
  return { kind: opTok.v, a: nums[0].v, b: nums[1].v, value }
}

function queueNote(why: string): string {
  if (why.startsWith('Вначале')) return 'Снаружи пока не считаем: это действие в скобках, оно первое.'
  if (why.startsWith('Скобки уже')) return 'Внутри скобок осталось одно число, поэтому скобки снимаем.'
  if (why.startsWith('Следующее')) return 'Плюс и минус ещё рано трогать: сначала очередь умножения и деления.'
  if (why.startsWith('Слева')) return 'Этот знак левее другого умножения или деления, поэтому он следующий.'
  return 'Скобки, умножение и деление уже сделаны. Плюс и минус берём слева направо, сначала левый знак.'
}

/** Another walk of the same example: dots on the picture, and why this sign is next. */
export function exprAltBeats(input: string): AltBeat[] {
  const steps = solve(input)
  const beats: AltBeat[] = [
    {
      caption: 'Другое объяснение: очередь знаков',
      speech: `Это другое объяснение, не повтор. Пример: ${readExpr(input)}. На картинке три правила по порядку. Нельзя брать знак просто потому, что он левее. Сначала скобки, если они есть. Потом умножение и деление, слева направо. Потом сложение и вычитание, слева направо. Сейчас каждое действие покажу точками.`,
      picture: 'intro',
      a: 0,
      b: 0,
      value: 0,
    },
  ]
  for (const step of steps) {
    const act = stepAction(step)
    const note = queueNote(step.why)
    if (act.kind === 'unwrap') {
      beats.push({
        caption: `Скобки сняты: ${act.value}`,
        speech: `В скобках осталось одно число, ${say(act.a)}. На картинке скобки раскрываются, и остаётся ${say(act.value)}. ${note}`,
        picture: 'unwrap',
        a: act.a,
        b: 0,
        value: act.value,
      })
    } else if (act.kind === '+') {
      beats.push({
        caption: `${act.a} + ${act.b} = ${act.value}`,
        speech: `Складываем ${say(act.a)} и ${say(act.b)}. На картинке жёлтые точки — первое число, красные — второе, они съезжаются. Вместе ${say(act.value)}. ${note}`,
        picture: 'dots',
        a: act.a,
        b: act.b,
        value: act.value,
      })
    } else if (act.kind === '−') {
      beats.push({
        caption: `${act.a} − ${act.b} = ${act.value}`,
        speech: `Вычитаем. Было ${say(act.a)} точек, ${say(act.b)} из них бледнеют и пропадают. Остаётся ${say(act.value)}. ${note}`,
        picture: 'fade',
        a: act.a,
        b: act.b,
        value: act.value,
      })
    } else if (act.kind === '·') {
      beats.push({
        caption: `${act.a} · ${act.b} = ${act.value}`,
        speech: `Умножаем. В ряду ${say(act.a)} точек, рядов ${say(act.b)}. На картинке ряды появляются по очереди. Всего точек ${say(act.value)}. ${note}`,
        picture: 'rows',
        a: act.a,
        b: act.b,
        value: act.value,
      })
    } else {
      beats.push({
        caption: `${act.a} : ${act.b} = ${act.value}`,
        speech: `Делим. ${say(act.a)} точек раскладываем на ${say(act.b)}. На картинке ряды одинаковые, в каждом по ${say(act.value)}. ${note}`,
        picture: 'split',
        a: act.a,
        b: act.b,
        value: act.value,
      })
    }
  }
  const value = resultOf(input)
  beats.push({
    caption: 'Одно число в конце',
    speech: `На картинке осталось одно число: ${say(value)}. Если у тебя вышло другое, очередь знаков сбилась. Вернись к первому действию: что по правилу раньше, то и считаем. В ответе ${say(value)}.`,
    picture: 'answer',
    a: 0,
    b: 0,
    value,
  })
  return beats
}

/** One slow explanation: the rule, every step, and how to notice a wrong answer. */
export function detailedSpeech(input: string): string {
  const steps = solve(input)
  const walk = steps
    .map((step, index) => `Шаг ${index + 1}. ${step.speech}`)
    .join(' ')
  return `${ruleSpeech(input)} ${walk} В ответе ${say(resultOf(input))}. Если вышло другое число, проверь, что сделано вначале, а что следующее.`
}

export function practiceSpeech(input: string): string {
  return `Проверочное задание. Способ тот же, числа другие. ${readExpr(input)}. Посчитай сам и запиши ответ.`
}
