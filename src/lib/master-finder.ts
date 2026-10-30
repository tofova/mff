/**
 * Master Finder — read-only "find anything, anywhere" scan of the whole
 * MongoDB database behind the admin dashboard.
 *
 * Given a link, an exact sentence or a gaming UID it walks EVERY document of
 * EVERY collection (listed dynamically with listCollections, so collections of
 * old/removed features and future ones are covered too) and reports each place
 * the text occurs: collection, document id, the exact field path (MongoDB
 * dotted notation, so `messages.3.html` is the 4th message's html), a
 * highlighted snippet and a human-readable label for the record.
 *
 * Why a Node-side walk instead of a Mongo query: the database is an Atlas
 * shared cluster (no server-side JavaScript) and the text can be buried inside
 * HTML strings, arrays and nested objects whose field names are not known up
 * front. Walking every value is the only way to miss nothing.
 *
 * What it reads vs. skips
 *  - Strings, numbers, booleans and ObjectIds are inspected, at any depth.
 *  - Raw bytes are never inspected: GridFS `*.chunks` collections are skipped
 *    whole and Binary values (support_upload_chunks.data) are skipped. Bytes
 *    cannot contain a readable link / sentence / UID.
 *  - Base64 `data:` URIs (inline support images, chatbot media) are skipped
 *    unless `includeDataUris` is on. The known heavy fields are also excluded
 *    from the query projection so their bytes are not even downloaded.
 *  - Values in sensitive fields (passwords, hashes, tokens) are still matched,
 *    but their snippet is masked.
 *
 * Modes
 *  - link / sentence: exact substring match. HTML-escaped and (for links)
 *    URL-encoded spellings are searched as well, because the notification
 *    templates escape URLs and /_next/image links carry them URL-encoded.
 *  - uid: whole-value match anywhere ("value") plus mentions inside longer
 *    text ("mention"). With `expandReferences` a second pass finds records
 *    linked only by id: support images by ticketId, refunds by orderId, SMS
 *    logs by payment-lock id, orders by the user's _id, and so on.
 *
 * The scan runs as a background job inside the server process. Progress,
 * summary and results live in two collections of their own
 * (`master_finder_jobs`, `master_finder_results`), which the scan never reads
 * as data. Nothing else in the database is ever written by this module.
 *
 * Self-contained: it depends only on the `mongodb` driver and the pure text
 * rules in master-finder-text.ts, so it can be exercised from a plain Node
 * script. Consumers: the admin section under
 * src/app/admin/(protected)/master-finder and the converter in
 * master-finder-convert.ts (step two: rewrite the found text, with undo).
 */

import { Binary, ObjectId, type Collection, type Db, type Document } from 'mongodb';
import {
    evaluateEligibility,
    isSensitivePath,
    textVariants,
    type Eligibility,
    type FinderMatchKind,
    type FinderMode,
    type FinderVariant,
} from './master-finder-text';

// The mode / kind / variant types live in master-finder-text.ts (shared with the
// converter and the UI) and are re-exported here so consumers need one import.
export type { Eligibility, FinderMatchKind, FinderMode, FinderVariant } from './master-finder-text';

// ---------------------------------------------------------------------------
// Types shared with the admin UI (imported there with `import type`)
// ---------------------------------------------------------------------------

export type FinderJobStatus = 'queued' | 'running' | 'completed' | 'failed' | 'cancelled';

export interface FinderOptions {
    /** Case-insensitive matching (link / sentence modes). */
    ignoreCase: boolean;
    /** Also download and inspect base64 `data:` URIs (slow, large). */
    includeDataUris: boolean;
    /** uid mode: run the second pass that follows ids to linked records. */
    expandReferences: boolean;
}

export interface FinderScanRequest {
    mode: FinderMode;
    query: string;
    options: FinderOptions;
}

export interface FinderProgress {
    phase: 'starting' | 'scan' | 'references' | 'done';
    collectionsTotal: number;
    collectionsDone: number;
    currentCollection: string | null;
    docsScanned: number;
    docsEstimated: number;
    matches: number;
    byCollection: Record<string, number>;
    updatedAt: string; // ISO
}

export interface FinderSummary {
    byCollection: Record<string, number>;
    totalMatches: number;
    storedMatches: number;
    truncated: boolean;
    skippedCollections: string[];
    skippedFields: string[];
    dataUrisSkipped: number;
    referenceSeeds: number;
    referenceSeedsLimited: boolean;
    errors: Record<string, string>;
    durationMs: number;
}

export interface FinderJob {
    id: string;
    mode: FinderMode;
    query: string;
    options: FinderOptions;
    status: FinderJobStatus;
    createdAt: string;
    startedAt: string | null;
    finishedAt: string | null;
    progress: FinderProgress;
    summary: FinderSummary | null;
    error: string | null;
    /** The most recent Convert run on this scan's results, if any. */
    lastConversion: FinderConversionRef | null;
}

export interface FinderConversionRef {
    batchId: string;
    at: string;
    changed: number;
    skipped: number;
}

/** What Convert (or Undo) did to one matched field. */
export interface FinderConversionMark {
    batchId: string;
    status: 'changed' | 'skipped' | 'restored' | 'restore-skipped';
    reason: string | null;
    at: string;
}

export interface FinderMatch {
    id: string;
    seq: number;
    collection: string;
    docId: string;
    path: string;
    kind: FinderMatchKind;
    variant: FinderVariant;
    snippet: string;
    /** Offset of the match inside `snippet`; -1 when the snippet is masked. */
    matchStart: number;
    matchLength: number;
    occurrences: number;
    valueLength: number;
    label: string;
    adminPath: string | null;
    via: { collection: string; docId: string } | null;
    sensitive: boolean;
    /** Whether Convert may rewrite this match (see master-finder-text.ts). */
    eligibility: Eligibility;
    /** Set once a Convert / Undo has touched this match. */
    conversion: FinderConversionMark | null;
}

