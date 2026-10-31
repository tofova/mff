/**
 * Notification Cleanup — bulk removal of old notifications, with a 7-day backup.
 *
 * Why this exists: before 16 June 2026 a broadcast created one unlinked copy
 * per user, so there was no way to remove such a broadcast again except one
 * notification at a time. This module searches the `notifications` collection
 * by sentence / link (plus optional UID, IST time frame and "unlinked only"),
 * shows exactly what would go, and deletes the ticked notifications in a
 * background job.
 *
 * Safety rules (enforced here; the UI only mirrors them):
 *  - ONLY the `notifications` collection is ever deleted from. The one
 *    exception is a `broadcast_notifications` record whose notifications have
 *    all been removed by the same run: it is removed too (mirroring the
 *    existing "delete broadcast" action), and backed up like everything else.
 *  - Two guards start unticked: notifications younger than RECENT_DAYS and
 *    support-reply notifications. They are listed and can be ticked on purpose.
 *  - Nothing created after the moment the admin clicked Delete is touched.
 *  - Each notification is re-checked against the searched text right before it
 *    is deleted; one that changed in between is skipped and reported.
 *  - Every deleted document is copied in full to a backup collection first.
 *    Undo re-inserts the copies with their original ids. Backups expire after
 *    BACKUP_DAYS (TTL index) and can be discarded earlier to free storage.
 *
 * Self-contained: depends only on the mongodb driver and the pure text rules
 * in master-finder-text.ts, so a plain Node script can exercise it.
 */

import { ObjectId, type Collection, type Db, type Document, type Filter } from 'mongodb';
import { textVariants } from './master-finder-text';

// ---------------------------------------------------------------------------
// Types shared with the admin UI
// ---------------------------------------------------------------------------

export type CleanupTextMode = 'sentence' | 'link';

export interface CleanupCriteria {
    mode: CleanupTextMode;
    /** Exact text to look for in message / html / imageUrl. May be empty when another criterion is set. */
    text: string;
    ignoreCase: boolean;
    /** Exact gaming ID the notification was sent to, or ''. */
    gamingId: string;
    /** IST datetime-local strings ("YYYY-MM-DDTHH:mm") or ''. */
    startLocal: string;
    endLocal: string;
    /** Only notifications without a broadcastId (the old one-copy-per-user style). */
    unlinkedOnly: boolean;
}

/**
 * Which matched notifications are ticked. baseline 'default' = everything
 * except the two guards; 'none' = nothing. The id lists override the baseline.
 */
export interface CleanupSelection {
    baseline: 'default' | 'none';
    includedIds: string[];
    excludedIds: string[];
}

export interface CleanupBroadcastInfo {
    broadcastId: string;
    /** Notifications of this broadcast that match the search. */
    matched: number;
    /** All notifications this broadcast still has. */
    total: number;
    /** How many of them are ticked. */
    ticked: number;
    sample: string;
    /** True when the ticked ones are all the broadcast has left: its record goes too. */
    willEmpty: boolean;
}

export interface CleanupPlan {
    total: number;
    linked: number;
    unlinked: number;
    recent: number;
    supportReplies: number;
    guarded: number;
    ticked: number;
    oldest: string | null;
    newest: string | null;
    broadcasts: CleanupBroadcastInfo[];
    recentDays: number;
}

export interface CleanupRow {
    id: string;
    gamingId: string;
    createdAt: string;
    isPopup: boolean;
    isRead: boolean;
    type: string | null;
    broadcastId: string | null;
    hasHtml: boolean;
    imageUrl: string | null;
    snippet: string;
    matchStart: number;
    matchLength: number;
    matchedIn: 'message' | 'html' | 'imageUrl' | null;
    recent: boolean;
    supportReply: boolean;
    /** Ticked under the 'default' baseline (i.e. not guarded). */
    tickedByDefault: boolean;
}

export interface CleanupRowsPage {
    rows: CleanupRow[];
    total: number;
    page: number;
    pageSize: number;
}

export type CleanupBatchStatus = 'running' | 'completed' | 'failed';
export type CleanupUndoStatus = 'running' | 'done' | 'failed';

export interface CleanupUndo {
    status: CleanupUndoStatus;
    startedAt: string;
    finishedAt: string | null;
    restored: number;
    alreadyPresent: number;
    broadcastsRestored: number;
    error: string | null;
}

export interface CleanupBatch {
    id: string;
    status: CleanupBatchStatus;
    createdAt: string;
    finishedAt: string | null;
    error: string | null;
    criteria: CleanupCriteria;
    selection: { baseline: CleanupSelection['baseline']; included: number; excluded: number };
    progress: { processed: number; total: number; updatedAt: string };
    counts: { candidates: number; deleted: number; skipped: number; broadcastsRemoved: number; backupBytes: number };
    skippedReasons: Record<string, number>;
    backupExpiresAt: string;
    backupDiscardedAt: string | null;
    /** Backup documents still stored (0 once expired, discarded or restored). */
    backupRemaining: number;
    undo: CleanupUndo | null;
    /** True when Undo is possible right now. */
    canUndo: boolean;
}

export const CLEANUP_LIMITS = {
    recentDays: 7,
    backupDays: 7,
    pageSize: 50,
    deletePage: 500,
    keepBatches: 50,
    staleRunningMs: 10 * 60 * 1000,
    maxSelectionIds: 10000,
    maxTextLength: 2000,
    minTextLength: { sentence: 3, link: 4 } as Record<CleanupTextMode, number>,
};

