'use client';

// ---------------------------------------------------------------------------
// Master Finder — Convert panel (step two).
//
// Lets the admin type the new text, see exactly how many matches are ticked,
// confirm, watch the conversion run, and undo it. The rules about what may be
// rewritten live on the server (src/lib/master-finder-text.ts); this panel only
// displays the plan the server computed from the current ticks.
// ---------------------------------------------------------------------------

import { useMemo, useState } from 'react';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { Label } from '@/components/ui/label';
import { Badge } from '@/components/ui/badge';
import { Progress } from '@/components/ui/progress';
import {
    AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription,
    AlertDialogFooter, AlertDialogHeader, AlertDialogTitle, AlertDialogTrigger,
} from '@/components/ui/alert-dialog';
import { AlertTriangle, Loader2, Lock, Replace, RotateCcw, Undo2 } from 'lucide-react';
import type { FinderJob } from '@/lib/master-finder';
import type { ConversionBatch, ConversionPlan } from '@/lib/master-finder-convert';
import { ConversionStatusBadge, ReasonList, canUndo, fmtInt, plural, truncate } from './finder-ui';

interface ConvertPanelProps {
    job: FinderJob;
    plan: ConversionPlan | null;
    planLoading: boolean;
    replacement: string;
    onReplacementChange: (value: string) => void;
    /** The conversion being watched: running, or the last one for this scan. */
    batch: ConversionBatch | null;
    /** A conversion or undo is running somewhere, so nothing else may start. */
    busy: boolean;
    selectionTouched: boolean;
    onResetSelection: () => void;
    onConvert: () => Promise<void>;
    onUndo: (batchId: string) => Promise<void>;
}

function clientHint(mode: FinderJob['mode'], oldText: string, value: string): string | null {
    const v = value.trim();
    if (!v) return null;
    if (v === oldText) return 'Same as the old text.';
    if (mode === 'link') {
        try {
            const url = new URL(v);
            if (url.protocol !== 'http:' && url.protocol !== 'https:') return 'Must start with http:// or https://';
        } catch {
            return 'Not a full link yet (needs https://…).';
        }
    }
    return null;
}

