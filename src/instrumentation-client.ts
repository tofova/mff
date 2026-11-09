// --- PostHog: browser initialisation ---
// Next.js loads this file by itself on every page, before React hydrates
// (the `instrumentation-client` convention). Nothing imports it.
//
// What is switched on, all of it: pageviews on every route change, page-leave
// with scroll depth, autocapture of every click and form interaction, dead and
// rage clicks, heatmaps, web vitals and network timing, JavaScript exceptions,
// and session replay with console logs and (scrubbed) network payloads.
// Admin pages are recorded too for now; their events carry page_area=admin so
// they can be filtered out in reports.
//
// Switching everything off: set NEXT_PUBLIC_POSTHOG_DISABLED=true and redeploy,
// or turn individual features off in the PostHog project settings (no deploy).

import posthog from 'posthog-js';
import type { CaptureResult } from 'posthog-js';
import {
  POSTHOG_ENABLED,
  POSTHOG_HOST,
  POSTHOG_KEY,
  POSTHOG_UI_HOST,
  REPLAY_MASK_CLASS,
} from '@/lib/analytics/posthog-config';
import { initialSuperProperties, maskNetworkRequest, pageArea } from '@/lib/analytics/posthog-client';
import { AnalyticsEvents } from '@/lib/analytics/events';

// Replay and heatmap payloads are left untouched; everything else is labelled.
const UNLABELLED_EVENTS = new Set(['$snapshot', '$$heatmap']);

function addPageArea(event: CaptureResult | null): CaptureResult | null {
  if (!event || UNLABELLED_EVENTS.has(event.event)) return event;
  try {
    event.properties = { ...event.properties, page_area: pageArea(window.location.pathname) };
  } catch {
    /* send the event unlabelled */
  }
  return event;
}

function start(): void {
  if (typeof window === 'undefined' || !POSTHOG_ENABLED) return;
  if (posthog.__loaded) return; // hot reload in development

  posthog.init(POSTHOG_KEY, {
    api_host: POSTHOG_HOST,
    ui_host: POSTHOG_UI_HOST,

    // A person profile for every visitor, registered or not, so the whole
    // pre-registration journey is on the same profile once they identify.
    person_profiles: 'always',

    capture_pageview: 'history_change',
    capture_pageleave: true,
    autocapture: true,
    capture_dead_clicks: true,
    capture_heatmaps: true,
    capture_performance: { web_vitals: true, network_timing: true },
    capture_exceptions: true,

    enable_recording_console_log: true,
    session_recording: {
      maskAllInputs: true, // everything typed into a field is hidden in replays
      maskTextSelector: `.${REPLAY_MASK_CLASS}`, // Gaming IDs printed as text
      recordCrossOriginIframes: false,
      recordHeaders: true,
      recordBody: true,
      maskCapturedNetworkRequestFn: maskNetworkRequest,
    },

    session_idle_timeout_seconds: 30 * 60,
    persistence: 'localStorage+cookie',
    before_send: addPageArea,

    loaded: (client) => {
      try {
        client.register(initialSuperProperties());

        // The referral / ad-source code from the landing URL (?ref=...), kept for
        // this browser so later events and the person carry it.
        const ref = new URLSearchParams(window.location.search).get('ref');
        if (ref) {
          client.register_once({ referral_code: ref });
          client.setPersonProperties(undefined, { initial_referral_code: ref });
        }

        window.addEventListener('appinstalled', () => {
          client.capture(AnalyticsEvents.pwaInstalled);
        });
      } catch (error) {
        console.error('PostHog post-init setup failed:', error);
      }
    },
  });
}

try {
  start();
} catch (error) {
  console.error('PostHog failed to start:', error);
}
