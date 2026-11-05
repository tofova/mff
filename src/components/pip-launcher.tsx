'use client';

/**
 * Pip, the 2D mascot from the "Pip Website Mascot" artifact, as the launcher of
 * the home page's chat assistant.
 *
 * `public/pip/pip-mascot.js` is an unedited copy of the artifact's 2D script.
 * Everything specific to this site is applied from here, on the outside:
 * colours, size, greeting, layering and what a click does. A newer copy of the
 * script can therefore replace that file without merging anything.
 *
 * Pip is drawn by that script, not by React, so this component renders nothing.
 * When Pip cannot be shown (the script fails to load, takes too long, or throws)
 * `onFail` is called once and the caller shows its own backup button.
 */

import { forwardRef, useEffect, useImperativeHandle, useRef } from 'react';

// ---------------------------------------------------------------------------
// The parts of the script's API that are used here.
// ---------------------------------------------------------------------------

type PipTheme = {
  body: string;
  hi: string;
  shade: string;
  belly: string;
  limb: string;
  foot: string;
  leaf: string;
  leafDark: string;
  cheek: string;
};

type PipOptions = {
  theme?: string | Partial<PipTheme>;
  mode?: 'corner' | 'inline';
  side?: 'right' | 'left';
  size?: number | string;
  greet?: boolean;
  greeting?: string[];
  hints?: boolean;
  idleTricks?: boolean;
  chatter?: boolean;
  trickEvery?: [number, number];
  sleepAfter?: number;
};

type PipInstance = {
  /** The element Pip lives in. In corner mode the script appends it to <body>. */
  el: HTMLElement;
  /** Plays a trick by name. Returns false when it could not start. */
  do: (name: string, options?: Record<string, unknown>) => boolean;
  /** Removes Pip together with every listener and timer it created. */
  destroy: () => void;
};

type PipLibrary = {
  mount: (options?: PipOptions) => PipInstance;
};

declare global {
  interface Window {
    PipMascot?: PipLibrary;
  }
}

// ---------------------------------------------------------------------------
// Settings
// ---------------------------------------------------------------------------

const SCRIPT_SRC = '/pip/pip-mascot.js';

/** How long Pip may take to appear before the backup button is used instead. */
const LOAD_TIMEOUT_MS = 8000;

/**
 * The script gives Pip the highest z-index there is. 20 is the layer of the
 * round button Pip replaced, so the chat panel, dialogs, the loading screen and
 * toasts cover Pip exactly as they covered that button.
 */
const LAYER = '20';

/** Accessible name of the launcher. Unchanged from the button Pip replaced. */
const LABEL = 'Open FAQ Chatbot';

/** The speech bubble uses the site's headline font. */
const BUBBLE_FONT = "'Poppins', sans-serif";

/** Pip in the site's orange (--primary), keeping the green sprout of the artifact's themes. */
const SITE_THEME: PipTheme = {
  body: '#FF8052',
  hi: '#FFC9B3',
  shade: '#F35A2B',
  belly: '#FFF1EB',
  limb: '#FA7042',
  foot: '#D34317',
  leaf: '#62D6A0',
  leafDark: '#2E9F6C',
  cheek: '#FF6E98',
};

const PIP_OPTIONS: PipOptions = {
  mode: 'corner',
  side: 'right',
  // The frame, not the visible size. At 86 the character itself is about
  // 63 x 67 px: just narrower than the 64 px round button Pip replaced, and
  // 3 px taller. From 88 up Pip would be wider than that button.
  size: 86,
  theme: SITE_THEME,
  // The greeting is started further down, once Pip is really visible.
  greet: false,
  greeting: ['Hi! Need help?', 'Tap me to chat.'],
  // A quiet Pip: no reactions to hovered buttons, no random chatter, no naps,
  // and idle tricks less often than the script's default of every 7 to 13 s.
  hints: false,
  chatter: false,
  sleepAfter: 0,
  trickEvery: [15000, 30000],
};

/** Set once Pip has greeted, so it greets once per browser session, not on every visit to the page. */
const GREETED_KEY = 'pip_greeted';
/**
 * The greeting waits until Pip has been in clear view for this long. Anything
 * shorter lets it slip into the gap between the page's loading screen and the
 * welcome dialog, which opens for guests 1.5 s after the page mounts.
 */
const GREET_CLEAR_VIEW_MS = 2000;
const GREET_CHECK_MS = 400;

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

let libraryPromise: Promise<PipLibrary> | null = null;

/** Loads the script once per page load and resolves with the library it defines. */
function loadPipLibrary(): Promise<PipLibrary> {
  if (window.PipMascot) return Promise.resolve(window.PipMascot);
  if (!libraryPromise) {
    libraryPromise = new Promise<PipLibrary>((resolve, reject) => {
      const script = document.createElement('script');
      script.src = SCRIPT_SRC;
      script.async = true;
      script.onload = () => {
        if (window.PipMascot) resolve(window.PipMascot);
        else reject(new Error(`${SCRIPT_SRC} loaded but did not define PipMascot`));
      };
      script.onerror = () => {
        script.remove();
        reject(new Error(`${SCRIPT_SRC} could not be loaded`));
      };
      document.head.appendChild(script);
    });
    // A failed load is not remembered: the next time the page is opened it is tried again.
    libraryPromise.catch(() => {
      libraryPromise = null;
    });
  }
  return libraryPromise;
}

