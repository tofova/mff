/**
 * Master Finder — step two: Convert (and Undo).
 *
 * Rewrites every selected place where a scanned link / sentence occurs into a
 * new text, and can undo that again. It works ONLY on the stored results of a
 * finished scan from master-finder.ts, never on a fresh guess, so the admin
 * has always seen the exact list before anything is written.
 *
 * Safety rules (enforced here; the UI only mirrors them):
 *  - UID scans are search-only. Only link and sentence scans can convert.
 *  - Protected and never written: record ids, admin_* collections, the
 *    finder's own collections, sensitive fields (passwords, hashes, tokens),
 *    values that are not text. They are listed, with the reason.
 *  - Link mode: a hit where the stored link continues after the searched part
 *    (the old link is a prefix of a longer link) is unticked by default.
 *  - Only string values are rewritten, and only with the current value as the
 *    precondition: updateOne({ _id, <path>: <value read a moment ago> }). If
 *    the field changed in between, the row is skipped and reported.
 *  - Every rewritten field is recorded with its old and new value so the whole
 *    batch can be undone, again guarded by a precondition on the value written.
 *
 * Like a scan, a conversion (or an undo) runs as a background job inside the
 * server process, one at a time; the admin UI polls for progress. Nothing here
 * deletes anything, and nothing outside the selected fields is ever touched.
 */

import { ObjectId, type AnyBulkWriteOperation, type Collection, type Db, type Document, type Filter } from 'mongodb';
import {
    FINDER_CHANGES_COLLECTION,
    FINDER_CONVERSIONS_COLLECTION,
    isJobId,
    jobsCol,
    resultsCol,
    type FinderConversionMark,
    type FinderMode,
    type ResultDoc,
} from './master-finder';
import { convertFieldValue, evaluateEligibility, getByPath, validateReplacement, type Eligibility } from './master-finder-text';

// ---------------------------------------------------------------------------
// Types shared with the admin UI
// ---------------------------------------------------------------------------

/**
 * Which matches to rewrite. The default is "every eligible match that is not a
 * boundary warning"; the three lists override that default. Priority:
 * includedRowIds > excludedRowIds > excludedCollections > default.
 */
export interface ConversionSelection {
    excludedRowIds: string[];
    includedRowIds: string[];
    excludedCollections: string[];
}

export interface ConversionPlan {
    jobId: string;
    mode: FinderMode;
    oldText: string;
    totalRows: number;
    selected: number;
    unselected: number;
    warned: number;
    protected: number;
    alreadyConverted: number;
    selectedByCollection: Record<string, number>;
    protectedReasons: Record<string, number>;
    truncated: boolean;
}

export type ConversionStatus = 'running' | 'completed' | 'failed';
export type UndoStatus = 'running' | 'done' | 'failed';

export interface ConversionUndo {
    status: UndoStatus;
    startedAt: string;
    finishedAt: string | null;
    processed: number;
    total: number;
    restored: number;
    skipped: number;
    skippedReasons: Record<string, number>;
    error: string | null;
}

export interface ConversionBatch {
    id: string;
    jobId: string;
    mode: FinderMode;
    oldText: string;
    newText: string;
    ignoreCase: boolean;
    status: ConversionStatus;
    createdAt: string;
    finishedAt: string | null;
    error: string | null;
    progress: { processed: number; total: number; updatedAt: string };
    counts: { selected: number; changed: number; skipped: number; occurrences: number };
    skippedReasons: Record<string, number>;
    changedByCollection: Record<string, number>;
    undo: ConversionUndo | null;
}

export interface ConversionChange {
    id: string;
    collection: string;
    docId: string;
    path: string;
    oldValue: string;
    newValue: string;
    occurrences: number;
    changedAt: string;
    undone: boolean;
    undoneAt: string | null;
    undoSkippedReason: string | null;
    label: string;
    adminPath: string | null;
}

export interface ConversionChangesPage {
    rows: ConversionChange[];
    total: number;
    page: number;
    pageSize: number;
}

export const CONVERSION_LIMITS = {
    /** Finished batches kept (with their change records, so Undo stays possible). */
    keepBatches: 50,
    pageSize: 50,
    /** Field updates in flight at once. */
    concurrency: 8,
    /** Rows loaded per round trip. */
    pageRows: 100,
    staleRunningMs: 10 * 60 * 1000,
    maxSelectionIds: 10000,
};

