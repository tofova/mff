/**
 * Bulk coin gift — "Send Coins to All Users" (server-only).
 *
 * Used by the admin Coin Management section to credit the same number of coins
 * to every eligible user at once (event giveaways). The feature is additive:
 * this file, src/lib/bulk-coin-gift-shared.ts and the two files next to the
 * coin-management page implement all of it; the single-user "Add Coins" action
 * (`addCoinsToUser` in src/app/actions.ts) is untouched.
 *
 * Who is eligible: every document in `users` except banned (`isBanned: true`)
 * and hidden (`isHidden: true`) profiles — the same audience as the existing
 * "Send to All Users" notification broadcast.
 *
 * How a run works:
 *   1. A `coin_broadcasts` document is created with status 'sending'. It is the
 *      run's progress record and its permanent audit trail (amount, counts,
 *      timestamps, who was excluded). At most one run can be 'sending' at a time
 *      (enforced by a unique partial index, so two admin tabs cannot double-send).
 *   2. The audience is frozen at start (`maxId` = newest user `_id`): profiles
 *      created while the run is in progress are not included.
 *   3. Users are processed in `_id` order in chunks of BULK_COIN_RULES.chunkSize.
 *      Each chunk is credited with ONE updateMany({$inc: {coins}}) — the same
 *      operation the single-user "Add Coins" button uses — and every credited
 *      user document is tagged with the run id (`bulkCoinGiftId`). The tag makes
 *      crediting exactly-once: a user already tagged by this run is never
 *      credited again, even if the run is resumed after a crash.
 *   4. Optionally one bell notification per user is inserted per chunk, linked to
 *      a `broadcast_notifications` document exactly like the notification
 *      broadcast creates, so the gift also shows up in Users Notification →
 *      Broadcasts with live push progress. Push delivery reuses the existing
 *      batched sender once all users are credited.
 *   5. After every chunk the record stores the last processed `_id` and a
 *      heartbeat (`updatedAt`). A run that dies half way (server restart,
 *      database hiccup) is detected as interrupted and can be RESUMED from where
 *      it stopped instead of crediting everyone twice.
 *
 * Server logs are prefixed with `[BulkCoins <runId>]`; completion and failure
 * are also reported to the admin on Telegram (best effort).
 */

import { ObjectId, type Collection, type Filter } from 'mongodb';
import type { MongoDbWithClient } from '@/lib/mongodb';
import type { BroadcastNotification, Notification, User } from '@/lib/definitions';
import { sendTelegramAlert } from '@/lib/telegram';
import { sendBatchedPushNotifications } from '@/lib/broadcast-push-notifications';
import {
    BULK_COIN_RULES,
    DEFAULT_BULK_COIN_MESSAGE,
    type BulkCoinAudience,
    type BulkCoinRunStatus,
    type BulkCoinRunView,
} from '@/lib/bulk-coin-gift-shared';

export const COIN_BROADCASTS_COLLECTION = 'coin_broadcasts';
/** `type` value written on the bell notifications created by a run. */
export const BULK_COIN_NOTIFICATION_TYPE = 'bulk_coin_gift';

/** One "send coins to all users" run (collection `coin_broadcasts`). */
export interface CoinBroadcast {
    _id: ObjectId;
    amount: number;
    status: BulkCoinRunStatus;
    createdAt: Date;
    updatedAt: Date;
    completedAt?: Date;
    /** Eligible users when the run started. */
    targetUsers: number;
    excludedBanned: number;
    excludedHidden: number;
    /** Users credited so far (made exact from the tags when the run completes). */
    creditedUsers: number;
    /** Bell notifications inserted so far. */
    notifiedUsers: number;
    notify: boolean;
    /** Final notification text (placeholder already replaced). Set only when notify is on. */
    message?: string;
    imageUrl?: string;
    isPopup: boolean;
    /** Linked broadcast_notifications document (push progress). Set only when notify is on. */
    broadcastId?: string;
    pushTargets?: number;
    /** Newest user `_id` when the run started: the frozen upper bound of the audience. */
    maxId: ObjectId;
    /** Last processed user `_id`: the resume point. */
    cursorAfterId?: ObjectId;
    resumedCount: number;
    error?: string;
}

/** The user fields this feature reads or writes: `User` plus the run tag it adds. */
type GiftUser = User & { bulkCoinGiftId?: string };

