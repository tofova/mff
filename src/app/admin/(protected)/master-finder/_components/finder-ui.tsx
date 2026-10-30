'use client';

// Small presentational helpers shared by the Master Finder components.

import { useEffect, useState } from 'react';
import { Loader2 } from 'lucide-react';
import { Badge } from '@/components/ui/badge';
import type { FinderJob } from '@/lib/master-finder';
import type { ConversionBatch } from '@/lib/master-finder-convert';

export const fmtInt = (n: number) => n.toLocaleString('en-IN');

export function shortId(id: string): string {
    return id.length > 12 ? `${id.slice(0, 6)}…${id.slice(-4)}` : id;
}

export function fmtDuration(ms: number): string {
    if (ms < 1000) return `${ms} ms`;
    const s = Math.round(ms / 1000);
    if (s < 60) return `${s}s`;
    return `${Math.floor(s / 60)}m ${s % 60}s`;
}

export function truncate(text: string, max: number): string {
    return text.length > max ? `${text.slice(0, max - 1)}…` : text;
}

export const plural = (n: number, word: string, pluralWord = `${word}s`) => (n === 1 ? word : pluralWord);

/** Client-only date rendering, so server and first client paint agree. */
export function WhenIST({ iso }: { iso: string }) {
    const [mounted, setMounted] = useState(false);
    useEffect(() => setMounted(true), []);
    if (!mounted) return null;
    return (
        <span>
            {new Date(iso).toLocaleString('en-IN', {
                timeZone: 'Asia/Kolkata',
                day: '2-digit',
                month: 'short',
                hour: '2-digit',
                minute: '2-digit',
            })}
        </span>
    );
}

export function ScanStatusBadge({ status }: { status: FinderJob['status'] }) {
    switch (status) {
        case 'queued':
        case 'running':
            return (
                <Badge className="gap-1">
                    <Loader2 className="h-3 w-3 animate-spin" />
                    {status === 'queued' ? 'Starting' : 'Scanning'}
                </Badge>
            );
        case 'completed':
            return <Badge variant="secondary">Completed</Badge>;
        case 'cancelled':
            return <Badge variant="outline">Cancelled</Badge>;
        case 'failed':
            return <Badge variant="destructive">Failed</Badge>;
    }
}

export function conversionStateLabel(batch: ConversionBatch): { text: string; variant: 'default' | 'secondary' | 'destructive' | 'outline'; busy: boolean } {
    if (batch.status === 'running') return { text: 'Converting', variant: 'default', busy: true };
    if (batch.status === 'failed') return { text: 'Failed', variant: 'destructive', busy: false };
    if (batch.undo) {
        if (batch.undo.status === 'running') return { text: 'Undoing', variant: 'default', busy: true };
        if (batch.undo.status === 'failed') return { text: 'Undo failed', variant: 'destructive', busy: false };
        return batch.undo.skipped > 0
            ? { text: 'Partly undone', variant: 'outline', busy: false }
            : { text: 'Undone', variant: 'outline', busy: false };
    }
    return { text: 'Converted', variant: 'secondary', busy: false };
}

export function ConversionStatusBadge({ batch }: { batch: ConversionBatch }) {
    const state = conversionStateLabel(batch);
    return (
        <Badge variant={state.variant} className="gap-1">
            {state.busy && <Loader2 className="h-3 w-3 animate-spin" />}
            {state.text}
        </Badge>
    );
}

/** True when this batch still has something that can be undone. */
export function canUndo(batch: ConversionBatch): boolean {
    if (batch.status === 'running') return false;
    if (batch.counts.changed === 0) return false;
    if (!batch.undo) return true;
    return batch.undo.status === 'failed';
}

/** "reason × n" list for skipped / protected breakdowns. */
export function ReasonList({ reasons, className }: { reasons: Record<string, number>; className?: string }) {
    const entries = Object.entries(reasons).sort((a, b) => b[1] - a[1]);
    if (entries.length === 0) return null;
    return (
        <ul className={className ?? 'list-disc pl-5 text-xs text-muted-foreground'}>
            {entries.map(([reason, n]) => (
                <li key={reason}>
                    {reason} × {fmtInt(n)}
                </li>
            ))}
        </ul>
    );
}