// ---------------------------------------------------------------------------
// Storage documents
// ---------------------------------------------------------------------------

interface UndoDoc {
    status: UndoStatus;
    startedAt: Date;
    finishedAt: Date | null;
    updatedAt: Date;
    processed: number;
    total: number;
    restored: number;
    skipped: number;
    skippedReasons: Record<string, number>;
    error: string | null;
}

interface BatchDoc {
    _id: ObjectId;
    jobId: ObjectId;
    mode: FinderMode;
    oldText: string;
    newText: string;
    ignoreCase: boolean;
    selection: ConversionSelection;
    status: ConversionStatus;
    createdAt: Date;
    finishedAt: Date | null;
    error: string | null;
    progress: { processed: number; total: number; updatedAt: Date };
    counts: { selected: number; changed: number; skipped: number; occurrences: number };
    skippedReasons: Record<string, number>;
    changedByCollection: Record<string, number>;
    undo: UndoDoc | null;
}

interface ChangeDoc {
    _id: ObjectId;
    batchId: ObjectId;
    jobId: ObjectId;
    resultId: ObjectId | null;
    collection: string;
    docKey: unknown;
    docId: string;
    path: string;
    oldValue: string;
    newValue: string;
    occurrences: number;
    changedAt: Date;
    undone: boolean;
    undoneAt: Date | null;
    undoSkippedReason: string | null;
    label: string;
    adminPath: string | null;
}

function batchesCol(db: Db): Collection<BatchDoc> {
    return db.collection<BatchDoc>(FINDER_CONVERSIONS_COLLECTION);
}

function changesCol(db: Db): Collection<ChangeDoc> {
    return db.collection<ChangeDoc>(FINDER_CHANGES_COLLECTION);
}

let indexesEnsured = false;
async function ensureIndexes(db: Db): Promise<void> {
    if (indexesEnsured) return;
    indexesEnsured = true;
    try {
        await Promise.all([
            changesCol(db).createIndex({ batchId: 1, _id: 1 }),
            batchesCol(db).createIndex({ createdAt: -1 }),
            batchesCol(db).createIndex({ jobId: 1, createdAt: -1 }),
        ]);
    } catch (err) {
        console.warn('[master-finder] could not create conversion indexes:', err);
    }
}

const HEX24 = /^[0-9a-f]{24}$/i;

function idToString(id: unknown): string {
    if (id instanceof ObjectId) return id.toHexString();
    if (typeof id === 'string') return id;
    if (typeof id === 'number' || typeof id === 'bigint' || typeof id === 'boolean') return String(id);
    try {
        return JSON.stringify(id);
    } catch {
        return String(id);
    }
}

/** The raw _id to address a scanned record with (older rows may predate `docKey`). */
function docKeyOf(row: ResultDoc): unknown {
    if (row.docKey !== undefined && row.docKey !== null) return row.docKey;
    return HEX24.test(row.docId) ? new ObjectId(row.docId) : row.docId;
}

function toUndo(u: UndoDoc | null | undefined): ConversionUndo | null {
    if (!u) return null;
    return {
        status: u.status,
        startedAt: u.startedAt.toISOString(),
        finishedAt: u.finishedAt ? u.finishedAt.toISOString() : null,
        processed: u.processed,
        total: u.total,
        restored: u.restored,
        skipped: u.skipped,
        skippedReasons: u.skippedReasons,
        error: u.error,
    };
}

function toBatch(doc: BatchDoc): ConversionBatch {
    return {
        id: doc._id.toHexString(),
        jobId: doc.jobId.toHexString(),
        mode: doc.mode,
        oldText: doc.oldText,
        newText: doc.newText,
        ignoreCase: doc.ignoreCase,
        status: doc.status,
        createdAt: doc.createdAt.toISOString(),
        finishedAt: doc.finishedAt ? doc.finishedAt.toISOString() : null,
        error: doc.error,
        progress: { processed: doc.progress.processed, total: doc.progress.total, updatedAt: doc.progress.updatedAt.toISOString() },
        counts: doc.counts,
        skippedReasons: doc.skippedReasons,
        changedByCollection: doc.changedByCollection,
        undo: toUndo(doc.undo),
    };
}