export interface BulkCoinSendInput {
    amount: number;
    notify: boolean;
    message?: string;
    imageUrl?: string;
    isPopup?: boolean;
}

export type BulkCoinRunResult = { ok: true; run: CoinBroadcast } | { ok: false; reason: string };

type Db = MongoDbWithClient;

const INTERRUPTED_MESSAGE = 'Interrupted: no progress for 2 minutes (server restarted?). Use Resume to continue from where it stopped.';

function eligibleFilter(): Filter<GiftUser> {
    return { isBanned: { $ne: true }, isHidden: { $ne: true } };
}

/** Every BSON number type `$inc` can work on (the driver's Filter type has no 'number' alias). */
const NUMERIC_COINS: Filter<GiftUser>[] = [
    { coins: { $type: 'int' } },
    { coins: { $type: 'long' } },
    { coins: { $type: 'double' } },
    { coins: { $type: 'decimal' } },
];

/** The bell notification one user gets from a run. */
function buildNotification(run: CoinBroadcast, gamingId: string, createdAt: Date): Omit<Notification, '_id'> {
    return {
        gamingId,
        message: run.message as string,
        ...(run.imageUrl ? { imageUrl: run.imageUrl } : {}),
        isRead: false,
        createdAt,
        isPopup: run.isPopup,
        ...(run.broadcastId ? { broadcastId: run.broadcastId } : {}),
        type: BULK_COIN_NOTIFICATION_TYPE,
    };
}

function log(runId: ObjectId | string, text: string): void {
    console.log(`[BulkCoins ${runId}] ${text}`);
}

function istNow(): string {
    return new Date().toLocaleString('en-IN', { timeZone: 'Asia/Kolkata', dateStyle: 'medium', timeStyle: 'short' });
}

function isDuplicateKeyError(error: unknown): boolean {
    return typeof error === 'object' && error !== null && (error as { code?: number }).code === 11000;
}

/** Best effort: a failed alert is logged, never thrown. */
async function alertAdmin(text: string): Promise<void> {
    const result = await sendTelegramAlert(text);
    if (!result.ok) console.error('[BulkCoins] Telegram alert not delivered:', result.reason);
}

let indexesReady: Promise<void> | undefined;

/** The runs collection, with its indexes created once per process. */
async function runsCollection(db: Db): Promise<Collection<CoinBroadcast>> {
    const col = db.collection<CoinBroadcast>(COIN_BROADCASTS_COLLECTION);
    if (!indexesReady) {
        indexesReady = Promise.all([
            // At most one run may be 'sending' at any moment, even if two admin
            // tabs click "send" at the same time.
            col.createIndex({ status: 1 }, { unique: true, partialFilterExpression: { status: 'sending' }, name: 'one_sending_run' }),
            col.createIndex({ createdAt: -1 }, { name: 'created_desc' }),
        ])
            .then(() => undefined)
            .catch((error) => {
                indexesReady = undefined;
                throw error;
            });
    }
    await indexesReady;
    return col;
}

/** Replaces `{amount}` in the admin's text (or the default text) with the coin amount. */
export function formatGiftMessage(template: string | undefined, amount: number): string {
    const base = (template ?? '').trim() || DEFAULT_BULK_COIN_MESSAGE;
    return base.replace(/\{amount\}/gi, amount.toLocaleString('en-IN'));
}

/** Counts who would receive coins right now. */
export async function getBulkCoinAudience(db: Db): Promise<BulkCoinAudience> {
    const users = db.collection<GiftUser>('users');
    const [total, banned, hidden, eligible] = await Promise.all([
        users.countDocuments({}),
        users.countDocuments({ isBanned: true }),
        users.countDocuments({ isHidden: true }),
        users.countDocuments(eligibleFilter()),
    ]);
    return { total, banned, hidden, eligible };
}

/** 'sending' but silent for longer than the heartbeat window: the process died mid-run. */
export function isRunInterrupted(run: Pick<CoinBroadcast, 'status' | 'updatedAt'>, now: number = Date.now()): boolean {
    return run.status === 'sending' && now - run.updatedAt.getTime() > BULK_COIN_RULES.staleAfterMs;
}

