'use client';

// ---------------------------------------------------------------------------
// Master Finder — recent conversions, with Undo and a per-field change log.
// ---------------------------------------------------------------------------

import { useState } from 'react';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import {
    AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription,
    AlertDialogFooter, AlertDialogHeader, AlertDialogTitle, AlertDialogTrigger,
} from '@/components/ui/alert-dialog';
import { ChevronDown, ChevronUp, History, Loader2, Undo2 } from 'lucide-react';
import type { ConversionBatch, ConversionChangesPage } from '@/lib/master-finder-convert';
import { ConversionStatusBadge, ReasonList, WhenIST, canUndo, fmtInt, plural, shortId, truncate } from './finder-ui';

interface ConversionHistoryProps {
    conversions: ConversionBatch[];
    busy: boolean;
    currentJobId: string | null;
    onUndo: (batchId: string) => Promise<void>;
    loadChanges: (batchId: string, page: number) => Promise<ConversionChangesPage>;
}

const MODE_LABEL = { link: 'Link', sentence: 'Sentence', uid: 'UID' } as const;

export default function ConversionHistory({ conversions, busy, currentJobId, onUndo, loadChanges }: ConversionHistoryProps) {
    const [openId, setOpenId] = useState<string | null>(null);
    const [changes, setChanges] = useState<Record<string, ConversionChangesPage | null>>({});
    const [loadingId, setLoadingId] = useState<string | null>(null);
    const [undoingId, setUndoingId] = useState<string | null>(null);

    if (conversions.length === 0) return null;

    const toggle = async (batchId: string) => {
        if (openId === batchId) {
            setOpenId(null);
            return;
        }
        setOpenId(batchId);
        if (!changes[batchId]) {
            setLoadingId(batchId);
            try {
                const page = await loadChanges(batchId, 1);
                setChanges((prev) => ({ ...prev, [batchId]: page }));
            } finally {
                setLoadingId(null);
            }
        }
    };

    const loadMore = async (batchId: string) => {
        const current = changes[batchId];
        if (!current) return;
        setLoadingId(batchId);
        try {
            const next = await loadChanges(batchId, current.page + 1);
            setChanges((prev) => ({ ...prev, [batchId]: { ...next, rows: [...current.rows, ...next.rows] } }));
        } finally {
            setLoadingId(null);
        }
    };

    const handleUndo = async (batchId: string) => {
        setUndoingId(batchId);
        try {
            await onUndo(batchId);
            // The change log changes after an undo; drop the cached page.
            setChanges((prev) => ({ ...prev, [batchId]: null }));
        } finally {
            setUndoingId(null);
        }
    };

    return (
        <Card>
            <CardHeader className="pb-3">
                <CardTitle className="flex items-center gap-2 text-lg"><History className="h-5 w-5" /> Recent conversions</CardTitle>
                <CardDescription>Every conversion is kept with its old and new values, so it can be undone or checked later.</CardDescription>
            </CardHeader>
            <CardContent>
                <ul className="divide-y">
                    {conversions.map((b) => {
                        const page = changes[b.id];
                        const open = openId === b.id;
                        return (
                            <li key={b.id} className="py-3 text-sm">
                                <div className="flex flex-wrap items-start justify-between gap-2">
                                    <div className="min-w-0 space-y-1">
                                        <div className="flex flex-wrap items-center gap-2">
                                            <ConversionStatusBadge batch={b} />
                                            <span className="text-xs text-muted-foreground">{MODE_LABEL[b.mode]}</span>
                                            {b.jobId === currentJobId && <Badge variant="outline" className="font-normal">this scan</Badge>}
                                            <span className="text-xs text-muted-foreground"><WhenIST iso={b.createdAt} /></span>
                                        </div>
                                        <p className="break-all font-mono text-xs">
                                            {truncate(b.oldText, 90)} <span className="text-muted-foreground">→</span> {truncate(b.newText, 90)}
                                        </p>
                                        <p className="text-xs text-muted-foreground">
                                            {fmtInt(b.counts.changed)} {plural(b.counts.changed, 'field')} changed
                                            {b.counts.skipped > 0 && <> · {fmtInt(b.counts.skipped)} skipped</>}
                                            {b.undo?.status === 'done' && <> · {fmtInt(b.undo.restored)} restored{b.undo.skipped > 0 && <>, {fmtInt(b.undo.skipped)} left as they were</>}</>}
                                        </p>
                                    </div>
                                    <div className="flex shrink-0 items-center gap-1">
                                        {canUndo(b) && (
                                            <AlertDialog>
                                                <AlertDialogTrigger asChild>
                                                    <Button variant="outline" size="sm" className="h-7 text-xs" disabled={busy || undoingId === b.id}>
                                                        {undoingId === b.id ? <Loader2 className="mr-1 h-3 w-3 animate-spin" /> : <Undo2 className="mr-1 h-3 w-3" />}
                                                        Undo
                                                    </Button>
                                                </AlertDialogTrigger>
                                                <AlertDialogContent>
                                                    <AlertDialogHeader>
                                                        <AlertDialogTitle>Undo this conversion?</AlertDialogTitle>
                                                        <AlertDialogDescription>
                                                            Puts the old text back into the {fmtInt(b.counts.changed)} {plural(b.counts.changed, 'field')} that were changed.
                                                            A field edited again after the conversion is left alone and reported.
                                                        </AlertDialogDescription>
                                                    </AlertDialogHeader>
                                                    <AlertDialogFooter>
                                                        <AlertDialogCancel>Cancel</AlertDialogCancel>
                                                        <AlertDialogAction onClick={() => handleUndo(b.id)}>Yes, undo</AlertDialogAction>
                                                    </AlertDialogFooter>
                                                </AlertDialogContent>
                                            </AlertDialog>
                                        )}
                                        <Button variant="ghost" size="sm" className="h-7 text-xs" onClick={() => toggle(b.id)} disabled={b.counts.changed === 0}>
                                            {open ? <ChevronUp className="mr-1 h-3 w-3" /> : <ChevronDown className="mr-1 h-3 w-3" />}
                                            {open ? 'Hide changes' : 'Show changes'}
                                        </Button>
                                    </div>
                                </div>

                                {b.status === 'failed' && b.error && <p className="mt-1 text-xs text-destructive">{b.error}</p>}
                                {b.counts.skipped > 0 && open && <ReasonList reasons={b.skippedReasons} className="mt-1 list-disc pl-5 text-xs text-muted-foreground" />}

                                {open && (
                                    <div className="mt-2 space-y-1.5">
                                        {loadingId === b.id && !page && (
                                            <p className="flex items-center gap-2 text-xs text-muted-foreground"><Loader2 className="h-3 w-3 animate-spin" /> Loading changes…</p>
                                        )}
                                        {page?.rows.map((c) => (
                                            <div key={c.id} className="rounded border bg-muted/30 p-2 text-xs">
                                                <div className="flex flex-wrap items-center gap-2">
                                                    <Badge variant="outline" className="font-mono">{c.collection}</Badge>
                                                    <span className="font-medium">{c.label}</span>
                                                    <span className="font-mono text-muted-foreground" title={c.docId}>{shortId(c.docId)} · {c.path}</span>
                                                    {c.occurrences > 1 && <span className="text-muted-foreground">× {c.occurrences}</span>}
                                                    {c.undone ? (
                                                        <Badge variant="outline" className="font-normal">restored</Badge>
                                                    ) : c.undoSkippedReason ? (
                                                        <Badge variant="outline" className="border-amber-400 font-normal text-amber-700">undo skipped: {c.undoSkippedReason}</Badge>
                                                    ) : null}
                                                </div>
                                                <p className="mt-1 break-all font-mono">
                                                    <span className="text-muted-foreground">old: </span>{truncate(c.oldValue, 200)}
                                                </p>
                                                <p className="break-all font-mono">
                                                    <span className="text-muted-foreground">new: </span>{truncate(c.newValue, 200)}
                                                </p>
                                            </div>
                                        ))}
                                        {page && page.rows.length < page.total && (
                                            <Button variant="outline" size="sm" className="h-7 text-xs" onClick={() => loadMore(b.id)} disabled={loadingId === b.id}>
                                                {loadingId === b.id && <Loader2 className="mr-1 h-3 w-3 animate-spin" />}
                                                Show more ({fmtInt(page.rows.length)} of {fmtInt(page.total)})
                                            </Button>
                                        )}
                                    </div>
                                )}
                            </li>
                        );
                    })}
                </ul>
            </CardContent>
        </Card>
    );
}
