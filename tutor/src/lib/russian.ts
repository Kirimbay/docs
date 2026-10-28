const ONES = [
  'ноль',
  'один',
  'два',
  'три',
  'четыре',
  'пять',
  'шесть',
  'семь',
  'восемь',
  'девять',
  'десять',
  'одиннадцать',
  'двенадцать',
  'тринадцать',
  'четырнадцать',
  'пятнадцать',
  'шестнадцать',
  'семнадцать',
  'восемнадцать',
  'девятнадцать',
]

const TENS = [
  '',
  '',
  'двадцать',
  'тридцать',
  'сорок',
  'пятьдесят',
  'шестьдесят',
  'семьдесят',
  'восемьдесят',
  'девяносто',
]

/** How Misha says a whole number. Medium, plain, no extra sweetness. */
export function say(n: number): string {
  if (!Number.isFinite(n)) return String(n)
  if (!Number.isInteger(n)) return String(n)
  if (n < 0) return `минус ${say(-n)}`
  if (n < 20) return ONES[n]
  if (n < 100) {
    const t = Math.floor(n / 10)
    const o = n % 10
    return o ? `${TENS[t]} ${ONES[o]}` : TENS[t]
  }
  if (n < 200) {
    const rest = n - 100
    return rest ? `сто ${say(rest)}` : 'сто'
  }
  return String(n)
}
