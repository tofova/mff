// --- PostHog: public configuration ---
// The project token is PUBLIC by design: it ships inside the browser bundle to
// every visitor, exactly like the Meta Pixel ID and the Google Ads ID already
// hardcoded in this project. It can only be used to *send* data to the project,
// never to read it. (Reading needs a personal API key, which is not used here.)
//
// Environment variables override the hardcoded values when present, so a
// separate test project can be used during development without a code change:
//   NEXT_PUBLIC_POSTHOG_KEY   (also accepted: NEXT_PUBLIC_POSTHOG_PROJECT_TOKEN)
//   NEXT_PUBLIC_POSTHOG_HOST
//   NEXT_PUBLIC_POSTHOG_DISABLED=true   switches all tracking off
//
// This file has ONLY constants, so client and server code can share it.

export const POSTHOG_KEY: string =
  process.env.NEXT_PUBLIC_POSTHOG_KEY ||
  process.env.NEXT_PUBLIC_POSTHOG_PROJECT_TOKEN ||
  'phc_mNzpc6NCDqfYwYGZeYSpghrkmKEa9U3aMWp7xUBDfsL3';

/** Ingestion endpoint. Later this becomes the managed reverse proxy subdomain. */
export const POSTHOG_HOST: string = process.env.NEXT_PUBLIC_POSTHOG_HOST || 'https://us.i.posthog.com';

/** Where the PostHog web app lives (used for toolbar / deep links). */
export const POSTHOG_UI_HOST = 'https://us.posthog.com';

export const POSTHOG_ENABLED: boolean =
  process.env.NEXT_PUBLIC_POSTHOG_DISABLED !== 'true' && POSTHOG_KEY.length > 0;

/** Elements with this class have their TEXT masked in session replays. */
export const REPLAY_MASK_CLASS = 'ph-mask';

/**
 * Input boxes carrying this attribute show their typed text in session replays.
 * Every other box stays hidden (stars). See maskTypedText in posthog-client.ts.
 */
export const REPLAY_SHOW_INPUT_ATTR = 'data-ph-show-input';
