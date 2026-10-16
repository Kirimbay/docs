const KEY = 'misha-tutor-v1'

export type Progress = {
  done: string[]
  exprs: string[]
}

const empty: Progress = { done: [], exprs: [] }

export function loadProgress(): Progress {
  try {
    const raw = localStorage.getItem(KEY)
    if (!raw) return empty
    const data = JSON.parse(raw) as Progress
    return {
      done: Array.isArray(data.done) ? data.done : [],
      exprs: Array.isArray(data.exprs) ? data.exprs : [],
    }
  } catch {
    return empty
  }
}

export function saveProgress(p: Progress) {
  localStorage.setItem(KEY, JSON.stringify(p))
}