export interface FinderResultsPage {
    rows: FinderMatch[];
    total: number;
    page: number;
    pageSize: number;
}

/** Every collection the finder owns starts with this prefix; the scan never reads them as data. */
export const FINDER_COLLECTION_PREFIX = 'master_finder_';
export const FINDER_JOBS_COLLECTION = 'master_finder_jobs';
export const FINDER_RESULTS_COLLECTION = 'master_finder_results';
export const FINDER_CONVERSIONS_COLLECTION = 'master_finder_conversions';
export const FINDER_CHANGES_COLLECTION = 'master_finder_changes';

export const FINDER_LIMITS = {
    /** Matches beyond this are counted but not stored (the UI says "refine"). */
    maxStoredMatches: 5000,
    maxQueryLength: 2000,
    minQueryLength: { link: 4, sentence: 3, uid: 3 } as Record<FinderMode, number>,
    pageSize: 50,
    /** uid mode: how many matched records may seed the reference pass. */
    maxReferenceSeeds: 500,
    /** Finished jobs kept for review; older ones (and their results) are pruned. */
    keepJobs: 15,
    /** A "running" job without a progress update for this long is treated as interrupted. */
    staleRunningMs: 10 * 60 * 1000,
};

// ---------------------------------------------------------------------------
// Tunables
// ---------------------------------------------------------------------------

/** Scan the collections an admin cares about first so useful hits appear early. */
const SCAN_PRIORITY = [
    'users', 'support_tickets', 'orders', 'payment_locks', 'refund_requests', 'products',
    'notifications', 'broadcast_notifications', 'legacy_users', 'withdrawals', 'sms_webhook_logs',
    'ai_logs', 'support_images', 'support_files.files', 'support_blocks', 'support_upload_limits',
    'support_upload_chunks', 'user_product_controls', 'visual_id_promotions',
    'pre_seeded_login_history', 'blocked_identifiers', 'custom_ads', 'slider_images', 'events',
    'coin_broadcasts',
];

/** Base64 media fields: excluded from the projection unless includeDataUris. */
const HEAVY_TEXT_FIELDS: Record<string, string[]> = {
    support_images: ['dataUri'],
    ai_logs: ['mediaDataUri'],
};

/** Raw-byte fields: always excluded from the projection. */
const BINARY_FIELDS: Record<string, string[]> = {
    support_upload_chunks: ['data'],
};

/** uid mode: a whole-value hit in one of these TOP-LEVEL fields marks the record as "owned" by the UID, so its _id seeds the reference pass. */
const SEED_FIELDS = new Set(['gamingId', 'visualGamingId', 'matchedGamingId', 'username']);

const RESULT_FLUSH_SIZE = 100;
const PROGRESS_INTERVAL_MS = 800;
const SNIPPET_CONTEXT = 90;
const MAX_DEPTH = 64;
const MASKED_SNIPPET = '[hidden: sensitive field]';
// Built with the constructor: lookbehind is an ES2018 regex feature and the
// project's TypeScript target is ES2017 (the literal form would not compile).
const HEX24_TOKEN = new RegExp('(?<![0-9a-fA-F])[0-9a-fA-F]{24}(?![0-9a-fA-F])', 'g');
const HEX24_EXACT = /^[0-9a-f]{24}$/i;

// ---------------------------------------------------------------------------
// Storage documents
// ---------------------------------------------------------------------------

export interface JobDoc {
    _id: ObjectId;
    mode: FinderMode;
    query: string;
    options: FinderOptions;
    status: FinderJobStatus;
    createdAt: Date;
    startedAt: Date | null;
    finishedAt: Date | null;
    progress: FinderProgress;
    summary: FinderSummary | null;
    error: string | null;
    cancelRequested?: boolean;
    lastConversion?: { batchId: ObjectId; at: Date; changed: number; skipped: number } | null;
}

export interface ResultDoc {
    _id?: ObjectId;
    jobId: ObjectId;
    seq: number;
    collection: string;
    docId: string;
    /** The record's raw _id (ObjectId, string, …) so Convert can address it exactly. */
    docKey: unknown;
    path: string;
    kind: FinderMatchKind;
    variant: FinderVariant;
    snippet: string;
    matchStart: number;
    matchLength: number;
    occurrences: number;
    valueLength: number;
    label: string;
    adminPath: string | null;
    via: { collection: string; docId: string } | null;
    sensitive: boolean;
    conversion?: { batchId: ObjectId; status: FinderConversionMark['status']; reason: string | null; at: Date };
}

export function jobsCol(db: Db): Collection<JobDoc> {
    return db.collection<JobDoc>(FINDER_JOBS_COLLECTION);
}

export function resultsCol(db: Db): Collection<ResultDoc> {
    return db.collection<ResultDoc>(FINDER_RESULTS_COLLECTION);
}

let indexesEnsured = false;
async function ensureIndexes(db: Db): Promise<void> {
    if (indexesEnsured) return;
    indexesEnsured = true;
    try {
        await Promise.all([
            resultsCol(db).createIndex({ jobId: 1, seq: 1 }),
            resultsCol(db).createIndex({ jobId: 1, collection: 1, seq: 1 }),
            jobsCol(db).createIndex({ createdAt: -1 }),
        ]);
    } catch (err) {
        // Non-fatal: the tool works without indexes, just slower on big result sets.
        console.warn('[master-finder] could not create indexes:', err);
    }
}

