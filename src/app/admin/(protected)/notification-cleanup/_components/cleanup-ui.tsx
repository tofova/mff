'use client';

// Small presentational helpers shared by the Notification Cleanup components.

import { useEffect, useState } from 'react';
import { Loader2 } from 'lucide-react';
import { Badge } from '@/components/ui/badge';
import type { CleanupBatch, CleanupCriteria } from '@/lib/notification-cleanup';

export const fmtInt = (n: number) => n.toLocaleString('en-IN');
export const plural = (n: number, word: string, pluralWord = `${word}s`) => (n === 1 ? word : pluralWord);
export const truncate = (text: string, max: number) => (text.length > max ? `${text.slice(0, max - 1)}…` : text);

const IST: Intl.DateTimeFormatOptions = { timeZone: 'Asia/Kolkata', day: '2-digit', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' };

/** Client-only date rendering, so server and first client paint agree. */
export function WhenIST({ iso, withYear = false }: { iso: string; withYear?: boolean }) {
    const [mounted, setMounted] = useState(false);
    useEffect(() => setMounted(true), []);
    if (!mounted) return null;
    const opts = withYear ? IST : { ...IST, year: undefined };
    return <span>{new Date(iso).toLocaleString('en-IN', opts)}</span>;
}

/** Human summary of what a batch searched for. */
export function criteriaSummary(c: CleanupCriteria): string {
    const parts: string[] = [];
    if (c.text) parts.push(`${c.mode === 'link' ? 'link' : 'text'} “${truncate(c.text, 70)}”${c.ignoreCase ? ' (any case)' : ''}`);
    if (c.gamingId) parts.push(`UID ${c.gamingId}`);
    if (c.startLocal || c.endLocal) parts.push(`${c.startLocal ? `from ${c.startLocal.replace('T', ' ')}` : ''}${c.startLocal && c.endLocal ? ' ' : ''}${c.endLocal ? `to ${c.endLocal.replace('T', ' ')}` : ''} IST`);
    if (c.unlinkedOnly) parts.push('only unlinked');
    return parts.join(' · ');
}

export type BackupState = 'kept' | 'expired' | 'discarded' | 'restored' | 'none';

export function backupState(b: CleanupBatch): BackupState {
    if (b.counts.deleted === 0) return 'none';
    if (b.undo?.status === 'done') return 'restored';
    if (b.backupDiscardedAt) return 'discarded';
    if (b.backupRemaining === 0) return 'expired';
    return 'kept';
}

export function CleanupStatusBadge({ batch }: { batch: CleanupBatch }) {
    if (batch.status === 'running') {
        return <Badge className="gap-1"><Loader2 className="h-3 w-3 animate-spin" /> Deleting</Badge>;
    }
    if (batch.status === 'failed') return <Badge variant="destructive">Failed</Badge>;
    if (batch.undo) {
        if (batch.undo.status === 'running') return <Badge className="gap-1"><Loader2 className="h-3 w-3 animate-spin" /> Undoing</Badge>;
        if (batch.undo.status === 'failed') return <Badge variant="destructive">Undo failed</Badge>;
        return <Badge variant="outline">Undone</Badge>;
    }
    return <Badge variant="secondary">Deleted</Badge>;
}

export function isBatchBusy(batch: CleanupBatch | null): boolean {
    return !!batch && (batch.status === 'running' || batch.undo?.status === 'running');
}

/** "reason × n" list. */
export function ReasonList({ reasons, className }: { reasons: Record<string, number>; className?: string }) {
    const entries = Object.entries(reasons).sort((a, b) => b[1] - a[1]);
    if (entries.length === 0) return null;
    return (
        <ul className={className ?? 'list-disc pl-5 text-xs text-muted-foreground'}>
            {entries.map(([reason, n]) => (
                <li key={reason}>{reason} × {fmtInt(n)}</li>
            ))}
        </ul>
    );
}
