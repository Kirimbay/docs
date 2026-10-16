import { useId } from 'react'
import type { PageShot } from '../clips'

/** Textbook crop. The part Kukuzya is talking about gets a moving outline. */
export function BookClip({
  shot,
  active,
  onPick,
}: {
  shot: PageShot
  active?: string | string[] | null
  onPick?: (id: string) => void
}) {
  const uid = useId().replace(/:/g, '')
  const ids = active == null ? [] : Array.isArray(active) ? active : [active]
  const hot = shot.regions.filter((region) => ids.includes(region.id))

  return (
    <figure className={`book ${shot.slim ? 'slim' : ''}`}>
      <img src={shot.src} width={shot.w} height={shot.h} alt={shot.alt} />
      <svg viewBox={`0 0 ${shot.w} ${shot.h}`} aria-hidden="true">
        {hot.length > 0 && (
          <>
            <defs>
              <mask id={uid}>
                <rect width={shot.w} height={shot.h} fill="white" />
                {hot.map((region) => (
                  <rect key={region.id} x={region.x} y={region.y} width={region.w} height={region.h} rx="8" fill="black" />
                ))}
              </mask>
            </defs>
            <rect width={shot.w} height={shot.h} className="book-dim" mask={`url(#${uid})`} />
            {hot.map((region) => (
              <rect key={region.id} className="book-ring" x={region.x} y={region.y} width={region.w} height={region.h} rx="8" />
            ))}
          </>
        )}
        {onPick &&
          shot.regions.map((region) => (
            <rect
              key={`hit-${region.id}`}
              className="book-hit"
              x={region.x}
              y={region.y}
              width={region.w}
              height={region.h}
              onClick={() => onPick(region.id)}
            />
          ))}
      </svg>
    </figure>
  )
}
