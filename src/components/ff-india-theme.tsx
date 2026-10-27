import type { CSSProperties } from 'react';
import { cn } from '@/lib/utils';
import { INDIA_MAINLAND_LENGTH, INDIA_MAINLAND_PATH, INDIA_MAINLAND_VIEWBOX } from '@/lib/india-outline-path';

/**
 * Small shared pieces of the Free Fire India launch theme. Purely presentational:
 * the callers decide whether to render them (see src/lib/ff-india-theme.ts).
 */

/** Three slanted bars in saffron, white and green. Decorative only. */
export function TricolourMark({ className, onDark = false }: { className?: string; onDark?: boolean }) {
  return (
    <svg viewBox="0 0 18 12" className={cn('h-3 w-auto shrink-0', className)} aria-hidden="true" focusable="false">
      <path d="M3 0h4L4 12H0z" fill="#FF9933" />
      <path d="M8 0h4L9 12H5z" fill={onDark ? '#FFFFFF' : '#E6E6E6'} />
      <path d="M13 0h4L14 12H10z" fill="#138808" />
    </svg>
  );
}

/** Thin saffron-white-green line (top of the header, bottom of the footer, top of dialogs). */
export function FfIndiaRibbon({ className }: { className?: string }) {
  return <div aria-hidden="true" className={cn('ffi-tricolour h-1 w-full', className)} />;
}

/** Small white pill with the tricolour mark, e.g. "Launch celebration". */
export function FfIndiaChip({ label, className }: { label: string; className?: string }) {
  return (
    <span
      className={cn(
        'inline-flex items-center gap-1.5 rounded-full border border-border bg-card px-2.5 py-0.5 font-headline text-[10px] font-bold uppercase tracking-[0.08em] text-foreground',
        className
      )}
    >
      <TricolourMark className="h-2.5" />
      {label}
    </span>
  );
}

/**
 * Small map of India that keeps drawing itself: the border line runs from the north down the
 * western side and back up the eastern side, the tricolour fills in, it fades out, and the
 * loop starts again. Replaces the radar beside "India" on the home page while the theme is on.
 */
export function IndiaMapLoop({ className }: { className?: string }) {
  const dash: CSSProperties = { '--ffi-len': INDIA_MAINLAND_LENGTH } as CSSProperties;
  return (
    <svg viewBox={INDIA_MAINLAND_VIEWBOX} className={cn('h-6 w-auto shrink-0 overflow-visible', className)} aria-hidden="true" focusable="false">
      <defs>
        <linearGradient id="ffi-loop-fill" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0" stopColor="#FF9933" />
          <stop offset="0.5" stopColor="#FFFFFF" />
          <stop offset="1" stopColor="#138808" />
        </linearGradient>
      </defs>
      <path d={INDIA_MAINLAND_PATH} className="ffi-loop-fill" fill="url(#ffi-loop-fill)" />
      <path
        d={INDIA_MAINLAND_PATH}
        className="ffi-loop-outline"
        fill="none"
        stroke="#F2542D"
        strokeWidth="1.4"
        vectorEffect="non-scaling-stroke"
        strokeLinejoin="round"
        strokeLinecap="round"
        strokeDasharray={INDIA_MAINLAND_LENGTH}
        strokeDashoffset={INDIA_MAINLAND_LENGTH}
        style={dash}
      />
    </svg>
  );
}
