'use client';

// ---------------------------------------------------------------------------
// Notification Cleanup — admin UI.
//
// Search the notifications collection by sentence or link (plus optional UID,
// IST time frame and "only unlinked"), see exactly which notifications match
// with a tick per notification, delete the ticked ones in a background job,
// and undo or discard the 7-day backup. Which notifications may be ticked by
// default is decided on the server (src/lib/notification-cleanup.ts); the
// ticks here are only the admin's choice within those rules.
// ---------------------------------------------------------------------------

import { useCallback, useEffect, useMemo, useRef, useState, useTransition } from 'react';
import Link from 'next/link';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { Label } from '@/components/ui/label';
import { Switch } from '@/components/ui/switch';
import { Badge } from '@/components/ui/badge';
import { Checkbox } from '@/components/ui/checkbox';
import { Progress } from '@/components/ui/progress';
import { Tabs, TabsList, TabsTrigger } from '@/components/ui/tabs';
import {
    AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription,
    AlertDialogFooter, AlertDialogHeader, AlertDialogTitle,
} from '@/components/ui/alert-dialog';
import { useToast } from '@/hooks/use-toast';
import { cn } from '@/lib/utils';
import {
    AlertTriangle, BellMinus, ChevronLeft, ChevronRight, Copy, ExternalLink, Headset, Link2, Loader2, Search,
    ShieldAlert, Trash2, Type, X,
} from 'lucide-react';
import type { CleanupBatch, CleanupBatchesPage, CleanupCriteria, CleanupPlan, CleanupRow, CleanupRowsPage, CleanupSelection, CleanupTextMode } from '@/lib/notification-cleanup';
import { discardBackup, getCleanup, getCleanupHistory, getCleanupPlan, getCleanupRows, startCleanup, undoCleanup } from '../actions';
import CleanupHistory, { BackupLine, DiscardButton, UndoButton } from './cleanup-history';
import { CleanupStatusBadge, ReasonList, WhenIST, criteriaSummary, fmtInt, isBatchBusy, plural } from './cleanup-ui';

interface NotificationCleanupProps {
    initialHistory: CleanupBatchesPage;
}

const EMPTY_CRITERIA: CleanupCriteria = {
    mode: 'sentence',
    text: '',
    ignoreCase: false,
    gamingId: '',
    startLocal: '',
    endLocal: '',
    unlinkedOnly: false,
};

function Snippet({ row }: { row: CleanupRow }) {
    if (!row.snippet) return <span className="italic text-muted-foreground">(no text)</span>;
    if (row.matchStart < 0) return <span className="break-words">{row.snippet}</span>;
    return (
        <span className="break-words">
            {row.snippet.slice(0, row.matchStart)}
            <mark className="rounded bg-yellow-200 px-0.5 text-foreground dark:bg-yellow-700/60">
                {row.snippet.slice(row.matchStart, row.matchStart + row.matchLength)}
            </mark>
            {row.snippet.slice(row.matchStart + row.matchLength)}
        </span>
    );
}