/** Whether Pip is the topmost thing at its own position, i.e. no overlay covers it. */
function isUncovered(host: HTMLElement): boolean {
  const box = host.getBoundingClientRect();
  if (box.width === 0 || box.height === 0) return false;
  // 60% down the box is the middle of Pip's body, which is always painted.
  const topmost = document.elementFromPoint(box.left + box.width / 2, box.top + box.height * 0.6);
  return topmost !== null && host.contains(topmost);
}

function hasGreeted(): boolean {
  try {
    return window.sessionStorage.getItem(GREETED_KEY) === '1';
  } catch {
    return false;
  }
}

function rememberGreeted(): void {
  try {
    window.sessionStorage.setItem(GREETED_KEY, '1');
  } catch {
    // Storage is unavailable: Pip simply greets again next time.
  }
}

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

export type PipLauncherHandle = {
  /** Moves keyboard focus to Pip. Used to return focus when the chat closes. */
  focus: () => void;
};

type PipLauncherProps = {
  /** Called when the visitor clicks, taps or keyboard-activates Pip. */
  onOpen: () => void;
  /** Called once if Pip cannot be shown. The caller shows its backup button. */
  onFail: () => void;
};

const PipLauncher = forwardRef<PipLauncherHandle, PipLauncherProps>(function PipLauncher(
  { onOpen, onFail },
  ref
) {
  const buttonRef = useRef<HTMLElement | null>(null);

  // The latest callbacks, so the effect below runs only once per mount.
  const onOpenRef = useRef(onOpen);
  const onFailRef = useRef(onFail);
  useEffect(() => {
    onOpenRef.current = onOpen;
    onFailRef.current = onFail;
  });

  useImperativeHandle(
    ref,
    () => ({
      focus: () => buttonRef.current?.focus({ preventScroll: true }),
    }),
    []
  );

  useEffect(() => {
    let pip: PipInstance | null = null;
    let stopped = false; // unmounted, or the caller was already told that Pip failed
    let loadTimer = 0;
    let greetTimer = 0;

    const handleClick = () => {
      // Whoever opens the chat no longer needs to be told what Pip is for.
      window.clearTimeout(greetTimer);
      rememberGreeted();
      onOpenRef.current();
    };

    const removePip = () => {
      window.clearTimeout(loadTimer);
      window.clearTimeout(greetTimer);
      buttonRef.current = null;
      if (!pip) return;
      pip.el.removeEventListener('click', handleClick);
      try {
        pip.destroy();
      } catch {
        // Already gone.
      }
      pip = null;
    };

    const fail = (reason: unknown) => {
      if (stopped) return;
      stopped = true;
      removePip();
      console.warn('[PipLauncher] Pip is unavailable; showing the backup chat button.', reason);
      onFailRef.current();
    };

    // The page starts under a loading screen, and dialogs can follow it (the
    // welcome dialog for guests, event popups). A greeting played underneath
    // them would be missed, so it waits until nothing has covered Pip for a while.
    let inViewSince: number | null = null;
    const greetWhenInView = () => {
      if (stopped || !pip) return;
      const now = performance.now();
      if (document.hidden || !isUncovered(pip.el)) inViewSince = null;
      else if (inViewSince === null) inViewSince = now;

      if (inViewSince !== null && now - inViewSince >= GREET_CLEAR_VIEW_MS) {
        if (pip.do('hello')) rememberGreeted();
        return;
      }
      greetTimer = window.setTimeout(greetWhenInView, GREET_CHECK_MS);
    };

    loadTimer = window.setTimeout(
      () => fail(new Error(`Pip was not ready after ${LOAD_TIMEOUT_MS} ms`)),
      LOAD_TIMEOUT_MS
    );

    loadPipLibrary()
      .then((library) => {
        if (stopped) return;
        window.clearTimeout(loadTimer);

        pip = library.mount(PIP_OPTIONS);
        const host = pip.el;
        host.style.zIndex = LAYER;
        host.style.setProperty('--pip-font', BUBBLE_FONT);
        // Clicks, taps and Enter/Space on Pip's own button all bubble up to the host.
        host.addEventListener('click', handleClick);

        const button = host.querySelector<HTMLElement>('button');
        if (button) {
          button.setAttribute('aria-label', LABEL);
          button.setAttribute('aria-haspopup', 'dialog');
        }
        buttonRef.current = button;

        if (!hasGreeted()) greetTimer = window.setTimeout(greetWhenInView, GREET_CHECK_MS);
      })
      .catch(fail);

    return () => {
      stopped = true;
      removePip();
    };
  }, []);

  return null;
});

export default PipLauncher;
