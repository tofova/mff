'use client';

// ---------------------------------------------------------------------------
// Notification Cleanup — recent cleanups, with Undo and Discard backup.
// ---------------------------------------------------------------------------

import { useState } from 'react';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import {
    AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription,
    AlertDialogFooter, AlertDialogHeader, AlertDialogTitle, AlertDialogTrigger,
} from '@/components/ui/alert-dialog';
import { History, Loader2, Trash2, Undo2 } from 'lucide-react';
import type { CleanupBatch } from '@/lib/notification-cleanup';
import { CleanupStatusBadge, ReasonList, WhenIST, backupState, criteriaSummary, fmtInt, plural } from './cleanup-ui';

interface CleanupHistoryProps {
    batches: CleanupBatch[];
    busy: boolean;
    currentId: string | null;
    onUndo: (batchId: string) => Promise<void>;
    onDiscard: (batchId: string) => Promise<void>;
}

export function BackupLine({ batch }: { batch: CleanupBatch }) {
    const state = backupState(batch);
    switch (state) {
        case 'kept':
            return (
                <span>
                    backup of {fmtInt(batch.backupRemaining)} {plural(batch.backupRemaining, 'copy', 'copies')} kept until <WhenIST iso={batch.backupExpiresAt} withYear />
                </span>
            );
        case 'expired':
            return <span>backup expired, cannot be undone any more</span>;
        case 'discarded':
            return <span>backup discarded, cannot be undone any more</span>;
        case 'restored':
            return <span>restored {fmtInt(batch.undo?.restored ?? 0)}{batch.undo && batch.undo.alreadyPresent > 0 ? ` (${fmtInt(batch.undo.alreadyPresent)} were already back)` : ''}{batch.undo && batch.undo.broadcastsRestored > 0 ? `, ${fmtInt(batch.undo.broadcastsRestored)} broadcast ${plural(batch.undo.broadcastsRestored, 'record')}` : ''}</span>;
        default:
            return null;
    }
}

export function UndoButton({ batch, busy, pending, onUndo, size = 'sm' }: { batch: CleanupBatch; busy: boolean; pending: boolean; onUndo: (id: string) => void; size?: 'sm' | 'default' }) {
    if (!batch.canUndo) return null;
    return (
        <AlertDialog>
            <AlertDialogTrigger asChild>
                <Button variant="outline" size={size} className={size === 'sm' ? 'h-7 text-xs' : ''} disabled={busy || pending}>
                    {pending ? <Loader2 className="mr-1 h-3 w-3 animate-spin" /> : <Undo2 className="mr-1 h-3 w-3" />}
                    Undo
                </Button>
            </AlertDialogTrigger>
            <AlertDialogContent>
                <AlertDialogHeader>
                    <AlertDialogTitle>Put the deleted notifications back?</AlertDialogTitle>
                    <AlertDialogDescription>
                        Restores the {fmtInt(batch.backupRemaining)} backed-up {plural(batch.backupRemaining, 'copy', 'copies')} of this cleanup
                        {batch.counts.broadcastsRemoved > 0 && <> and the {fmtInt(batch.counts.broadcastsRemoved)} broadcast {plural(batch.counts.broadcastsRemoved, 'record')}</>},
                        with their original ids, so users see them in their bell again.
                    </AlertDialogDescription>
                </AlertDialogHeader>
                <AlertDialogFooter>
                    <AlertDialogCancel>Cancel</AlertDialogCancel>
                    <AlertDialogAction onClick={() => onUndo(batch.id)}>Yes, restore</AlertDialogAction>
                </AlertDialogFooter>
            </AlertDialogContent>
        </AlertDialog>
    );
}

