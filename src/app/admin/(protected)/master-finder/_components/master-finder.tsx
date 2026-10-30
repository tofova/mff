'use client';

// ---------------------------------------------------------------------------
// Master Finder — admin UI.
//
// Step one (find): pick what to look for (a link, an exact sentence or a UID),
// start the scan, watch the progress, then browse every place the text occurs
// grouped by collection. Each row says which record it is, the exact field
// path, a highlighted snippet and, where possible, a link into the admin page
// that manages that record.
//
// Step two (convert): for link and sentence scans every row carries a tick.
// Protected rows cannot be ticked, boundary warnings are unticked by default,
// and the Convert panel shows the plan the server computed from the ticks.
// The panel starts the conversion, shows its progress and offers Undo. Which
// rows may be rewritten is decided on the server (master-finder-text.ts); the
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
import { useToast } from '@/hooks/use-toast';
import { cn } from '@/lib/utils';
import {
    AlertTriangle, ChevronLeft, ChevronRight, Copy, ExternalLink, History, Link2, Loader2, Lock,
    ScanSearch, Type, UserRound, XCircle,
} from 'lucide-react';
import type { FinderConversionMark, FinderJob, FinderMatch, FinderMode, FinderResultsPage } from '@/lib/master-finder';
import type { ConversionBatch, ConversionPlan, ConversionSelection } from '@/lib/master-finder-convert';
import { transformForVariant } from '@/lib/master-finder-text';
import {
    cancelFinderScan, getFinderConversion, getFinderConversionChanges, getFinderConversionPlan, getFinderScan,
    getFinderScanResults, getRecentFinderConversions, getRecentFinderScans, startFinderConversion, startFinderScan,
    startFinderUndo,
} from '../actions';
import ConvertPanel from './convert-panel';
import ConversionHistory from './conversion-history';
import { ScanStatusBadge, fmtDuration, fmtInt, plural, shortId, WhenIST } from './finder-ui';

interface MasterFinderProps {
    initialJobs: FinderJob[];
    initialConversions: ConversionBatch[];
}

const MODE_META: Record<FinderMode, { label: string; placeholder: string; help: string; minLength: number }> = {
    link: {
        label: 'Link',
        placeholder: 'https://res.cloudinary.com/…/image.png',
        help: 'Finds the exact link anywhere: product images, order history, notification HTML, slider, events, support chats. HTML-escaped and URL-encoded spellings are searched too. Links can then be converted to a new link.',
        minLength: 4,
    },
    sentence: {
        label: 'Sentence',
        placeholder: 'Paste the exact sentence or phrase…',
        help: 'Exact text match across every collection: notifications, support messages, AI chats, SMS logs, product names and more. The text can then be converted to new text.',
        minLength: 3,
    },
    uid: {
        label: 'UID',
        placeholder: 'Gaming ID, visual ID or a record id',
        help: 'Everything attached to the ID: records keyed by it, text that mentions it and, with "Follow linked records", records linked only by id such as support images, refunds and SMS logs. UID scans are search-only.',
        minLength: 3,
    },
};

const ACTIVE_STATUSES = new Set<FinderJob['status']>(['queued', 'running']);
const isActive = (job: FinderJob | null): boolean => !!job && ACTIVE_STATUSES.has(job.status);

function Snippet({ row }: { row: FinderMatch }) {
    if (row.matchStart < 0) {
        return <span className="italic text-muted-foreground">{row.snippet}</span>;
    }
    const before = row.snippet.slice(0, row.matchStart);
    const hit = row.snippet.slice(row.matchStart, row.matchStart + row.matchLength);
    const after = row.snippet.slice(row.matchStart + row.matchLength);
    return (
        <span className="break-all">
            {before}
            <mark className="rounded bg-yellow-200 px-0.5 text-foreground dark:bg-yellow-700/60">{hit}</mark>
            {after}
        </span>
    );
}

/** The same snippet with the replacement dropped in, so the admin sees the result before converting. */
function AfterSnippet({ row, replacement }: { row: FinderMatch; replacement: string }) {
    const before = row.snippet.slice(0, row.matchStart);
    const after = row.snippet.slice(row.matchStart + row.matchLength);
    return (
        <span className="break-all">
            {before}
            <mark className="rounded bg-emerald-200 px-0.5 text-foreground dark:bg-emerald-700/60">{transformForVariant(row.variant, replacement)}</mark>
            {after}
        </span>
    );
}

