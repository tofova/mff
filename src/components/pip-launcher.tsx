'use client';

/**
 * Pip, the 2D mascot from the "Pip Website Mascot" artifact, as the launcher of
 * the home page's chat assistant.
 *
 * `public/pip/pip-mascot.js` is this site's own copy of the artifact's 2D
 * script. The artifact itself is never changed, because it is reused on other
 * sites; the copy may be edited where this site needs it, and every such edit
 * is listed at the top of that file. Most of what is specific to this site is
 * applied from here, on the outside: colours, size, layering, what a click
 * does, and what Pip does and says while it waits.
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
  sleepAfter?: number;
};

type PipInstance = {
  /** The element Pip lives in. In corner mode the script appends it to <body>. */
  el: HTMLElement;
  /** Types a line into Pip's speech bubble and keeps it up long enough to read. */
  say: (text: string) => number;
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
// Settings: loading and look
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
  // The script's own idle tricks and chatter are off: both are scheduled here
  // instead (see "what Pip does while it waits"), so they share one rhythm and
  // the lines can depend on what the visitor is doing. No reactions to hovered
  // buttons and no naps.
  idleTricks: false,
  chatter: false,
  hints: false,
  sleepAfter: 0,
};

// ---------------------------------------------------------------------------
// Settings: what Pip does while it waits
// ---------------------------------------------------------------------------

/** Set once Pip has greeted, so it greets once per browser session, not on every visit to the page. */
const GREETED_KEY = 'pip_greeted';
/**
 * The greeting waits until Pip has been in clear view for this long. Anything
 * shorter lets it slip into the gap between the page's loading screen and the
 * welcome dialog, which opens for guests 1.5 s after the page mounts.
 */
const GREET_CLEAR_VIEW_MS = 2000;
const GREET_CHECK_MS = 400;

/** While Pip is in view it does one thing every 8 to 15 seconds: a trick or a spoken line. */
const ACT_EVERY_MS: [number, number] = [8000, 15000];

/** Pip plays one or two tricks between two spoken lines. */
const TRICKS_BETWEEN_LINES: [number, number] = [1, 2];

/** The tricks, weighted like the script's own idle mix. */
const TRICKS: [name: string, weight: number][] = [
  ['lookAround', 3],
  ['hop', 2],
  ['wink', 1.4],
  ['think', 1.2],
  ['love', 1],
  ['dance', 1],
  ['spin', 1],
  ['wave', 0.6],
];

/** Pip does not speak while the visitor is typing: this long after the last key press. */
const TYPING_PAUSE_MS = 5000;

// Everything Pip says is below. Keep each line short but clear: at most about
// 23 characters, so it stays on one line of the speech bubble even on a phone
// that is only 320 px wide.

/** Invitations to open the chat, used in turn. The greeting already says "Tap me to chat." */
const CHAT_LINES = [
  'Need help? Tap me!',
  'Got a question? Ask me.',
  'Tap me to chat.',
  'Stuck? I can help.',
  'Payment help? Ask me.',
  'Order help? Ask me.',
];

/** The same, for a visitor who has already opened the chat in this browser session. */
const CHAT_LINES_AFTER_USE = ['Anything else? Tap me.', 'More questions? Tap me.'];
const CHAT_USED_KEY = 'pip_chat_used';

/** Said shortly after the chat is closed, at most once in the repeat time. */
const AFTER_CHAT_LINE = "I'm here if you need me.";
const AFTER_CHAT_DELAY_MS = 700;
const AFTER_CHAT_REPEAT_MS = 120_000;

/** Where the visitor is on the page, read at the moment Pip is about to speak. */
type PageView = {
  /** The visitor is still at the top of the page. */
  nearTop: boolean;
  /** At least half a screen of page is left below. */
  moreBelow: boolean;
  /** The end of the page is on screen. */
  atEnd: boolean;
  /** Whether an element matching the selector is on screen right now. */
  shows: (selector: string) => boolean;
};

type Tip = {
  text: string;
  /** The line is only said while this holds. */
  when: (page: PageView) => boolean;
};

/** Tips about where the visitor is on the page. These are tried first. */
const PLACE_TIPS: Tip[] = [
  { text: 'Scroll for more items.', when: (page) => page.nearTop && page.moreBelow },
  { text: "That's all! Need help?", when: (page) => page.atEnd && !page.nearTop },
];

