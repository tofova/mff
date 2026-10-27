'use server';

/**
 * Server actions for the admin "Send Coins to All Users" card.
 *
 * Thin layer: admin check + input validation here, all database work in
 * src/lib/bulk-coin-gift.ts. Lives next to the coin-management page like the
 * other admin sections' `actions.ts` files; the existing single-user
 * `addCoinsToUser` action in src/app/actions.ts is not touched.
 */

import { z } from 'zod';
import { revalidatePath, unstable_noStore as noStore } from 'next/cache';
import { isAdminAuthenticated } from '@/app/actions';
import { connectToDatabase } from '@/lib/mongodb';
import { isSafeHttpUrl, MEDIA_URL_ERROR } from '@/lib/media-urls';
import {
    createBulkCoinRun,
    findActiveBulkCoinRun,
    getBulkCoinAudience,
    getBulkCoinRunById,
    listBulkCoinRuns,
    processBulkCoinRun,
    resumeBulkCoinRun,
    toBulkCoinRunView,
} from '@/lib/bulk-coin-gift';
import { BULK_COIN_RULES, type BulkCoinAudience, type BulkCoinRunView } from '@/lib/bulk-coin-gift-shared';

export interface BulkCoinOverview {
    audience: BulkCoinAudience;
    /** Most recent runs first. */
    history: BulkCoinRunView[];
    /** The run currently crediting users, if any (so a reloaded page can keep showing progress). */
    activeRunId: string | null;
}

export type BulkCoinOverviewResult = { success: true; overview: BulkCoinOverview } | { success: false; message: string };
export type BulkCoinRunActionResult = { success: true; message: string; run: BulkCoinRunView } | { success: false; message: string };

const startSchema = z.object({
    amount: z.coerce
        .number({ invalid_type_error: 'Enter the number of coins.' })
        .int('Coins must be a whole number.')
        .min(BULK_COIN_RULES.minAmount, `Send at least ${BULK_COIN_RULES.minAmount} coin.`)
        .max(BULK_COIN_RULES.maxAmount, `You can send at most ${BULK_COIN_RULES.maxAmount.toLocaleString('en-IN')} coins per user.`),
    notify: z.enum(['on', 'off']).optional(),
    message: z.string().trim().max(BULK_COIN_RULES.maxMessageLength, `Keep the message under ${BULK_COIN_RULES.maxMessageLength} characters.`).optional().or(z.literal('')),
    imageUrl: z.string().trim().refine(isSafeHttpUrl, MEDIA_URL_ERROR).optional().or(z.literal('')),
    isPopup: z.enum(['on', 'off']).optional(),
});

/** Audience counts, recent runs and the active run (for the card's first load and refreshes). */
export async function getBulkCoinOverview(): Promise<BulkCoinOverviewResult> {
    noStore();
    if (!(await isAdminAuthenticated())) return { success: false, message: 'Unauthorized.' };
    try {
        const db = await connectToDatabase();
        const [audience, runs, active] = await Promise.all([getBulkCoinAudience(db), listBulkCoinRuns(db), findActiveBulkCoinRun(db)]);
        const now = Date.now();
        return {
            success: true,
            overview: {
                audience,
                history: runs.map((run) => toBulkCoinRunView(run, now)),
                activeRunId: active ? active._id.toString() : null,
            },
        };
    } catch (error) {
        console.error('[BulkCoins] overview failed:', error);
        return { success: false, message: 'Could not load the bulk coin overview.' };
    }
}

/** One run, for progress polling. */
export async function getBulkCoinRun(runId: string): Promise<BulkCoinRunActionResult> {
    noStore();
    if (!(await isAdminAuthenticated())) return { success: false, message: 'Unauthorized.' };
    try {
        const db = await connectToDatabase();
        const run = await getBulkCoinRunById(db, runId);
        if (!run) return { success: false, message: 'Run not found.' };
        return { success: true, message: '', run: toBulkCoinRunView(run) };
    } catch (error) {
        console.error('[BulkCoins] run lookup failed:', error);
        return { success: false, message: 'Could not load the run.' };
    }
}

/**
 * Starts a new run: validates the form, creates the run record and credits the
 * users in the background. The card polls `getBulkCoinRun` for progress.
 */
export async function startBulkCoinSend(formData: FormData): Promise<BulkCoinRunActionResult> {
    if (!(await isAdminAuthenticated())) return { success: false, message: 'Unauthorized.' };

    const parsed = startSchema.safeParse(Object.fromEntries(formData.entries()));
    if (!parsed.success) {
        return { success: false, message: parsed.error.issues[0]?.message ?? 'Invalid data.' };
    }
    const { amount, notify, message, imageUrl, isPopup } = parsed.data;

    try {
        const db = await connectToDatabase();
        const created = await createBulkCoinRun(db, {
            amount,
            notify: notify === 'on',
            message: message || undefined,
            imageUrl: imageUrl || undefined,
            isPopup: isPopup === 'on',
        });
        if (!created.ok) return { success: false, message: created.reason };

        // Fire and forget (same pattern as the notification broadcast's push
        // delivery): crediting runs in bounded chunks and reports progress to the
        // run record, which the card polls. processBulkCoinRun never throws.
        processBulkCoinRun(db, created.run._id).catch((error) =>
            console.error(`[BulkCoins ${created.run._id}] background run failed:`, error),
        );

        revalidatePath('/admin/coin-management');
        revalidatePath('/');
        return {
            success: true,
            message: `Sending ${amount.toLocaleString('en-IN')} coins to ${created.run.targetUsers.toLocaleString('en-IN')} users…`,
            run: toBulkCoinRunView(created.run),
        };
    } catch (error) {
        console.error('[BulkCoins] start failed:', error);
        return { success: false, message: 'Could not start the bulk coin send. Check the server logs.' };
    }
}

/** Continues a failed or interrupted run from where it stopped (nobody is credited twice). */
export async function resumeBulkCoinSend(runId: string): Promise<BulkCoinRunActionResult> {
    if (!(await isAdminAuthenticated())) return { success: false, message: 'Unauthorized.' };
    try {
        const db = await connectToDatabase();
        const resumed = await resumeBulkCoinRun(db, String(runId ?? ''));
        if (!resumed.ok) return { success: false, message: resumed.reason };

        processBulkCoinRun(db, resumed.run._id).catch((error) =>
            console.error(`[BulkCoins ${resumed.run._id}] background resume failed:`, error),
        );

        revalidatePath('/admin/coin-management');
        revalidatePath('/');
        return { success: true, message: 'Resumed. Continuing from where it stopped…', run: toBulkCoinRunView(resumed.run) };
    } catch (error) {
        console.error('[BulkCoins] resume failed:', error);
        return { success: false, message: 'Could not resume the bulk coin send. Check the server logs.' };
    }
}
