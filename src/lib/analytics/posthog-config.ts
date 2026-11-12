// --- PostHog: public configuration ---
// The project token is PUBLIC by design: it ships inside the browser bundle to
// every visitor, exactly like the Meta Pixel ID and the Google Ads ID already
// hardcoded in this project. It can only be used to *send* data to the project,
// never to read it. (Reading needs a personal API key, which is not used here
// and must never be put in any variable below: it is secret and starts with phx_.)
//
// WHICH PostHog the site sends to is decided when the site is BUILT. These
// variables override the built-in values, so moving to another PostHog account,
// or to a self-hosted PostHog, needs no code change:
//   NEXT_PUBLIC_POSTHOG_KEY       project token, starts with phc_
//                                 (also accepted: NEXT_PUBLIC_POSTHOG_PROJECT_TOKEN)
//   NEXT_PUBLIC_POSTHOG_HOST      where events and replays are sent
//   NEXT_PUBLIC_POSTHOG_UI_HOST   where the PostHog web app lives (toolbar, links)
//   NEXT_PUBLIC_POSTHOG_DISABLED=true   switches all tracking off
// A variable that is missing or empty leaves the built-in value in place.
//
// Docker / Dokploy: give them as "Build-time Arguments" and redeploy; the
// Dockerfile passes them to the build. Runtime "Environment Settings" are too
// late, because Next.js copies NEXT_PUBLIC_* values into the browser code while
// it builds.
//
//   Another PostHog Cloud account in the same region: set NEXT_PUBLIC_POSTHOG_KEY only.
//   EU cloud:     KEY, HOST=https://eu.i.posthog.com and UI_HOST=https://eu.posthog.com
//   Self-hosted:  KEY, and both HOST and UI_HOST set to the server's own address.
//
// This file has ONLY constants, so client and server code can share it.

/** A build-time value without the spaces or quotes that are easy to paste along with it. */
function fromEnv(value: string | undefined): string {
  return (value ?? '').trim().replace(/^["']+|["']+$/g, '').trim();
}

/** The same for an address, without a trailing slash. */
function hostFromEnv(value: string | undefined): string {
  return fromEnv(value).replace(/\/+$/, '');
}

export const POSTHOG_KEY: string =
  fromEnv(process.env.NEXT_PUBLIC_POSTHOG_KEY) ||
  fromEnv(process.env.NEXT_PUBLIC_POSTHOG_PROJECT_TOKEN) ||
  'phc_mNzpc6NCDqfYwYGZeYSpghrkmKEa9U3aMWp7xUBDfsL3';

/** Ingestion endpoint. Later this becomes the managed reverse proxy subdomain. */
export const POSTHOG_HOST: string = hostFromEnv(process.env.NEXT_PUBLIC_POSTHOG_HOST) || 'https://us.i.posthog.com';

/** Where the PostHog web app lives (used for toolbar / deep links). */
export const POSTHOG_UI_HOST: string =
  hostFromEnv(process.env.NEXT_PUBLIC_POSTHOG_UI_HOST) || 'https://us.posthog.com';

export const POSTHOG_ENABLED: boolean =
  fromEnv(process.env.NEXT_PUBLIC_POSTHOG_DISABLED).toLowerCase() !== 'true' && POSTHOG_KEY.length > 0;

/** Elements with this class have their TEXT masked in session replays. */
export const REPLAY_MASK_CLASS = 'ph-mask';

/**
 * Input boxes carrying this attribute show their typed text in session replays.
 * Every other box stays hidden (stars). See maskTypedText in posthog-client.ts.
 */
export const REPLAY_SHOW_INPUT_ATTR = 'data-ph-show-input';
