import map from '../audio-map.json'

const table = map as Record<string, string>

export function audioUrl(text: string): string | null {
  const file = table[text]
  return file ? `/audio/${file}.mp3` : null
}

let cachedVoice: SpeechSynthesisVoice | null | undefined

function pickVoice(): SpeechSynthesisVoice | null {
  if (cachedVoice !== undefined) return cachedVoice
  if (typeof speechSynthesis === 'undefined') {
    cachedVoice = null
    return null
  }
  const voices = speechSynthesis.getVoices()
  const ru = voices.filter((v) => v.lang.toLowerCase().startsWith('ru'))
  cachedVoice =
    ru.find((v) => /dmitry|dmitri|pavel|male|муж/i.test(v.name)) ??
    ru.find((v) => !/female|svetlana|irina|жен/i.test(v.name)) ??
    ru[0] ??
    null
  return cachedVoice
}

if (typeof speechSynthesis !== 'undefined') {
  speechSynthesis.addEventListener('voiceschanged', () => {
    cachedVoice = undefined
  })
}

/** Browser voice only if the recorded file is missing. A bit faster, medium pitch. */
export function speakFallback(text: string, onend: () => void): void {
  if (typeof speechSynthesis === 'undefined') {
    onend()
    return
  }
  try {
    const utter = new SpeechSynthesisUtterance(text)
    utter.lang = 'ru-RU'
    utter.rate = 1.25
    utter.pitch = 1
    const voice = pickVoice()
    if (voice) utter.voice = voice
    utter.onend = onend
    utter.onerror = onend
    speechSynthesis.cancel()
    speechSynthesis.speak(utter)
  } catch {
    onend()
  }
}

export function stopFallback() {
  if (typeof speechSynthesis !== 'undefined') speechSynthesis.cancel()
}
