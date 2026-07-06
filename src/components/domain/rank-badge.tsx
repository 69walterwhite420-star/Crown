import { rankOf, type CrownRank } from "@/lib/crown";
import { cn } from "@/lib/utils";

/**
 * CROWN rank cross-badge: a round seal with a monogram and the rank's heraldic metal.
 * The metal comes through the CSS variable `--rk`, so the rim/monogram color = the rank's metal.
 */
export function RankBadge({
  points,
  rank,
  size = 40,
  className,
}: {
  points?: number;
  rank?: CrownRank;
  size?: number;
  className?: string;
}) {
  const r = rank ?? rankOf(points ?? 0);
  return (
    <span
      className={cn("grid flex-none place-items-center rounded-full border font-display", className)}
      style={{
        width: size,
        height: size,
        color: r.metal,
        borderColor: r.metal,
        fontSize: size * 0.42,
        background: `radial-gradient(circle at 50% 32%, color-mix(in srgb, ${r.metal} 22%, transparent), transparent 70%)`,
      }}
      title={r.name}
      aria-label={r.name}
    >
      {r.sigil}
    </span>
  );
}