export const CLEANUP_BATCHES_COLLECTION = 'notification_cleanup_batches';
export const CLEANUP_BACKUP_COLLECTION = 'notification_cleanup_backup';
const NOTIFICATIONS = 'notifications';
const BROADCASTS = 'broadcast_notifications';
const SNIPPET_CONTEXT = 90;
const HEX24 = /^[0-9a-f]{24}$/i;

// ---------------------------------------------------------------------------
// Storage documents
// ---------------------------------------------------------------------------

interface UndoDoc {
    status: CleanupUndoStatus;
    startedAt: Date;
    finishedAt: Date | null;
    updatedAt: Date;
    restored: number;
    alreadyPresent: number;
    broadcastsRestored: number;
    error: string | null;
}

interface BatchDoc {
    _id: ObjectId;
    status: CleanupBatchStatus;
    createdAt: Date;
    /** Nothing created at or after this moment is touched. */
    createdBefore: Date;
    finishedAt: Date | null;
    error: string | null;
    criteria: CleanupCriteria;
    selection: CleanupSelection;
    progress: { processed: number; total: number; updatedAt: Date };
    counts: { candidates: number; deleted: number; skipped: number; broadcastsRemoved: number; backupBytes: number };
    skippedReasons: Record<string, number>;
    backupExpiresAt: Date;
    backupDiscardedAt: Date | null;
    undo: UndoDoc | null;
}

interface BackupDoc {
    _id: ObjectId;
    batchId: ObjectId;
    kind: 'notification' | 'broadcast';
    originalId: unknown;
    doc: Document;
    deletedAt: Date;
    /** TTL index: MongoDB removes the copy once this moment has passed. */
    expireAt: Date;
}

function batchesCol(db: Db): Collection<BatchDoc> {
    return db.collection<BatchDoc>(CLEANUP_BATCHES_COLLECTION);
}

function backupCol(db: Db): Collection<BackupDoc> {
    return db.collection<BackupDoc>(CLEANUP_BACKUP_COLLECTION);
}

function notificationsCol(db: Db): Collection<Document> {
    return db.collection(NOTIFICATIONS);
}

let indexesEnsured = false;
async function ensureIndexes(db: Db): Promise<void> {
    if (indexesEnsured) return;
    indexesEnsured = true;
    try {
        await Promise.all([
            backupCol(db).createIndex({ expireAt: 1 }, { expireAfterSeconds: 0 }),
            backupCol(db).createIndex({ batchId: 1, kind: 1 }),
            batchesCol(db).createIndex({ createdAt: -1 }),
        ]);
    } catch (err) {
        console.warn('[notification-cleanup] could not create indexes:', err);
    }
}

// ---------------------------------------------------------------------------
// Criteria + filters
// ---------------------------------------------------------------------------

/** datetime-local ("YYYY-MM-DDTHH:mm") typed in IST → UTC Date. */
export function istLocalToUtcDate(local: string): Date | null {
    if (!local) return null;
    const withSeconds = local.length === 16 ? `${local}:00` : local;
    const date = new Date(`${withSeconds}+05:30`);
    return Number.isNaN(date.getTime()) ? null : date;
}

