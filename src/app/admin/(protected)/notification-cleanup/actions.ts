'use server';

// ---------------------------------------------------------------------------
// Notification Cleanup — server actions.
//
// Thin, admin-gated wrappers around src/lib/notification-cleanup.ts. The
// deletion and the undo run in the background inside the server process; the
// client polls `getCleanup` for progress.
//
// Self-contained: this folder plus that lib file implement the whole feature.
// The only pre-existing file touched is the admin sidebar (one link). Only the
// `notifications` collection is ever deleted from (plus a broadcast record the
// run has emptied), and every deleted document is backed up first.
// ---------------------------------------------------------------------------

import { isAdminAuthenticated } from '@/app/actions';
import { connectToDatabase } from '@/lib/mongodb';
import { revalidatePath, unstable_noStore as noStore } from 'next/cache';
import {
    createCleanup,
    discardCleanupBackup,
    getCleanupBatch,
    listCleanupBatches,
    listCleanupRows,
    planCleanup,
    runCleanup,
    runCleanupUndo,
    startCleanupUndo,
    type CleanupBatch,
    type CleanupPlan,
    type CleanupRowsPage,
} from '@/lib/notification-cleanup';

export async function getCleanupPlan(
    criteria: unknown,
    selection: unknown,
): Promise<{ success: boolean; plan?: CleanupPlan; message: string }> {
    noStore();
    if (!(await isAdminAuthenticated())) return { success: false, message: 'Unauthorized.' };
    try {
        const db = await connectToDatabase();
        const result = await planCleanup(db, criteria, selection);
        return result.ok ? { success: true, plan: result.plan, message: '' } : { success: false, message: result.message };
    } catch (error) {
        console.error('[notification-cleanup] could not plan:', error);
        return { success: false, message: 'Could not search. Please try again.' };
    }
}

export async function getCleanupRows(criteria: unknown, page: number): Promise<CleanupRowsPage> {
    noStore();
    const empty: CleanupRowsPage = { rows: [], total: 0, page: 1, pageSize: 50 };
    if (!(await isAdminAuthenticated())) return empty;
    try {
        const db = await connectToDatabase();
        return await listCleanupRows(db, criteria, page);
    } catch (error) {
        console.error('[notification-cleanup] could not list rows:', error);
        return empty;
    }
}

export async function startCleanup(
    criteria: unknown,
    selection: unknown,
): Promise<{ success: boolean; batchId?: string; total?: number; message: string }> {
    noStore();
    if (!(await isAdminAuthenticated())) return { success: false, message: 'Unauthorized.' };
    try {
        const db = await connectToDatabase();
        const created = await createCleanup(db, criteria, selection);
        if (!created.ok) return { success: false, message: created.message };

        // Fire-and-forget: progress is read back through getCleanup.
        runCleanup(db, created.batchId).catch((err) => console.error('[notification-cleanup] background run failed:', err));

        revalidatePath('/admin/users-notification');
        return { success: true, batchId: created.batchId, total: created.total, message: 'Deleting…' };
    } catch (error) {
        console.error('[notification-cleanup] could not start:', error);
        return { success: false, message: 'Could not start the cleanup. Please try again.' };
    }
}

export async function getCleanup(batchId: string): Promise<CleanupBatch | null> {
    noStore();
    if (!(await isAdminAuthenticated())) return null;
    try {
        const db = await connectToDatabase();
        return await getCleanupBatch(db, batchId);
    } catch (error) {
        console.error('[notification-cleanup] could not load batch:', error);
        return null;
    }
}

export async function undoCleanup(batchId: string): Promise<{ success: boolean; message: string }> {
    noStore();
    if (!(await isAdminAuthenticated())) return { success: false, message: 'Unauthorized.' };
    try {
        const db = await connectToDatabase();
        const started = await startCleanupUndo(db, batchId);
        if (!started.ok) return { success: false, message: started.message };

        runCleanupUndo(db, batchId).catch((err) => console.error('[notification-cleanup] background undo failed:', err));

        revalidatePath('/admin/users-notification');
        return { success: true, message: 'Undo started. The notifications are being put back.' };
    } catch (error) {
        console.error('[notification-cleanup] could not start undo:', error);
        return { success: false, message: 'Could not start the undo. Please try again.' };
    }
}

export async function discardBackup(batchId: string): Promise<{ success: boolean; message: string }> {
    noStore();
    if (!(await isAdminAuthenticated())) return { success: false, message: 'Unauthorized.' };
    try {
        const db = await connectToDatabase();
        const result = await discardCleanupBackup(db, batchId);
        return result.ok
            ? { success: true, message: `Backup discarded (${result.removed} copies removed). This cleanup can no longer be undone.` }
            : { success: false, message: result.message };
    } catch (error) {
        console.error('[notification-cleanup] could not discard backup:', error);
        return { success: false, message: 'Could not discard the backup. Please try again.' };
    }
}

export async function getRecentCleanups(): Promise<CleanupBatch[]> {
    noStore();
    if (!(await isAdminAuthenticated())) return [];
    try {
        const db = await connectToDatabase();
        return await listCleanupBatches(db, 20);
    } catch (error) {
        console.error('[notification-cleanup] could not list batches:', error);
        return [];
    }
}
