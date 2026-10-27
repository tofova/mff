'use client';

import { useEffect, useState, type CSSProperties } from 'react';

type Piece = {
  id: number;
  left: number;
  delay: number;
  duration: number;
  drift: number;
  colour: string;
  width: number;
  height: number;
};

const COLOURS = ['#FF9933', '#FFFFFF', '#138808', '#F2B84B'];
const SESSION_KEY = 'ffi_confetti_seen';

/**
 * A short tricolour confetti shower for the Free Fire India launch theme, once per
 * browser session. Client-only (the pieces are random, so nothing is rendered on the
 * server), never blocks taps, and skipped for people who prefer reduced motion.
 * Mounted by the root layout once the loading screen is gone.
 */
export default function FfIndiaConfetti() {
  const [pieces, setPieces] = useState<Piece[] | null>(null);

  useEffect(() => {
    let seen = false;
    try {
      seen = sessionStorage.getItem(SESSION_KEY) === '1';
      if (!seen) sessionStorage.setItem(SESSION_KEY, '1');
    } catch {
      /* storage unavailable (private mode): just show it this once */
    }
    if (seen) return;
    if (typeof window.matchMedia === 'function' && window.matchMedia('(prefers-reduced-motion: reduce)').matches) return;

    const start = window.setTimeout(() => {
      setPieces(
        Array.from({ length: 48 }, (_, i) => ({
          id: i,
          left: Math.random() * 100,
          delay: Math.random() * 1.4,
          duration: 3 + Math.random() * 2,
          drift: (Math.random() - 0.5) * 180,
          colour: COLOURS[i % COLOURS.length],
          width: 6 + Math.random() * 5,
          height: 10 + Math.random() * 8,
        }))
      );
    }, 400);
    const stop = window.setTimeout(() => setPieces(null), 400 + 6500);
    return () => {
      window.clearTimeout(start);
      window.clearTimeout(stop);
    };
  }, []);

  if (!pieces) return null;

  return (
    <div aria-hidden="true" className="pointer-events-none fixed inset-0 z-[60] overflow-hidden">
      {pieces.map((p) => (
        <span
          key={p.id}
          className="ffi-confetti-piece"
          style={
            {
              left: `${p.left}%`,
              width: p.width,
              height: p.height,
              backgroundColor: p.colour,
              '--ffi-delay': `${p.delay}s`,
              '--ffi-duration': `${p.duration}s`,
              '--ffi-drift': `${p.drift}px`,
            } as CSSProperties
          }
        />
      ))}
    </div>
  );
}
