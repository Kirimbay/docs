import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from 'react'
import { audioUrl, speakFallback, stopFallback } from '../lib/speech'

const SILENT_WAV =
  'data:audio/wav;base64,UklGRiQAAABXQVZFZm10IBAAAAABAAEARKwAAIhYAQACABAAZGF0YQAAAAA='

type Voice = {
  speak: (text: string) => number
  stopOwned: (token: number) => void
  unlock: () => void
  speaking: boolean
  enabled: boolean
  setEnabled: (on: boolean) => void
  line: string
}

const Ctx = createContext<Voice | null>(null)

export function VoiceProvider({ children }: { children: ReactNode }) {
  const audioRef = useRef<HTMLAudioElement | null>(null)
  const token = useRef(0)
  const [speaking, setSpeaking] = useState(false)
  const [line, setLine] = useState('')
  const [enabled, setEnabledState] = useState(() => localStorage.getItem('misha-voice') !== 'off')

  const silence = useCallback((my: number) => {
    if (token.current !== my) return
    token.current += 1
    const audio = audioRef.current
    if (audio) {
      audio.onended = null
      audio.onerror = null
      audio.pause()
    }
    stopFallback()
    setSpeaking(false)
  }, [])

  const unlock = useCallback(() => {
    if (!enabled) return
    if (!audioRef.current) audioRef.current = new Audio()
    const audio = audioRef.current
    if (audio.dataset.unlocked === '1') return
    audio.dataset.unlocked = '1'
    audio.src = SILENT_WAV
    void audio.play().then(() => audio.pause()).catch(() => {
      audio.dataset.unlocked = ''
    })
  }, [enabled])

  const speak = useCallback(
    (text: string) => {
      const my = ++token.current
      setLine(text)
      if (!enabled || !text) return my
      const finish = () => {
        if (token.current !== my) return
        setSpeaking(false)
      }
      const url = audioUrl(text)
      if (!audioRef.current) audioRef.current = new Audio()
      const audio = audioRef.current
      if (url) {
        audio.onended = null
        audio.pause()
        audio.src = url
        audio.onended = finish
        audio.onerror = () => {
          if (token.current !== my) return
          speakFallback(text, finish)
        }
        setSpeaking(true)
        void audio.play().catch(() => {
          if (token.current !== my) return
          speakFallback(text, finish)
        })
        return my
      }
      setSpeaking(true)
      speakFallback(text, finish)
      return my
    },
    [enabled],
  )

  const setEnabled = useCallback(
    (on: boolean) => {
      localStorage.setItem('misha-voice', on ? 'on' : 'off')
      setEnabledState(on)
      if (!on) silence(++token.current)
    },
    [silence],
  )

  const value = useMemo(
    () => ({ speak, stopOwned: silence, unlock, speaking, enabled, setEnabled, line }),
    [speak, silence, unlock, speaking, enabled, setEnabled, line],
  )

  return <Ctx.Provider value={value}>{children}</Ctx.Provider>
}

export function useVoice(): Voice {
  const value = useContext(Ctx)
  if (!value) throw new Error('Голос ещё не готов')
  return value
}

/** Plays `text` whenever it or `nonce` changes. */
export function useNarration(text: string, nonce: number | string = 0) {
  const { speak, stopOwned, line } = useVoice()
  const lineRef = useRef(line)
  lineRef.current = line
  useEffect(() => {
    // A click may have started this exact line already. Don't restart it.
    if (nonce === 0 && lineRef.current === text) return
    const my = speak(text)
    return () => stopOwned(my)
  }, [text, nonce, speak, stopOwned])
}