export default function ConvertPanel({
    job, plan, planLoading, replacement, onReplacementChange, batch, busy, selectionTouched,
    onResetSelection, onConvert, onUndo,
}: ConvertPanelProps) {
    const [starting, setStarting] = useState(false);
    const [undoing, setUndoing] = useState(false);

    const hint = useMemo(() => clientHint(job.mode, job.query, replacement), [job.mode, job.query, replacement]);
    const selected = plan?.selected ?? 0;
    const collections = plan ? Object.keys(plan.selectedByCollection).length : 0;
    const canStart = !busy && !starting && selected > 0 && replacement.trim().length > 0 && !hint;

    const handleConvert = async () => {
        setStarting(true);
        try {
            await onConvert();
        } finally {
            setStarting(false);
        }
    };

    const handleUndo = async (batchId: string) => {
        setUndoing(true);
        try {
            await onUndo(batchId);
        } finally {
            setUndoing(false);
        }
    };

    const batchPercent =
        batch && batch.status === 'running'
            ? batch.progress.total > 0 ? Math.min(99, Math.round((batch.progress.processed / batch.progress.total) * 100)) : 0
            : 100;
    const undoPercent =
        batch?.undo && batch.undo.status === 'running'
            ? batch.undo.total > 0 ? Math.min(99, Math.round((batch.undo.processed / batch.undo.total) * 100)) : 0
            : 100;

    return (
        <Card>
            <CardHeader className="pb-3">
                <CardTitle className="flex items-center gap-2 text-lg">
                    <Replace className="h-5 w-5" /> Convert
                </CardTitle>
                <CardDescription>
                    Replace the found {job.mode === 'link' ? 'link' : 'text'} in every ticked row below. Only text fields are rewritten,
                    each change is recorded, and the whole conversion can be undone from this page.
                </CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
                <div className="grid gap-3 md:grid-cols-2">
                    <div className="space-y-1.5">
                        <Label className="text-muted-foreground">Old {job.mode === 'link' ? 'link' : 'text'}</Label>
                        <p className="break-all rounded-md border bg-muted/50 p-2 font-mono text-xs">{job.query}</p>
                    </div>
                    <div className="space-y-1.5">
                        <Label htmlFor="finder-replacement">Replace with</Label>
                        {job.mode === 'sentence' ? (
                            <Textarea
                                id="finder-replacement"
                                rows={3}
                                value={replacement}
                                onChange={(e) => onReplacementChange(e.target.value)}
                                placeholder="The new sentence…"
                                disabled={busy}
                                className="font-mono text-xs"
                            />
                        ) : (
                            <Input
                                id="finder-replacement"
                                value={replacement}
                                onChange={(e) => onReplacementChange(e.target.value)}
                                placeholder="https://cdn.example.com/new-image.png"
                                disabled={busy}
                                className="font-mono text-xs"
                            />
                        )}
                        {hint && <p className="text-xs text-amber-700">{hint}</p>}
                    </div>
                </div>

                {/* ---- what will happen ---- */}
                <div className="rounded-md border p-3 text-sm">
                    {planLoading && !plan ? (
                        <p className="flex items-center gap-2 text-muted-foreground"><Loader2 className="h-4 w-4 animate-spin" /> Counting ticked rows…</p>
                    ) : plan ? (
                        <div className="space-y-2">
                            <div className="flex flex-wrap items-center gap-2">
                                <Badge className="font-normal">{fmtInt(plan.selected)} ticked</Badge>
                                {plan.unselected > 0 && <Badge variant="outline" className="font-normal">{fmtInt(plan.unselected)} unticked</Badge>}
                                {plan.warned > 0 && (
                                    <Badge variant="outline" className="gap-1 border-amber-400 font-normal text-amber-700">
                                        <AlertTriangle className="h-3 w-3" /> {fmtInt(plan.warned)} need a look
                                    </Badge>
                                )}
                                {plan.protected > 0 && (
                                    <Badge variant="outline" className="gap-1 font-normal">
                                        <Lock className="h-3 w-3" /> {fmtInt(plan.protected)} protected
                                    </Badge>
                                )}
                                {plan.alreadyConverted > 0 && <Badge variant="secondary" className="font-normal">{fmtInt(plan.alreadyConverted)} already converted</Badge>}
                                {planLoading && <Loader2 className="h-3.5 w-3.5 animate-spin text-muted-foreground" />}
                            </div>
                            {plan.selected > 0 && (
                                <p className="text-xs text-muted-foreground">
                                    Across {fmtInt(collections)} {plural(collections, 'collection')}:{' '}
                                    {Object.entries(plan.selectedByCollection)
                                        .sort((a, b) => b[1] - a[1])
                                        .map(([name, n]) => `${name} ${fmtInt(n)}`)
                                        .join(' · ')}
                                </p>
                            )}
                            {plan.warned > 0 && (
                                <p className="text-xs text-amber-700">
                                    Rows marked “needs a look” hold a longer link that merely starts with the old one. They are unticked
                                    by default; tick them yourself if they really should change.
                                </p>
                            )}
                            <p className="text-xs text-muted-foreground">
                                Rows an earlier conversion skipped, or an undo left alone, also start unticked.
                            </p>
                            {plan.protected > 0 && (
                                <details className="text-xs text-muted-foreground">
                                    <summary className="cursor-pointer select-none">Why rows are protected</summary>
                                    <ReasonList reasons={plan.protectedReasons} className="mt-1 list-disc pl-5" />
                                </details>
                            )}
                            {plan.truncated && (
                                <p className="flex items-start gap-2 text-xs text-amber-700">
                                    <AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0" />
                                    This scan stopped at the match limit, so the database holds more places than listed. Convert these,
                                    then run the same scan again to catch the rest.
                                </p>
                            )}
                        </div>
                    ) : (
                        <p className="text-muted-foreground">No plan yet.</p>
                    )}
                </div>

                <div className="flex flex-wrap items-center gap-2">
                    <AlertDialog>
                        <AlertDialogTrigger asChild>
                            <Button disabled={!canStart} className="font-bold">
                                {starting ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <Replace className="mr-2 h-4 w-4" />}
                                Convert {fmtInt(selected)} {plural(selected, 'field')}
                            </Button>
                        </AlertDialogTrigger>
                        <AlertDialogContent>
                            <AlertDialogHeader>
                                <AlertDialogTitle>Convert {fmtInt(selected)} {plural(selected, 'field')}?</AlertDialogTitle>
                                <AlertDialogDescription asChild>
                                    <div className="space-y-2 text-sm text-muted-foreground">
                                        <p className="break-all font-mono text-xs">
                                            <span className="text-foreground">{truncate(job.query, 160)}</span>
                                            <br />↓<br />
                                            <span className="text-foreground">{truncate(replacement.trim(), 160)}</span>
                                        </p>
                                        <p>
                                            The ticked fields are rewritten now, across {fmtInt(collections)} {plural(collections, 'collection')}.
                                            Each change is recorded with its old value, and the whole conversion can be undone afterwards.
                                            A field that changed since the scan is skipped and reported, never overwritten.
                                        </p>
                                    </div>
                                </AlertDialogDescription>
                            </AlertDialogHeader>
                            <AlertDialogFooter>
                                <AlertDialogCancel>Cancel</AlertDialogCancel>
                                <AlertDialogAction onClick={handleConvert}>Yes, convert</AlertDialogAction>
                            </AlertDialogFooter>
                        </AlertDialogContent>
                    </AlertDialog>
                    {selectionTouched && (
                        <Button variant="ghost" size="sm" onClick={onResetSelection} disabled={busy}>
                            <RotateCcw className="mr-1 h-4 w-4" /> Reset ticks
                        </Button>
                    )}
                    {busy && <span className="text-xs text-muted-foreground">Another conversion or undo is running.</span>}
                </div>

                {/* ---- the conversion being watched ---- */}
                {batch && (
                    <div className="space-y-2 rounded-md border bg-muted/30 p-3 text-sm">
                        <div className="flex flex-wrap items-center justify-between gap-2">
                            <div className="flex flex-wrap items-center gap-2">
                                <ConversionStatusBadge batch={batch} />
                                <span className="break-all font-mono text-xs text-muted-foreground">
                                    {truncate(batch.oldText, 60)} → {truncate(batch.newText, 60)}
                                </span>
                            </div>
                            {canUndo(batch) && (
                                <AlertDialog>
                                    <AlertDialogTrigger asChild>
                                        <Button variant="outline" size="sm" disabled={busy || undoing}>
                                            {undoing ? <Loader2 className="mr-1 h-4 w-4 animate-spin" /> : <Undo2 className="mr-1 h-4 w-4" />}
                                            Undo this conversion
                                        </Button>
                                    </AlertDialogTrigger>
                                    <AlertDialogContent>
                                        <AlertDialogHeader>
                                            <AlertDialogTitle>Undo this conversion?</AlertDialogTitle>
                                            <AlertDialogDescription>
                                                Puts the old text back into the {fmtInt(batch.counts.changed)} {plural(batch.counts.changed, 'field')} that
                                                were changed. A field edited again after the conversion is left alone and reported.
                                            </AlertDialogDescription>
                                        </AlertDialogHeader>
                                        <AlertDialogFooter>
                                            <AlertDialogCancel>Cancel</AlertDialogCancel>
                                            <AlertDialogAction onClick={() => handleUndo(batch.id)}>Yes, undo</AlertDialogAction>
                                        </AlertDialogFooter>
                                    </AlertDialogContent>
                                </AlertDialog>
                            )}
                        </div>

                        {batch.status === 'running' && (
                            <>
                                <Progress value={batchPercent} className="h-2" />
                                <p className="text-xs text-muted-foreground">
                                    {fmtInt(batch.progress.processed)} of {fmtInt(batch.progress.total)} fields · {fmtInt(batch.counts.changed)} changed so far
                                </p>
                            </>
                        )}
                        {batch.status === 'failed' && (
                            <p className="flex items-start gap-2 text-destructive">
                                <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" /> {batch.error ?? 'The conversion failed.'}
                                {batch.counts.changed > 0 && <> {fmtInt(batch.counts.changed)} {plural(batch.counts.changed, 'field was', 'fields were')} changed before it stopped and can be undone.</>}
                            </p>
                        )}
                        {batch.status === 'completed' && (
                            <div className="space-y-1">
                                <p>
                                    Changed <strong>{fmtInt(batch.counts.changed)}</strong> {plural(batch.counts.changed, 'field')}
                                    {batch.counts.occurrences !== batch.counts.changed && <> ({fmtInt(batch.counts.occurrences)} occurrences)</>}
                                    {batch.counts.skipped > 0 && <> · skipped {fmtInt(batch.counts.skipped)}</>}
                                    {Object.keys(batch.changedByCollection).length > 0 && (
                                        <span className="text-muted-foreground">
                                            {' '}· {Object.entries(batch.changedByCollection).sort((a, b) => b[1] - a[1]).map(([n, c]) => `${n} ${fmtInt(c)}`).join(' · ')}
                                        </span>
                                    )}
                                </p>
                                {batch.counts.skipped > 0 && <ReasonList reasons={batch.skippedReasons} />}
                            </div>
                        )}
                        {batch.undo && (
                            <div className="space-y-1 border-t pt-2">
                                {batch.undo.status === 'running' && (
                                    <>
                                        <Progress value={undoPercent} className="h-2" />
                                        <p className="text-xs text-muted-foreground">
                                            Undoing · {fmtInt(batch.undo.processed)} of {fmtInt(batch.undo.total)} · {fmtInt(batch.undo.restored)} restored so far
                                        </p>
                                    </>
                                )}
                                {batch.undo.status === 'failed' && (
                                    <p className="flex items-start gap-2 text-destructive">
                                        <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" /> Undo failed: {batch.undo.error ?? 'unknown error'}
                                    </p>
                                )}
                                {batch.undo.status === 'done' && (
                                    <>
                                        <p>
                                            Restored <strong>{fmtInt(batch.undo.restored)}</strong> of {fmtInt(batch.undo.total)} {plural(batch.undo.total, 'field')}
                                            {batch.undo.skipped > 0 && <> · {fmtInt(batch.undo.skipped)} left as they were</>}
                                        </p>
                                        {batch.undo.skipped > 0 && <ReasonList reasons={batch.undo.skippedReasons} />}
                                    </>
                                )}
                            </div>
                        )}
                    </div>
                )}
            </CardContent>
        </Card>
    );
}
