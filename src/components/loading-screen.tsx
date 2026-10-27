'use client';

import Image from 'next/image';
import type { CSSProperties } from 'react';
import { isFfIndiaThemeActive } from '@/lib/ff-india-theme';
import {
  INDIA_ISLAND_DOTS,
  INDIA_ISLANDS_PATH,
  INDIA_MAINLAND_CENTRE,
  INDIA_MAINLAND_LENGTH,
  INDIA_MAINLAND_PATH,
  INDIA_OUTLINE_VIEWBOX,
} from '@/lib/india-outline-path';

const [, , VIEW_W, VIEW_H] = INDIA_OUTLINE_VIEWBOX.split(' ').map(Number);
const mapBox: CSSProperties = { width: 220, aspectRatio: `${VIEW_W} / ${VIEW_H}` };
const logoPosition: CSSProperties = {
  left: `${(INDIA_MAINLAND_CENTRE.x / VIEW_W) * 100}%`,
  top: `${(INDIA_MAINLAND_CENTRE.y / VIEW_H) * 100}%`,
};

export default function LoadingScreen() {
  if (!isFfIndiaThemeActive()) {
    return (
      <div className="fixed inset-0 z-[9999] flex items-center justify-center bg-background/50 backdrop-blur-sm">
        <div className="relative w-48 h-48 animation-pulse-vanish">
          <Image
            src="/img/load.png"
            alt="Loading Garena Gears"
            fill
            className="object-contain"
            priority
          />
        </div>
      </div>
    );
  }

  // Launch-theme splash: the border of India is drawn by a single line from the north,
  // down the western side to the southern tip and back up the eastern side; the islands
  // appear, the map fills with the tricolour and the F logo pops in at the centre of the
  // mainland. Timing lives in globals.css.
  return (
    <div
      className="fixed inset-0 z-[9999] flex items-center justify-center bg-[#FFF8EF]/90 backdrop-blur-sm"
      role="status"
      aria-label="Loading Garena Store"
    >
      <div className="relative" style={mapBox}>
        <svg viewBox={INDIA_OUTLINE_VIEWBOX} className="h-full w-full overflow-visible" aria-hidden="true" focusable="false">
          <defs>
            <linearGradient id="ffi-map-fill" x1="0" y1="0" x2="0" y2="1">
              <stop offset="0" stopColor="#FF9933" />
              <stop offset="0.5" stopColor="#FFFFFF" />
              <stop offset="1" stopColor="#138808" />
            </linearGradient>
          </defs>
          <path d={INDIA_MAINLAND_PATH} className="ffi-map-fill" fill="url(#ffi-map-fill)" />
          <g className="ffi-map-islands" fill="url(#ffi-map-fill)" stroke="#1F3A93" strokeWidth="0.9" strokeLinejoin="round">
            <path d={INDIA_ISLANDS_PATH} />
            {INDIA_ISLAND_DOTS.map(([x, y], i) => (
              <circle key={i} cx={x} cy={y} r="0.9" />
            ))}
          </g>
          <path
            d={INDIA_MAINLAND_PATH}
            className="ffi-map-outline"
            fill="none"
            stroke="#1F3A93"
            strokeWidth="1.5"
            strokeLinejoin="round"
            strokeLinecap="round"
            strokeDasharray={INDIA_MAINLAND_LENGTH}
            strokeDashoffset={INDIA_MAINLAND_LENGTH}
          />
        </svg>
        {/* The F logo in tricolour (CSS mask over the yellow logo); the plain logo where masks are unsupported. */}
        <div className="ffi-f-logo absolute h-16 w-16" style={logoPosition}>
          <div className="ffi-f-mask h-full w-full" />
          <Image src="/img/load.png" alt="" fill className="ffi-f-img object-contain" priority />
        </div>
      </div>
    </div>
  );
}