/** The "Watch Ad" and coin balance cards near the top of the home page. */
const COIN_CARDS = 'a[href="/watch-ad"]';

/**
 * Tips about things on the page, tried in a new random order on every visit.
 * Each is tied to its thing being on screen, so Pip never points at something
 * that is not there.
 */
const FEATURE_TIPS: Tip[] = [
  { text: 'Watch ads to earn coins.', when: (page) => page.shows(COIN_CARDS) },
  { text: 'Use coins to pay less.', when: (page) => page.shows(COIN_CARDS) },
  { text: 'Try the search box.', when: (page) => page.shows('input[placeholder="Search products..."]') },
  { text: 'Filter by category.', when: (page) => page.shows('button[role="combobox"]') },
  { text: 'Tap the cart for orders.', when: (page) => page.shows('a[href="/order"]') },
  { text: 'Problem? Try Support.', when: (page) => page.shows('a[href="/support"]') },
];

/** The same tip is not said again for this long. */
const TIP_REPEAT_AFTER_MS = 180_000;

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

/** Whether an element matching the selector is drawn and has its middle inside the window. */
function isOnScreen(selector: string): boolean {
  for (const element of document.querySelectorAll(selector)) {
    const box = element.getBoundingClientRect();
    const middle = (box.top + box.bottom) / 2;
    if (box.width > 0 && box.height > 0 && middle > 0 && middle < window.innerHeight) return true;
  }
  return false;
}

function readPage(): PageView {
  const screen = window.innerHeight;
  const below = document.documentElement.scrollHeight - (window.scrollY + screen);
  return {
    nearTop: window.scrollY < screen * 0.4,
    moreBelow: below > screen * 0.5,
    atEnd: below < screen * 0.25,
    shows: isOnScreen,
  };
}

/** Flags that last for the browser session. Without storage they are simply forgotten. */
function hasFlag(key: string): boolean {
  try {
    return window.sessionStorage.getItem(key) === '1';
  } catch {
    return false;
  }
}

function setFlag(key: string): void {
  try {
    window.sessionStorage.setItem(key, '1');
  } catch {
    // Storage is unavailable.
  }
}

function randomBetween([low, high]: [number, number]): number {
  return low + Math.random() * (high - low);
}

/** A whole number from low to high, both included. */
function randomWhole([low, high]: [number, number]): number {
  return low + Math.floor(Math.random() * (high - low + 1));
}

/** A copy of the list in random order. */
function shuffled<T>(items: T[]): T[] {
  const copy = items.slice();
  for (let i = copy.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [copy[i], copy[j]] = [copy[j], copy[i]];
  }
  return copy;
}

/** A trick by weight, never the same one twice in a row. */
function pickTrick(previous: string): string {
  const pool = TRICKS.filter(([name]) => name !== previous);
  let roll = Math.random() * pool.reduce((sum, [, weight]) => sum + weight, 0);
  for (const [name, weight] of pool) {
    roll -= weight;
    if (roll <= 0) return name;
  }
  return pool[0][0];
}

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

