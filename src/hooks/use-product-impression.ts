'use client';

// --- PostHog: product impressions and attention time ---
// Attach the returned ref to a product card. The hook reports:
//   product_impression  once per card per page, when the card has been at least
//                       half visible for 0.5 s (a fast scroll past it does not count);
//   product_attention   when the card leaves the screen (scrolled away, tab hidden,
//                       page closed, card removed) after staying at least half
//                       visible for 2 s or longer in one go, with visible_ms.
//                       A scroll past the card, even a slow one, is an impression
//                       but not attention: the buyer has to stop on it.
// Summing visible_ms per product gives "which product do people look at longest".
// The hook does nothing in browsers without IntersectionObserver and never throws.

import { useEffect, useRef } from 'react';
import { productProperties, track, type ProductLike } from '@/lib/analytics/posthog-client';
import { AnalyticsEvents } from '@/lib/analytics/events';

const VISIBLE_RATIO = 0.5;
const IMPRESSION_AFTER_MS = 500;
// A buyer has to keep the card on screen this long before it counts as attention.
// Shorter looks send no product_attention event at all (product_impression still counts them).
const MIN_ATTENTION_MS = 2000;

export function useProductImpression<T extends HTMLElement>(product: ProductLike, position?: number) {
  const ref = useRef<T | null>(null);
  // Latest product data (stock, price) for the events, without re-arming the observer.
  const latest = useRef({ product, position });
  latest.current = { product, position };
  const productId = String(product._id);

  useEffect(() => {
    const element = ref.current;
    if (!element || typeof window === 'undefined' || typeof IntersectionObserver === 'undefined') return;

    let intersecting = false;
    let visibleSince: number | null = null;
    let impressionSent = false;
    let impressionTimer: number | undefined;

    const props = (extra?: Record<string, unknown>) =>
      productProperties(latest.current.product, { position: latest.current.position ?? null, ...extra });

    const becameVisible = () => {
      if (visibleSince !== null) return;
      visibleSince = Date.now();
      if (!impressionSent && impressionTimer === undefined) {
        impressionTimer = window.setTimeout(() => {
          impressionTimer = undefined;
          impressionSent = true;
          track(AnalyticsEvents.productImpression, props());
        }, IMPRESSION_AFTER_MS);
      }
    };

    const becameHidden = (reason: string) => {
      if (impressionTimer !== undefined) {
        window.clearTimeout(impressionTimer);
        impressionTimer = undefined;
      }
      if (visibleSince === null) return;
      const visibleMs = Date.now() - visibleSince;
      visibleSince = null;
      if (visibleMs >= MIN_ATTENTION_MS) {
        track(AnalyticsEvents.productAttention, props({ visible_ms: visibleMs, end_reason: reason }));
      }
    };

    const observer = new IntersectionObserver(
      (entries) => {
        const entry = entries[entries.length - 1];
        intersecting = entry.isIntersecting && entry.intersectionRatio >= VISIBLE_RATIO;
        if (intersecting && document.visibilityState === 'visible') becameVisible();
        else becameHidden('scrolled_away');
      },
      { threshold: [0, VISIBLE_RATIO] }
    );
    observer.observe(element);

    const onVisibilityChange = () => {
      if (document.visibilityState === 'hidden') becameHidden('page_hidden');
      else if (intersecting) becameVisible();
    };
    const onPageHide = () => becameHidden('page_hide');
    document.addEventListener('visibilitychange', onVisibilityChange);
    window.addEventListener('pagehide', onPageHide);

    return () => {
      observer.disconnect();
      document.removeEventListener('visibilitychange', onVisibilityChange);
      window.removeEventListener('pagehide', onPageHide);
      becameHidden('unmounted');
    };
    // Re-arm only when the card shows a different product.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [productId]);

  return ref;
}