/** The run currently in progress (still reporting progress), if any. */
export async function findActiveBulkCoinRun(db: Db): Promise<CoinBroadcast | null> {
    const runs = await runsCollection(db);
    const since = new Date(Date.now() - BULK_COIN_RULES.staleAfterMs);
    return runs.findOne({ status: 'sending', updatedAt: { $gte: since } }, { sort: { createdAt: -1 } });
}

/**
 * Marks silent 'sending' runs as failed (resumable) so they neither block new
 * runs nor look alive forever. `keepId` is left alone (it is about to be resumed).
 */
async function failInterruptedRuns(db: Db, keepId?: ObjectId): Promise<void> {
    const runs = await runsCollection(db);
    const filter: Filter<CoinBroadcast> = { status: 'sending', updatedAt: { $lt: new Date(Date.now() - BULK_COIN_RULES.staleAfterMs) } };
    if (keepId) filter._id = { $ne: keepId };
    const result = await runs.updateMany(filter, { $set: { status: 'failed', error: INTERRUPTED_MESSAGE, updatedAt: new Date() } });
    if (result.modifiedCount > 0) console.warn(`[BulkCoins] marked ${result.modifiedCount} interrupted run(s) as failed (resumable).`);
}

export async function listBulkCoinRuns(db: Db, limit: number = BULK_COIN_RULES.historyLimit): Promise<CoinBroadcast[]> {
    const runs = await runsCollection(db);
    return runs.find({}).sort({ createdAt: -1 }).limit(limit).toArray();
}

export async function getBulkCoinRunById(db: Db, runId: string): Promise<CoinBroadcast | null> {
    if (!ObjectId.isValid(runId)) return null;
    const runs = await runsCollection(db);
    return runs.findOne({ _id: new ObjectId(runId) });
}

/** JSON-safe view of a run for the admin card. */
export function toBulkCoinRunView(run: CoinBroadcast, now: number = Date.now()): BulkCoinRunView {
    const interrupted = isRunInterrupted(run, now);
    const denominator = Math.max(run.targetUsers, run.creditedUsers);
    let percent = denominator > 0 ? Math.round((run.creditedUsers / denominator) * 100) : 0;
    if (run.status === 'completed') percent = 100;
    return {
        id: run._id.toString(),
        amount: run.amount,
        status: run.status,
        createdAt: run.createdAt.toISOString(),
        updatedAt: run.updatedAt.toISOString(),
        completedAt: run.completedAt?.toISOString(),
        targetUsers: run.targetUsers,
        creditedUsers: run.creditedUsers,
        notifiedUsers: run.notifiedUsers,
        totalCoins: run.amount * run.creditedUsers,
        notify: run.notify,
        message: run.message,
        imageUrl: run.imageUrl,
        isPopup: run.isPopup,
        broadcastId: run.broadcastId,
        pushTargets: run.pushTargets,
        resumedCount: run.resumedCount ?? 0,
        error: run.error,
        isInterrupted: interrupted,
        canResume: run.status === 'failed' || interrupted,
        percent: Math.min(100, Math.max(0, percent)),
    };
}

/**
 * Creates the run record (status 'sending') and, when notify is on, the linked
 * broadcast document. Nothing is credited yet: call `processBulkCoinRun` next.
 */