function initialProgress(now: Date): FinderProgress {
    return {
        phase: 'starting',
        collectionsTotal: 0,
        collectionsDone: 0,
        currentCollection: null,
        docsScanned: 0,
        docsEstimated: 0,
        matches: 0,
        byCollection: {},
        updatedAt: now.toISOString(),
    };
}

function toJob(doc: JobDoc): FinderJob {
    return {
        id: doc._id.toHexString(),
        mode: doc.mode,
        query: doc.query,
        options: doc.options,
        status: doc.status,
        createdAt: doc.createdAt.toISOString(),
        startedAt: doc.startedAt ? doc.startedAt.toISOString() : null,
        finishedAt: doc.finishedAt ? doc.finishedAt.toISOString() : null,
        progress: doc.progress,
        summary: doc.summary,
        error: doc.error,
        lastConversion: doc.lastConversion
            ? {
                  batchId: doc.lastConversion.batchId.toHexString(),
                  at: doc.lastConversion.at.toISOString(),
                  changed: doc.lastConversion.changed,
                  skipped: doc.lastConversion.skipped,
              }
            : null,
    };
}

function toMatch(doc: ResultDoc, mode: FinderMode): FinderMatch {
    return {
        id: doc._id ? doc._id.toHexString() : `${doc.jobId.toHexString()}-${doc.seq}`,
        seq: doc.seq,
        collection: doc.collection,
        docId: doc.docId,
        path: doc.path,
        kind: doc.kind,
        variant: doc.variant,
        snippet: doc.snippet,
        matchStart: doc.matchStart,
        matchLength: doc.matchLength,
        occurrences: doc.occurrences,
        valueLength: doc.valueLength,
        label: doc.label,
        adminPath: doc.adminPath,
        via: doc.via,
        sensitive: doc.sensitive,
        eligibility: evaluateEligibility({
            mode,
            collection: doc.collection,
            path: doc.path,
            kind: doc.kind,
            variant: doc.variant,
            sensitive: doc.sensitive,
            snippet: doc.snippet,
            matchStart: doc.matchStart,
            matchLength: doc.matchLength,
        }),
        conversion: doc.conversion
            ? {
                  batchId: doc.conversion.batchId.toHexString(),
                  status: doc.conversion.status,
                  reason: doc.conversion.reason,
                  at: doc.conversion.at.toISOString(),
              }
            : null,
    };
}

// ---------------------------------------------------------------------------
// Request validation
// ---------------------------------------------------------------------------

const MODES: FinderMode[] = ['link', 'sentence', 'uid'];

export function validateFinderRequest(
    input: unknown,
): { ok: true; request: FinderScanRequest } | { ok: false; message: string } {
    const raw = (input && typeof input === 'object' ? input : {}) as Record<string, unknown>;
    const mode = raw.mode;
    if (typeof mode !== 'string' || !MODES.includes(mode as FinderMode)) {
        return { ok: false, message: 'Choose what to search for: a link, a sentence or a UID.' };
    }
    const query = typeof raw.query === 'string' ? raw.query.trim() : '';
    const min = FINDER_LIMITS.minQueryLength[mode as FinderMode];
    if (query.length < min) {
        return { ok: false, message: `Enter at least ${min} characters to search.` };
    }
    if (query.length > FINDER_LIMITS.maxQueryLength) {
        return { ok: false, message: `The search text is too long (max ${FINDER_LIMITS.maxQueryLength} characters).` };
    }
    const options: FinderOptions = {
        ignoreCase: mode !== 'uid' && raw.ignoreCase === true,
        includeDataUris: raw.includeDataUris === true,
        expandReferences: mode === 'uid' && raw.expandReferences !== false,
    };
    return { ok: true, request: { mode: mode as FinderMode, query, options } };
}

// ---------------------------------------------------------------------------
// Matching helpers
// ---------------------------------------------------------------------------

interface Needle {
    text: string;
    variant: FinderVariant;
    /** Pre-lowercased when ignoreCase. */
    cmp: string;
}

function buildNeedles(mode: FinderMode, query: string, ignoreCase: boolean): Needle[] {
    return textVariants(mode, query).map((v) => ({
        text: v.text,
        variant: v.variant,
        cmp: ignoreCase ? v.text.toLowerCase() : v.text,
    }));
}

interface StringHit {
    needle: Needle;
    index: number;
    occurrences: number;
}

/** First needle (in priority order) found in `value`, with its first position and total occurrences. */
function scanString(value: string, needles: Needle[], ignoreCase: boolean): StringHit | null {
    const hay = ignoreCase ? value.toLowerCase() : value;
    for (const needle of needles) {
        let idx = hay.indexOf(needle.cmp);
        if (idx < 0) continue;
        const first = idx;
        let count = 0;
        while (idx >= 0) {
            count++;
            idx = hay.indexOf(needle.cmp, idx + needle.cmp.length);
        }
        return { needle, index: first, occurrences: count };
    }
    return null;
}

function makeSnippet(value: string, index: number, length: number): { snippet: string; matchStart: number; matchLength: number } {
    const start = Math.max(0, index - SNIPPET_CONTEXT);
    const end = Math.min(value.length, index + length + SNIPPET_CONTEXT);
    const prefix = start > 0 ? '…' : '';
    const suffix = end < value.length ? '…' : '';
    // Same-length substitutions only, so matchStart stays valid.
    const body = value.slice(start, end).replace(/[\r\n\t\u2028\u2029]/g, ' ');
    return { snippet: prefix + body + suffix, matchStart: prefix.length + (index - start), matchLength: length };
}

function isObjectId(value: unknown): value is ObjectId {
    return value instanceof ObjectId || (value !== null && typeof value === 'object' && (value as { _bsontype?: string })._bsontype === 'ObjectId');
}