export default function NotificationCleanup({ initialHistory }: NotificationCleanupProps) {
    const initialBatches = initialHistory.batches;
    const { toast } = useToast();

    // --- criteria being typed, and the criteria that was actually searched ---------
    const [draft, setDraft] = useState<CleanupCriteria>(EMPTY_CRITERIA);
    const [applied, setApplied] = useState<CleanupCriteria | null>(null);

    // --- results ------------------------------------------------------------------------
    const [plan, setPlan] = useState<CleanupPlan | null>(null);
    const [planError, setPlanError] = useState<string | null>(null);
    const [planLoading, setPlanLoading] = useState(false);
    const [rows, setRows] = useState<CleanupRowsPage | null>(null);
    const [rowsLoading, setRowsLoading] = useState(false);
    const [page, setPage] = useState(1);
    const rowsRequest = useRef(0);
    const [reloadTick, setReloadTick] = useState(0);

    // --- ticks ----------------------------------------------------------------------------
    const [baseline, setBaseline] = useState<CleanupSelection['baseline']>('default');
    const [includedIds, setIncludedIds] = useState<Set<string>>(new Set());
    const [excludedIds, setExcludedIds] = useState<Set<string>>(new Set());
    const [selectionVersion, setSelectionVersion] = useState(0);

    // --- deletion ---------------------------------------------------------------------------
    const [confirmOpen, setConfirmOpen] = useState(false);
    const [confirmText, setConfirmText] = useState('');
    const [activeBatch, setActiveBatch] = useState<CleanupBatch | null>(() => initialBatches.find(isBatchBusy) ?? null);
    const [batches, setBatches] = useState<CleanupBatch[]>(initialBatches);
    const [historyTotal, setHistoryTotal] = useState(initialHistory.total);
    const [historyPages, setHistoryPages] = useState(1);
    const [loadingMore, setLoadingMore] = useState(false);

    /** Reload every history page currently shown (so an expanded list stays expanded). */
    const reloadHistory = useCallback(async (pages: number) => {
        const results: CleanupBatchesPage[] = [];
        for (let p = 1; p <= pages; p++) {
            const data = await getCleanupHistory(p);
            results.push(data);
            if (data.batches.length < data.pageSize) break;
        }
        if (results.length === 0) return;
        setBatches(results.flatMap((r) => r.batches));
        setHistoryTotal(results[results.length - 1].total);
        setHistoryPages(results.length);
    }, []);

    const showMoreHistory = async () => {
        setLoadingMore(true);
        try {
            const data = await getCleanupHistory(historyPages + 1);
            setBatches((prev) => {
                const seen = new Set(prev.map((b) => b.id));
                return [...prev, ...data.batches.filter((b) => !seen.has(b.id))];
            });
            setHistoryTotal(data.total);
            setHistoryPages(data.page);
        } finally {
            setLoadingMore(false);
        }
    };
    const [isStarting, startStarting] = useTransition();
    const [pendingAction, setPendingAction] = useState(false);

    const busy = isBatchBusy(activeBatch) || batches.some(isBatchBusy);

    const selectionPayload = useCallback((): CleanupSelection => ({
        baseline,
        includedIds: [...includedIds],
        excludedIds: [...excludedIds],
    }), [baseline, includedIds, excludedIds]);

    const resetTicks = useCallback((nextBaseline: CleanupSelection['baseline']) => {
        setBaseline(nextBaseline);
        setIncludedIds(new Set());
        setExcludedIds(new Set());
        setSelectionVersion((v) => v + 1);
    }, []);

    // --- search ---------------------------------------------------------------------------
    const handleSearch = () => {
        const next: CleanupCriteria = {
            ...draft,
            text: draft.text.trim(),
            gamingId: draft.gamingId.trim(),
            startLocal: draft.startLocal.trim(),
            endLocal: draft.endLocal.trim(),
        };
        if (!next.text && !next.gamingId && !next.startLocal && !next.endLocal && !next.unlinkedOnly) {
            toast({ variant: 'destructive', title: 'Nothing to search', description: 'Enter a sentence or link, a UID, a time frame, or switch on "only unlinked".' });
            return;
        }
        setApplied(next);
        setPage(1);
        setRows(null);
        setPlan(null);
        setPlanError(null);
        resetTicks('default');
    };

    const handleClear = () => {
        setDraft(EMPTY_CRITERIA);
        setApplied(null);
        setPlan(null);
        setPlanError(null);
        setRows(null);
        resetTicks('default');
    };

    // --- plan (debounced on ticks) ------------------------------------------------------------
    useEffect(() => {
        if (!applied) return;
        let cancelled = false;
        setPlanLoading(true);
        const timer = setTimeout(async () => {
            const res = await getCleanupPlan(applied, selectionPayload());
            if (cancelled) return;
            if (res.success && res.plan) {
                setPlan(res.plan);
                setPlanError(null);
            } else {
                setPlan(null);
                setPlanError(res.message);
            }
            setPlanLoading(false);
        }, 300);
        return () => {
            cancelled = true;
            clearTimeout(timer);
        };
    }, [applied, selectionVersion, reloadTick]); // eslint-disable-line react-hooks/exhaustive-deps

    // --- rows ----------------------------------------------------------------------------------
    useEffect(() => {
        if (!applied) return;
        const requestNo = ++rowsRequest.current;
        setRowsLoading(true);
        getCleanupRows(applied, page)
            .then((data) => {
                if (requestNo === rowsRequest.current) setRows(data);
            })
            .finally(() => {
                if (requestNo === rowsRequest.current) setRowsLoading(false);
            });
    }, [applied, page, reloadTick]);

    // --- batch polling --------------------------------------------------------------------------
    const activeBusy = isBatchBusy(activeBatch);
    useEffect(() => {
        if (!activeBatch || !activeBusy) return;
        const id = activeBatch.id;
        const timer = setInterval(async () => {
            const fresh = await getCleanup(id);
            if (fresh) setActiveBatch(fresh);
        }, 1200);
        return () => clearInterval(timer);
    }, [activeBatch?.id, activeBusy]); // eslint-disable-line react-hooks/exhaustive-deps

    const wasBusy = useRef(false);
    useEffect(() => {
        if (activeBusy) {
            wasBusy.current = true;
            return;
        }
        if (!wasBusy.current) return;
        wasBusy.current = false;
        setReloadTick((t) => t + 1);
        reloadHistory(historyPages).catch(() => { /* best-effort */ });
    }, [activeBusy]); // eslint-disable-line react-hooks/exhaustive-deps

    // --- ticks ------------------------------------------------------------------------------------
    const isTicked = (row: CleanupRow): boolean => {
        if (includedIds.has(row.id)) return true;
        if (excludedIds.has(row.id)) return false;
        return baseline === 'default' ? row.tickedByDefault : false;
    };

    const setTicked = (row: CleanupRow, on: boolean) => {
        setIncludedIds((prev) => { const s = new Set(prev); if (on) s.add(row.id); else s.delete(row.id); return s; });
        setExcludedIds((prev) => { const s = new Set(prev); if (on) s.delete(row.id); else s.add(row.id); return s; });
        setSelectionVersion((v) => v + 1);
    };

    // --- deletion ---------------------------------------------------------------------------------
    const openConfirm = () => {
        setConfirmText('');
        setConfirmOpen(true);
    };

    const handleDelete = () => {
        if (!applied) return;
        startStarting(async () => {
            const res = await startCleanup(applied, selectionPayload());
            setConfirmOpen(false);
            if (!res.success || !res.batchId) {
                toast({ variant: 'destructive', title: 'Not started', description: res.message });
                return;
            }
            const batch = await getCleanup(res.batchId);
            if (batch) setActiveBatch(batch);
            resetTicks('default');
            toast({ title: 'Deleting', description: `${fmtInt(res.total ?? 0)} ${plural(res.total ?? 0, 'notification')} are being removed. A backup is kept for 7 days.` });
        });
    };

    const handleUndo = async (batchId: string) => {
        setPendingAction(true);
        try {
            const res = await undoCleanup(batchId);
            if (!res.success) {
                toast({ variant: 'destructive', title: 'Undo not started', description: res.message });
                return;
            }
            const batch = await getCleanup(batchId);
            if (batch) setActiveBatch(batch);
            toast({ title: 'Restoring', description: res.message });
        } finally {
            setPendingAction(false);
        }
    };

    const handleDiscard = async (batchId: string) => {
        setPendingAction(true);
        try {
            const res = await discardBackup(batchId);
            toast({ variant: res.success ? 'default' : 'destructive', title: res.success ? 'Backup discarded' : 'Not discarded', description: res.message });
            const fresh = await getCleanup(batchId);
            if (fresh && activeBatch?.id === batchId) setActiveBatch(fresh);
            await reloadHistory(historyPages);
        } finally {
            setPendingAction(false);
        }
    };

    const copy = async (text: string) => {
        try {
            await navigator.clipboard.writeText(text);
            toast({ title: 'Copied', description: text });
        } catch {
            toast({ variant: 'destructive', title: 'Copy failed', description: 'Your browser blocked clipboard access.' });
        }
    };

    // --- derived ---------------------------------------------------------------------------------------
    const ticked = plan?.ticked ?? 0;
    const emptying = useMemo(() => plan?.broadcasts.filter((b) => b.willEmpty) ?? [], [plan]);
    const totalPages = rows ? Math.max(1, Math.ceil(rows.total / rows.pageSize)) : 1;
    const canDelete = !!applied && ticked > 0 && !busy && !isStarting;
    const confirmReady = confirmText.trim().toUpperCase() === 'DELETE';
    const batchPercent = activeBatch && activeBatch.status === 'running'
        ? activeBatch.progress.total > 0 ? Math.min(99, Math.round((activeBatch.progress.processed / activeBatch.progress.total) * 100)) : 0
        : 100;

    return (
        <div className="space-y-6">
            {/* ------------------------------------------------------------ search */}
            <Card>
                <CardHeader>
                    <CardTitle className="flex items-center gap-2 text-2xl font-headline">
                        <BellMinus className="h-6 w-6" /> Notification Cleanup
                    </CardTitle>
                    <CardDescription>
                        Find old notifications by their text and remove them for every user at once. Only the notifications collection is
                        touched. Everything deleted is backed up for 7 days and can be put back with one click.
                    </CardDescription>
                </CardHeader>
                <CardContent className="space-y-4">
                    <Tabs value={draft.mode} onValueChange={(v) => setDraft((d) => ({ ...d, mode: v as CleanupTextMode }))}>
                        <TabsList>
                            <TabsTrigger value="sentence" className="gap-1.5"><Type className="h-4 w-4" /> Sentence</TabsTrigger>
                            <TabsTrigger value="link" className="gap-1.5"><Link2 className="h-4 w-4" /> Link</TabsTrigger>
                        </TabsList>
                    </Tabs>

                    <div className="space-y-2">
                        <Label htmlFor="cleanup-text">{draft.mode === 'link' ? 'Link' : 'Sentence'} the notification contains</Label>
                        {draft.mode === 'sentence' ? (
                            <Textarea
                                id="cleanup-text"
                                rows={2}
                                value={draft.text}
                                onChange={(e) => setDraft((d) => ({ ...d, text: e.target.value }))}
                                placeholder="e.g. Lightning Kick-Off is coming!"
                                disabled={busy}
                            />
                        ) : (
                            <Input
                                id="cleanup-text"
                                value={draft.text}
                                onChange={(e) => setDraft((d) => ({ ...d, text: e.target.value }))}
                                placeholder="https://…/event-banner.png"
                                disabled={busy}
                                onKeyDown={(e) => { if (e.key === 'Enter' && !busy) handleSearch(); }}
                            />
                        )}
                        <p className="text-xs text-muted-foreground">
                            Exact text match in the message, the HTML body and the image link. HTML-escaped and URL-encoded spellings are matched too.
                            Leave it empty to filter by UID or time frame only.
                        </p>
                    </div>

                    <div className="grid gap-4 md:grid-cols-3">
                        <div className="space-y-1.5">
                            <Label htmlFor="cleanup-uid">Sent to UID (optional)</Label>
                            <Input id="cleanup-uid" value={draft.gamingId} onChange={(e) => setDraft((d) => ({ ...d, gamingId: e.target.value }))} placeholder="Gaming ID" disabled={busy} />
                        </div>
                        <div className="space-y-1.5">
                            <Label htmlFor="cleanup-from">From (IST, optional)</Label>
                            <Input id="cleanup-from" type="datetime-local" value={draft.startLocal} onChange={(e) => setDraft((d) => ({ ...d, startLocal: e.target.value }))} disabled={busy} />
                        </div>
                        <div className="space-y-1.5">
                            <Label htmlFor="cleanup-to">To (IST, optional)</Label>
                            <Input id="cleanup-to" type="datetime-local" value={draft.endLocal} onChange={(e) => setDraft((d) => ({ ...d, endLocal: e.target.value }))} disabled={busy} />
                        </div>
                    </div>

                    <div className="flex flex-wrap gap-x-8 gap-y-3">
                        <div className="flex items-center gap-2">
                            <Switch id="cleanup-case" checked={draft.ignoreCase} onCheckedChange={(v) => setDraft((d) => ({ ...d, ignoreCase: v }))} disabled={busy} />
                            <Label htmlFor="cleanup-case" className="font-normal">Ignore letter case</Label>
                        </div>
                        <div className="flex items-center gap-2">
                            <Switch id="cleanup-unlinked" checked={draft.unlinkedOnly} onCheckedChange={(v) => setDraft((d) => ({ ...d, unlinkedOnly: v }))} disabled={busy} />
                            <Label htmlFor="cleanup-unlinked" className="font-normal">Only old unlinked notifications (sent before broadcasts were linked)</Label>
                        </div>
                    </div>

                    <div className="flex flex-wrap items-center gap-2">
                        <Button onClick={handleSearch} disabled={busy} className="font-bold">
                            <Search className="mr-2 h-4 w-4" /> Search
                        </Button>
                        {applied && (
                            <Button variant="ghost" onClick={handleClear} disabled={busy}>
                                <X className="mr-2 h-4 w-4" /> Clear
                            </Button>
                        )}
                        {busy && <span className="text-xs text-muted-foreground">A cleanup or undo is running; wait for it to finish.</span>}
                    </div>
                </CardContent>
            </Card>

            {/* ------------------------------------------------------------ current cleanup */}
            {activeBatch && (
                <Card>
                    <CardHeader className="pb-3">
                        <div className="flex flex-wrap items-center justify-between gap-2">
                            <CardTitle className="flex items-center gap-2 text-lg">
                                <CleanupStatusBadge batch={activeBatch} />
                                <span className="text-sm font-normal text-muted-foreground">{criteriaSummary(activeBatch.criteria)}</span>
                            </CardTitle>
                            <div className="flex items-center gap-1">
                                <UndoButton batch={activeBatch} busy={busy} pending={pendingAction} onUndo={handleUndo} size="default" />
                                <DiscardButton batch={activeBatch} busy={busy} pending={pendingAction} onDiscard={handleDiscard} size="default" />
                            </div>
                        </div>
                    </CardHeader>
                    <CardContent className="space-y-2 text-sm">
                        {activeBatch.status === 'running' && (
                            <>
                                <Progress value={batchPercent} className="h-2" />
                                <p className="text-muted-foreground">
                                    {fmtInt(activeBatch.progress.processed)} of {fmtInt(activeBatch.progress.total)} checked · {fmtInt(activeBatch.counts.deleted)} deleted so far
                                </p>
                            </>
                        )}
                        {activeBatch.status === 'failed' && (
                            <p className="flex items-start gap-2 text-destructive">
                                <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" /> {activeBatch.error ?? 'The cleanup failed.'}
                                {activeBatch.counts.deleted > 0 && <> {fmtInt(activeBatch.counts.deleted)} {plural(activeBatch.counts.deleted, 'notification was', 'notifications were')} deleted before it stopped; they are in the backup.</>}
                            </p>
                        )}
                        {activeBatch.status === 'completed' && (
                            <div className="space-y-1">
                                <p>
                                    Deleted <strong>{fmtInt(activeBatch.counts.deleted)}</strong> {plural(activeBatch.counts.deleted, 'notification')}
                                    {activeBatch.counts.skipped > 0 && <> · skipped {fmtInt(activeBatch.counts.skipped)}</>}
                                    {activeBatch.counts.broadcastsRemoved > 0 && <> · removed {fmtInt(activeBatch.counts.broadcastsRemoved)} emptied broadcast {plural(activeBatch.counts.broadcastsRemoved, 'record')}</>}
                                </p>
                                {activeBatch.counts.skipped > 0 && <ReasonList reasons={activeBatch.skippedReasons} />}
                                <p className="text-xs text-muted-foreground"><BackupLine batch={activeBatch} /></p>
                            </div>
                        )}
                        {activeBatch.undo?.status === 'running' && (
                            <p className="flex items-center gap-2 text-muted-foreground">
                                <Loader2 className="h-4 w-4 animate-spin" /> Restoring… {fmtInt(activeBatch.undo.restored)} put back so far
                            </p>
                        )}
                        {activeBatch.undo?.status === 'failed' && (
                            <p className="flex items-start gap-2 text-destructive">
                                <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" /> Undo failed: {activeBatch.undo.error ?? 'unknown error'}
                            </p>
                        )}
                    </CardContent>
                </Card>
            )}

            {/* ------------------------------------------------------------ plan */}
            {applied && (
                <Card>
                    <CardHeader className="pb-3">
                        <CardTitle className="text-lg">What matches</CardTitle>
                        <CardDescription>{criteriaSummary(applied)}</CardDescription>
                    </CardHeader>
                    <CardContent className="space-y-3 text-sm">
                        {planError && <p className="text-destructive">{planError}</p>}
                        {!plan && planLoading && !planError && (
                            <p className="flex items-center gap-2 text-muted-foreground"><Loader2 className="h-4 w-4 animate-spin" /> Counting…</p>
                        )}
                        {plan && (
                            <>
                                <div className="flex flex-wrap items-center gap-2">
                                    <Badge variant="outline" className="font-normal">{fmtInt(plan.total)} {plural(plan.total, 'notification')} match</Badge>
                                    <Badge className="font-normal">{fmtInt(plan.ticked)} ticked for deletion</Badge>
                                    {plan.recent > 0 && (
                                        <Badge variant="outline" className="gap-1 border-amber-400 font-normal text-amber-700">
                                            <ShieldAlert className="h-3 w-3" /> {fmtInt(plan.recent)} recent (last {plan.recentDays} days)
                                        </Badge>
                                    )}
                                    {plan.supportReplies > 0 && (
                                        <Badge variant="outline" className="gap-1 border-amber-400 font-normal text-amber-700">
                                            <Headset className="h-3 w-3" /> {fmtInt(plan.supportReplies)} support {plural(plan.supportReplies, 'reply', 'replies')}
                                        </Badge>
                                    )}
                                    {planLoading && <Loader2 className="h-3.5 w-3.5 animate-spin text-muted-foreground" />}
                                </div>
                                <p className="text-xs text-muted-foreground">
                                    {fmtInt(plan.unlinked)} unlinked (old style) · {fmtInt(plan.linked)} linked to a broadcast
                                    {plan.oldest && plan.newest && (
                                        <> · from <WhenIST iso={plan.oldest} withYear /> to <WhenIST iso={plan.newest} withYear /></>
                                    )}
                                </p>
                                {plan.guarded > 0 && (
                                    <p className="text-xs text-amber-700">
                                        Recent notifications and support replies start unticked so they are not removed by accident. Tick them in the list if they should go too.
                                    </p>
                                )}
                                {plan.broadcasts.length > 0 && (
                                    <div className="space-y-1">
                                        <p className="text-xs font-medium">Broadcasts involved</p>
                                        <ul className="space-y-0.5 text-xs text-muted-foreground">
                                            {plan.broadcasts.map((b) => (
                                                <li key={b.broadcastId} className="flex flex-wrap items-center gap-2">
                                                    <span className="font-mono">{b.broadcastId.slice(-6)}</span>
                                                    <span className="break-words">“{b.sample || '(no text)'}”</span>
                                                    <span>{fmtInt(b.ticked)} of {fmtInt(b.total)} ticked</span>
                                                    {b.willEmpty && <Badge variant="outline" className="font-normal">record will be removed too</Badge>}
                                                </li>
                                            ))}
                                        </ul>
                                    </div>
                                )}
                                <div className="flex flex-wrap items-center gap-2 pt-1">
                                    <Button variant="destructive" onClick={openConfirm} disabled={!canDelete} className="font-bold">
                                        <Trash2 className="mr-2 h-4 w-4" /> Delete {fmtInt(ticked)} ticked {plural(ticked, 'notification')}
                                    </Button>
                                    <Button variant="outline" size="sm" onClick={() => resetTicks('none')} disabled={busy || (baseline === 'none' && includedIds.size === 0)}>
                                        Untick all
                                    </Button>
                                    <Button variant="outline" size="sm" onClick={() => resetTicks('default')} disabled={busy || (baseline === 'default' && includedIds.size === 0 && excludedIds.size === 0)}>
                                        Back to default ticks
                                    </Button>
                                </div>
                            </>
                        )}
                    </CardContent>
                </Card>
            )}

            {/* ------------------------------------------------------------ rows */}
            {applied && (
                <Card>
                    <CardHeader className="pb-3">
                        <CardTitle className="text-lg">Matching notifications</CardTitle>
                        <CardDescription>Newest first. Untick anything that must stay. “Open” shows the user in User Management.</CardDescription>
                    </CardHeader>
                    <CardContent className="space-y-3">
                        {(!rows || (rows.rows.length === 0 && rowsLoading)) && (
                            <p className="flex items-center justify-center gap-2 py-8 text-sm text-muted-foreground"><Loader2 className="h-4 w-4 animate-spin" /> Loading…</p>
                        )}
                        {rows && rows.rows.length === 0 && !rowsLoading && (
                            <p className="py-8 text-center text-sm text-muted-foreground">No notifications match.</p>
                        )}
                        {rows && rows.rows.length > 0 && (
                            <div className="space-y-2">
                                {rows.rows.map((row) => {
                                    const on = isTicked(row);
                                    return (
                                        <div key={row.id} className={cn('rounded-lg border bg-card p-3 text-sm', !on && 'opacity-75')}>
                                            <div className="flex items-start gap-3">
                                                <div className="pt-0.5">
                                                    <Checkbox checked={on} disabled={busy} onCheckedChange={(c) => setTicked(row, c === true)} aria-label="Delete this notification" />
                                                </div>
                                                <div className="min-w-0 flex-1 space-y-1">
                                                    <div className="flex flex-wrap items-start justify-between gap-2">
                                                        <div className="flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
                                                            <span className="font-medium text-foreground">UID {row.gamingId || '?'}</span>
                                                            <WhenIST iso={row.createdAt} withYear />
                                                            {row.broadcastId ? <Badge variant="outline" className="font-normal">broadcast {row.broadcastId.slice(-6)}</Badge> : <Badge variant="outline" className="font-normal">unlinked</Badge>}
                                                            {row.isPopup && <Badge variant="secondary" className="font-normal">popup</Badge>}
                                                            {row.hasHtml && <Badge variant="secondary" className="font-normal">HTML</Badge>}
                                                            {row.imageUrl && <Badge variant="secondary" className="font-normal">image</Badge>}
                                                            {row.isRead ? <span>read</span> : <span>unread</span>}
                                                            {row.recent && <Badge variant="outline" className="gap-1 border-amber-400 font-normal text-amber-700"><ShieldAlert className="h-3 w-3" /> recent</Badge>}
                                                            {row.supportReply && <Badge variant="outline" className="gap-1 border-amber-400 font-normal text-amber-700"><Headset className="h-3 w-3" /> support reply</Badge>}
                                                            {row.matchedIn && row.matchedIn !== 'message' && <span>matched in {row.matchedIn === 'html' ? 'HTML body' : 'image link'}</span>}
                                                        </div>
                                                        <div className="flex shrink-0 items-center gap-1">
                                                            <Button variant="ghost" size="sm" className="h-7 gap-1 px-2 text-xs" onClick={() => copy(row.gamingId)} title="Copy UID">
                                                                <Copy className="h-3 w-3" /> UID
                                                            </Button>
                                                            {row.gamingId && (
                                                                <Button asChild variant="outline" size="sm" className="h-7 gap-1 px-2 text-xs">
                                                                    <Link href={`/admin/users?search=${encodeURIComponent(row.gamingId)}`} target="_blank" rel="noopener noreferrer">
                                                                        <ExternalLink className="h-3 w-3" /> Open
                                                                    </Link>
                                                                </Button>
                                                            )}
                                                        </div>
                                                    </div>
                                                    <p className="rounded bg-muted/60 p-2 text-xs leading-relaxed"><Snippet row={row} /></p>
                                                </div>
                                            </div>
                                        </div>
                                    );
                                })}
                            </div>
                        )}
                        {rows && rows.total > rows.pageSize && (
                            <div className="flex items-center justify-between pt-2">
                                <Button variant="outline" size="sm" onClick={() => setPage((p) => Math.max(1, p - 1))} disabled={page <= 1 || rowsLoading}>
                                    <ChevronLeft className="mr-1 h-4 w-4" /> Previous
                                </Button>
                                <span className="text-sm text-muted-foreground">Page {page} of {totalPages} · {fmtInt(rows.total)} notifications</span>
                                <Button variant="outline" size="sm" onClick={() => setPage((p) => Math.min(totalPages, p + 1))} disabled={page >= totalPages || rowsLoading}>
                                    Next <ChevronRight className="ml-1 h-4 w-4" />
                                </Button>
                            </div>
                        )}
                    </CardContent>
                </Card>
            )}

            {/* ------------------------------------------------------------ confirm */}
            <AlertDialog open={confirmOpen} onOpenChange={setConfirmOpen}>
                <AlertDialogContent>
                    <AlertDialogHeader>
                        <AlertDialogTitle>Delete {fmtInt(ticked)} {plural(ticked, 'notification')}?</AlertDialogTitle>
                        <AlertDialogDescription asChild>
                            <div className="space-y-2 text-sm text-muted-foreground">
                                <p>{applied ? criteriaSummary(applied) : ''}</p>
                                <p>
                                    The ticked notifications disappear from every affected user&apos;s bell right away.
                                    {emptying.length > 0 && <> {fmtInt(emptying.length)} broadcast {plural(emptying.length, 'record')} that would be left empty {plural(emptying.length, 'is', 'are')} removed too.</>}
                                    {' '}A full backup is kept for 7 days, so this can be undone from this page.
                                </p>
                                {plan && plan.guarded > 0 && (
                                    <p>Unticked recent notifications and support replies are kept.</p>
                                )}
                                <div className="space-y-1 pt-1">
                                    <Label htmlFor="cleanup-confirm" className="text-foreground">Type DELETE to confirm</Label>
                                    <Input id="cleanup-confirm" value={confirmText} onChange={(e) => setConfirmText(e.target.value)} autoComplete="off" placeholder="DELETE" />
                                </div>
                            </div>
                        </AlertDialogDescription>
                    </AlertDialogHeader>
                    <AlertDialogFooter>
                        <AlertDialogCancel disabled={isStarting}>Cancel</AlertDialogCancel>
                        <AlertDialogAction
                            onClick={(e) => { e.preventDefault(); handleDelete(); }}
                            disabled={!confirmReady || isStarting}
                            className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
                        >
                            {isStarting ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <Trash2 className="mr-2 h-4 w-4" />}
                            Delete {fmtInt(ticked)}
                        </AlertDialogAction>
                    </AlertDialogFooter>
                </AlertDialogContent>
            </AlertDialog>

            <CleanupHistory
                batches={batches}
                total={historyTotal}
                loadingMore={loadingMore}
                onShowMore={showMoreHistory}
                busy={busy}
                currentId={activeBatch?.id ?? null}
                onUndo={handleUndo}
                onDiscard={handleDiscard}
            />
        </div>
    );
}