export async function createBulkCoinRun(db: Db, input: BulkCoinSendInput): Promise<BulkCoinRunResult> {
    const amount = Math.floor(Number(input.amount));
    if (!Number.isFinite(amount) || amount < BULK_COIN_RULES.minAmount || amount > BULK_COIN_RULES.maxAmount) {
        return { ok: false, reason: `Amount must be a whole number between ${BULK_COIN_RULES.minAmount} and ${BULK_COIN_RULES.maxAmount.toLocaleString('en-IN')}.` };
    }

    const runs = await runsCollection(db);
    await failInterruptedRuns(db);
    if (await findActiveBulkCoinRun(db)) {
        return { ok: false, reason: 'A bulk coin send is already in progress. Wait for it to finish.' };
    }

    const users = db.collection<GiftUser>('users');
    const audience = await getBulkCoinAudience(db);
    if (audience.eligible === 0) return { ok: false, reason: 'There are no eligible users to send coins to.' };
    const newest = await users.find({}, { projection: { _id: 1 }, sort: { _id: -1 }, limit: 1 }).next();
    if (!newest) return { ok: false, reason: 'There are no users yet.' };

    const now = new Date();
    const notify = !!input.notify;
    const message = notify ? formatGiftMessage(input.message, amount) : undefined;
    const imageUrl = notify && input.imageUrl?.trim() ? input.imageUrl.trim() : undefined;
    const run: CoinBroadcast = {
        _id: new ObjectId(),
        amount,
        status: 'sending',
        createdAt: now,
        updatedAt: now,
        targetUsers: audience.eligible,
        excludedBanned: audience.banned,
        excludedHidden: audience.hidden,
        creditedUsers: 0,
        notifiedUsers: 0,
        notify,
        ...(message ? { message } : {}),
        ...(imageUrl ? { imageUrl } : {}),
        isPopup: notify && !!input.isPopup,
        maxId: newest._id,
        resumedCount: 0,
    };

    try {
        await runs.insertOne(run);
    } catch (error) {
        if (isDuplicateKeyError(error)) return { ok: false, reason: 'A bulk coin send is already in progress. Wait for it to finish.' };
        throw error;
    }

    if (notify && message) {
        try {
            // Same shape as the document `sendNotificationToAll` creates, so the
            // gift is listed in Users Notification → Broadcasts with push progress.
            const broadcast: Omit<BroadcastNotification, '_id'> = {
                message,
                imageUrl,
                isPopup: run.isPopup,
                createdAt: now,
                totalUsers: audience.eligible,
                pushTotal: 0,
                pushSent: 0,
                pushFailed: 0,
                status: 'sending',
            };
            const inserted = await db.collection<BroadcastNotification>('broadcast_notifications').insertOne(broadcast as BroadcastNotification);
            run.broadcastId = inserted.insertedId.toString();
            await runs.updateOne({ _id: run._id }, { $set: { broadcastId: run.broadcastId } });
        } catch (error) {
            await runs.deleteOne({ _id: run._id }).catch(() => undefined);
            throw error;
        }
    }

    log(run._id, `created: ${amount} coins × ${audience.eligible} users (skipping ${audience.banned} banned, ${audience.hidden} hidden), notify=${notify}`);
    return { ok: true, run };
}

/**
 * Puts a failed or interrupted run back to 'sending' so `processBulkCoinRun` can
 * continue it. Users already credited by the run are never credited again.
 */
export async function resumeBulkCoinRun(db: Db, runId: string): Promise<BulkCoinRunResult> {
    if (!ObjectId.isValid(runId)) return { ok: false, reason: 'Invalid run id.' };
    const runs = await runsCollection(db);
    const id = new ObjectId(runId);
    const run = await runs.findOne({ _id: id });
    if (!run) return { ok: false, reason: 'Run not found.' };
    if (run.status === 'completed') return { ok: false, reason: 'This send already completed.' };
    if (run.status === 'sending' && !isRunInterrupted(run)) return { ok: false, reason: 'This send is still running.' };

    await failInterruptedRuns(db, id);
    const active = await findActiveBulkCoinRun(db);
    if (active && !active._id.equals(id)) return { ok: false, reason: 'Another bulk coin send is in progress. Wait for it to finish.' };

    try {
        const updated = await runs.findOneAndUpdate(
            { _id: id, status: run.status },
            { $set: { status: 'sending', updatedAt: new Date() }, $unset: { error: '' }, $inc: { resumedCount: 1 } },
            { returnDocument: 'after' },
        );
        if (!updated) return { ok: false, reason: 'The run changed in the meantime. Refresh and try again.' };
        log(id, `resumed (attempt ${updated.resumedCount}) from ${updated.creditedUsers} credited users`);
        return { ok: true, run: updated };
    } catch (error) {
        if (isDuplicateKeyError(error)) return { ok: false, reason: 'Another bulk coin send is in progress. Wait for it to finish.' };
        throw error;
    }
}

/**
 * Credits one chunk of users. Returns how many balances were increased.
 * The run tag in the filter makes this safe to repeat after a crash.
 */
