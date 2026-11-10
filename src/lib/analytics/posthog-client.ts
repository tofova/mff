// --- PostHog: browser helpers ---
// Components talk to PostHog ONLY through this file. Every function is a silent
// no-op when PostHog is disabled, not loaded yet (blocked script, offline,
// server side) or throws, so nothing else in the app can ever be affected by
// analytics. Same pattern as src/lib/google-ads.ts.
//
// Initialisation lives in src/instrumentation-client.ts (loaded by Next.js on
// every page). Event names live in ./events.ts.

import posthog from 'posthog-js';
import type { CapturedNetworkRequest } from 'posthog-js';
import type { Product, User } from '@/lib/definitions';
import { POSTHOG_ENABLED, REPLAY_SHOW_INPUT_ATTR } from './posthog-config';
import type { AnalyticsEventName } from './events';

export type Properties = Record<string, unknown>;

/** A product whose `_id` may be an ObjectId or an already-serialised string. */
export type ProductLike = Omit<Product, '_id'> & { _id: unknown };

/** True only in the browser, with tracking enabled and the SDK initialised. */
export function isAnalyticsReady(): boolean {
  try {
    return typeof window !== 'undefined' && POSTHOG_ENABLED && posthog.__loaded === true;
  } catch {
    return false;
  }
}

interface TrackOptions {
  /** Send right away with a beacon: for events fired just before the page navigates away. */
  instant?: boolean;
}

/** Records a custom event. Never throws, never awaits. */
export function track(event: AnalyticsEventName | string, properties?: Properties, options?: TrackOptions): void {
  if (!isAnalyticsReady()) return;
  try {
    posthog.capture(event, properties, options?.instant ? { send_instantly: true, transport: 'sendBeacon' } : undefined);
  } catch (error) {
    console.error('PostHog event failed:', error);
  }
}

function toIso(value: unknown): string | null {
  try {
    if (!value) return null;
    const date = value instanceof Date ? value : new Date(value as string);
    return Number.isNaN(date.getTime()) ? null : date.toISOString();
  } catch {
    return null;
  }
}

/**
 * Ties this browser (and everything it did before registering) to the Gaming ID.
 * Calling it again with the same Gaming ID only refreshes the person properties.
 * Only facts are sent: never the gift-password hash, IPs or fingerprints.
 */
export function identifyUser(user: User): void {
  if (!isAnalyticsReady() || !user?.gamingId) return;
  try {
    posthog.identify(
      user.gamingId,
      {
        gaming_id: user.gamingId,
        visual_gaming_id: user.visualGamingId ?? null,
        coins: user.coins,
        is_banned: !!user.isBanned,
        is_hidden: !!user.isHidden,
        is_redeem_disabled: !!user.isRedeemDisabled,
        has_gift_password: !!user.giftPassword,
        has_push_token: !!user.fcmToken,
        referred_by_code: user.referredByCode ?? null,
        account_created_at: toIso(user.createdAt),
      },
      { first_identified_at: new Date().toISOString() }
    );
  } catch (error) {
    console.error('PostHog identify failed:', error);
  }
}

/** Detaches the browser from the current person (logout). The next visitor starts anonymous. */
export function resetAnalytics(): void {
  if (!isAnalyticsReady()) return;
  try {
    posthog.reset();
  } catch (error) {
    console.error('PostHog reset failed:', error);
  }
}

/** The same product facts on every product event, so reports can group by any of them. */
export function productProperties(product: ProductLike, extra?: Properties): Properties {
  const categories = Array.isArray(product.category) ? product.category : [];
  return {
    product_id: String(product._id),
    product_name: product.name,
    price: product.price,
    purchase_price: product.purchasePrice ?? null,
    quantity: product.quantity,
    is_coin_product: !!product.isCoinProduct,
    coins_applicable: product.coinsApplicable ?? 0,
    categories,
    category: categories[0] ?? 'uncategorized',
    tag: product.tag ?? null,
    is_available: !!product.isAvailable,
    is_coming_soon: !!product.isComingSoon,
    has_end_date: !!product.endDate,
    one_time_buy: !!product.oneTimeBuy,
    only_upi: !!product.onlyUpi,
    display_order: product.displayOrder ?? null,
    visibility: product.visibility ?? 'all',
    ...extra,
  };
}

