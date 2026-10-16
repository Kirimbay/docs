import type { Praise } from './voice'

export function Misha({
  speaking,
  praise = null,
  mood = 'calm',
}: {
  speaking: boolean
  praise?: Praise | null
  mood?: 'calm' | 'cheer'
}) {
  const pose = ['misha', speaking ? 'is-speaking' : '', praise ? `is-praise is-${praise}` : '', mood === 'cheer' ? 'is-cheer' : '']
    .filter(Boolean)
    .join(' ')
  return (
    <svg className={pose} viewBox="0 0 220 260" overflow="visible" role="img" aria-label="Кукузя">
      <ellipse cx="110" cy="244" rx="58" ry="7" fill="rgba(70,50,20,.13)" />
      <g className="body">
        <path d="M78 214c2 16 14 24 32 24s30-8 32-24v-8H78z" fill="#3d4d73" />
        <path d="M92 214h16v22H92z" fill="#2c261f" opacity=".15" />
        <path d="M62 146c0-16 16-26 48-26s48 10 48 26v62c0 10-18 16-48 16s-48-6-48-16z" fill="#f0b429" />
        <path d="M86 128h48l-8 28H94z" fill="#fff7e4" />
        <path d="M104 128h12l-2 22h-8z" fill="#e85d4c" />
        <g className="arm arm-left">
          <path d="M62 152c-22 6-34 28-30 46 10-2 18-16 22-30 2-8 6-14 8-16z" fill="#f0b429" />
          <circle cx="36" cy="196" r="11" fill="#f6c9a4" />
        </g>
        <g className="arm arm-right">
          <path d="M158 152c22 6 34 28 30 46-10-2-18-16-22-30-2-8-6-14-8-16z" fill="#f0b429" />
          <circle cx="186" cy="188" r="11" fill="#f6c9a4" />
          <g className="thumb">
            <rect x="178" y="168" width="16" height="22" rx="6" fill="#f6c9a4" />
            <rect x="190" y="156" width="8" height="16" rx="4" fill="#f6c9a4" />
          </g>
        </g>
        <g className="head">
          <rect x="98" y="112" width="24" height="22" rx="10" fill="#f6c9a4" />
          <circle cx="110" cy="84" r="46" fill="#f6c9a4" />
          <path
            d="M66 84c2-30 18-50 44-50 28 0 46 20 46 48-12-6-22-4-30 2 4-18-6-30-18-30-14 0-24 14-22 32-8-8-16-10-20-2z"
            fill="#5c3b2e"
          />
          <path d="M70 78c10-6 18-8 24-4" fill="none" stroke="#5c3b2e" strokeWidth="6" strokeLinecap="round" />
          <g className="eyes">
            <circle cx="94" cy="88" r="5" fill="#2c261f" />
            <circle cx="128" cy="88" r="5" fill="#2c261f" />
            <circle cx="96" cy="86" r="1.7" fill="#fff" />
            <circle cx="130" cy="86" r="1.7" fill="#fff" />
          </g>
          <path className="smile" d="M100 102c3 5 14 6 18 1" fill="none" stroke="#d08968" strokeWidth="2.4" strokeLinecap="round" />
          <path className="mouth" d="M96 112c6 8 22 8 28 0" fill="none" stroke="#c46a4a" strokeWidth="3" strokeLinecap="round" />
          <ellipse className="mouth-open" cx="110" cy="114" rx="8" ry="5" fill="#c46a4a" />
          <ellipse className="kiss-mouth" cx="110" cy="114" rx="5" ry="5" fill="#e07a6a" />
          <ellipse cx="80" cy="104" rx="8" ry="4.5" fill="#f3b1a0" opacity=".9" />
          <ellipse cx="142" cy="104" rx="8" ry="4.5" fill="#f3b1a0" opacity=".9" />
        </g>
      </g>
      <g className="fx" aria-hidden="true">
        <g className="fx-thumb">
          <rect x="146" y="28" width="68" height="28" rx="14" fill="#fff" stroke="#f0b429" strokeWidth="3" />
          <text x="180" y="47" textAnchor="middle" fontFamily="Nunito, sans-serif" fontSize="16" fontWeight="800" fill="#8a4b16">
            Класс!
          </text>
        </g>
        <path className="heart h1" d={heart(168, 118)} fill="#e85d4c" />
        <path className="heart h2" d={heart(48, 150)} fill="#ff8fab" />
        <path className="heart h3" d={heart(150, 96)} fill="#e85d4c" />
        <path className="kiss-heart" d={heart(132, 100)} fill="#e85d4c" />
      </g>
    </svg>
  )
}

function heart(x: number, y: number): string {
  return `M${x} ${y}c0-6 8-10 8-4 0-6 8-2 8 4 0 8-8 12-8 12s-8-4-8-12z`
}