function toChange(doc: ChangeDoc): ConversionChange {
    return {
        id: doc._id.toHexString(),
        collection: doc.collection,
        docId: doc.docId,
        path: doc.path,
        oldValue: doc.oldValue,
        newValue: doc.newValue,
        occurrences: doc.occurrences,
        changedAt: doc.changedAt.toISOString(),
        undone: doc.undone,
        undoneAt: doc.undoneAt ? doc.undoneAt.toISOString() : null,
        undoSkippedReason: doc.undoSkippedReason,
        label: doc.label,
        adminPath: doc.adminPath,
    };
}

// ---------------------------------------------------------------------------
// Selection
// ---------------------------------------------------------------------------

function cleanIds(list: unknown): string[] {
    if (!Array.isArray(list)) return [];
    const out: string[] = [];
    for (const v of list) {
        if (typeof v === 'string' && v.length > 0 && v.length <= 128) out.push(v);
        if (out.length >= CONVERSION_LIMITS.maxSelectionIds) break;
    }
    return out;
}

export function sanitizeSelection(input: unknown): ConversionSelection {
    const raw = (input && typeof input === 'object' ? input : {}) as Record<string, unknown>;
    return {
        excludedRowIds: cleanIds(raw.excludedRowIds),
        includedRowIds: cleanIds(raw.includedRowIds),
        excludedCollections: cleanIds(raw.excludedCollections),
    };
}

interface SelectionSets {
    excluded: Set<string>;
    included: Set<string>;
    excludedCollections: Set<string>;
}

function toSets(selection: ConversionSelection): SelectionSets {
    return {
        excluded: new Set(selection.excludedRowIds),
        included: new Set(selection.includedRowIds),
        excludedCollections: new Set(selection.excludedCollections),
    };
}

interface RowDecision {
    eligibility: Eligibility;
    selected: boolean;
    alreadyConverted: boolean;
}

/** The single source of truth for "will this row be rewritten?" (plan and run use it alike). */
function decideRow(row: ResultDoc, mode: FinderMode, sets: SelectionSets): RowDecision {
    const eligibility = evaluateEligibility({
        mode,
        collection: row.collection,
        path: row.path,
        kind: row.kind,
        variant: row.variant,
        sensitive: row.sensitive,
        snippet: row.snippet,
        matchStart: row.matchStart,
        matchLength: row.matchLength,
    });
    const mark = row.conversion?.status;
    const alreadyConverted = mark === 'changed';
    if (eligibility.status === 'protected' || alreadyConverted) {
        return { eligibility, selected: false, alreadyConverted };
    }
    const id = row._id ? row._id.toHexString() : '';
    let selected: boolean;
    if (sets.included.has(id)) selected = true;
    else if (sets.excluded.has(id)) selected = false;
    else if (sets.excludedCollections.has(row.collection)) selected = false;
    // Default: eligible rows are ticked, except boundary warnings and rows an
    // earlier conversion skipped (or an undo left alone): those need a human look.
    else selected = eligibility.status === 'eligible' && mark !== 'skipped' && mark !== 'restore-skipped';
    return { eligibility, selected, alreadyConverted };
}

const ROW_PROJECTION = {
    collection: 1,
    docId: 1,
    docKey: 1,
    path: 1,
    kind: 1,
    variant: 1,
    sensitive: 1,
    snippet: 1,
    matchStart: 1,
    matchLength: 1,
    conversion: 1,
    label: 1,
    adminPath: 1,
    seq: 1,
} as const;

// ---------------------------------------------------------------------------
// Plan
// ---------------------------------------------------------------------------

export async function planConversion(db: Db, jobId: string, selectionInput: unknown): Promise<ConversionPlan | null> {
    if (!isJobId(jobId)) return null;
    const job = await jobsCol(db).findOne({ _id: new ObjectId(jobId) });
    if (!job) return null;

    const sets = toSets(sanitizeSelection(selectionInput));
    const plan: ConversionPlan = {
        jobId,
        mode: job.mode,
        oldText: job.query,
        totalRows: 0,
        selected: 0,
        unselected: 0,
        warned: 0,
        protected: 0,
        alreadyConverted: 0,
        selectedByCollection: {},
        protectedReasons: {},
        truncated: job.summary?.truncated ?? false,
    };

    const cursor = resultsCol(db).find({ jobId: job._id }, { projection: ROW_PROJECTION });
    for await (const row of cursor) {
        const d = decideRow(row, job.mode, sets);
        plan.totalRows++;
        if (d.alreadyConverted) {
            plan.alreadyConverted++;
            continue;
        }
        if (d.eligibility.status === 'protected') {
            plan.protected++;
            const reason = d.eligibility.reason ?? 'protected';
            plan.protectedReasons[reason] = (plan.protectedReasons[reason] ?? 0) + 1;
            continue;
        }
        if (d.eligibility.status === 'warning') plan.warned++;
        if (d.selected) {
            plan.selected++;
            plan.selectedByCollection[row.collection] = (plan.selectedByCollection[row.collection] ?? 0) + 1;
        } else {
            plan.unselected++;
        }
    }
    return plan;
}