export type PipLauncherHandle = {
  /**
   * Called by the chat when it closes: moves keyboard focus back to Pip, and
   * Pip says that it is still around.
   */
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
  /** Set while Pip is on the page. */
  const chatClosedRef = useRef<(() => void) | null>(null);

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
      focus: () => {
        buttonRef.current?.focus({ preventScroll: true });
        chatClosedRef.current?.();
      },
    }),
    []
  );

  useEffect(() => {
    let pip: PipInstance | null = null;
    let stopped = false; // unmounted, or the caller was already told that Pip failed
    let loadTimer = 0;
    let greetTimer = 0;
    let actTimer = 0;
    let afterChatTimer = 0;

    // What has happened so far on this visit to the page.
    let greeted = hasFlag(GREETED_KEY);
    let chatUsed = hasFlag(CHAT_USED_KEY);
    let tricksSinceLine = 0;
    let tricksBeforeLine = randomWhole(TRICKS_BETWEEN_LINES);
    let lastTrick = '';
    let lastLineWasTip = false; // the greeting counts as an invitation to chat
    let chatLineIndex = 0;
    let lastKeyAt = -Infinity;
    let afterChatLineAt = -Infinity;
    const tips = [...PLACE_TIPS, ...shuffled(FEATURE_TIPS)];
    const tipSaidAt = new Map<Tip, number>();

    /** Under a dialog or in a background tab nobody is watching Pip. */
    const inView = () => pip !== null && !document.hidden && isUncovered(pip.el);

    const onKeyDown = () => {
      lastKeyAt = performance.now();
    };

    // ---- speaking

    const say = (text: string, wave: boolean) => {
      if (!pip) return;
      if (wave) pip.do('wave');
      pip.say(text);
      tricksSinceLine = 0;
      tricksBeforeLine = randomWhole(TRICKS_BETWEEN_LINES);
    };

    /** A tip that fits the page right now if there is one and the last line was not a tip, else an invitation to chat. */
    const nextLine = (): { text: string; wave: boolean } => {
      const now = performance.now();
      if (!lastLineWasTip) {
        const page = readPage();
        const tip = tips.find(
          (candidate) =>
            now - (tipSaidAt.get(candidate) ?? -Infinity) >= TIP_REPEAT_AFTER_MS && candidate.when(page)
        );
        if (tip) {
          tipSaidAt.set(tip, now);
          lastLineWasTip = true;
          return { text: tip.text, wave: false };
        }
      }
      lastLineWasTip = false;
      const lines = chatUsed ? CHAT_LINES_AFTER_USE : CHAT_LINES;
      return { text: lines[chatLineIndex++ % lines.length], wave: true };
    };

    // ---- the rhythm: one thing every 8 to 15 seconds

    const act = () => {
      if (stopped || !pip) return;
      if (inView()) {
        const typing = performance.now() - lastKeyAt < TYPING_PAUSE_MS;
        if (tricksSinceLine >= tricksBeforeLine && !typing) {
          const line = nextLine();
          say(line.text, line.wave);
        } else {
          lastTrick = pickTrick(lastTrick);
          pip.do(lastTrick);
          tricksSinceLine++;
        }
      }
      scheduleAct();
    };

    const scheduleAct = () => {
      window.clearTimeout(actTimer);
      actTimer = window.setTimeout(act, randomBetween(ACT_EVERY_MS));
    };

    // ---- the greeting

    // The page starts under a loading screen, and dialogs can follow it (the
    // welcome dialog for guests, event popups). A greeting played underneath
    // them would be missed, so it waits until nothing has covered Pip for a while.
    let inViewSince: number | null = null;
    const greetWhenInView = () => {
      if (stopped || !pip) return;
      const now = performance.now();
      if (!inView()) inViewSince = null;
      else if (inViewSince === null) inViewSince = now;

      if (inViewSince !== null && now - inViewSince >= GREET_CLEAR_VIEW_MS) {
        if (pip.do('hello')) setFlag(GREETED_KEY);
        greeted = true;
        scheduleAct();
        return;
      }
      greetTimer = window.setTimeout(greetWhenInView, GREET_CHECK_MS);
    };

    // ---- the chat opening and closing

    const handleClick = () => {
      if (!greeted) {
        // Whoever opens the chat no longer needs to be told what Pip is for.
        window.clearTimeout(greetTimer);
        setFlag(GREETED_KEY);
        greeted = true;
        scheduleAct();
      }
      chatUsed = true;
      setFlag(CHAT_USED_KEY);
      onOpenRef.current();
    };

    const handleChatClosed = () => {
      if (stopped || !pip) return;
      // A fresh 8 to 15 seconds, so no trick lands on top of the line below.
      scheduleAct();
      window.clearTimeout(afterChatTimer);
      if (performance.now() - afterChatLineAt < AFTER_CHAT_REPEAT_MS) return;
      afterChatTimer = window.setTimeout(() => {
        if (stopped || !inView()) return;
        afterChatLineAt = performance.now();
        lastLineWasTip = false;
        say(AFTER_CHAT_LINE, true);
      }, AFTER_CHAT_DELAY_MS);
    };

    // ---- mounting and removing

    const removePip = () => {
      window.clearTimeout(loadTimer);
      window.clearTimeout(greetTimer);
      window.clearTimeout(actTimer);
      window.clearTimeout(afterChatTimer);
      window.removeEventListener('keydown', onKeyDown);
      buttonRef.current = null;
      chatClosedRef.current = null;
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
        chatClosedRef.current = handleChatClosed;
        window.addEventListener('keydown', onKeyDown, { passive: true });

        if (greeted) scheduleAct();
        else greetTimer = window.setTimeout(greetWhenInView, GREET_CHECK_MS);
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