function isBinary(value: unknown): boolean {
    return Buffer.isBuffer(value) || value instanceof Binary || (value !== null && typeof value === 'object' && (value as { _bsontype?: string })._bsontype === 'Binary');
}

function idToString(id: unknown): string {
    if (isObjectId(id)) return id.toHexString();
    if (typeof id === 'string') return id;
    if (typeof id === 'number' || typeof id === 'bigint' || typeof id === 'boolean') return String(id);
    try {
        return JSON.stringify(id);
    } catch {
        return String(id);
    }
}

type Visit = (path: string, value: unknown) => void;

/** Depth-first walk over every leaf value of a BSON document. */
function walkValue(value: unknown, path: string, visit: Visit, depth: number): void {
    if (value === null || value === undefined || depth > MAX_DEPTH) return;
    const t = typeof value;
    if (t === 'string' || t === 'number' || t === 'boolean' || t === 'bigint') {
        visit(path, value);
        return;
    }
    if (t !== 'object') return;
    if (value instanceof Date || value instanceof RegExp) return;
    if (Array.isArray(value)) {
        for (let i = 0; i < value.length; i++) {
            walkValue(value[i], path ? `${path}.${i}` : String(i), visit, depth + 1);
        }
        return;
    }
    if (isBinary(value)) return;
    if (isObjectId(value)) {
        visit(path, value);
        return;
    }
    const bsonType = (value as { _bsontype?: string })._bsontype;
    if (bsonType === 'Long' || bsonType === 'Decimal128' || bsonType === 'Double' || bsonType === 'Int32') {
        visit(path, String(value));
        return;
    }
    if (bsonType === 'DBRef') {
        walkValue((value as { oid?: unknown }).oid, path ? `${path}.$id` : '$id', visit, depth + 1);
        return;
    }
    if (bsonType) return; // Timestamp, MinKey, MaxKey, Code, BSONRegExp, BSONSymbol: nothing searchable
    for (const key of Object.keys(value as object)) {
        walkValue((value as Record<string, unknown>)[key], path ? `${path}.${key}` : key, visit, depth + 1);
    }
}

// ---------------------------------------------------------------------------
// Human-readable record labels + where to open them in the admin
// ---------------------------------------------------------------------------

function fmtDate(d: unknown): string | null {
    const date = d instanceof Date ? d : typeof d === 'string' ? new Date(d) : null;
    if (!date || Number.isNaN(date.getTime())) return null;
    return (
        date.toLocaleString('en-IN', {
            timeZone: 'Asia/Kolkata',
            day: '2-digit',
            month: 'short',
            year: 'numeric',
            hour: '2-digit',
            minute: '2-digit',
            hour12: true,
        }) + ' IST'
    );
}

function str(v: unknown, max = 48): string | null {
    if (v === null || v === undefined) return null;
    if (typeof v === 'string') {
        const s = v.replace(/\s+/g, ' ').trim();
        if (!s) return null;
        return s.length > max ? s.slice(0, max - 1) + '…' : s;
    }
    if (typeof v === 'number' || typeof v === 'boolean') return String(v);
    if (isObjectId(v)) return v.toHexString();
    return null;
}

function money(v: unknown): string | null {
    return typeof v === 'number' ? `₹${v}` : null;
}

function q(v: string | null): string {
    return v ? `?search=${encodeURIComponent(v)}` : '';
}