// Anything that must never end up in a replay's network panel:
// passwords, gift passwords, redeem codes, UTR numbers, tokens, admin backup codes.
const SENSITIVE_PAYLOAD = /password|giftpassword|redeemcode|redeem_code|\butr\b|secret|token|backup[\s_-]?codes?/i;
const SENSITIVE_HEADER = /cookie|authorization|x-api-key/i;
// Pages whose traffic is nothing but secrets (admin sign-in codes, backup codes,
// password changes): their request and response bodies are never kept.
const ALWAYS_MASKED_PATHS = ['/admin/login', '/admin/security'];
const MASKED_BODY = '[masked by site]';

function isAlwaysMaskedUrl(name: unknown): boolean {
  try {
    const path = new URL(String(name ?? ''), window.location.origin).pathname;
    return ALWAYS_MASKED_PATHS.some((prefix) => path === prefix || path.startsWith(`${prefix}/`));
  } catch {
    return false;
  }
}

/**
 * What a replay shows for text typed into a box. Everything is hidden (one star
 * per character) unless the box carries the REPLAY_SHOW_INPUT_ATTR attribute.
 * Password boxes stay hidden even if they were marked by mistake.
 */
export function maskTypedText(text: string, element?: HTMLElement): string {
  const value = typeof text === 'string' ? text : '';
  try {
    if (
      element &&
      typeof element.hasAttribute === 'function' &&
      element.hasAttribute(REPLAY_SHOW_INPUT_ATTR) &&
      (element.getAttribute('type') || '').toLowerCase() !== 'password' &&
      !element.hasAttribute('data-rr-is-password')
    ) {
      return value;
    }
  } catch {
    /* fall through: hide */
  }
  return '*'.repeat(value.length);
}

/** Scrubs sensitive data from network requests before they are stored with a replay. */
export function maskNetworkRequest(data: CapturedNetworkRequest): CapturedNetworkRequest | null {
  try {
    const alwaysMasked = isAlwaysMaskedUrl(data.name);
    if (typeof data.requestBody === 'string' && (alwaysMasked || SENSITIVE_PAYLOAD.test(data.requestBody))) {
      data.requestBody = MASKED_BODY;
    }
    if (typeof data.responseBody === 'string' && (alwaysMasked || SENSITIVE_PAYLOAD.test(data.responseBody))) {
      data.responseBody = MASKED_BODY;
    }
    for (const headers of [data.requestHeaders, data.responseHeaders]) {
      if (!headers || typeof headers !== 'object') continue;
      const record = headers as unknown as Record<string, unknown>;
      for (const key of Object.keys(record)) {
        if (SENSITIVE_HEADER.test(key)) record[key] = '[masked]';
      }
    }
  } catch {
    /* keep the request as it is */
  }
  return data;
}

export type AppMode = 'standalone' | 'webview' | 'in_app_browser' | 'browser';

/** How the visitor opened the site: installed app / PWA, Android WebView (APK), Facebook or Instagram browser, or a normal browser. */
export function detectAppMode(): AppMode {
  try {
    const ua = navigator.userAgent || '';
    if (/FBAN|FBAV|Instagram/i.test(ua)) return 'in_app_browser';
    if (
      window.matchMedia?.('(display-mode: standalone)')?.matches ||
      (navigator as Navigator & { standalone?: boolean }).standalone === true
    ) {
      return 'standalone';
    }
    if (/; wv\)/.test(ua) || /\bwv\b/.test(ua)) return 'webview';
  } catch {
    /* fall through */
  }
  return 'browser';
}

/** 'admin' for the admin panel, 'site' for everything visitors see. */
export function pageArea(pathname: string): 'admin' | 'site' {
  return pathname === '/admin' || pathname.startsWith('/admin/') ? 'admin' : 'site';
}

/** Properties attached to every event from this browser. */
export function initialSuperProperties(): Properties {
  return {
    environment: process.env.NODE_ENV || 'unknown',
    app_mode: detectAppMode(),
  };
}
