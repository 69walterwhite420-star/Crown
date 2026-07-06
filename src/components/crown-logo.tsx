/**
 * Лого CROWN — золотой шестиугольник-контур с короной внутри. Прозрачный фон (просто SVG, без подложки).
 * Цвет наследуется из `currentColor` → тонируется классом/цветом текста родителя.
 */
export function CrownLogo({ size = 28, className }: { size?: number; className?: string }) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 120 120"
      fill="none"
      className={className}
      aria-hidden="true"
    >
      {/* Шестиугольник (острые верх/низ, вертикальные бока) */}
      <polygon
        points="60,7 106,33.5 106,86.5 60,113 14,86.5 14,33.5"
        fill="none"
        stroke="currentColor"
        strokeWidth="6.5"
        strokeLinejoin="round"
      />
      {/* Тело короны — 3 зубца */}
      <path d="M44 55 L53 66 L60 46 L67 66 L76 55 L72 73 Q60 78 48 73 Z" fill="currentColor" />
      {/* Свуш-основание */}
      <path d="M50 75 Q61 80 77 71" stroke="currentColor" strokeWidth="2.4" fill="none" strokeLinecap="round" />
      {/* Шарики на зубцах */}
      <circle cx="60" cy="40" r="4.6" fill="currentColor" />
      <circle cx="44" cy="49.5" r="3.8" fill="currentColor" />
      <circle cx="76" cy="49.5" r="3.8" fill="currentColor" />
    </svg>
  );
}
