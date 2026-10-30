'use server';

// ---------------------------------------------------------------------------
// Master Finder — server actions.
//
// Thin, admin-gated wrappers around src/lib/master-finder.ts (scan) and
// src/lib/master-finder-convert.ts (convert + undo). Scans, conversions and
// undos run in the background inside the server process; the client polls the
// `get…` actions for progress and pages through results.
//
// Self-contained: this folder plus the two lib files implement the whole
// feature. The only pre-existing file touched is the admin sidebar (one link).
// A scan writes to nothing but the finder's own collections; a conversion
// writes only to the fields the admin selected, each one recorded for Undo.
// ---------------------------------------------------------------------------

import { isAdminAuthenticated } from '@/app/actions';
import { connectToDatabase } from '@/lib/mongodb';
import { unstable_noStore as noStore } from 'next/cache';
import {
    createFinderJob,
    getFinderJob,
    getFinderResults,
    listRecentFinderJobs,
    requestFinderCancel,
    runFinderJob,
    validateFinderRequest,
    type FinderJob,
    type FinderResultsPage,
} from '@/lib/master-finder';
import {
    createConversion,
    getConversion,
    getConversionChanges,
    listConversions,
    planConversion,
    runConversion,
    runUndo,
    startUndo,
    type ConversionBatch,
    type ConversionChangesPage,
    type ConversionPlan,
} from '@/lib/master-finder-convert';

// ---------------------------------------------------------------------------
// Scan
// ---------------------------------------------------------------------------

export async function startFinderScan(
    input: unknown,
): Promise<{ success: boolean; jobId?: string; message: string }> {
    noStore();
    if (!(await isAdminAuthenticated())) return { success: false, message: 'Unauthorized.' };

    const validated = validateFinderRequest(input);
    if (!validated.ok) return { success: false, message: validated.message };

    try {
        const db = await connectToDatabase();
        const created = await createFinderJob(db, validated.request);
        if (!created.ok) return { success: false, message: created.message };

        // Fire-and-forget: the scan keeps running after this action returns.
        // Progress is read back through getFinderScan (same pattern as the
        // broadcast push sender).
        runFinderJob(db, created.jobId).catch((err) => console.error('[master-finder] background scan failed:', err));

        return { success: true, jobId: created.jobId, message: 'Scan started.' };
    } catch (error) {
        console.error('[master-finder] could not start scan:', error);
        return { success: false, message: 'Could not start the scan. Please try again.' };
    }
}

export async function getFinderScan(jobId: string): Promise<FinderJob | null> {
    noStore();
    if (!(await isAdminAuthenticated())) return null;
    try {
        const db = await connectToDatabase();
        return await getFinderJob(db, jobId);
    } catch (error) {
        console.error('[master-finder] could not load scan:', error);
        return null;
    }
}

export async function getFinderScanResults(
    jobId: string,
    collection: string | null,
    page: number,
): Promise<FinderResultsPage> {
    noStore();
    const empty: FinderResultsPage = { rows: [], total: 0, page: 1, pageSize: 50 };
    if (!(await isAdminAuthenticated())) return empty;
    try {
        const db = await connectToDatabase();
        return await getFinderResults(db, jobId, { collection, page });
    } catch (error) {
        console.error('[master-finder] could not load results:', error);
        return empty;
    }
}

export async function cancelFinderScan(jobId: string): Promise<{ success: boolean; message: string }> {
    noStore();
    if (!(await isAdminAuthenticated())) return { success: false, message: 'Unauthorized.' };
    try {
        const db = await connectToDatabase();
        const ok = await requestFinderCancel(db, jobId);
        return ok
            ? { success: true, message: 'Cancel requested. The scan stops after the current batch.' }
            : { success: false, message: 'This scan is not running any more.' };
    } catch (error) {
        console.error('[master-finder] could not cancel scan:', error);
        return { success: false, message: 'Could not cancel the scan.' };
    }
}

export async function getRecentFinderScans(): Promise<FinderJob[]> {
    noStore();
    if (!(await isAdminAuthenticated())) return [];
    try {
        const db = await connectToDatabase();
        return await listRecentFinderJobs(db);
    } catch (error) {
        console.error('[master-finder] could not list scans:', error);
        return [];
    }
}

// ---------------------------------------------------------------------------
// Convert + Undo
// ---------------------------------------------------------------------------

export async function getFinderConversionPlan(jobId: string, selection: unknown): Promise<ConversionPlan | null> {
    noStore();
    if (!(await isAdminAuthenticated())) return null;
    try {
        const db = await connectToDatabase();
        return await planConversion(db, jobId, selection);
    } catch (error) {
        console.error('[master-finder] could not plan conversion:', error);
        return null;
    }
}

export async function startFinderConversion(
    jobId: string,
    newText: unknown,
    selection: unknown,
): Promise<{ success: boolean; batchId?: string; message: string }> {
    noStore();
    if (!(await isAdminAuthenticated())) return { success: false, message: 'Unauthorized.' };
    try {
        const db = await connectToDatabase();
        const created = await createConversion(db, jobId, newText, selection);
        if (!created.ok) return { success: false, message: created.message };

        runConversion(db, created.batchId).catch((err) => console.error('[master-finder] background conversion failed:', err));

        return { success: true, batchId: created.batchId, message: 'Conversion started.' };
    } catch (error) {
        console.error('[master-finder] could not start conversion:', error);
        return { success: false, message: 'Could not start the conversion. Please try again.' };
    }
}

export async function getFinderConversion(batchId: string): Promise<ConversionBatch | null> {
    noStore();
    if (!(await isAdminAuthenticated())) return null;
    try {
        const db = await connectToDatabase();
        return await getConversion(db, batchId);
    } catch (error) {
        console.error('[master-finder] could not load conversion:', error);
        return null;
    }
}

export async function startFinderUndo(batchId: string): Promise<{ success: boolean; message: string }> {
    noStore();
    if (!(await isAdminAuthenticated())) return { success: false, message: 'Unauthorized.' };
    try {
        const db = await connectToDatabase();
        const started = await startUndo(db, batchId);
        if (!started.ok) return { success: false, message: started.message };

        runUndo(db, batchId).catch((err) => console.error('[master-finder] background undo failed:', err));

        return { success: true, message: 'Undo started.' };
    } catch (error) {
        console.error('[master-finder] could not start undo:', error);
        return { success: false, message: 'Could not start the undo. Please try again.' };
    }
}

export async function getRecentFinderConversions(jobId?: string | null): Promise<ConversionBatch[]> {
    noStore();
    if (!(await isAdminAuthenticated())) return [];
    try {
        const db = await connectToDatabase();
        return await listConversions(db, { jobId: jobId ?? null, limit: 20 });
    } catch (error) {
        console.error('[master-finder] could not list conversions:', error);
        return [];
    }
}

export async function getFinderConversionChanges(batchId: string, page: number): Promise<ConversionChangesPage> {
    noStore();
    const empty: ConversionChangesPage = { rows: [], total: 0, page: 1, pageSize: 50 };
    if (!(await isAdminAuthenticated())) return empty;
    try {
        const db = await connectToDatabase();
        return await getConversionChanges(db, batchId, page);
    } catch (error) {
        console.error('[master-finder] could not load conversion changes:', error);
        return empty;
    }
}