async function creditChunk(users: Collection<GiftUser>, ids: ObjectId[], amount: number, tag: string): Promise<number> {
    // Fast path: `$inc` on numeric (or absent) balances — identical to the
    // single-user "Add Coins" action.
    const fast = await users.updateMany(
        { _id: { $in: ids }, bulkCoinGiftId: { $ne: tag }, $or: [...NUMERIC_COINS, { coins: { $exists: false } }] },
        { $inc: { coins: amount }, $set: { bulkCoinGiftId: tag } },
    );
    let credited = fast.modifiedCount;

    if (fast.matchedCount < ids.length) {
        // Safety net: a balance stored as null or text would make `$inc` throw and
        // abort the whole run. Rebuild such a balance as a number instead.
        const slow = await users.updateMany(
            { _id: { $in: ids }, bulkCoinGiftId: { $ne: tag }, coins: { $exists: true }, $nor: NUMERIC_COINS },
            [{ $set: { coins: { $add: [{ $convert: { input: '$coins', to: 'double', onError: 0, onNull: 0 } }, amount] }, bulkCoinGiftId: tag } }],
        );
        credited += slow.modifiedCount;
    }
    return credited;
}

/**
 * Credits every eligible user of the run, chunk by chunk, then finalizes it.
 * Safe to call again for a resumed run. Never throws: a failure is written to the
 * run record (status 'failed', `error`) and the admin is alerted.
 */
export async function processBulkCoinRun(db: Db, runId: ObjectId): Promise<CoinBroadcast | null> {
    const runs = await runsCollection(db);
    const users = db.collection<GiftUser>('users');
    const notifications = db.collection<Notification>('notifications');

    const run = await runs.findOne({ _id: runId });
    if (!run) return null;
    if (run.status !== 'sending') return run;

    const tag = run._id.toString();
    let cursorAfterId: ObjectId | undefined = run.cursorAfterId;
    let chunkNo = 0;

    try {
        for (;;) {
            const idRange = cursorAfterId ? { $gt: cursorAfterId, $lte: run.maxId } : { $lte: run.maxId };
            const chunk = await users
                .find(
                    { ...eligibleFilter(), _id: idRange, bulkCoinGiftId: { $ne: tag } },
                    { projection: { _id: 1, gamingId: 1 }, sort: { _id: 1 }, limit: BULK_COIN_RULES.chunkSize },
                )
                .toArray();
            if (chunk.length === 0) break;
            chunkNo++;

            const ids = chunk.map((u) => u._id);
            const credited = await creditChunk(users, ids, run.amount, tag);

            let notified = 0;
            if (run.notify && run.message) {
                const createdAt = new Date();
                const docs = chunk.map((u) => buildNotification(run, u.gamingId, createdAt));
                const inserted = await notifications.insertMany(docs as Notification[], { ordered: false });
                notified = inserted.insertedCount;
            }

            cursorAfterId = ids[ids.length - 1];
            await runs.updateOne(
                { _id: run._id },
                { $inc: { creditedUsers: credited, notifiedUsers: notified }, $set: { cursorAfterId, updatedAt: new Date() } },
            );
            log(run._id, `chunk ${chunkNo}: credited=${credited}, notified=${notified}`);
        }

        return await finalizeRun(db, run);
    } catch (error) {
        const reason = error instanceof Error ? error.message : String(error);
        console.error(`[BulkCoins ${run._id}] failed:`, error);
        await runs
            .updateOne({ _id: run._id }, { $set: { status: 'failed', error: `Stopped: ${reason}`, updatedAt: new Date() } })
            .catch((dbError) => console.error(`[BulkCoins ${run._id}] could not record the failure:`, dbError));
        const current = await runs.findOne({ _id: run._id }).catch(() => null);
        await alertAdmin(
            [
                '⚠️ Bulk coin gift STOPPED before finishing',
                `Amount: ${run.amount} coins per user`,
                `Credited so far: ${current?.creditedUsers ?? '?'} of ${run.targetUsers} users`,
                `Reason: ${reason}`,
                `Time: ${istNow()}`,
                '',
                'Open Admin → Coin Management and press Resume to continue; nobody is credited twice.',
            ].join('\n'),
        );
        return current;
    }
}

/**
 * Makes sure every credited user has their bell notification. Normally nothing
 * is missing; after an interruption between crediting a chunk and inserting its
 * notifications, the users of that chunk get theirs here, exactly once.
 * Returns the final notification count for the run.
 */