function kindLabel(row: FinderMatch, mode: FinderMode): string {
    if (row.kind === 'reference') return 'linked by id';
    if (row.kind === 'value') return mode === 'uid' ? 'keyed by this ID' : 'whole field';
    return 'inside text';
}

function variantLabel(variant: FinderMatch['variant']): string | null {
    switch (variant) {
        case 'html-escaped': return 'HTML-escaped';
        case 'url-encoded': return 'URL-encoded';
        default: return null;
    }
}

function ConversionMarkBadge({ mark }: { mark: FinderConversionMark }) {
    switch (mark.status) {
        case 'changed':
            return <Badge className="bg-emerald-600 font-normal hover:bg-emerald-600">Converted</Badge>;
        case 'restored':
            return <Badge variant="outline" className="font-normal">Restored by undo</Badge>;
        case 'skipped':
            return <Badge variant="outline" className="border-amber-400 font-normal text-amber-700">Not converted: {mark.reason ?? 'skipped'}</Badge>;
        case 'restore-skipped':
            return <Badge variant="outline" className="border-amber-400 font-normal text-amber-700">Undo skipped: {mark.reason ?? 'skipped'}</Badge>;
    }
}

export default function MasterFinder({ initialJobs, initialConversions }: MasterFinderProps) {
    const { toast } = useToast();

    // --- scan form ------------------------------------------------------------
    const [mode, setMode] = useState<FinderMode>('link');
    const [query, setQuery] = useState('');
    const [ignoreCase, setIgnoreCase] = useState(false);
    const [includeDataUris, setIncludeDataUris] = useState(false);
    const [expandReferences, setExpandReferences] = useState(true);

    // If the admin reloads while a scan is running, re-attach to it.
    const [job, setJob] = useState<FinderJob | null>(() => initialJobs.find(isActive) ?? null);
    const [recentJobs, setRecentJobs] = useState<FinderJob[]>(initialJobs);

    // --- results ---------------------------------------------------------------
    const [results, setResults] = useState<FinderResultsPage | null>(null);
    const [collectionFilter, setCollectionFilter] = useState<string | null>(null);
    const [page, setPage] = useState(1);
    const [loadingResults, setLoadingResults] = useState(false);
    const resultsRequest = useRef(0);
    const [reloadTick, setReloadTick] = useState(0);

    // --- conversion ------------------------------------------------------------
    const [replacement, setReplacement] = useState('');
    const [excludedRows, setExcludedRows] = useState<Map<string, string>>(new Map()); // rowId → collection
    const [includedRows, setIncludedRows] = useState<Map<string, string>>(new Map());
    const [excludedCollections, setExcludedCollections] = useState<Set<string>>(new Set());
    const [selectionVersion, setSelectionVersion] = useState(0);
    const [plan, setPlan] = useState<ConversionPlan | null>(null);
    const [planLoading, setPlanLoading] = useState(false);
    const [activeBatch, setActiveBatch] = useState<ConversionBatch | null>(null);
    const [conversions, setConversions] = useState<ConversionBatch[]>(initialConversions);

    const [isStarting, startStarting] = useTransition();
    const [isCancelling, startCancelling] = useTransition();

    const scanActive = isActive(job);
    const meta = MODE_META[mode];
    const batchBusy = !!activeBatch && (activeBatch.status === 'running' || activeBatch.undo?.status === 'running');
    const anyBusy = batchBusy || conversions.some((c) => c.status === 'running' || c.undo?.status === 'running');
    const canConvert = !!job && job.mode !== 'uid' && !scanActive && job.status !== 'queued';
    const selectionTouched = excludedRows.size > 0 || includedRows.size > 0 || excludedCollections.size > 0;

    const selectionPayload = useCallback((): ConversionSelection => ({
        excludedRowIds: [...excludedRows.keys()],
        includedRowIds: [...includedRows.keys()],
        excludedCollections: [...excludedCollections],
    }), [excludedRows, includedRows, excludedCollections]);

    const resetSelection = useCallback(() => {
        setExcludedRows(new Map());
        setIncludedRows(new Map());
        setExcludedCollections(new Set());
        setSelectionVersion((v) => v + 1);
    }, []);

    const resetForJob = useCallback((next: FinderJob | null) => {
        setJob(next);
        setCollectionFilter(null);
        setPage(1);
        setResults(null);
        setReplacement('');
        setPlan(null);
        setActiveBatch(null);
        resetSelection();
    }, [resetSelection]);

    // --- scan polling -----------------------------------------------------------
    useEffect(() => {
        if (!job || !ACTIVE_STATUSES.has(job.status)) return;
        const id = job.id;
        const timer = setInterval(async () => {
            const fresh = await getFinderScan(id);
            if (fresh) setJob(fresh);
        }, 1200);
        return () => clearInterval(timer);
    }, [job?.id, job?.status]); // eslint-disable-line react-hooks/exhaustive-deps

    // --- results loading --------------------------------------------------------
    const loadResults = useCallback(async (jobId: string, collection: string | null, pageNo: number) => {
        const requestNo = ++resultsRequest.current;
        setLoadingResults(true);
        try {
            const pageData = await getFinderScanResults(jobId, collection, pageNo);
            if (requestNo === resultsRequest.current) setResults(pageData);
        } finally {
            if (requestNo === resultsRequest.current) setLoadingResults(false);
        }
    }, []);

    const matchCount = job?.progress.matches ?? 0;
    useEffect(() => {
        if (!job || job.status === 'queued') return;
        loadResults(job.id, collectionFilter, page);
    }, [job?.id, job?.status, matchCount, collectionFilter, page, reloadTick, loadResults]); // eslint-disable-line react-hooks/exhaustive-deps

    // Refresh the history list once a scan ends, and pick up its last conversion.
    useEffect(() => {
        if (!job || ACTIVE_STATUSES.has(job.status)) return;
        getRecentFinderScans().then(setRecentJobs).catch(() => { /* best-effort */ });
    }, [job?.id, job?.status]); // eslint-disable-line react-hooks/exhaustive-deps

    useEffect(() => {
        if (!job?.lastConversion || activeBatch) return;
        const batchId = job.lastConversion.batchId;
        getFinderConversion(batchId).then((b) => { if (b) setActiveBatch(b); }).catch(() => { /* best-effort */ });
    }, [job?.id, job?.lastConversion?.batchId]); // eslint-disable-line react-hooks/exhaustive-deps

    // --- conversion plan (debounced) ------------------------------------------------
    useEffect(() => {
        if (!job || !canConvert) {
            setPlan(null);
            return;
        }
        let cancelled = false;
        setPlanLoading(true);
        const timer = setTimeout(async () => {
            const next = await getFinderConversionPlan(job.id, selectionPayload());
            if (cancelled) return;
            setPlan(next);
            setPlanLoading(false);
        }, 350);
        return () => {
            cancelled = true;
            clearTimeout(timer);
        };
    }, [job?.id, job?.status, canConvert, selectionVersion, reloadTick]); // eslint-disable-line react-hooks/exhaustive-deps

    // --- conversion / undo polling ------------------------------------------------------
    useEffect(() => {
        if (!activeBatch || !batchBusy) return;
        const id = activeBatch.id;
        const timer = setInterval(async () => {
            const fresh = await getFinderConversion(id);
            if (fresh) setActiveBatch(fresh);
        }, 1200);
        return () => clearInterval(timer);
    }, [activeBatch?.id, batchBusy]); // eslint-disable-line react-hooks/exhaustive-deps

    // When a conversion or undo finishes: reload rows (marks), plan, history and the scan.
    const wasBusy = useRef(false);
    useEffect(() => {
        if (batchBusy) {
            wasBusy.current = true;
            return;
        }
        if (!wasBusy.current) return;
        wasBusy.current = false;
        setReloadTick((t) => t + 1);
        getRecentFinderConversions().then(setConversions).catch(() => { /* best-effort */ });
        if (job) getFinderScan(job.id).then((fresh) => { if (fresh) setJob(fresh); }).catch(() => { /* best-effort */ });
    }, [batchBusy]); // eslint-disable-line react-hooks/exhaustive-deps

    // --- handlers -------------------------------------------------------------------
    const handleStart = () => {
        const trimmed = query.trim();
        if (trimmed.length < meta.minLength) {
            toast({ variant: 'destructive', title: 'Too short', description: `Enter at least ${meta.minLength} characters.` });
            return;
        }
        startStarting(async () => {
            const res = await startFinderScan({ mode, query: trimmed, ignoreCase, includeDataUris, expandReferences });
            if (!res.success || !res.jobId) {
                toast({ variant: 'destructive', title: 'Could not start', description: res.message });
                return;
            }
            const fresh = await getFinderScan(res.jobId);
            resetForJob(fresh ?? {
                id: res.jobId, mode, query: trimmed, status: 'queued', createdAt: new Date().toISOString(),
                startedAt: null, finishedAt: null, summary: null, error: null, lastConversion: null,
                options: { ignoreCase, includeDataUris, expandReferences },
                progress: { phase: 'starting', collectionsTotal: 0, collectionsDone: 0, currentCollection: null, docsScanned: 0, docsEstimated: 0, matches: 0, byCollection: {}, updatedAt: new Date().toISOString() },
            });
        });
    };

    const handleCancel = () => {
        if (!job) return;
        startCancelling(async () => {
            const res = await cancelFinderScan(job.id);
            toast({ variant: res.success ? 'default' : 'destructive', title: res.success ? 'Cancelling' : 'Not cancelled', description: res.message });
        });
    };

    const openJob = (j: FinderJob) => resetForJob(j);

    const copy = async (text: string) => {
        try {
            await navigator.clipboard.writeText(text);
            toast({ title: 'Copied', description: text });
        } catch {
            toast({ variant: 'destructive', title: 'Copy failed', description: 'Your browser blocked clipboard access.' });
        }
    };

    const handleConvert = async () => {
        if (!job) return;
        const res = await startFinderConversion(job.id, replacement, selectionPayload());
        if (!res.success || !res.batchId) {
            toast({ variant: 'destructive', title: 'Not started', description: res.message });
            return;
        }
        const batch = await getFinderConversion(res.batchId);
        if (batch) setActiveBatch(batch);
        toast({ title: 'Converting', description: 'The conversion is running. Progress is shown in the Convert panel.' });
    };

    const handleUndo = async (batchId: string) => {
        const res = await startFinderUndo(batchId);
        if (!res.success) {
            toast({ variant: 'destructive', title: 'Undo not started', description: res.message });
            return;
        }
        const batch = await getFinderConversion(batchId);
        if (batch) setActiveBatch(batch);
        toast({ title: 'Undoing', description: 'The old text is being put back.' });
    };

    // --- ticks ----------------------------------------------------------------------
    // Mirrors decideRow() in src/lib/master-finder-convert.ts; the server decides, this only predicts.
    const isRowTicked = (row: FinderMatch): boolean => {
        const mark = row.conversion?.status;
        if (row.eligibility.status === 'protected' || mark === 'changed') return false;
        if (includedRows.has(row.id)) return true;
        if (excludedRows.has(row.id)) return false;
        if (excludedCollections.has(row.collection)) return false;
        return row.eligibility.status === 'eligible' && mark !== 'skipped' && mark !== 'restore-skipped';
    };

    const setRowTicked = (row: FinderMatch, on: boolean) => {
        setIncludedRows((prev) => { const m = new Map(prev); if (on) m.set(row.id, row.collection); else m.delete(row.id); return m; });
        setExcludedRows((prev) => { const m = new Map(prev); if (on) m.delete(row.id); else m.set(row.id, row.collection); return m; });
        setSelectionVersion((v) => v + 1);
    };

    /** on = back to the default ticks for that collection; off = untick every row in it. */
    const setCollectionTicked = (name: string, on: boolean) => {
        setExcludedCollections((prev) => { const s = new Set(prev); if (on) s.delete(name); else s.add(name); return s; });
        setIncludedRows((prev) => { const m = new Map(prev); for (const [id, c] of prev) if (c === name) m.delete(id); return m; });
        setExcludedRows((prev) => { const m = new Map(prev); for (const [id, c] of prev) if (c === name) m.delete(id); return m; });
        setSelectionVersion((v) => v + 1);
    };

    // --- derived --------------------------------------------------------------------
    const progress = job?.progress;
    const percent = useMemo(() => {
        if (!job) return 0;
        if (!ACTIVE_STATUSES.has(job.status)) return 100;
        if (!progress || progress.docsEstimated <= 0) return 0;
        return Math.min(99, Math.round((progress.docsScanned / progress.docsEstimated) * 100));
    }, [job, progress]);

    const counts = useMemo(() => {
        const source = job?.summary?.byCollection ?? job?.progress.byCollection ?? {};
        return Object.entries(source).sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]));
    }, [job]);

    const totalPages = results ? Math.max(1, Math.ceil(results.total / results.pageSize)) : 1;
    const summary = job?.summary ?? null;
    const errorEntries = summary ? Object.entries(summary.errors) : [];
    const showTicks = canConvert;
    const previewText = replacement.trim();

    return (
        <div className="space-y-6">
            {/* ------------------------------------------------------------ search */}
            <Card>
                <CardHeader>
                    <CardTitle className="flex items-center gap-2 text-2xl font-headline">
                        <ScanSearch className="h-6 w-6" /> Master Finder
                    </CardTitle>
                    <CardDescription>
                        Search the entire database for a link, an exact sentence or a UID and see every place it is used.
                        Links and sentences can then be converted to new text, with undo. Scanning never changes anything.
                    </CardDescription>
                </CardHeader>
                <CardContent className="space-y-4">
                    <Tabs value={mode} onValueChange={(v) => setMode(v as FinderMode)}>
                        <TabsList>
                            <TabsTrigger value="link" className="gap-1.5"><Link2 className="h-4 w-4" /> Link</TabsTrigger>
                            <TabsTrigger value="sentence" className="gap-1.5"><Type className="h-4 w-4" /> Sentence</TabsTrigger>
                            <TabsTrigger value="uid" className="gap-1.5"><UserRound className="h-4 w-4" /> UID</TabsTrigger>
                        </TabsList>
                    </Tabs>

                    <div className="space-y-2">
                        <Label htmlFor="finder-query">{meta.label} to find</Label>
                        {mode === 'sentence' ? (
                            <Textarea
                                id="finder-query"
                                rows={3}
                                value={query}
                                onChange={(e) => setQuery(e.target.value)}
                                placeholder={meta.placeholder}
                                disabled={scanActive}
                            />
                        ) : (
                            <Input
                                id="finder-query"
                                value={query}
                                onChange={(e) => setQuery(e.target.value)}
                                placeholder={meta.placeholder}
                                disabled={scanActive}
                                onKeyDown={(e) => { if (e.key === 'Enter' && !scanActive && !isStarting && !anyBusy) handleStart(); }}
                            />
                        )}
                        <p className="text-xs text-muted-foreground">{meta.help}</p>
                    </div>

                    <div className="flex flex-wrap gap-x-8 gap-y-3">
                        {mode !== 'uid' && (
                            <div className="flex items-center gap-2">
                                <Switch id="finder-case" checked={ignoreCase} onCheckedChange={setIgnoreCase} disabled={scanActive} />
                                <Label htmlFor="finder-case" className="font-normal">Ignore letter case</Label>
                            </div>
                        )}
                        {mode === 'uid' && (
                            <div className="flex items-center gap-2">
                                <Switch id="finder-refs" checked={expandReferences} onCheckedChange={setExpandReferences} disabled={scanActive} />
                                <Label htmlFor="finder-refs" className="font-normal">Follow linked records (second pass)</Label>
                            </div>
                        )}
                        <div className="flex items-center gap-2">
                            <Switch id="finder-data" checked={includeDataUris} onCheckedChange={setIncludeDataUris} disabled={scanActive} />
                            <Label htmlFor="finder-data" className="font-normal">Include base64 media (much slower)</Label>
                        </div>
                    </div>

                    <div className="flex flex-wrap items-center gap-2">
                        <Button onClick={handleStart} disabled={scanActive || isStarting || anyBusy} className="font-bold">
                            {isStarting ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <ScanSearch className="mr-2 h-4 w-4" />}
                            {scanActive ? 'Scan in progress…' : 'Start scan'}
                        </Button>
                        {scanActive && (
                            <Button variant="outline" onClick={handleCancel} disabled={isCancelling}>
                                {isCancelling ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <XCircle className="mr-2 h-4 w-4" />}
                                Cancel
                            </Button>
                        )}
                        <span className="text-xs text-muted-foreground">
                            {anyBusy
                                ? 'A conversion or undo is running; scanning waits until it finishes.'
                                : 'The scan reads every record in every collection, so it can take a little while on large logs.'}
                        </span>
                    </div>
                </CardContent>
            </Card>

            {/* ---------------------------------------------------------- progress */}
            {job && progress && (
                <Card>
                    <CardHeader className="pb-3">
                        <div className="flex flex-wrap items-center justify-between gap-2">
                            <CardTitle className="text-lg flex items-center gap-2">
                                <ScanStatusBadge status={job.status} />
                                <span className="font-normal text-muted-foreground">{MODE_META[job.mode].label}:</span>
                                <span className="break-all font-mono text-sm">{job.query}</span>
                            </CardTitle>
                            <div className="text-sm text-muted-foreground">
                                {fmtInt(progress.matches)} {plural(progress.matches, 'match', 'matches')}
                                {summary && <> · {fmtDuration(summary.durationMs)}</>}
                            </div>
                        </div>
                    </CardHeader>
                    <CardContent className="space-y-3">
                        {ACTIVE_STATUSES.has(job.status) && (
                            <>
                                <Progress value={percent} className="h-2" />
                                <p className="text-sm text-muted-foreground">
                                    {progress.phase === 'references' ? 'Pass 2 of 2, following linked records' : progress.phase === 'scan' ? (job.mode === 'uid' && job.options.expandReferences ? 'Pass 1 of 2' : 'Scanning') : 'Preparing'}
                                    {progress.currentCollection && <> · <span className="font-mono">{progress.currentCollection}</span></>}
                                    {' '}· {fmtInt(progress.docsScanned)} of about {fmtInt(progress.docsEstimated)} records
                                    {' '}· {progress.collectionsDone}/{progress.collectionsTotal} collections
                                </p>
                            </>
                        )}

                        {job.status === 'failed' && (
                            <p className="flex items-start gap-2 text-sm text-destructive">
                                <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" /> {job.error ?? 'The scan failed.'}
                            </p>
                        )}

                        {summary && (
                            <div className="space-y-1 text-sm text-muted-foreground">
                                <p>
                                    {fmtInt(summary.totalMatches)} {plural(summary.totalMatches, 'match', 'matches')} in {fmtInt(Object.keys(summary.byCollection).length)} {plural(Object.keys(summary.byCollection).length, 'collection')}
                                    {' '}· {fmtInt(progress.collectionsTotal)} collections scanned
                                    {job.mode === 'uid' && job.options.expandReferences && <> · {fmtInt(summary.referenceSeeds)} {plural(summary.referenceSeeds, 'record')} followed for links</>}
                                </p>
                                {summary.truncated && (
                                    <p className="flex items-start gap-2 text-amber-700">
                                        <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" />
                                        Only the first {fmtInt(summary.storedMatches)} matches were kept. Narrow the search to see everything.
                                    </p>
                                )}
                                {summary.referenceSeedsLimited && (
                                    <p className="flex items-start gap-2 text-amber-700">
                                        <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" />
                                        This ID owns more records than the linked-record pass can follow; only the first {fmtInt(summary.referenceSeeds)} were followed.
                                    </p>
                                )}
                                {errorEntries.length > 0 && (
                                    <p className="flex items-start gap-2 text-destructive">
                                        <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" />
                                        Could not read {errorEntries.map(([name]) => name).join(', ')}.
                                    </p>
                                )}
                                {(summary.skippedCollections.length > 0 || summary.skippedFields.length > 0 || summary.dataUrisSkipped > 0) && (
                                    <details className="text-xs">
                                        <summary className="cursor-pointer select-none">What was not inspected</summary>
                                        <ul className="mt-1 list-disc space-y-0.5 pl-5">
                                            {summary.skippedCollections.map((s) => <li key={s}>{s}</li>)}
                                            {summary.skippedFields.map((s) => <li key={s}>{s}</li>)}
                                            {summary.dataUrisSkipped > 0 && <li>{fmtInt(summary.dataUrisSkipped)} base64 media {plural(summary.dataUrisSkipped, 'value')} (turn on “Include base64 media” to scan them)</li>}
                                        </ul>
                                    </details>
                                )}
                            </div>
                        )}
                    </CardContent>
                </Card>
            )}

            {/* ----------------------------------------------------------- convert */}
            {job && canConvert && (
                <ConvertPanel
                    job={job}
                    plan={plan}
                    planLoading={planLoading}
                    replacement={replacement}
                    onReplacementChange={setReplacement}
                    batch={activeBatch}
                    busy={anyBusy}
                    selectionTouched={selectionTouched}
                    onResetSelection={resetSelection}
                    onConvert={handleConvert}
                    onUndo={handleUndo}
                />
            )}

            {/* ----------------------------------------------------------- results */}
            {job && job.status !== 'queued' && (
                <Card>
                    <CardHeader className="pb-3">
                        <CardTitle className="text-lg">Where it is used</CardTitle>
                        <CardDescription>
                            Grouped by collection. Click a collection to filter. “Open” jumps to the admin page that manages the record.
                            {showTicks && <> Untick any row that must keep the old text; protected rows cannot be ticked.</>}
                        </CardDescription>
                    </CardHeader>
                    <CardContent className="space-y-4">
                        {counts.length > 0 && (
                            <div className="flex flex-wrap items-center gap-2">
                                <button
                                    type="button"
                                    onClick={() => { setCollectionFilter(null); setPage(1); }}
                                    className={cn(
                                        'rounded-full border px-3 py-1 text-xs font-medium transition-colors',
                                        collectionFilter === null ? 'bg-primary text-primary-foreground border-primary' : 'bg-background hover:bg-muted',
                                    )}
                                >
                                    All · {fmtInt(counts.reduce((a, [, n]) => a + n, 0))}
                                </button>
                                {counts.map(([name, n]) => (
                                    <button
                                        key={name}
                                        type="button"
                                        onClick={() => { setCollectionFilter(name); setPage(1); }}
                                        className={cn(
                                            'rounded-full border px-3 py-1 text-xs font-mono transition-colors',
                                            collectionFilter === name ? 'bg-primary text-primary-foreground border-primary' : 'bg-background hover:bg-muted',
                                            excludedCollections.has(name) && 'line-through opacity-70',
                                        )}
                                    >
                                        {name} · {fmtInt(n)}
                                    </button>
                                ))}
                            </div>
                        )}

                        {showTicks && collectionFilter && (
                            <div className="flex flex-wrap items-center gap-2 text-xs">
                                <span className="text-muted-foreground">Ticks for <span className="font-mono">{collectionFilter}</span>:</span>
                                <Button variant="outline" size="sm" className="h-7 text-xs" onClick={() => setCollectionTicked(collectionFilter, false)} disabled={anyBusy || excludedCollections.has(collectionFilter)}>
                                    Untick all
                                </Button>
                                <Button variant="outline" size="sm" className="h-7 text-xs" onClick={() => setCollectionTicked(collectionFilter, true)} disabled={anyBusy}>
                                    Back to default
                                </Button>
                            </div>
                        )}

                        {results && results.rows.length === 0 && !loadingResults && (
                            <p className="py-8 text-center text-sm text-muted-foreground">
                                {ACTIVE_STATUSES.has(job.status) ? 'No matches yet…' : 'No matches found.'}
                            </p>
                        )}

                        {(!results || (results.rows.length === 0 && loadingResults)) && (
                            <p className="py-8 text-center text-sm text-muted-foreground flex items-center justify-center gap-2">
                                <Loader2 className="h-4 w-4 animate-spin" /> Loading…
                            </p>
                        )}

                        {results && results.rows.length > 0 && (
                            <div className="space-y-2">
                                {results.rows.map((row) => {
                                    const ticked = showTicks && isRowTicked(row);
                                    const protectedRow = row.eligibility.status === 'protected';
                                    const converted = row.conversion?.status === 'changed';
                                    return (
                                        <div
                                            key={row.id}
                                            className={cn(
                                                'rounded-lg border bg-card p-3 text-sm',
                                                showTicks && !ticked && !protectedRow && !converted && 'opacity-80',
                                            )}
                                        >
                                            <div className="flex items-start gap-3">
                                                {showTicks && (
                                                    <div className="pt-0.5">
                                                        {protectedRow ? (
                                                            <Lock className="h-4 w-4 text-muted-foreground" aria-label={`Protected: ${row.eligibility.reason ?? ''}`} />
                                                        ) : (
                                                            <Checkbox
                                                                checked={ticked}
                                                                disabled={anyBusy || converted}
                                                                onCheckedChange={(c) => setRowTicked(row, c === true)}
                                                                aria-label="Include this field in the conversion"
                                                            />
                                                        )}
                                                    </div>
                                                )}
                                                <div className="min-w-0 flex-1 space-y-1">
                                                    <div className="flex flex-wrap items-start justify-between gap-2">
                                                        <div className="min-w-0 space-y-1">
                                                            <div className="flex flex-wrap items-center gap-2">
                                                                <Badge variant="outline" className="font-mono">{row.collection}</Badge>
                                                                <span className="font-medium break-words">{row.label}</span>
                                                            </div>
                                                            <div className="flex flex-wrap items-center gap-x-2 gap-y-1 text-xs text-muted-foreground">
                                                                <span>
                                                                    field <span className="font-mono text-foreground">{row.path}</span>
                                                                </span>
                                                                <Badge variant="secondary" className="font-normal">{kindLabel(row, job.mode)}</Badge>
                                                                {variantLabel(row.variant) && <Badge variant="secondary" className="font-normal">{variantLabel(row.variant)}</Badge>}
                                                                {row.occurrences > 1 && <span>× {row.occurrences} in this field</span>}
                                                                {row.via && (
                                                                    <span>
                                                                        via <span className="font-mono">{row.via.collection}</span> {shortId(row.via.docId)}
                                                                    </span>
                                                                )}
                                                                {showTicks && protectedRow && (
                                                                    <Badge variant="outline" className="gap-1 font-normal">
                                                                        <Lock className="h-3 w-3" /> protected: {row.eligibility.reason}
                                                                    </Badge>
                                                                )}
                                                                {showTicks && row.eligibility.status === 'warning' && (
                                                                    <Badge variant="outline" className="gap-1 border-amber-400 font-normal text-amber-700">
                                                                        <AlertTriangle className="h-3 w-3" /> needs a look: {row.eligibility.reason}
                                                                    </Badge>
                                                                )}
                                                                {row.conversion && <ConversionMarkBadge mark={row.conversion} />}
                                                            </div>
                                                        </div>
                                                        <div className="flex shrink-0 items-center gap-1">
                                                            <Button variant="ghost" size="sm" className="h-7 gap-1 px-2 font-mono text-xs" onClick={() => copy(row.docId)} title={row.docId}>
                                                                <Copy className="h-3 w-3" /> {shortId(row.docId)}
                                                            </Button>
                                                            {row.adminPath && (
                                                                <Button asChild variant="outline" size="sm" className="h-7 gap-1 px-2 text-xs">
                                                                    <Link href={row.adminPath} target="_blank" rel="noopener noreferrer">
                                                                        <ExternalLink className="h-3 w-3" /> Open
                                                                    </Link>
                                                                </Button>
                                                            )}
                                                        </div>
                                                    </div>
                                                    <p className="rounded bg-muted/60 p-2 font-mono text-xs leading-relaxed">
                                                        <Snippet row={row} />
                                                    </p>
                                                    {showTicks && ticked && previewText && row.matchStart >= 0 && (
                                                        <p className="rounded bg-emerald-50 p-2 font-mono text-xs leading-relaxed dark:bg-emerald-950/40">
                                                            <span className="select-none text-muted-foreground">after → </span>
                                                            <AfterSnippet row={row} replacement={previewText} />
                                                        </p>
                                                    )}
                                                </div>
                                            </div>
                                        </div>
                                    );
                                })}
                            </div>
                        )}

                        {results && results.total > results.pageSize && (
                            <div className="flex items-center justify-between pt-2">
                                <Button variant="outline" size="sm" onClick={() => setPage((p) => Math.max(1, p - 1))} disabled={page <= 1 || loadingResults}>
                                    <ChevronLeft className="mr-1 h-4 w-4" /> Previous
                                </Button>
                                <span className="text-sm text-muted-foreground">
                                    Page {page} of {totalPages} · {fmtInt(results.total)} matches
                                </span>
                                <Button variant="outline" size="sm" onClick={() => setPage((p) => Math.min(totalPages, p + 1))} disabled={page >= totalPages || loadingResults}>
                                    Next <ChevronRight className="ml-1 h-4 w-4" />
                                </Button>
                            </div>
                        )}
                    </CardContent>
                </Card>
            )}

            {/* ----------------------------------------------------------- history */}
            {recentJobs.length > 0 && (
                <Card>
                    <CardHeader className="pb-3">
                        <CardTitle className="text-lg flex items-center gap-2"><History className="h-5 w-5" /> Recent scans</CardTitle>
                        <CardDescription>The last few scans are kept so their results can be reopened.</CardDescription>
                    </CardHeader>
                    <CardContent>
                        <ul className="divide-y">
                            {recentJobs.map((j) => (
                                <li key={j.id} className="flex flex-wrap items-center justify-between gap-2 py-2 text-sm">
                                    <button
                                        type="button"
                                        onClick={() => openJob(j)}
                                        className={cn('min-w-0 flex-1 text-left hover:underline', job?.id === j.id && 'font-semibold')}
                                    >
                                        <span className="text-muted-foreground">{MODE_META[j.mode].label}: </span>
                                        <span className="break-all font-mono text-xs">{j.query.length > 90 ? `${j.query.slice(0, 89)}…` : j.query}</span>
                                    </button>
                                    <div className="flex items-center gap-3 text-xs text-muted-foreground">
                                        <span>{fmtInt(j.progress.matches)} {plural(j.progress.matches, 'match', 'matches')}</span>
                                        {j.lastConversion && <Badge variant="outline" className="font-normal">converted {fmtInt(j.lastConversion.changed)}</Badge>}
                                        <WhenIST iso={j.createdAt} />
                                        <ScanStatusBadge status={j.status} />
                                    </div>
                                </li>
                            ))}
                        </ul>
                    </CardContent>
                </Card>
            )}

            <ConversionHistory
                conversions={conversions}
                busy={anyBusy}
                currentJobId={job?.id ?? null}
                onUndo={handleUndo}
                loadChanges={(batchId, pageNo) => getFinderConversionChanges(batchId, pageNo)}
            />
        </div>
    );
}