function describeDocument(collection: string, doc: Document): { label: string; adminPath: string | null } {
    const gid = str(doc.gamingId);
    const vgid = str(doc.visualGamingId);
    const who = gid ? `UID ${gid}${vgid && vgid !== gid ? ` (${vgid})` : ''}` : null;
    const when = fmtDate(doc.createdAt ?? doc.receivedAt ?? doc.promotionDate ?? doc.at ?? doc.timestamp ?? doc.updatedAt);
    const parts: (string | null)[] = [];
    let adminPath: string | null = null;

    switch (collection) {
        case 'users':
            parts.push(who, doc.isBanned ? 'banned' : null, typeof doc.coins === 'number' ? `${doc.coins} coins` : null, when);
            adminPath = `/admin/users${q(gid)}`;
            break;
        case 'orders':
            parts.push('Order', str(doc.productName), money(doc.finalPrice), str(doc.status), who, when);
            adminPath =
                doc.status === 'Completed' ? `/admin/success${q(gid)}`
                    : doc.status === 'Failed' ? `/admin/failed${q(gid)}`
                        : doc.status === 'Processing' ? '/admin'
                            : '/admin/all-orders';
            break;
        case 'products':
            parts.push('Product', str(doc.name), money(doc.price), doc.isVanished ? 'vanished' : null);
            adminPath = doc.isVanished ? '/admin/vanished-products' : '/admin/price-management';
            break;
        case 'notifications':
            parts.push('Notification', who ? `to ${who}` : null, str(doc.type), doc.isPopup ? 'popup' : null, when);
            adminPath = '/admin/users-notification';
            break;
        case 'broadcast_notifications':
            parts.push('Broadcast', str(doc.status), typeof doc.totalUsers === 'number' ? `${doc.totalUsers} users` : null, when);
            adminPath = '/admin/users-notification';
            break;
        case 'support_tickets':
            parts.push('Support report', str(doc.subject), str(doc.status), who, when);
            adminPath = '/admin/support';
            break;
        case 'support_images': {
            const ticket = str(doc.ticketId);
            parts.push('Support image', who, ticket ? `ticket ${ticket}` : null, when);
            adminPath = '/admin/support';
            break;
        }
        case 'support_files.files': {
            const meta = (doc.metadata ?? {}) as Document;
            const owner = str(meta.gamingId);
            parts.push('Support file', str(doc.filename), owner ? `UID ${owner}` : null, fmtDate(doc.uploadDate));
            adminPath = '/admin/support';
            break;
        }
        case 'support_blocks':
        case 'support_upload_limits':
        case 'support_upload_chunks':
            parts.push(collection.replace(/_/g, ' '), who, when);
            adminPath = '/admin/support';
            break;
        case 'refund_requests':
            parts.push('Refund', str(doc.productName), money(doc.amount), str(doc.status), who, fmtDate(doc.acceptedAt ?? doc.createdAt));
            adminPath = '/admin/refunds';
            break;
        case 'payment_locks':
            parts.push('Payment session', str(doc.productName), money(doc.amount), str(doc.status), who, when);
            adminPath = `/admin/payment-sessions${q(gid)}`;
            break;
        case 'sms_webhook_logs': {
            const matched = str(doc.matchedGamingId);
            const sender = str(doc.sender);
            parts.push('SMS log', sender ? `from ${sender}` : null, str(doc.status), matched ? `UID ${matched}` : null, when);
            adminPath = `/admin/sms-logs${q(matched)}`;
            break;
        }
        case 'ai_logs': {
            const question = str(doc.question, 60);
            parts.push('AI chat', who, question ? `“${question}”` : null, when);
            adminPath = `/admin/ai-logs${q(gid)}`;
            break;
        }
        case 'legacy_users': {
            const username = str(doc.username);
            parts.push('Account', username, when);
            adminPath = `/admin/accounts${q(username)}`;
            break;
        }
        case 'withdrawals':
            parts.push('Withdrawal', str(doc.username), money(doc.amount), str(doc.status), when);
            adminPath = '/admin/withdrawals';
            break;
        case 'user_product_controls':
            parts.push('Product control', str(doc.type), str(doc.productName), who, when);
            adminPath = `/admin/user-product-controls${q(gid)}`;
            break;
        case 'visual_id_promotions': {
            const oldId = str(doc.oldGamingId);
            const newId = str(doc.newGamingId);
            parts.push('Promoted ID', oldId && newId ? `${oldId} → ${newId}` : oldId ?? newId, when);
            adminPath = `/admin/promoted-ids${q(newId)}`;
            break;
        }
        case 'pre_seeded_login_history': {
            const target = str(doc.gamingIdToSeed);
            parts.push('Pre-seeded login history', target ? `for UID ${target}` : null);
            adminPath = '/admin/login-history';
            break;
        }
        case 'blocked_identifiers': {
            const value = str(doc.value);
            parts.push('Blocked', str(doc.type), value, str(doc.reason), when);
            adminPath = `/admin/block-management${q(value)}`;
            break;
        }
        case 'custom_ads':
            parts.push('Custom ad', str(doc.ctaText), when);
            adminPath = '/admin/custom-ads';
            break;
        case 'slider_images':
            parts.push('Slider image', typeof doc.displayOrder === 'number' ? `position ${doc.displayOrder}` : null, when);
            adminPath = '/admin/slider-management';
            break;
        case 'events':
            parts.push('Event image', when);
            adminPath = '/admin/events';
            break;
        case 'coin_broadcasts':
            parts.push('Bulk coin send', when);
            adminPath = '/admin/coin-management';
            break;
        case 'app_settings':
        case 'upi_change_log':
            parts.push(collection.replace(/_/g, ' '), when);
            adminPath = '/admin/upi-management';
            break;
        case 'online_visitors':
        case 'online_samples':
            parts.push(collection.replace(/_/g, ' '), who, when);
            adminPath = '/admin/online';
            break;
        case 'ad_reward_sessions':
            parts.push('Ad reward session', who, when);
            adminPath = '/admin/ad-analytics';
            break;
        default:
            if (collection.startsWith('admin_')) {
                parts.push(collection.replace(/_/g, ' '), when);
                adminPath = '/admin/security';
            } else {
                parts.push(
                    collection.replace(/_/g, ' '),
                    who,
                    str(doc.username),
                    str(doc.name),
                    str(doc.title),
                    str(doc.subject),
                    str(doc.status),
                    str(doc.type),
                    when,
                );
            }
    }

    const label = parts.filter((p): p is string => Boolean(p)).slice(0, 6).join(' · ') || collection;
    return { label, adminPath };
}

// ---------------------------------------------------------------------------
// Job management
// ---------------------------------------------------------------------------

/** The job this server process is currently scanning (one at a time, to protect the shared cluster). */
let activeJobId: string | null = null;

export function isJobId(id: string): boolean {
    return HEX24_EXACT.test(id);
}

/** Mark "running" jobs that stopped reporting progress (server restart) as failed. */
async function failStaleJobs(db: Db): Promise<void> {
    const cutoff = new Date(Date.now() - FINDER_LIMITS.staleRunningMs).toISOString();
    const stale = await jobsCol(db)
        .find({ status: { $in: ['queued', 'running'] }, 'progress.updatedAt': { $lt: cutoff } }, { projection: { _id: 1 } })
        .toArray();
    for (const j of stale) {
        if (activeJobId === j._id.toHexString()) continue;
        await jobsCol(db).updateOne(
            { _id: j._id, status: { $in: ['queued', 'running'] } },
            { $set: { status: 'failed', error: 'Interrupted: the server restarted while this scan was running.', finishedAt: new Date() } },
        );
    }
}

async function pruneOldJobs(db: Db): Promise<void> {
    const old = await jobsCol(db)
        .find({}, { projection: { _id: 1 }, sort: { createdAt: -1 }, skip: FINDER_LIMITS.keepJobs })
        .toArray();
    if (old.length === 0) return;
    const ids = old.map((o) => o._id);
    await resultsCol(db).deleteMany({ jobId: { $in: ids } });
    await jobsCol(db).deleteMany({ _id: { $in: ids } });
}

