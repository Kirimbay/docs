import { writeFileSync } from 'node:fs'
import { allSpeeches } from '../src/speeches.ts'

const texts = allSpeeches()
writeFileSync(new URL('./speeches.json', import.meta.url), JSON.stringify(texts, null, 2))
console.log(`phrases ${texts.length}`)
