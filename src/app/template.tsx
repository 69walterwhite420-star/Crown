/**
 * Smooth page fade-in on EVERY navigation. `template.tsx` (unlike layout) remounts on each
 * transition → the animation plays again. Only `opacity` (no transform) — otherwise the wrapper would become
 * a containing block and break the header's `position: sticky` and `fixed` elements. Nothing is blocked: a pure
 * CSS fade, content is interactive immediately. Respects reduced-motion (global rule in globals.css).
 */
export default function Template({ children }: { children: React.ReactNode }) {
  return <div className="animate-page-in">{children}</div>;
}