/** Create a queued job. The caller then starts `runFinderJob` in the background. */
export async function createFinderJob(
    db: Db,
    request: FinderScanRequest,
): Promise<{ ok: true; jobId: string } | { ok: false; message: string }> {
    await ensureIndexes(db);
    await failStaleJobs(db);

    const active = await jobsCol(db).findOne({ status: { $in: ['queued', 'running'] } }, { projection: { _id: 1 } });
    if (active) {
        return { ok: false, message: 'Another scan is still running. Wait for it to finish or cancel it first.' };
    }

    const now = new Date();
    const doc: JobDoc = {
        _id: new ObjectId(),
        mode: request.mode,
        query: request.query,
        options: request.options,
        status: 'queued',
        createdAt: now,
        startedAt: null,
        finishedAt: null,
        progress: initialProgress(now),
        summary: null,
        error: null,
    };
    await jobsCol(db).insertOne(doc);
    await pruneOldJobs(db);
    return { ok: true, jobId: doc._id.toHexString() };
}

export async function getFinderJob(db: Db, jobId: string): Promise<FinderJob | null> {
    if (!isJobId(jobId)) return null;
    await failStaleJobs(db);
    const doc = await jobsCol(db).findOne({ _id: new ObjectId(jobId) });
    return doc ? toJob(doc) : null;
}

export async function listRecentFinderJobs(db: Db, limit = FINDER_LIMITS.keepJobs): Promise<FinderJob[]> {
    await failStaleJobs(db);
    const docs = await jobsCol(db).find({}, { sort: { createdAt: -1 }, limit }).toArray();
    return docs.map(toJob);
}

export async function requestFinderCancel(db: Db, jobId: string): Promise<boolean> {
    if (!isJobId(jobId)) return false;
    const res = await jobsCol(db).updateOne(
        { _id: new ObjectId(jobId), status: { $in: ['queued', 'running'] } },
        { $set: { cancelRequested: true } },
    );
    return res.matchedCount > 0;
}

export async function getFinderResults(
    db: Db,
    jobId: string,
    opts: { collection?: string | null; page?: number; pageSize?: number } = {},
): Promise<FinderResultsPage> {
    const pageSize = Math.min(Math.max(opts.pageSize ?? FINDER_LIMITS.pageSize, 1), 200);
    const page = Math.max(opts.page ?? 1, 1);
    if (!isJobId(jobId)) return { rows: [], total: 0, page, pageSize };

    const job = await jobsCol(db).findOne({ _id: new ObjectId(jobId) }, { projection: { mode: 1 } });
    if (!job) return { rows: [], total: 0, page, pageSize };

    const filter: Record<string, unknown> = { jobId: job._id };
    if (opts.collection) filter.collection = opts.collection;

    const [total, docs] = await Promise.all([
        resultsCol(db).countDocuments(filter),
        resultsCol(db)
            .find(filter, { sort: { seq: 1 }, skip: (page - 1) * pageSize, limit: pageSize })
            .toArray(),
    ]);
    return { rows: docs.map((doc) => toMatch(doc, job.mode)), total, page, pageSize };
}

/**
 * Run a queued job to completion. Intended to be called WITHOUT awaiting from a
 * server action (fire-and-forget); progress is polled through `getFinderJob`.
 */
export async function runFinderJob(db: Db, jobId: string): Promise<void> {
    if (!isJobId(jobId)) return;
    const _id = new ObjectId(jobId);
    const job = await jobsCol(db).findOne({ _id });
    if (!job || job.status !== 'queued') return;

    if (activeJobId) {
        await jobsCol(db).updateOne(
            { _id },
            { $set: { status: 'failed', error: 'Another scan is already running in this server process.', finishedAt: new Date() } },
        );
        return;
    }

    activeJobId = jobId;
    const runner = new ScanRunner(db, job);
    try {
        await runner.run();
    } catch (err) {
        await runner.fail(err);
    } finally {
        activeJobId = null;
    }
}

// ---------------------------------------------------------------------------
// The scan itself
// ---------------------------------------------------------------------------

type Phase = 'scan' | 'references';

class ScanRunner {
    private readonly needles: Needle[];
    private readonly ignoreCase: boolean;
    private readonly includeDataUris: boolean;
    private readonly mode: FinderMode;
    private readonly query: string;
    /** Lower-cased query when it looks like an ObjectId (so `_id`s and references can match in uid mode). */
    private readonly queryHex: string | null;

    private progress: FinderProgress;
    private byCollection: Record<string, number> = {};
    private totalMatches = 0;
    private storedMatches = 0;
    private truncated = false;
    private buffer: ResultDoc[] = [];
    private readonly seeds = new Map<string, { collection: string; docId: string }>();
    private seedsLimited = false;
    private dataUrisSkipped = 0;
    private readonly errors: Record<string, string> = {};
    private skippedCollections: string[] = [];
    private readonly skippedFields = new Set<string>();
    private lastProgressAt = 0;
    private cancelled = false;
    private readonly startedAt = Date.now();

    private readonly db: Db;
    private readonly job: JobDoc;

    constructor(db: Db, job: JobDoc) {
        this.db = db;
        this.job = job;
        this.mode = job.mode;
        this.query = job.query;
        this.ignoreCase = job.options.ignoreCase;
        this.includeDataUris = job.options.includeDataUris;
        this.needles = buildNeedles(job.mode, job.query, job.options.ignoreCase);
        this.queryHex = HEX24_EXACT.test(job.query) ? job.query.toLowerCase() : null;
        this.progress = { ...job.progress, byCollection: {} };
    }