function escapeRegex(s: string): string {
    return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

export function validateCriteria(input: unknown): { ok: true; criteria: CleanupCriteria } | { ok: false; message: string } {
    const raw = (input && typeof input === 'object' ? input : {}) as Record<string, unknown>;
    const mode = raw.mode === 'link' ? 'link' : raw.mode === 'sentence' ? 'sentence' : null;
    if (!mode) return { ok: false, message: 'Choose Sentence or Link.' };
    const text = typeof raw.text === 'string' ? raw.text.trim() : '';
    if (text && text.length < CLEANUP_LIMITS.minTextLength[mode]) {
        return { ok: false, message: `Enter at least ${CLEANUP_LIMITS.minTextLength[mode]} characters of text.` };
    }
    if (text.length > CLEANUP_LIMITS.maxTextLength) return { ok: false, message: 'The text is too long.' };
    const gamingId = typeof raw.gamingId === 'string' ? raw.gamingId.trim().slice(0, 64) : '';
    const startLocal = typeof raw.startLocal === 'string' ? raw.startLocal.trim() : '';
    const endLocal = typeof raw.endLocal === 'string' ? raw.endLocal.trim() : '';
    const start = istLocalToUtcDate(startLocal);
    const end = istLocalToUtcDate(endLocal);
    if (startLocal && !start) return { ok: false, message: 'The "from" date is not valid.' };
    if (endLocal && !end) return { ok: false, message: 'The "to" date is not valid.' };
    if (start && end && start > end) return { ok: false, message: 'The "from" date is after the "to" date.' };
    const unlinkedOnly = raw.unlinkedOnly === true;
    if (!text && !gamingId && !start && !end && !unlinkedOnly) {
        return { ok: false, message: 'Enter a sentence or link, a UID, a time frame, or switch on "only unlinked".' };
    }
    return {
        ok: true,
        criteria: { mode, text, ignoreCase: raw.ignoreCase === true, gamingId, startLocal, endLocal, unlinkedOnly },
    };
}

/** The notifications a criteria set describes. `createdBefore` freezes the set at the moment Delete was clicked. */
function buildFilter(criteria: CleanupCriteria, createdBefore?: Date): Filter<Document> {
    const and: Filter<Document>[] = [];
    if (criteria.text) {
        const pattern = textVariants(criteria.mode, criteria.text).map((v) => escapeRegex(v.text)).join('|');
        const rx = { $regex: pattern, $options: criteria.ignoreCase ? 'i' : '' };
        and.push({ $or: [{ message: rx }, { html: rx }, { imageUrl: rx }] });
    }
    if (criteria.gamingId) and.push({ gamingId: criteria.gamingId });
    const createdAt: Record<string, Date> = {};
    const start = istLocalToUtcDate(criteria.startLocal);
    const end = istLocalToUtcDate(criteria.endLocal);
    if (start) createdAt.$gte = start;
    if (end) createdAt.$lte = end;
    if (createdBefore && (!end || createdBefore < end)) createdAt.$lt = createdBefore;
    if (Object.keys(createdAt).length > 0) and.push({ createdAt });
    if (criteria.unlinkedOnly) and.push({ broadcastId: { $exists: false } });
    return and.length === 0 ? {} : and.length === 1 ? and[0] : { $and: and };
}

function recentCutoff(now = new Date()): Date {
    return new Date(now.getTime() - CLEANUP_LIMITS.recentDays * 24 * 60 * 60 * 1000);
}

const SUPPORT_FILTER: Filter<Document> = { $or: [{ type: 'support_reply' }, { supportTicketId: { $exists: true } }] };

function guardFilter(now: Date): Filter<Document> {
    return { $or: [{ createdAt: { $gt: recentCutoff(now) } }, SUPPORT_FILTER] };
}

function isRecent(doc: Document, now: Date): boolean {
    const created = doc.createdAt instanceof Date ? doc.createdAt : new Date(doc.createdAt);
    return !Number.isNaN(created.getTime()) && created > recentCutoff(now);
}

function isSupportReply(doc: Document): boolean {
    return doc.type === 'support_reply' || doc.supportTicketId !== undefined;
}

function cleanIds(list: unknown): string[] {
    if (!Array.isArray(list)) return [];
    const out: string[] = [];
    for (const v of list) {
        if (typeof v === 'string' && HEX24.test(v)) out.push(v);
        if (out.length >= CLEANUP_LIMITS.maxSelectionIds) break;
    }
    return out;
}

export function sanitizeSelection(input: unknown): CleanupSelection {
    const raw = (input && typeof input === 'object' ? input : {}) as Record<string, unknown>;
    return {
        baseline: raw.baseline === 'none' ? 'none' : 'default',
        includedIds: cleanIds(raw.includedIds),
        excludedIds: cleanIds(raw.excludedIds),
    };
}

/** Mongo filter for "is ticked", so counting and deleting use the exact same rule. */
function tickFilter(selection: CleanupSelection, now: Date): Filter<Document> {
    const included = selection.includedIds.map((id) => new ObjectId(id));
    const excluded = selection.excludedIds.map((id) => new ObjectId(id));
    if (selection.baseline === 'none') {
        return included.length > 0 ? { _id: { $in: included } } : { _id: { $in: [] } };
    }
    const byDefault: Filter<Document>[] = [{ $nor: [guardFilter(now)] }];
    if (excluded.length > 0) byDefault.push({ _id: { $nin: excluded } });
    const or: Filter<Document>[] = [{ $and: byDefault }];
    if (included.length > 0) or.push({ _id: { $in: included } });
    return { $or: or };
}

function and(...filters: Filter<Document>[]): Filter<Document> {
    const parts = filters.filter((f) => Object.keys(f).length > 0);
    return parts.length === 0 ? {} : parts.length === 1 ? parts[0] : { $and: parts };
}

// ---------------------------------------------------------------------------
// Snippets
// ---------------------------------------------------------------------------

interface Hit {
    index: number;
    length: number;
}

function findText(value: string, criteria: CleanupCriteria): Hit | null {
    if (!criteria.text) return null;
    const hay = criteria.ignoreCase ? value.toLowerCase() : value;
    for (const v of textVariants(criteria.mode, criteria.text)) {
        const needle = criteria.ignoreCase ? v.text.toLowerCase() : v.text;
        const index = hay.indexOf(needle);
        if (index >= 0) return { index, length: needle.length };
    }
    return null;
}

function stripTags(html: string): string {
    return html
        .replace(/<style[\s\S]*?<\/style>/gi, ' ')
        .replace(/<script[\s\S]*?<\/script>/gi, ' ')
        .replace(/<[^>]+>/g, ' ')
        .replace(/&nbsp;/g, ' ')
        .replace(/\s+/g, ' ')
        .trim();
}

function snippetAround(value: string, hit: Hit | null): { snippet: string; matchStart: number; matchLength: number } {
    const clean = value.replace(/[\r\n\t]/g, ' ');
    if (!hit) {
        const cut = clean.length > 2 * SNIPPET_CONTEXT ? `${clean.slice(0, 2 * SNIPPET_CONTEXT)}…` : clean;
        return { snippet: cut, matchStart: -1, matchLength: 0 };
    }
    const start = Math.max(0, hit.index - SNIPPET_CONTEXT);
    const end = Math.min(clean.length, hit.index + hit.length + SNIPPET_CONTEXT);
    const prefix = start > 0 ? '…' : '';
    const suffix = end < clean.length ? '…' : '';
    return { snippet: prefix + clean.slice(start, end) + suffix, matchStart: prefix.length + (hit.index - start), matchLength: hit.length };
}

function toRow(doc: Document, criteria: CleanupCriteria, now: Date): CleanupRow {
    const message = typeof doc.message === 'string' ? doc.message : '';
    const html = typeof doc.html === 'string' ? doc.html : '';
    const imageUrl = typeof doc.imageUrl === 'string' ? doc.imageUrl : null;

    let matchedIn: CleanupRow['matchedIn'] = null;
    let snippet = snippetAround(message || stripTags(html) || imageUrl || '', null);
    if (criteria.text) {
        const inMessage = findText(message, criteria);
        if (inMessage) {
            matchedIn = 'message';
            snippet = snippetAround(message, inMessage);
        } else {
            const text = stripTags(html);
            const inHtml = findText(text, criteria) ?? (findText(html, criteria) ? findText(text, criteria) : null);
            if (inHtml) {
                matchedIn = 'html';
                snippet = snippetAround(text, inHtml);
            } else if (findText(html, criteria)) {
                // Matched inside the raw HTML only (e.g. in a tag attribute): show the visible text.
                matchedIn = 'html';
                snippet = snippetAround(text || message, null);
            } else if (imageUrl && findText(imageUrl, criteria)) {
                matchedIn = 'imageUrl';
                snippet = snippetAround(imageUrl, findText(imageUrl, criteria));
            }
        }
    }

    const recent = isRecent(doc, now);
    const supportReply = isSupportReply(doc);
    const created = doc.createdAt instanceof Date ? doc.createdAt : new Date(doc.createdAt);
    return {
        id: (doc._id as ObjectId).toHexString(),
        gamingId: typeof doc.gamingId === 'string' ? doc.gamingId : '',
        createdAt: Number.isNaN(created.getTime()) ? new Date(0).toISOString() : created.toISOString(),
        isPopup: doc.isPopup === true,
        isRead: doc.isRead === true,
        type: typeof doc.type === 'string' ? doc.type : null,
        broadcastId: typeof doc.broadcastId === 'string' ? doc.broadcastId : null,
        hasHtml: html.length > 0,
        imageUrl,
        snippet: snippet.snippet,
        matchStart: snippet.matchStart,
        matchLength: snippet.matchLength,
        matchedIn,
        recent,
        supportReply,
        tickedByDefault: !recent && !supportReply,
    };
}

/** True when the document still contains the searched text (re-check right before deleting). */
function stillMatches(doc: Document, criteria: CleanupCriteria): boolean {
    if (!criteria.text) return true;
    for (const field of ['message', 'html', 'imageUrl'] as const) {
        const value = doc[field];
        if (typeof value === 'string' && findText(value, criteria)) return true;
    }
    return false;
}

// ---------------------------------------------------------------------------
// Plan + rows
// ---------------------------------------------------------------------------

export async function planCleanup(db: Db, criteriaInput: unknown, selectionInput: unknown): Promise<{ ok: true; plan: CleanupPlan } | { ok: false; message: string }> {
    const validated = validateCriteria(criteriaInput);
    if (!validated.ok) return validated;
    const criteria = validated.criteria;
    const selection = sanitizeSelection(selectionInput);
    const now = new Date();
    const filter = buildFilter(criteria);
    const col = notificationsCol(db);

    const [total, linked, recent, supportReplies, guarded, ticked, oldestDoc, newestDoc] = await Promise.all([
        col.countDocuments(filter),
        col.countDocuments(and(filter, { broadcastId: { $exists: true } })),
        col.countDocuments(and(filter, { createdAt: { $gt: recentCutoff(now) } })),
        col.countDocuments(and(filter, SUPPORT_FILTER)),
        col.countDocuments(and(filter, guardFilter(now))),
        col.countDocuments(and(filter, tickFilter(selection, now))),
        col.find(filter, { projection: { createdAt: 1 }, sort: { createdAt: 1 }, limit: 1 }).next(),
        col.find(filter, { projection: { createdAt: 1 }, sort: { createdAt: -1 }, limit: 1 }).next(),
    ]);

    const grouped = await col
        .aggregate<{ _id: string; matched: number; sample: string | null }>([
            { $match: and(filter, { broadcastId: { $exists: true } }) },
            { $group: { _id: '$broadcastId', matched: { $sum: 1 }, sample: { $first: '$message' } } },
            { $sort: { matched: -1 } },
            { $limit: 12 },
        ])
        .toArray();
    const broadcasts: CleanupBroadcastInfo[] = [];
    for (const g of grouped) {
        const [broadcastTotal, broadcastTicked] = await Promise.all([
            col.countDocuments({ broadcastId: g._id }),
            col.countDocuments(and(filter, { broadcastId: g._id }, tickFilter(selection, now))),
        ]);
        broadcasts.push({
            broadcastId: g._id,
            matched: g.matched,
            total: broadcastTotal,
            ticked: broadcastTicked,
            sample: (g.sample ?? '').replace(/\s+/g, ' ').slice(0, 80),
            willEmpty: broadcastTicked > 0 && broadcastTicked >= broadcastTotal,
        });
    }

    const toIso = (d: Document | null) => {
        const v = d?.createdAt;
        const date = v instanceof Date ? v : v ? new Date(v) : null;
        return date && !Number.isNaN(date.getTime()) ? date.toISOString() : null;
    };

    return {
        ok: true,
        plan: {
            total,
            linked,
            unlinked: total - linked,
            recent,
            supportReplies,
            guarded,
            ticked,
            oldest: toIso(oldestDoc),
            newest: toIso(newestDoc),
            broadcasts,
            recentDays: CLEANUP_LIMITS.recentDays,
        },
    };
}

export async function listCleanupRows(db: Db, criteriaInput: unknown, page = 1, pageSize = CLEANUP_LIMITS.pageSize): Promise<CleanupRowsPage> {
    const size = Math.min(Math.max(pageSize, 1), 200);
    const pageNo = Math.max(page, 1);
    const validated = validateCriteria(criteriaInput);
    if (!validated.ok) return { rows: [], total: 0, page: pageNo, pageSize: size };
    const filter = buildFilter(validated.criteria);
    const col = notificationsCol(db);
    const now = new Date();
    const [total, docs] = await Promise.all([
        col.countDocuments(filter),
        col.find(filter, { sort: { createdAt: -1, _id: -1 }, skip: (pageNo - 1) * size, limit: size }).toArray(),
    ]);
    return { rows: docs.map((d) => toRow(d, validated.criteria, now)), total, page: pageNo, pageSize: size };
}

// ---------------------------------------------------------------------------
// Batches
// ---------------------------------------------------------------------------

let activeBatchId: string | null = null;

function toUndo(u: UndoDoc | null): CleanupUndo | null {
    if (!u) return null;
    return {
        status: u.status,
        startedAt: u.startedAt.toISOString(),
        finishedAt: u.finishedAt ? u.finishedAt.toISOString() : null,
        restored: u.restored,
        alreadyPresent: u.alreadyPresent,
        broadcastsRestored: u.broadcastsRestored,
        error: u.error,
    };
}

function toBatch(doc: BatchDoc, backupRemaining: number): CleanupBatch {
    const undo = toUndo(doc.undo);
    const canUndo =
        doc.status !== 'running' &&
        doc.counts.deleted > 0 &&
        doc.backupDiscardedAt === null &&
        backupRemaining > 0 &&
        (!undo || undo.status === 'failed');
    return {
        id: doc._id.toHexString(),
        status: doc.status,
        createdAt: doc.createdAt.toISOString(),
        finishedAt: doc.finishedAt ? doc.finishedAt.toISOString() : null,
        error: doc.error,
        criteria: doc.criteria,
        selection: { baseline: doc.selection.baseline, included: doc.selection.includedIds.length, excluded: doc.selection.excludedIds.length },
        progress: { processed: doc.progress.processed, total: doc.progress.total, updatedAt: doc.progress.updatedAt.toISOString() },
        counts: doc.counts,
        skippedReasons: doc.skippedReasons,
        backupExpiresAt: doc.backupExpiresAt.toISOString(),
        backupDiscardedAt: doc.backupDiscardedAt ? doc.backupDiscardedAt.toISOString() : null,
        backupRemaining,
        undo,
        canUndo,
    };
}

async function withBackupCounts(db: Db, docs: BatchDoc[]): Promise<CleanupBatch[]> {
    if (docs.length === 0) return [];
    const counts = await backupCol(db)
        .aggregate<{ _id: ObjectId; n: number }>([
            { $match: { batchId: { $in: docs.map((d) => d._id) } } },
            { $group: { _id: '$batchId', n: { $sum: 1 } } },
        ])
        .toArray();
    const byBatch = new Map(counts.map((c) => [c._id.toHexString(), c.n]));
    return docs.map((d) => toBatch(d, byBatch.get(d._id.toHexString()) ?? 0));
}

async function failStaleBatches(db: Db): Promise<void> {
    const cutoff = new Date(Date.now() - CLEANUP_LIMITS.staleRunningMs);
    const stale = await batchesCol(db)
        .find(
            { $or: [{ status: 'running', 'progress.updatedAt': { $lt: cutoff } }, { 'undo.status': 'running', 'undo.updatedAt': { $lt: cutoff } }] },
            { projection: { _id: 1, status: 1, undo: 1 } },
        )
        .toArray();
    const message = 'Interrupted: the server restarted while this was running.';
    for (const b of stale) {
        if (activeBatchId === b._id.toHexString()) continue;
        if (b.status === 'running') {
            await batchesCol(db).updateOne({ _id: b._id, status: 'running' }, { $set: { status: 'failed', error: message, finishedAt: new Date() } });
        } else if (b.undo?.status === 'running') {
            await batchesCol(db).updateOne(
                { _id: b._id, 'undo.status': 'running' },
                { $set: { 'undo.status': 'failed', 'undo.error': message, 'undo.finishedAt': new Date() } },
            );
        }
    }
}

async function pruneOldBatches(db: Db): Promise<void> {
    const old = await batchesCol(db)
        .find({}, { projection: { _id: 1 }, sort: { createdAt: -1 }, skip: CLEANUP_LIMITS.keepBatches })
        .toArray();
    if (old.length === 0) return;
    const ids = old.map((o) => o._id);
    await backupCol(db).deleteMany({ batchId: { $in: ids } });
    await batchesCol(db).deleteMany({ _id: { $in: ids } });
}

async function somethingIsRunning(db: Db): Promise<string | null> {
    const busy = await batchesCol(db).findOne({ $or: [{ status: 'running' }, { 'undo.status': 'running' }] }, { projection: { _id: 1 } });
    return busy ? 'Another cleanup or undo is still running. Wait for it to finish.' : null;
}

function isBatchId(id: string): boolean {
    return HEX24.test(id);
}

export async function getCleanupBatch(db: Db, batchId: string): Promise<CleanupBatch | null> {
    if (!isBatchId(batchId)) return null;
    await failStaleBatches(db);
    const doc = await batchesCol(db).findOne({ _id: new ObjectId(batchId) });
    if (!doc) return null;
    return (await withBackupCounts(db, [doc]))[0];
}

export async function listCleanupBatches(db: Db, limit = 20): Promise<CleanupBatch[]> {
    await failStaleBatches(db);
    const docs = await batchesCol(db)
        .find({}, { sort: { createdAt: -1 }, limit: Math.min(Math.max(limit, 1), CLEANUP_LIMITS.keepBatches) })
        .toArray();
    return withBackupCounts(db, docs);
}

export interface CleanupBatchesPage {
    batches: CleanupBatch[];
    /** All kept cleanups (at most CLEANUP_LIMITS.keepBatches). */
    total: number;
    page: number;
    pageSize: number;
}

/** One page of the kept cleanups, newest first, so the history can be shown 20 at a time. */
export async function listCleanupBatchesPage(db: Db, page = 1, pageSize = 20): Promise<CleanupBatchesPage> {
    const size = Math.min(Math.max(pageSize, 1), CLEANUP_LIMITS.keepBatches);
    const pageNo = Math.max(page, 1);
    await failStaleBatches(db);
    const [total, docs] = await Promise.all([
        batchesCol(db).countDocuments({}),
        batchesCol(db).find({}, { sort: { createdAt: -1 }, skip: (pageNo - 1) * size, limit: size }).toArray(),
    ]);
    return { batches: await withBackupCounts(db, docs), total, page: pageNo, pageSize: size };
}

/** Create a cleanup batch (status running). The caller then starts `runCleanup` in the background. */
export async function createCleanup(
    db: Db,
    criteriaInput: unknown,
    selectionInput: unknown,
): Promise<{ ok: true; batchId: string; total: number } | { ok: false; message: string }> {
    const validated = validateCriteria(criteriaInput);
    if (!validated.ok) return validated;
    const criteria = validated.criteria;
    const selection = sanitizeSelection(selectionInput);

    await ensureIndexes(db);
    await failStaleBatches(db);
    const busy = await somethingIsRunning(db);
    if (busy) return { ok: false, message: busy };

    const now = new Date();
    const total = await notificationsCol(db).countDocuments(and(buildFilter(criteria, now), tickFilter(selection, now)));
    if (total === 0) return { ok: false, message: 'Nothing is ticked, so there is nothing to delete.' };

    const doc: BatchDoc = {
        _id: new ObjectId(),
        status: 'running',
        createdAt: now,
        createdBefore: now,
        finishedAt: null,
        error: null,
        criteria,
        selection,
        progress: { processed: 0, total, updatedAt: now },
        counts: { candidates: total, deleted: 0, skipped: 0, broadcastsRemoved: 0, backupBytes: 0 },
        skippedReasons: {},
        backupExpiresAt: new Date(now.getTime() + CLEANUP_LIMITS.backupDays * 24 * 60 * 60 * 1000),
        backupDiscardedAt: null,
        undo: null,
    };
    await batchesCol(db).insertOne(doc);
    await pruneOldBatches(db);
    return { ok: true, batchId: doc._id.toHexString(), total };
}

/** Run a freshly created batch. Call WITHOUT awaiting from a server action. */
export async function runCleanup(db: Db, batchId: string): Promise<void> {
    if (!isBatchId(batchId)) return;
    const _id = new ObjectId(batchId);
    const batch = await batchesCol(db).findOne({ _id });
    if (!batch || batch.status !== 'running' || batch.progress.processed > 0) return;
    if (activeBatchId) {
        await batchesCol(db).updateOne({ _id }, { $set: { status: 'failed', error: 'Another cleanup is already running in this server process.', finishedAt: new Date() } });
        return;
    }
    activeBatchId = batchId;
    const runner = new CleanupRunner(db, batch);
    try {
        await runner.run();
    } catch (err) {
        await runner.fail(err);
    } finally {
        activeBatchId = null;
    }
}

function bump(map: Record<string, number>, key: string): void {
    map[key] = (map[key] ?? 0) + 1;
}

class CleanupRunner {
    private readonly db: Db;
    private readonly batch: BatchDoc;
    private readonly counts = { candidates: 0, deleted: 0, skipped: 0, broadcastsRemoved: 0, backupBytes: 0 };
    private readonly skippedReasons: Record<string, number> = {};
    private readonly touchedBroadcasts = new Set<string>();
    private processed = 0;

    constructor(db: Db, batch: BatchDoc) {
        this.db = db;
        this.batch = batch;
        this.counts.candidates = batch.counts.candidates;
    }

    async run(): Promise<void> {
        const now = this.batch.createdBefore;
        const filter = and(buildFilter(this.batch.criteria, this.batch.createdBefore), tickFilter(this.batch.selection, now));
        const col = notificationsCol(this.db);

        let lastId: ObjectId | null = null;
        for (;;) {
            const pageFilter: Filter<Document> = lastId ? and(filter, { _id: { $gt: lastId } }) : filter;
            const docs = await col.find(pageFilter, { sort: { _id: 1 }, limit: CLEANUP_LIMITS.deletePage }).toArray();
            if (docs.length === 0) break;
            lastId = docs[docs.length - 1]._id as ObjectId;
            await this.deletePage(docs);
        }

        await this.removeEmptiedBroadcasts();

        const finishedAt = new Date();
        await batchesCol(this.db).updateOne(
            { _id: this.batch._id },
            {
                $set: {
                    status: 'completed',
                    finishedAt,
                    counts: this.counts,
                    skippedReasons: this.skippedReasons,
                    progress: { processed: this.processed, total: this.batch.progress.total, updatedAt: finishedAt },
                },
            },
        );
    }

    async fail(err: unknown): Promise<void> {
        console.error('[notification-cleanup] cleanup failed:', err);
        try {
            await batchesCol(this.db).updateOne(
                { _id: this.batch._id },
                {
                    $set: {
                        status: 'failed',
                        error: err instanceof Error ? err.message : String(err),
                        finishedAt: new Date(),
                        counts: this.counts,
                        skippedReasons: this.skippedReasons,
                        progress: { processed: this.processed, total: this.batch.progress.total, updatedAt: new Date() },
                    },
                },
            );
        } catch (updateErr) {
            console.error('[notification-cleanup] could not record the failure:', updateErr);
        }
    }

    private async deletePage(docs: Document[]): Promise<void> {
        const verified: Document[] = [];
        for (const doc of docs) {
            if (stillMatches(doc, this.batch.criteria)) verified.push(doc);
            else {
                this.counts.skipped++;
                bump(this.skippedReasons, 'changed since the search');
            }
        }
        if (verified.length > 0) {
            const now = new Date();
            const backups: BackupDoc[] = verified.map((doc) => ({
                _id: new ObjectId(),
                batchId: this.batch._id,
                kind: 'notification',
                originalId: doc._id,
                doc,
                deletedAt: now,
                expireAt: this.batch.backupExpiresAt,
            }));
            await backupCol(this.db).insertMany(backups, { ordered: false });
            for (const doc of verified) this.counts.backupBytes += JSON.stringify(doc).length;

            const ids = verified.map((d) => d._id);
            const res = await notificationsCol(this.db).deleteMany({ _id: { $in: ids } });
            this.counts.deleted += res.deletedCount;
            if (res.deletedCount < ids.length) {
                const gone = ids.length - res.deletedCount;
                this.counts.skipped += gone;
                this.skippedReasons['already deleted'] = (this.skippedReasons['already deleted'] ?? 0) + gone;
            }
            for (const doc of verified) {
                if (typeof doc.broadcastId === 'string' && doc.broadcastId) this.touchedBroadcasts.add(doc.broadcastId);
            }
        }
        this.processed += docs.length;
        await batchesCol(this.db).updateOne(
            { _id: this.batch._id },
            { $set: { progress: { processed: this.processed, total: this.batch.progress.total, updatedAt: new Date() }, counts: this.counts, skippedReasons: this.skippedReasons } },
        );
    }

    /** A broadcast whose notifications are all gone now loses its record too (like the existing "delete broadcast"). */
    private async removeEmptiedBroadcasts(): Promise<void> {
        for (const broadcastId of this.touchedBroadcasts) {
            const remaining = await notificationsCol(this.db).countDocuments({ broadcastId });
            if (remaining > 0 || !HEX24.test(broadcastId)) continue;
            const _id = new ObjectId(broadcastId);
            const record = await this.db.collection(BROADCASTS).findOne({ _id });
            if (!record) continue;
            await backupCol(this.db).insertOne({
                _id: new ObjectId(),
                batchId: this.batch._id,
                kind: 'broadcast',
                originalId: record._id,
                doc: record,
                deletedAt: new Date(),
                expireAt: this.batch.backupExpiresAt,
            });
            const res = await this.db.collection(BROADCASTS).deleteOne({ _id });
            if (res.deletedCount > 0) this.counts.broadcastsRemoved++;
        }
    }
}

// ---------------------------------------------------------------------------
// Undo + discard
// ---------------------------------------------------------------------------

export async function startCleanupUndo(db: Db, batchId: string): Promise<{ ok: true } | { ok: false; message: string }> {
    if (!isBatchId(batchId)) return { ok: false, message: 'Unknown cleanup.' };
    await failStaleBatches(db);
    const batch = await getCleanupBatch(db, batchId);
    if (!batch) return { ok: false, message: 'Unknown cleanup.' };
    if (batch.status === 'running') return { ok: false, message: 'This cleanup is still running.' };
    if (batch.undo?.status === 'running') return { ok: false, message: 'Undo is already running.' };
    if (batch.undo?.status === 'done') return { ok: false, message: 'This cleanup was already undone.' };
    if (batch.backupDiscardedAt) return { ok: false, message: 'The backup was discarded, so this cleanup cannot be undone.' };
    if (batch.backupRemaining === 0) return { ok: false, message: 'The backup has expired, so this cleanup cannot be undone.' };
    const busy = await somethingIsRunning(db);
    if (busy) return { ok: false, message: busy };

    const now = new Date();
    const undo: UndoDoc = { status: 'running', startedAt: now, finishedAt: null, updatedAt: now, restored: 0, alreadyPresent: 0, broadcastsRestored: 0, error: null };
    const res = await batchesCol(db).updateOne(
        { _id: new ObjectId(batchId), $or: [{ undo: null }, { 'undo.status': 'failed' }] },
        { $set: { undo } },
    );
    return res.matchedCount > 0 ? { ok: true } : { ok: false, message: 'Undo could not be started. Refresh and try again.' };
}

interface BulkInsertOutcome {
    inserted: number;
    duplicates: number;
}

/** insertMany that tolerates documents whose _id already exists (they count as duplicates). */
async function insertTolerant(col: Collection<Document>, docs: Document[]): Promise<BulkInsertOutcome> {
    if (docs.length === 0) return { inserted: 0, duplicates: 0 };
    try {
        const res = await col.insertMany(docs, { ordered: false });
        return { inserted: res.insertedCount, duplicates: 0 };
    } catch (err) {
        const e = err as { insertedCount?: number; result?: { insertedCount?: number }; writeErrors?: { code?: number }[] };
        const writeErrors = Array.isArray(e.writeErrors) ? e.writeErrors : [];
        const duplicates = writeErrors.filter((w) => w.code === 11000).length;
        if (duplicates !== writeErrors.length) throw err;
        const inserted = e.insertedCount ?? e.result?.insertedCount ?? docs.length - duplicates;
        return { inserted, duplicates };
    }
}

/** Put the deleted notifications (and broadcast records) back. Call WITHOUT awaiting from a server action. */
export async function runCleanupUndo(db: Db, batchId: string): Promise<void> {
    if (!isBatchId(batchId)) return;
    const _id = new ObjectId(batchId);
    const batch = await batchesCol(db).findOne({ _id });
    if (!batch || !batch.undo || batch.undo.status !== 'running' || batch.undo.restored > 0) return;
    if (activeBatchId) {
        await batchesCol(db).updateOne({ _id }, { $set: { 'undo.status': 'failed', 'undo.error': 'Another cleanup is already running in this server process.', 'undo.finishedAt': new Date() } });
        return;
    }
    activeBatchId = batchId;
    let restored = 0;
    let alreadyPresent = 0;
    let broadcastsRestored = 0;
    try {
        for (;;) {
            const copies = await backupCol(db).find({ batchId: _id, kind: 'notification' }, { sort: { _id: 1 }, limit: CLEANUP_LIMITS.deletePage }).toArray();
            if (copies.length === 0) break;
            const outcome = await insertTolerant(notificationsCol(db), copies.map((c) => c.doc));
            restored += outcome.inserted;
            alreadyPresent += outcome.duplicates;
            await backupCol(db).deleteMany({ _id: { $in: copies.map((c) => c._id) } });
            await batchesCol(db).updateOne({ _id }, { $set: { 'undo.updatedAt': new Date(), 'undo.restored': restored, 'undo.alreadyPresent': alreadyPresent } });
        }
        const broadcastCopies = await backupCol(db).find({ batchId: _id, kind: 'broadcast' }).toArray();
        if (broadcastCopies.length > 0) {
            const outcome = await insertTolerant(db.collection(BROADCASTS), broadcastCopies.map((c) => c.doc));
            broadcastsRestored += outcome.inserted;
            await backupCol(db).deleteMany({ _id: { $in: broadcastCopies.map((c) => c._id) } });
        }
        const now = new Date();
        await batchesCol(db).updateOne(
            { _id },
            {
                $set: {
                    'undo.status': 'done',
                    'undo.finishedAt': now,
                    'undo.updatedAt': now,
                    'undo.restored': restored,
                    'undo.alreadyPresent': alreadyPresent,
                    'undo.broadcastsRestored': broadcastsRestored,
                },
            },
        );
    } catch (err) {
        console.error('[notification-cleanup] undo failed:', err);
        await batchesCol(db)
            .updateOne(
                { _id },
                {
                    $set: {
                        'undo.status': 'failed',
                        'undo.error': err instanceof Error ? err.message : String(err),
                        'undo.finishedAt': new Date(),
                        'undo.updatedAt': new Date(),
                        'undo.restored': restored,
                        'undo.alreadyPresent': alreadyPresent,
                        'undo.broadcastsRestored': broadcastsRestored,
                    },
                },
            )
            .catch((updateErr) => console.error('[notification-cleanup] could not record the undo failure:', updateErr));
    } finally {
        activeBatchId = null;
    }
}

/** Throw the backup away now (frees storage; Undo is no longer possible). */
export async function discardCleanupBackup(db: Db, batchId: string): Promise<{ ok: true; removed: number } | { ok: false; message: string }> {
    if (!isBatchId(batchId)) return { ok: false, message: 'Unknown cleanup.' };
    const _id = new ObjectId(batchId);
    const batch = await batchesCol(db).findOne({ _id });
    if (!batch) return { ok: false, message: 'Unknown cleanup.' };
    if (batch.status === 'running' || batch.undo?.status === 'running') return { ok: false, message: 'Wait until it has finished.' };
    const res = await backupCol(db).deleteMany({ batchId: _id });
    await batchesCol(db).updateOne({ _id }, { $set: { backupDiscardedAt: new Date() } });
    return { ok: true, removed: res.deletedCount };
}
