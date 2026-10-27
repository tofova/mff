/**
 * Free Fire India launch celebration theme (launch day: 28 October 2026).
 *
 * Everything the theme does on the site is switched by this one window:
 *   - the root layout sets <html data-theme="ff-india"> while it is active
 *     (every theme CSS rule in globals.css is scoped to that attribute),
 *   - the small React touches (ribbons, chips, loading screen, welcome
 *     animation, confetti) call isFfIndiaThemeActive() and render nothing
 *     outside the window.
 *
 * To end the celebration early, extend it, or switch it off entirely, change
 * the lines below and redeploy. No database or admin setting is involved.
 * All times are India Standard Time (UTC+05:30).
 */
export const FF_INDIA_THEME = {
  enabled: true,
  startsAt: '2026-10-27T00:00:00+05:30',
  endsAt: '2026-11-15T23:59:59+05:30',
} as const;

/** Value of the data-theme attribute on <html> while the theme is active. */
export const FF_INDIA_THEME_ATTR = 'ff-india';

export function isFfIndiaThemeActive(now: Date = new Date()): boolean {
  if (!FF_INDIA_THEME.enabled) return false;
  const t = now.getTime();
  return t >= Date.parse(FF_INDIA_THEME.startsAt) && t <= Date.parse(FF_INDIA_THEME.endsAt);
}