    async run(): Promise<void> {
        await jobsCol(this.db).updateOne({ _id: this.job._id }, { $set: { status: 'running', startedAt: new Date() } });

        const { scan, skipped } = await this.listCollections();
        this.skippedCollections = skipped;
        const estimates = await Promise.all(
            scan.map((name) => this.db.collection(name).estimatedDocumentCount().catch(() => 0)),
        );
        const docsEstimated = estimates.reduce((a, b) => a + b, 0);

        this.progress = {
            ...this.progress,
            phase: 'scan',
            collectionsTotal: scan.length,
            collectionsDone: 0,
            currentCollection: null,
            docsScanned: 0,
            docsEstimated,
            matches: 0,
        };
        await this.pushProgress(true);

        await this.pass(scan, 'scan');

        if (!this.cancelled && this.mode === 'uid' && this.job.options.expandReferences && this.seeds.size > 0) {
            this.progress = { ...this.progress, phase: 'references', collectionsDone: 0, currentCollection: null, docsScanned: 0 };
            await this.pushProgress(true);
            await this.pass(scan, 'references');
        }

        await this.flush();
        await this.finish(this.cancelled ? 'cancelled' : 'completed');
    }

    async fail(err: unknown): Promise<void> {
        console.error('[master-finder] scan failed:', err);
        try {
            await this.flush();
        } catch {
            /* keep going: the status update below matters more */
        }
        const message = err instanceof Error ? err.message : String(err);
        try {
            await jobsCol(this.db).updateOne(
                { _id: this.job._id },
                {
                    $set: {
                        status: 'failed',
                        error: message,
                        finishedAt: new Date(),
                        summary: this.summary(),
                        progress: { ...this.progress, phase: 'done', currentCollection: null, updatedAt: new Date().toISOString() },
                    },
                },
            );
        } catch (updateErr) {
            console.error('[master-finder] could not record the failure:', updateErr);
        }
    }

    // --- collections -------------------------------------------------------

    private async listCollections(): Promise<{ scan: string[]; skipped: string[] }> {
        const infos = (await this.db.listCollections({}, { nameOnly: true }).toArray()) as { name: string; type?: string }[];
        const scan: string[] = [];
        const skipped: string[] = [];
        for (const info of infos) {
            const name = info.name;
            if (!name || name.startsWith('system.')) continue;
            if (name.startsWith(FINDER_COLLECTION_PREFIX)) continue;
            if (info.type && info.type !== 'collection') {
                skipped.push(`${name} (${info.type})`);
                continue;
            }
            if (name.endsWith('.chunks')) {
                skipped.push(`${name} (file bytes)`);
                continue;
            }
            scan.push(name);
        }
        const rank = (name: string) => {
            const i = SCAN_PRIORITY.indexOf(name);
            return i === -1 ? SCAN_PRIORITY.length : i;
        };
        scan.sort((a, b) => rank(a) - rank(b) || a.localeCompare(b));
        return { scan, skipped };
    }

    private projectionFor(name: string): Record<string, 0> | undefined {
        const excl: Record<string, 0> = {};
        for (const f of BINARY_FIELDS[name] ?? []) {
            excl[f] = 0;
            this.skippedFields.add(`${name}.${f} (file bytes)`);
        }
        if (!this.includeDataUris) {
            for (const f of HEAVY_TEXT_FIELDS[name] ?? []) {
                excl[f] = 0;
                this.skippedFields.add(`${name}.${f} (base64 media)`);
            }
        }
        return Object.keys(excl).length > 0 ? excl : undefined;
    }

    // --- passes ------------------------------------------------------------

    private async pass(names: string[], phase: Phase): Promise<void> {
        for (const name of names) {
            if (this.cancelled) return;
            this.progress.currentCollection = name;
            await this.pushProgress(true);
            try {
                const cursor = this.db.collection(name).find({}, { projection: this.projectionFor(name), batchSize: 200 });
                for await (const doc of cursor) {
                    this.inspectDocument(name, doc, phase);
                    this.progress.docsScanned++;
                    if (this.buffer.length >= RESULT_FLUSH_SIZE) await this.flush();
                    await this.pushProgress(false);
                    if (this.cancelled) return;
                }
            } catch (err) {
                this.errors[name] = err instanceof Error ? err.message : String(err);
                console.error(`[master-finder] collection "${name}" failed:`, err);
            }
            this.progress.collectionsDone++;
            await this.flush();
            await this.pushProgress(true);
        }
    }

    private inspectDocument(collection: string, doc: Document, phase: Phase): void {
        const docId = idToString(doc._id);
        const ownHex = isObjectId(doc._id) ? doc._id.toHexString() : null;
        let described: { label: string; adminPath: string | null } | null = null;

        const record = (
            path: string,
            kind: FinderMatchKind,
            variant: FinderVariant,
            value: string,
            index: number,
            length: number,
            occurrences: number,
            via: { collection: string; docId: string } | null,
        ) => {
            this.totalMatches++;
            this.byCollection[collection] = (this.byCollection[collection] ?? 0) + 1;
            this.progress.matches = this.totalMatches;
            this.progress.byCollection = this.byCollection;

            if (phase === 'scan' && this.mode === 'uid' && kind === 'value' && ownHex && SEED_FIELDS.has(path)) {
                if (this.seeds.size < FINDER_LIMITS.maxReferenceSeeds) this.seeds.set(ownHex, { collection, docId });
                else if (!this.seeds.has(ownHex)) this.seedsLimited = true;
            }

            if (this.storedMatches >= FINDER_LIMITS.maxStoredMatches) {
                this.truncated = true;
                return;
            }
            const sensitive = isSensitivePath(path);
            const snip = sensitive
                ? { snippet: MASKED_SNIPPET, matchStart: -1, matchLength: 0 }
                : makeSnippet(value, index, length);
            if (!described) described = describeDocument(collection, doc);
            this.storedMatches++;
            this.buffer.push({
                jobId: this.job._id,
                seq: this.storedMatches,
                collection,
                docId,
                docKey: doc._id,
                path,
                kind,
                variant,
                snippet: snip.snippet,
                matchStart: snip.matchStart,
                matchLength: snip.matchLength,
                occurrences,
                valueLength: value.length,
                label: described.label,
                adminPath: described.adminPath,
                via,
                sensitive,
            });
        };

        if (phase === 'scan') {
            walkValue(doc, '', (path, value) => this.visitPrimary(path, value, record), 0);
        } else {
            walkValue(doc, '', (path, value) => this.visitReference(path, value, ownHex, record), 0);
        }
    }

