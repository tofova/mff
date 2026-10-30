/**
 * Master Finder — pure text rules shared by the scanner (master-finder.ts),
 * the converter (master-finder-convert.ts) and the admin UI.
 *
 * No imports and no Node- or browser-only APIs, so this file is safe inside the
 * client bundle and in plain Node scripts alike. Everything that decides HOW a
 * piece of text is matched, which places are protected, and how a replacement
 * must be spelled lives here, so the three consumers can never disagree.
 */

export type FinderMode = 'link' | 'sentence' | 'uid';
/** Which spelling of the searched text matched. */
export type FinderVariant = 'exact' | 'html-escaped' | 'url-encoded' | 'id';
/** value = the whole field equals the text; mention = inside a longer text; reference = linked by id (uid mode, pass 2). */
export type FinderMatchKind = 'value' | 'mention' | 'reference';

export const MAX_REPLACEMENT_LENGTH = 2048;

export function escapeHtml(s: string): string {
    return s
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;')
        .replace(/'/g, '&#39;');
}

export interface TextVariant {
    text: string;
    variant: FinderVariant;
}

/**
 * Every spelling of `text` the finder looks for, and the converter rewrites:
 * the text itself, its HTML-escaped form (notification templates escape URLs
 * and quotes) and, for links, its URL-encoded form (/_next/image?url=…).
 */
export function textVariants(mode: FinderMode, text: string): TextVariant[] {
    const out: TextVariant[] = [];
    const push = (t: string, variant: FinderVariant) => {
        if (t && !out.some((v) => v.text === t)) out.push({ text: t, variant });
    };
    push(text, 'exact');
    if (mode !== 'uid') {
        const escaped = escapeHtml(text);
        push(escaped, 'html-escaped');
        push(escaped.replace(/&#39;/g, '&apos;'), 'html-escaped');
        if (mode === 'link') push(encodeURIComponent(text), 'url-encoded');
    }
    return out;
}

/** How a replacement must be spelled to fit where the matched spelling was found. */
export function transformForVariant(variant: FinderVariant, replacement: string): string {
    switch (variant) {
        case 'html-escaped':
            return escapeHtml(replacement);
        case 'url-encoded':
            return encodeURIComponent(replacement);
        default:
            return replacement;
    }
}

// ---------------------------------------------------------------------------
// Protection rules
// ---------------------------------------------------------------------------

/** Passwords, hashes, tokens: matched, but never shown in full and never rewritten. */
export function isSensitivePath(path: string): boolean {
    const last = (path.split('.').pop() ?? '').toLowerCase();
    return (
        last.includes('password') ||
        last.includes('secret') ||
        last.endsWith('token') ||
        last.includes('hash') ||
        last.includes('backupcode')
    );
}

/** Admin security / login records and the finder's own bookkeeping are never rewritten. */
export function isProtectedCollection(name: string): boolean {
    return name.startsWith('admin_') || name.startsWith('master_finder_');
}

/** Record ids are never rewritten, wherever they sit. */
export function isIdPath(path: string): boolean {
    return path === '_id' || path.endsWith('._id') || path.endsWith('.$id');
}

// Characters that may legally continue a URL right after the searched link.
// If one follows the match, the stored link is LONGER than the one searched
// for (e.g. the searched link is a prefix of another link) and a blind
// replacement would corrupt it.
const URL_CONTINUATION = /[A-Za-z0-9\-._~:/?#@!$&*+=%]/;
// Inside a URL-encoded value only unreserved characters and %XX escapes continue it.
const ENCODED_CONTINUATION = /[A-Za-z0-9\-._~%*!'()]/;

/** True when the character right after a matched link means the stored link keeps going. */
export function linkContinues(variant: FinderVariant, nextChar: string | undefined): boolean {
    if (!nextChar) return false;
    return (variant === 'url-encoded' ? ENCODED_CONTINUATION : URL_CONTINUATION).test(nextChar);
}

export type EligibilityStatus = 'eligible' | 'warning' | 'protected';

export interface Eligibility {
    status: EligibilityStatus;
    /** Human-readable reason for 'warning' and 'protected'. */
    reason: string | null;
}

export interface EligibilityInput {
    mode: FinderMode;
    collection: string;
    path: string;
    kind: FinderMatchKind;
    variant: FinderVariant;
    sensitive: boolean;
    snippet: string;
    matchStart: number;
    matchLength: number;
}

/** Can this match be rewritten by Convert, and should it be ticked by default? */
export function evaluateEligibility(row: EligibilityInput): Eligibility {
    if (row.mode === 'uid') return { status: 'protected', reason: 'UID scans are search-only' };
    if (isProtectedCollection(row.collection)) return { status: 'protected', reason: 'admin security data' };
    if (row.sensitive) return { status: 'protected', reason: 'sensitive field' };
    if (isIdPath(row.path)) return { status: 'protected', reason: 'record id' };
    if (row.variant === 'id' || row.kind === 'reference') return { status: 'protected', reason: 'not a text value' };
    if (row.mode === 'link' && row.matchStart >= 0) {
        const next = row.snippet.charAt(row.matchStart + row.matchLength) || undefined;
        if (next && next !== '…' && linkContinues(row.variant, next)) {
            return { status: 'warning', reason: 'the stored link continues after the matched part' };
        }
    }
    return { status: 'eligible', reason: null };
}

// ---------------------------------------------------------------------------
// Rewriting
// ---------------------------------------------------------------------------

/** Replace every occurrence of `needle` in `value`, optionally ignoring letter case. */
export function replaceAllOccurrences(
    value: string,
    needle: string,
    replacement: string,
    ignoreCase: boolean,
): { value: string; count: number } {
    if (!needle) return { value, count: 0 };
    const hay = ignoreCase ? value.toLowerCase() : value;
    const nd = ignoreCase ? needle.toLowerCase() : needle;
    let idx = hay.indexOf(nd);
    if (idx < 0) return { value, count: 0 };
    let out = '';
    let last = 0;
    let count = 0;
    while (idx >= 0) {
        out += value.slice(last, idx) + replacement;
        last = idx + nd.length;
        count++;
        idx = hay.indexOf(nd, last);
    }
    out += value.slice(last);
    return { value: out, count };
}

/**
 * Apply a conversion to one field value: every spelling of the old text becomes
 * the matching spelling of the new text (plain stays plain, HTML-escaped stays
 * HTML-escaped, URL-encoded stays URL-encoded).
 */
export function convertFieldValue(
    mode: FinderMode,
    value: string,
    oldText: string,
    newText: string,
    ignoreCase: boolean,
): { value: string; count: number } {
    let current = value;
    let total = 0;
    for (const v of textVariants(mode, oldText)) {
        const r = replaceAllOccurrences(current, v.text, transformForVariant(v.variant, newText), ignoreCase);
        current = r.value;
        total += r.count;
    }
    return { value: current, count: total };
}

/** Validates the replacement text an admin typed. Returns the trimmed value. */
export function validateReplacement(
    mode: FinderMode,
    oldText: string,
    newText: unknown,
): { ok: true; value: string } | { ok: false; message: string } {
    if (mode === 'uid') return { ok: false, message: 'UID scans are search-only.' };
    const value = typeof newText === 'string' ? newText.trim() : '';
    if (!value) return { ok: false, message: 'Enter the new text.' };
    if (value.length > MAX_REPLACEMENT_LENGTH) {
        return { ok: false, message: `The new text is too long (max ${MAX_REPLACEMENT_LENGTH} characters).` };
    }
    if (value === oldText) return { ok: false, message: 'The new text is the same as the old one.' };
    if (mode === 'link') {
        let url: URL;
        try {
            url = new URL(value);
        } catch {
            return { ok: false, message: 'The new link must be a full http(s) URL, e.g. https://cdn.example.com/image.png' };
        }
        if (url.protocol !== 'http:' && url.protocol !== 'https:') {
            return { ok: false, message: 'The new link must start with http:// or https://' };
        }
        if (url.username || url.password) {
            return { ok: false, message: 'The new link must not contain a username or password.' };
        }
    }
    return { ok: true, value };
}

/** Reads a value out of a document by its dotted path (`messages.3.html`). */
export function getByPath(doc: unknown, path: string): unknown {
    let current: unknown = doc;
    for (const segment of path.split('.')) {
        if (current === null || current === undefined) return undefined;
        if (Array.isArray(current)) {
            const index = Number(segment);
            if (!Number.isInteger(index) || index < 0) return undefined;
            current = current[index];
        } else if (typeof current === 'object') {
            current = (current as Record<string, unknown>)[segment];
        } else {
            return undefined;
        }
    }
    return current;
}