export function DiscardButton({ batch, busy, pending, onDiscard, size = 'sm' }: { batch: CleanupBatch; busy: boolean; pending: boolean; onDiscard: (id: string) => void; size?: 'sm' | 'default' }) {
    if (backupState(batch) !== 'kept' || batch.status === 'running' || batch.undo?.status === 'running') return null;
    return (
        <AlertDialog>
            <AlertDialogTrigger asChild>
                <Button variant="ghost" size={size} className={size === 'sm' ? 'h-7 text-xs text-destructive hover:text-destructive' : 'text-destructive hover:text-destructive'} disabled={busy || pending}>
                    {pending ? <Loader2 className="mr-1 h-3 w-3 animate-spin" /> : <Trash2 className="mr-1 h-3 w-3" />}
                    Discard backup
                </Button>
            </AlertDialogTrigger>
            <AlertDialogContent>
                <AlertDialogHeader>
                    <AlertDialogTitle>Discard the backup now?</AlertDialogTitle>
                    <AlertDialogDescription>
                        Permanently removes the {fmtInt(batch.backupRemaining)} backed-up {plural(batch.backupRemaining, 'copy', 'copies')} and frees that storage right away.
                        After this, the {fmtInt(batch.counts.deleted)} deleted {plural(batch.counts.deleted, 'notification')} cannot be brought back.
                    </AlertDialogDescription>
                </AlertDialogHeader>
                <AlertDialogFooter>
                    <AlertDialogCancel>Keep backup</AlertDialogCancel>
                    <AlertDialogAction onClick={() => onDiscard(batch.id)} className="bg-destructive text-destructive-foreground hover:bg-destructive/90">Discard permanently</AlertDialogAction>
                </AlertDialogFooter>
            </AlertDialogContent>
        </AlertDialog>
    );
}

export default function CleanupHistory({ batches, busy, currentId, onUndo, onDiscard }: CleanupHistoryProps) {
    const [pendingId, setPendingId] = useState<string | null>(null);
    if (batches.length === 0) return null;

    const wrap = (fn: (id: string) => Promise<void>) => async (id: string) => {
        setPendingId(id);
        try {
            await fn(id);
        } finally {
            setPendingId(null);
        }
    };
    const handleUndo = wrap(onUndo);
    const handleDiscard = wrap(onDiscard);

    return (
        <Card>
            <CardHeader className="pb-3">
                <CardTitle className="flex items-center gap-2 text-lg"><History className="h-5 w-5" /> Recent cleanups</CardTitle>
                <CardDescription>Each cleanup keeps a backup of what it deleted for 7 days, unless you discard it earlier.</CardDescription>
            </CardHeader>
            <CardContent>
                <ul className="divide-y">
                    {batches.map((b) => (
                        <li key={b.id} className="flex flex-wrap items-start justify-between gap-2 py-3 text-sm">
                            <div className="min-w-0 space-y-1">
                                <div className="flex flex-wrap items-center gap-2">
                                    <CleanupStatusBadge batch={b} />
                                    {b.id === currentId && <Badge variant="outline" className="font-normal">current</Badge>}
                                    <span className="text-xs text-muted-foreground"><WhenIST iso={b.createdAt} withYear /></span>
                                </div>
                                <p className="break-words text-xs">{criteriaSummary(b.criteria)}</p>
                                <p className="text-xs text-muted-foreground">
                                    {fmtInt(b.counts.deleted)} deleted
                                    {b.counts.skipped > 0 && <> · {fmtInt(b.counts.skipped)} skipped</>}
                                    {b.counts.broadcastsRemoved > 0 && <> · {fmtInt(b.counts.broadcastsRemoved)} broadcast {plural(b.counts.broadcastsRemoved, 'record')} removed</>}
                                    {' '}· <BackupLine batch={b} />
                                </p>
                                {b.status === 'failed' && b.error && <p className="text-xs text-destructive">{b.error}</p>}
                                {b.undo?.status === 'failed' && b.undo.error && <p className="text-xs text-destructive">Undo failed: {b.undo.error}</p>}
                                {b.counts.skipped > 0 && <ReasonList reasons={b.skippedReasons} />}
                            </div>
                            <div className="flex shrink-0 items-center gap-1">
                                <UndoButton batch={b} busy={busy} pending={pendingId === b.id} onUndo={handleUndo} />
                                <DiscardButton batch={b} busy={busy} pending={pendingId === b.id} onDiscard={handleDiscard} />
                            </div>
                        </li>
                    ))}
                </ul>
            </CardContent>
        </Card>
    );
}
