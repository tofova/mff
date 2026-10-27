/**
 * Shared constants and types for the admin "Send Coins to All Users" feature.
 *
 * Kept in a plain module (no 'use server' / 'use client' directive) so the
 * server library (src/lib/bulk-coin-gift.ts), the server actions and the client
 * card can all import from it: a 'use server' file may only export async
 * functions, and a client component must never import the server library.
 */

export const BULK_COIN_RULES = {
    minAmount: 1,
    maxAmount: 1_000_000,
    maxMessageLength: 500,
    /** Users credited per database round-trip. */
    chunkSize: 500,
    /** A run that has reported no progress for this long counts as interrupted. */
    staleAfterMs: 2 * 60 * 1000,
    /** How many past runs the admin card lists. */
    historyLimit: 10,
} as const;

/**
 * Default bell/push text. `{amount}` is replaced with the number of coins when
 * the run is created, so the admin can keep the placeholder in a custom text too.
 */
export const DEFAULT_BULK_COIN_MESSAGE = '🎉 Good news! {amount} free coins have been added to your account. Enjoy!';

export type BulkCoinRunStatus = 'sending' | 'completed' | 'failed';

/** Who would receive coins right now. */
export interface BulkCoinAudience {
    /** Users who will be credited: every profile that is neither banned nor hidden. */
    eligible: number;
    banned: number;
    hidden: number;
    total: number;
}

/** A run as shown in the admin card (JSON-safe: ids as strings, dates as ISO strings). */
export interface BulkCoinRunView {
    id: string;
    amount: number;
    status: BulkCoinRunStatus;
    createdAt: string;
    updatedAt: string;
    completedAt?: string;
    /** Eligible users when the run started. */
    targetUsers: number;
    /** Users whose balance has been increased so far. */
    creditedUsers: number;
    /** Bell notifications created so far. */
    notifiedUsers: number;
    /** amount × creditedUsers */
    totalCoins: number;
    notify: boolean;
    message?: string;
    imageUrl?: string;
    isPopup: boolean;
    /** The broadcast_notifications document that tracks push delivery, when notify is on. */
    broadcastId?: string;
    pushTargets?: number;
    resumedCount: number;
    error?: string;
    /** Still marked 'sending' but silent for a while: the server most likely restarted mid-run. */
    isInterrupted: boolean;
    /** Failed or interrupted runs can be continued from where they stopped. */
    canResume: boolean;
    /** 0–100, based on creditedUsers / targetUsers. */
    percent: number;
}