    private skipDataUri(value: string): boolean {
        if (this.includeDataUris) return false;
        if (value.length > 64 && value.startsWith('data:')) {
            this.dataUrisSkipped++;
            return true;
        }
        return false;
    }

    /** Pass 1: the query itself (all modes). */
    private visitPrimary(
        path: string,
        value: unknown,
        record: (path: string, kind: FinderMatchKind, variant: FinderVariant, value: string, index: number, length: number, occurrences: number, via: null) => void,
    ): void {
        if (typeof value === 'string') {
            if (this.skipDataUri(value)) return;
            const hit = scanString(value, this.needles, this.ignoreCase);
            if (!hit) return;
            const trimmed = value.trim();
            const whole = this.ignoreCase ? trimmed.toLowerCase() === hit.needle.cmp : trimmed === hit.needle.text;
            record(path, whole ? 'value' : 'mention', hit.needle.variant, value, hit.index, hit.needle.cmp.length, hit.occurrences, null);
            return;
        }
        if (typeof value === 'number' || typeof value === 'boolean' || typeof value === 'bigint') {
            if (this.mode !== 'uid') return;
            const s = String(value);
            if (s === this.query) record(path, 'value', 'exact', s, 0, s.length, 1, null);
            return;
        }
        if (isObjectId(value)) {
            if (!this.queryHex) return;
            const hex = value.toHexString();
            if (hex === this.queryHex) record(path, 'value', 'id', hex, 0, hex.length, 1, null);
        }
    }

    /** Pass 2 (uid mode): ids of the records found in pass 1, wherever they are referenced. */
    private visitReference(
        path: string,
        value: unknown,
        ownHex: string | null,
        record: (path: string, kind: FinderMatchKind, variant: FinderVariant, value: string, index: number, length: number, occurrences: number, via: { collection: string; docId: string }) => void,
    ): void {
        if (path === '_id') return;
        if (typeof value === 'string') {
            if (this.skipDataUri(value)) return;
            if (value.length < 24) return;
            HEX24_TOKEN.lastIndex = 0;
            const found = new Map<string, { index: number; count: number }>();
            let m: RegExpExecArray | null;
            while ((m = HEX24_TOKEN.exec(value)) !== null) {
                const token = m[0].toLowerCase();
                if (token === ownHex || !this.seeds.has(token)) continue;
                const prev = found.get(token);
                if (prev) prev.count++;
                else found.set(token, { index: m.index, count: 1 });
            }
            for (const [token, f] of found) {
                record(path, 'reference', 'id', value, f.index, 24, f.count, this.seeds.get(token)!);
            }
            return;
        }
        if (isObjectId(value)) {
            const hex = value.toHexString();
            if (hex === ownHex) return;
            const seed = this.seeds.get(hex);
            if (seed) record(path, 'reference', 'id', hex, 0, hex.length, 1, seed);
        }
    }

    // --- persistence -------------------------------------------------------

    private async flush(): Promise<void> {
        if (this.buffer.length === 0) return;
        const batch = this.buffer;
        this.buffer = [];
        await resultsCol(this.db).insertMany(batch, { ordered: false });
    }

    /** Writes progress (throttled) and picks up a cancel request in the same round trip. */
    private async pushProgress(force: boolean): Promise<void> {
        const now = Date.now();
        if (!force && now - this.lastProgressAt < PROGRESS_INTERVAL_MS) return;
        this.lastProgressAt = now;
        this.progress.updatedAt = new Date().toISOString();
        const fresh = await jobsCol(this.db).findOneAndUpdate(
            { _id: this.job._id },
            { $set: { progress: this.progress } },
            { projection: { cancelRequested: 1 }, returnDocument: 'after' },
        );
        if (fresh?.cancelRequested) this.cancelled = true;
    }

    private summary(): FinderSummary {
        return {
            byCollection: { ...this.byCollection },
            totalMatches: this.totalMatches,
            storedMatches: this.storedMatches,
            truncated: this.truncated,
            skippedCollections: [...this.skippedCollections],
            skippedFields: [...this.skippedFields].sort(),
            dataUrisSkipped: this.dataUrisSkipped,
            referenceSeeds: this.seeds.size,
            referenceSeedsLimited: this.seedsLimited,
            errors: { ...this.errors },
            durationMs: Date.now() - this.startedAt,
        };
    }

    private async finish(status: 'completed' | 'cancelled'): Promise<void> {
        await jobsCol(this.db).updateOne(
            { _id: this.job._id },
            {
                $set: {
                    status,
                    finishedAt: new Date(),
                    summary: this.summary(),
                    progress: { ...this.progress, phase: 'done', currentCollection: null, updatedAt: new Date().toISOString() },
                },
            },
        );
    }
}