// ---------------------------------------------------------------------------
// Batch management
// ---------------------------------------------------------------------------

let activeBatchId: string | null = null;

/** A batch (or undo) that stopped reporting progress is marked failed (server restart). */
async function failStaleBatches(db: Db): Promise<void> {
    const cutoff = new Date(Date.now() - CONVERSION_LIMITS.staleRunningMs);
    const stale = await batchesCol(db)
        .find(
            { $or: [{ status: 'running', 'progress.updatedAt': { $lt: cutoff } }, { 'undo.status': 'running', 'undo.updatedAt': { $lt: cutoff } }] },
            { projection: { _id: 1, status: 1, undo: 1 } },
        )
        .toArray();
    for (const b of stale) {
        if (activeBatchId === b._id.toHexString()) continue;
        const message = 'Interrupted: the server restarted while this was running.';
        if (b.status === 'running') {
            await batchesCol(db).updateOne(
                { _id: b._id, status: 'running' },
                { $set: { status: 'failed', error: message, finishedAt: new Date() } },
            );
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
        .find({}, { projection: { _id: 1 }, sort: { createdAt: -1 }, skip: CONVERSION_LIMITS.keepBatches })
        .toArray();
    if (old.length === 0) return;
    const ids = old.map((o) => o._id);
    await changesCol(db).deleteMany({ batchId: { $in: ids } });
    await batchesCol(db).deleteMany({ _id: { $in: ids } });
}

async function somethingIsRunning(db: Db): Promise<string | null> {
    const busy = await batchesCol(db).findOne(
        { $or: [{ status: 'running' }, { 'undo.status': 'running' }] },
        { projection: { _id: 1 } },
    );
    if (busy) return 'Another conversion or undo is still running. Wait for it to finish.';
    const scanning = await jobsCol(db).findOne({ status: { $in: ['queued', 'running'] } }, { projection: { _id: 1 } });
    if (scanning) return 'A scan is running. Wait for it to finish before converting.';
    return null;
}

/** Create a conversion batch. The caller then starts `runConversion` in the background. */
export async function createConversion(
    db: Db,
    jobId: string,
    newTextInput: unknown,
    selectionInput: unknown,
): Promise<{ ok: true; batchId: string } | { ok: false; message: string }> {
    if (!isJobId(jobId)) return { ok: false, message: 'Unknown scan.' };
    const job = await jobsCol(db).findOne({ _id: new ObjectId(jobId) });
    if (!job) return { ok: false, message: 'Unknown scan.' };
    if (job.status === 'queued' || job.status === 'running') return { ok: false, message: 'Wait for the scan to finish first.' };
    if (job.mode === 'uid') return { ok: false, message: 'UID scans are search-only.' };

    const validated = validateReplacement(job.mode, job.query, newTextInput);
    if (!validated.ok) return { ok: false, message: validated.message };

    await ensureIndexes(db);
    await failStaleBatches(db);
    const busy = await somethingIsRunning(db);
    if (busy) return { ok: false, message: busy };

    const now = new Date();
    const doc: BatchDoc = {
        _id: new ObjectId(),
        jobId: job._id,
        mode: job.mode,
        oldText: job.query,
        newText: validated.value,
        ignoreCase: job.options.ignoreCase,
        selection: sanitizeSelection(selectionInput),
        status: 'running',
        createdAt: now,
        finishedAt: null,
        error: null,
        progress: { processed: 0, total: 0, updatedAt: now },
        counts: { selected: 0, changed: 0, skipped: 0, occurrences: 0 },
        skippedReasons: {},
        changedByCollection: {},
        undo: null,
    };
    await batchesCol(db).insertOne(doc);
    await pruneOldBatches(db);
    return { ok: true, batchId: doc._id.toHexString() };
}

export async function getConversion(db: Db, batchId: string): Promise<ConversionBatch | null> {
    if (!isJobId(batchId)) return null;
    await failStaleBatches(db);
    const doc = await batchesCol(db).findOne({ _id: new ObjectId(batchId) });
    return doc ? toBatch(doc) : null;
}

export async function listConversions(db: Db, opts: { jobId?: string | null; limit?: number } = {}): Promise<ConversionBatch[]> {
    await failStaleBatches(db);
    const filter: Filter<BatchDoc> = {};
    if (opts.jobId && isJobId(opts.jobId)) filter.jobId = new ObjectId(opts.jobId);
    const docs = await batchesCol(db)
        .find(filter, { sort: { createdAt: -1 }, limit: Math.min(Math.max(opts.limit ?? 20, 1), CONVERSION_LIMITS.keepBatches) })
        .toArray();
    return docs.map(toBatch);
}

export async function getConversionChanges(
    db: Db,
    batchId: string,
    page = 1,
    pageSize = CONVERSION_LIMITS.pageSize,
): Promise<ConversionChangesPage> {
    const size = Math.min(Math.max(pageSize, 1), 200);
    const pageNo = Math.max(page, 1);
    if (!isJobId(batchId)) return { rows: [], total: 0, page: pageNo, pageSize: size };
    const filter = { batchId: new ObjectId(batchId) };
    const [total, docs] = await Promise.all([
        changesCol(db).countDocuments(filter),
        changesCol(db)
            .find(filter, { sort: { _id: 1 }, skip: (pageNo - 1) * size, limit: size })
            .toArray(),
    ]);
    return { rows: docs.map(toChange), total, page: pageNo, pageSize: size };
}

/** Marks a finished batch for undo. The caller then starts `runUndo` in the background. */
export async function startUndo(db: Db, batchId: string): Promise<{ ok: true } | { ok: false; message: string }> {
    if (!isJobId(batchId)) return { ok: false, message: 'Unknown conversion.' };
    await failStaleBatches(db);
    const batch = await batchesCol(db).findOne({ _id: new ObjectId(batchId) });
    if (!batch) return { ok: false, message: 'Unknown conversion.' };
    if (batch.status === 'running') return { ok: false, message: 'This conversion is still running.' };
    if (batch.undo && batch.undo.status !== 'failed') {
        return { ok: false, message: batch.undo.status === 'running' ? 'Undo is already running.' : 'This conversion was already undone.' };
    }
    const remaining = await changesCol(db).countDocuments({ batchId: batch._id, undone: false });
    if (remaining === 0) return { ok: false, message: 'There is nothing left to undo for this conversion.' };
    const busy = await somethingIsRunning(db);
    if (busy) return { ok: false, message: busy };

    const now = new Date();
    const undo: UndoDoc = {
        status: 'running',
        startedAt: now,
        finishedAt: null,
        updatedAt: now,
        processed: 0,
        total: remaining,
        restored: 0,
        skipped: 0,
        skippedReasons: {},
        error: null,
    };
    const res = await batchesCol(db).updateOne(
        { _id: batch._id, $or: [{ undo: null }, { 'undo.status': 'failed' }] },
        { $set: { undo } },
    );
    return res.matchedCount > 0 ? { ok: true } : { ok: false, message: 'Undo could not be started. Please refresh and try again.' };
}

// ---------------------------------------------------------------------------
// Running a conversion
// ---------------------------------------------------------------------------

/** Run a freshly created batch to completion. Call WITHOUT awaiting from a server action. */
export async function runConversion(db: Db, batchId: string): Promise<void> {
    if (!isJobId(batchId)) return;
    const _id = new ObjectId(batchId);
    const batch = await batchesCol(db).findOne({ _id });
    if (!batch || batch.status !== 'running' || batch.progress.processed > 0) return;

    if (activeBatchId) {
        await batchesCol(db).updateOne(
            { _id },
            { $set: { status: 'failed', error: 'Another conversion is already running in this server process.', finishedAt: new Date() } },
        );
        return;
    }
    activeBatchId = batchId;
    const runner = new ConversionRunner(db, batch);
    try {
        await runner.run();
    } catch (err) {
        await runner.fail(err);
    } finally {
        activeBatchId = null;
    }
}

/** Run a started undo to completion. Call WITHOUT awaiting from a server action. */
export async function runUndo(db: Db, batchId: string): Promise<void> {
    if (!isJobId(batchId)) return;
    const _id = new ObjectId(batchId);
    const batch = await batchesCol(db).findOne({ _id });
    if (!batch || !batch.undo || batch.undo.status !== 'running' || batch.undo.processed > 0) return;

    if (activeBatchId) {
        await batchesCol(db).updateOne(
            { _id },
            { $set: { 'undo.status': 'failed', 'undo.error': 'Another conversion is already running in this server process.', 'undo.finishedAt': new Date() } },
        );
        return;
    }
    activeBatchId = batchId;
    const runner = new UndoRunner(db, batch);
    try {
        await runner.run();
    } catch (err) {
        await runner.fail(err);
    } finally {
        activeBatchId = null;
    }
}

async function forEachLimit<T>(items: T[], limit: number, fn: (item: T) => Promise<void>): Promise<void> {
    let next = 0;
    const workers = Array.from({ length: Math.min(limit, items.length) }, async () => {
        while (next < items.length) {
            const item = items[next++];
            await fn(item);
        }
    });
    await Promise.all(workers);
}

function bump(map: Record<string, number>, key: string): void {
    map[key] = (map[key] ?? 0) + 1;
}

type RowOutcome =
    | { status: 'changed'; change: ChangeDoc }
    | { status: 'skipped'; reason: string };

class ConversionRunner {
    private readonly db: Db;
    private readonly batch: BatchDoc;
    private readonly counts = { selected: 0, changed: 0, skipped: 0, occurrences: 0 };
    private readonly skippedReasons: Record<string, number> = {};
    private readonly changedByCollection: Record<string, number> = {};
    private processed = 0;
    private total = 0;
    private lastProgressAt = 0;

    constructor(db: Db, batch: BatchDoc) {
        this.db = db;
        this.batch = batch;
    }

    async run(): Promise<void> {
        const job = await jobsCol(this.db).findOne({ _id: this.batch.jobId });
        if (!job) throw new Error('The scan this conversion belongs to no longer exists.');
        const sets = toSets(this.batch.selection);

        // Pass 1: count what will be attempted, so the progress bar is honest.
        const countCursor = resultsCol(this.db).find({ jobId: job._id }, { projection: ROW_PROJECTION });
        for await (const row of countCursor) {
            if (decideRow(row, job.mode, sets).selected) this.total++;
        }
        this.counts.selected = this.total;
        await this.pushProgress(true);

        // Pass 2: rewrite, page by page, in result order.
        const cursor = resultsCol(this.db).find({ jobId: job._id }, { projection: ROW_PROJECTION, sort: { seq: 1 } });
        let page: ResultDoc[] = [];
        for await (const row of cursor) {
            if (!decideRow(row, job.mode, sets).selected) continue;
            page.push(row);
            if (page.length >= CONVERSION_LIMITS.pageRows) {
                await this.processPage(page);
                page = [];
            }
        }
        if (page.length > 0) await this.processPage(page);

        const now = new Date();
        await batchesCol(this.db).updateOne(
            { _id: this.batch._id },
            {
                $set: {
                    status: 'completed',
                    finishedAt: now,
                    counts: this.counts,
                    skippedReasons: this.skippedReasons,
                    changedByCollection: this.changedByCollection,
                    progress: { processed: this.processed, total: this.total, updatedAt: now },
                },
            },
        );
        await jobsCol(this.db).updateOne(
            { _id: job._id },
            { $set: { lastConversion: { batchId: this.batch._id, at: now, changed: this.counts.changed, skipped: this.counts.skipped } } },
        );
    }

    async fail(err: unknown): Promise<void> {
        console.error('[master-finder] conversion failed:', err);
        const message = err instanceof Error ? err.message : String(err);
        try {
            await batchesCol(this.db).updateOne(
                { _id: this.batch._id },
                {
                    $set: {
                        status: 'failed',
                        error: message,
                        finishedAt: new Date(),
                        counts: this.counts,
                        skippedReasons: this.skippedReasons,
                        changedByCollection: this.changedByCollection,
                        progress: { processed: this.processed, total: this.total, updatedAt: new Date() },
                    },
                },
            );
        } catch (updateErr) {
            console.error('[master-finder] could not record the conversion failure:', updateErr);
        }
    }

    private async processPage(rows: ResultDoc[]): Promise<void> {
        // One fetch per collection for the records on this page; only the top-level
        // field each path starts with is loaded (array indexes cannot be projected).
        const keysByCollection = new Map<string, Map<string, unknown>>();
        const fieldsByCollection = new Map<string, Set<string>>();
        for (const row of rows) {
            if (!keysByCollection.has(row.collection)) {
                keysByCollection.set(row.collection, new Map());
                fieldsByCollection.set(row.collection, new Set());
            }
            keysByCollection.get(row.collection)!.set(row.docId, docKeyOf(row));
            fieldsByCollection.get(row.collection)!.add(row.path.split('.')[0]);
        }
        const docs = new Map<string, Document>();
        for (const [collection, keys] of keysByCollection) {
            const projection: Record<string, 1> = { _id: 1 };
            for (const f of fieldsByCollection.get(collection) ?? []) projection[f] = 1;
            const found = await this.db
                .collection(collection)
                .find({ _id: { $in: [...keys.values()] } } as Filter<Document>, { projection })
                .toArray();
            for (const doc of found) docs.set(`${collection}\u0000${idToString(doc._id)}`, doc);
        }

        const marks: AnyBulkWriteOperation<ResultDoc>[] = [];
        const changes: ChangeDoc[] = [];
        await forEachLimit(rows, CONVERSION_LIMITS.concurrency, async (row) => {
            let outcome: RowOutcome;
            try {
                outcome = await this.convertRow(row, docs.get(`${row.collection}\u0000${row.docId}`));
            } catch (err) {
                outcome = { status: 'skipped', reason: `error: ${err instanceof Error ? err.message : String(err)}` };
            }
            const mark: ResultDoc['conversion'] = {
                batchId: this.batch._id,
                status: outcome.status,
                reason: outcome.status === 'skipped' ? outcome.reason : null,
                at: new Date(),
            };
            if (row._id) marks.push({ updateOne: { filter: { _id: row._id }, update: { $set: { conversion: mark } } } });
            if (outcome.status === 'changed') {
                changes.push(outcome.change);
                this.counts.changed++;
                this.counts.occurrences += outcome.change.occurrences;
                bump(this.changedByCollection, row.collection);
            } else {
                this.counts.skipped++;
                bump(this.skippedReasons, outcome.reason);
            }
        });

        if (changes.length > 0) await changesCol(this.db).insertMany(changes, { ordered: false });
        if (marks.length > 0) await resultsCol(this.db).bulkWrite(marks, { ordered: false });
        this.processed += rows.length;
        await this.pushProgress(true);
    }

    private async convertRow(row: ResultDoc, doc: Document | undefined): Promise<RowOutcome> {
        if (!doc) return { status: 'skipped', reason: 'record no longer exists' };
        const current = getByPath(doc, row.path);
        if (typeof current !== 'string') return { status: 'skipped', reason: 'field is missing or not text any more' };

        const { value: next, count } = convertFieldValue(this.batch.mode, current, this.batch.oldText, this.batch.newText, this.batch.ignoreCase);
        if (count === 0 || next === current) return { status: 'skipped', reason: 'old text no longer present' };

        // Precondition: the field must still hold exactly what we just read.
        const res = await this.db
            .collection(row.collection)
            .updateOne({ _id: doc._id, [row.path]: current } as Filter<Document>, { $set: { [row.path]: next } });
        if (res.matchedCount === 0) return { status: 'skipped', reason: 'changed since the scan' };

        return {
            status: 'changed',
            change: {
                _id: new ObjectId(),
                batchId: this.batch._id,
                jobId: this.batch.jobId,
                resultId: row._id ?? null,
                collection: row.collection,
                docKey: doc._id,
                docId: row.docId,
                path: row.path,
                oldValue: current,
                newValue: next,
                occurrences: count,
                changedAt: new Date(),
                undone: false,
                undoneAt: null,
                undoSkippedReason: null,
                label: row.label,
                adminPath: row.adminPath,
            },
        };
    }

    private async pushProgress(force: boolean): Promise<void> {
        const now = Date.now();
        if (!force && now - this.lastProgressAt < 800) return;
        this.lastProgressAt = now;
        await batchesCol(this.db).updateOne(
            { _id: this.batch._id },
            {
                $set: {
                    progress: { processed: this.processed, total: this.total, updatedAt: new Date() },
                    counts: this.counts,
                    skippedReasons: this.skippedReasons,
                    changedByCollection: this.changedByCollection,
                },
            },
        );
    }
}

// ---------------------------------------------------------------------------
// Running an undo
// ---------------------------------------------------------------------------

class UndoRunner {
    private readonly db: Db;
    private readonly batch: BatchDoc;
    private processed = 0;
    private restored = 0;
    private skipped = 0;
    private readonly skippedReasons: Record<string, number> = {};

    constructor(db: Db, batch: BatchDoc) {
        this.db = db;
        this.batch = batch;
    }

    async run(): Promise<void> {
        const cursor = changesCol(this.db).find({ batchId: this.batch._id, undone: false }, { sort: { _id: 1 } });
        let page: ChangeDoc[] = [];
        for await (const change of cursor) {
            page.push(change);
            if (page.length >= CONVERSION_LIMITS.pageRows) {
                await this.processPage(page);
                page = [];
            }
        }
        if (page.length > 0) await this.processPage(page);

        const now = new Date();
        await batchesCol(this.db).updateOne(
            { _id: this.batch._id },
            {
                $set: {
                    'undo.status': 'done',
                    'undo.finishedAt': now,
                    'undo.updatedAt': now,
                    'undo.processed': this.processed,
                    'undo.restored': this.restored,
                    'undo.skipped': this.skipped,
                    'undo.skippedReasons': this.skippedReasons,
                },
            },
        );
    }

    async fail(err: unknown): Promise<void> {
        console.error('[master-finder] undo failed:', err);
        const message = err instanceof Error ? err.message : String(err);
        try {
            const now = new Date();
            await batchesCol(this.db).updateOne(
                { _id: this.batch._id },
                {
                    $set: {
                        'undo.status': 'failed',
                        'undo.error': message,
                        'undo.finishedAt': now,
                        'undo.updatedAt': now,
                        'undo.processed': this.processed,
                        'undo.restored': this.restored,
                        'undo.skipped': this.skipped,
                        'undo.skippedReasons': this.skippedReasons,
                    },
                },
            );
        } catch (updateErr) {
            console.error('[master-finder] could not record the undo failure:', updateErr);
        }
    }

    private async processPage(changes: ChangeDoc[]): Promise<void> {
        const changeMarks: AnyBulkWriteOperation<ChangeDoc>[] = [];
        const resultMarks: AnyBulkWriteOperation<ResultDoc>[] = [];
        await forEachLimit(changes, CONVERSION_LIMITS.concurrency, async (change) => {
            let restored = false;
            let reason: string | null = null;
            try {
                // Precondition: the field must still hold exactly what the conversion wrote.
                const res = await this.db
                    .collection(change.collection)
                    .updateOne({ _id: change.docKey, [change.path]: change.newValue } as Filter<Document>, { $set: { [change.path]: change.oldValue } });
                restored = res.matchedCount > 0;
                if (!restored) reason = 'changed after the conversion';
            } catch (err) {
                reason = `error: ${err instanceof Error ? err.message : String(err)}`;
            }
            const now = new Date();
            if (restored) {
                this.restored++;
                changeMarks.push({ updateOne: { filter: { _id: change._id }, update: { $set: { undone: true, undoneAt: now, undoSkippedReason: null } } } });
            } else {
                this.skipped++;
                bump(this.skippedReasons, reason ?? 'skipped');
                changeMarks.push({ updateOne: { filter: { _id: change._id }, update: { $set: { undoSkippedReason: reason } } } });
            }
            if (change.resultId) {
                const mark: FinderConversionMark['status'] = restored ? 'restored' : 'restore-skipped';
                resultMarks.push({
                    updateOne: {
                        filter: { _id: change.resultId },
                        update: { $set: { conversion: { batchId: this.batch._id, status: mark, reason, at: now } } },
                    },
                });
            }
        });
        if (changeMarks.length > 0) await changesCol(this.db).bulkWrite(changeMarks, { ordered: false });
        if (resultMarks.length > 0) await resultsCol(this.db).bulkWrite(resultMarks, { ordered: false });
        this.processed += changes.length;
        await batchesCol(this.db).updateOne(
            { _id: this.batch._id },
            {
                $set: {
                    'undo.updatedAt': new Date(),
                    'undo.processed': this.processed,
                    'undo.restored': this.restored,
                    'undo.skipped': this.skipped,
                    'undo.skippedReasons': this.skippedReasons,
                },
            },
        );
    }
}