async function catchUpNotifications(db: Db, run: CoinBroadcast, creditedUsers: number): Promise<number> {
    const users = db.collection<GiftUser>('users');
    const notifications = db.collection<Notification>('notifications');
    const broadcastId = run.broadcastId as string;
    const tag = run._id.toString();

    const notified = await notifications.countDocuments({ broadcastId });
    if (notified >= creditedUsers) return notified;

    const already = new Set<string>(await notifications.distinct('gamingId', { broadcastId }));
    let batch: Omit<Notification, '_id'>[] = [];
    let added = 0;
    const flush = async () => {
        if (batch.length === 0) return;
        const inserted = await notifications.insertMany(batch as Notification[], { ordered: false });
        added += inserted.insertedCount;
        batch = [];
    };
    const createdAt = new Date();
    for await (const user of users.find({ bulkCoinGiftId: tag }, { projection: { gamingId: 1 } })) {
        if (already.has(user.gamingId)) continue;
        batch.push(buildNotification(run, user.gamingId, createdAt));
        if (batch.length >= BULK_COIN_RULES.chunkSize) await flush();
    }
    await flush();
    log(run._id, `notification catch-up: ${added} credited user(s) had no notification yet, added now`);
    return notifications.countDocuments({ broadcastId });
}

/** Exact final counts, push delivery hand-off and the completion alert. */
async function finalizeRun(db: Db, run: CoinBroadcast): Promise<CoinBroadcast | null> {
    const runs = await runsCollection(db);
    const users = db.collection<GiftUser>('users');
    const notifications = db.collection<Notification>('notifications');
    const tag = run._id.toString();

    // Count from the tags rather than the running total: exact even if a crash
    // happened between crediting a chunk and recording its count.
    const creditedUsers = await users.countDocuments({ bulkCoinGiftId: tag });
    const notifiedUsers = run.notify && run.message && run.broadcastId ? await catchUpNotifications(db, run, creditedUsers) : 0;

    let pushTargets = 0;
    if (run.notify && run.message && run.broadcastId) {
        const targets = await users
            .find({ bulkCoinGiftId: tag, fcmToken: { $type: 'string', $ne: '' } }, { projection: { gamingId: 1, fcmToken: 1 } })
            .toArray();
        const pairs = targets.filter((u) => !!u.fcmToken).map((u) => ({ token: u.fcmToken as string, gamingId: u.gamingId }));
        pushTargets = pairs.length;

        const broadcasts = db.collection<BroadcastNotification>('broadcast_notifications');
        const broadcastObjectId = new ObjectId(run.broadcastId);
        await broadcasts.updateOne({ _id: broadcastObjectId }, { $set: { totalUsers: creditedUsers, pushTotal: pushTargets } });
        if (pairs.length > 0) {
            // Fire and forget, exactly like the notification broadcast: progress is
            // written to broadcast_notifications and shown on the Users Notification page.
            sendBatchedPushNotifications(pairs, 'Garena Store', run.message, run.broadcastId, run.imageUrl).catch((error) =>
                console.error(`[BulkCoins ${run._id}] push delivery failed:`, error),
            );
        } else {
            await broadcasts.updateOne({ _id: broadcastObjectId }, { $set: { status: 'completed' } });
        }
    }

    const now = new Date();
    await runs.updateOne(
        { _id: run._id },
        { $set: { status: 'completed', completedAt: now, updatedAt: now, creditedUsers, notifiedUsers, pushTargets }, $unset: { error: '' } },
    );
    log(run._id, `completed: credited=${creditedUsers}, notified=${notifiedUsers}, pushTargets=${pushTargets}, totalCoins=${creditedUsers * run.amount}`);

    await alertAdmin(
        [
            '🪙 Bulk coin gift completed',
            `Amount: ${run.amount.toLocaleString('en-IN')} coins per user`,
            `Users credited: ${creditedUsers.toLocaleString('en-IN')} of ${run.targetUsers.toLocaleString('en-IN')} eligible`,
            `Total coins given: ${(creditedUsers * run.amount).toLocaleString('en-IN')}`,
            run.notify ? `Notification: bell for ${notifiedUsers.toLocaleString('en-IN')} users, push to ${pushTargets.toLocaleString('en-IN')} devices` : 'Notification: none',
            `Time: ${istNow()}`,
        ].join('\n'),
    );

    return runs.findOne({ _id: run._id });
}
