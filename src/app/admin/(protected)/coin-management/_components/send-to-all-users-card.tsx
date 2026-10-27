'use client';

/**
 * "Send Coins to All Users" card for the admin Coin Management page.
 *
 * Self-contained and additive: the page renders it under the existing
 * single-user "Add Coins" card, which is unchanged. The card shows who would
 * receive coins, asks for the amount (and an optional bell/push notification),
 * requires the amount to be typed again to confirm, then follows the run's
 * progress and lists recent runs with a Resume button for interrupted ones.
 */

import { useCallback, useEffect, useMemo, useState } from 'react';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { Checkbox } from '@/components/ui/checkbox';
import { Badge } from '@/components/ui/badge';
import { Progress } from '@/components/ui/progress';
import {
    AlertDialog,
    AlertDialogCancel,
    AlertDialogContent,
    AlertDialogDescription,
    AlertDialogFooter,
    AlertDialogHeader,
    AlertDialogTitle,
} from '@/components/ui/alert-dialog';
import { useToast } from '@/hooks/use-toast';
import { AlertTriangle, CheckCircle2, Coins, Loader2, RefreshCw, RotateCcw, Users, XCircle } from 'lucide-react';
import { getBulkCoinOverview, getBulkCoinRun, resumeBulkCoinSend, startBulkCoinSend, type BulkCoinOverview } from '../bulk-coin-actions';
import { BULK_COIN_RULES, DEFAULT_BULK_COIN_MESSAGE, type BulkCoinRunView } from '@/lib/bulk-coin-gift-shared';

const POLL_MS = 1500;

const formatNumber = (value: number) => value.toLocaleString('en-IN');

const formatIstDate = (iso: string) =>
    new Date(iso).toLocaleString('en-IN', {
        timeZone: 'Asia/Kolkata',
        year: 'numeric',
        month: 'short',
        day: 'numeric',
        hour: 'numeric',
        minute: 'numeric',
    });

const isSending = (run: BulkCoinRunView | null | undefined): boolean =>
    !!run && run.status === 'sending' && !run.isInterrupted;

function StatusBadge({ run }: { run: BulkCoinRunView }) {
    if (run.status === 'completed') {
        return (
            <Badge className="gap-1 bg-green-600 hover:bg-green-600 text-white">
                <CheckCircle2 className="h-3 w-3" /> Completed
            </Badge>
        );
    }
    if (run.status === 'failed') {
        return (
            <Badge variant="destructive" className="gap-1">
                <XCircle className="h-3 w-3" /> Stopped
            </Badge>
        );
    }
    if (run.isInterrupted) {
        return (
            <Badge variant="outline" className="gap-1 text-amber-600 border-amber-500">
                <AlertTriangle className="h-3 w-3" /> Interrupted
            </Badge>
        );
    }
    return (
        <Badge variant="secondary" className="gap-1">
            <Loader2 className="h-3 w-3 animate-spin" /> Sending…
        </Badge>
    );
}

function RunProgress({ run }: { run: BulkCoinRunView }) {
    const sending = isSending(run);
    return (
        <div className="rounded-lg border p-4 space-y-3" aria-live="polite">
            <div className="flex flex-wrap items-center justify-between gap-2">
                <p className="font-medium flex items-center gap-2">
                    {sending ? <Loader2 className="h-4 w-4 animate-spin" /> : <Coins className="h-4 w-4 text-amber-500" />}
                    {sending ? 'Sending coins…' : run.status === 'completed' ? 'All done' : 'Not finished'}
                </p>
                <StatusBadge run={run} />
            </div>
            <Progress value={run.percent} />
            <p className="text-sm text-muted-foreground">
                {formatNumber(run.creditedUsers)} of {formatNumber(run.targetUsers)} users received {formatNumber(run.amount)} coins
                {' · '}
                {formatNumber(run.totalCoins)} coins given{sending ? ' so far' : ''}
            </p>
            {run.status === 'completed' && run.notify && (
                <p className="text-xs text-muted-foreground">
                    Bell notification created for {formatNumber(run.notifiedUsers)} users; push sent to {formatNumber(run.pushTargets ?? 0)} devices
                    (push progress is on the Users Notification page, Broadcasts tab).
                </p>
            )}
            {run.error && <p className="text-sm text-destructive">{run.error}</p>}
        </div>
    );
}

export default function SendToAllUsersCard() {
    const { toast } = useToast();

    const [overview, setOverview] = useState<BulkCoinOverview | null>(null);
    const [loadError, setLoadError] = useState<string | null>(null);
    const [isRefreshing, setIsRefreshing] = useState(false);

    const [amountText, setAmountText] = useState('');
    const [notify, setNotify] = useState(true);
    const [message, setMessage] = useState(DEFAULT_BULK_COIN_MESSAGE);
    const [imageUrl, setImageUrl] = useState('');
    const [isPopup, setIsPopup] = useState(false);

    const [confirmOpen, setConfirmOpen] = useState(false);
    const [confirmText, setConfirmText] = useState('');
    const [isSubmitting, setIsSubmitting] = useState(false);
    const [resumingId, setResumingId] = useState<string | null>(null);

    /** The run being followed: the one just started/resumed, or the one found active on load. */
    const [activeRun, setActiveRun] = useState<BulkCoinRunView | null>(null);

    const amount = amountText.trim() === '' ? NaN : Number(amountText);
    const amountValid = Number.isInteger(amount) && amount >= BULK_COIN_RULES.minAmount && amount <= BULK_COIN_RULES.maxAmount;
    const eligible = overview?.audience.eligible ?? 0;
    const totalCoins = amountValid ? amount * eligible : 0;
    const sendingNow = isSending(activeRun);

    const messagePreview = useMemo(() => {
        const base = message.trim() || DEFAULT_BULK_COIN_MESSAGE;
        return base.replace(/\{amount\}/gi, amountValid ? formatNumber(amount) : '{amount}');
    }, [message, amount, amountValid]);

    const loadOverview = useCallback(async () => {
        setIsRefreshing(true);
        try {
            const result = await getBulkCoinOverview();
            if (!result.success) {
                setLoadError(result.message);
                return;
            }
            setLoadError(null);
            setOverview(result.overview);
            if (result.overview.activeRunId) {
                const run = await getBulkCoinRun(result.overview.activeRunId);
                if (run.success) setActiveRun((current) => (current && current.id === run.run.id && !isSending(run.run) ? current : run.run));
            }
        } finally {
            setIsRefreshing(false);
        }
    }, []);

    useEffect(() => {
        loadOverview();
    }, [loadOverview]);

    // Follow the active run until it completes, stops or goes silent.
    const activeRunId = activeRun?.id;
    const activeRunSending = sendingNow;
    useEffect(() => {
        if (!activeRunId || !activeRunSending) return;
        let cancelled = false;
        const timer = setInterval(async () => {
            const result = await getBulkCoinRun(activeRunId);
            if (cancelled || !result.success) return;
            setActiveRun(result.run);
            if (!isSending(result.run)) {
                if (result.run.status === 'completed') {
                    toast({
                        title: 'Coins sent',
                        description: `${formatNumber(result.run.amount)} coins added to ${formatNumber(result.run.creditedUsers)} users (${formatNumber(result.run.totalCoins)} coins in total).`,
                    });
                } else {
                    toast({ variant: 'destructive', title: 'Bulk coin send did not finish', description: result.run.error ?? 'Use Resume to continue.' });
                }
                loadOverview();
            }
        }, POLL_MS);
        return () => {
            cancelled = true;
            clearInterval(timer);
        };
    }, [activeRunId, activeRunSending, loadOverview, toast]);

    const openConfirm = (event: React.FormEvent<HTMLFormElement>) => {
        event.preventDefault();
        if (!amountValid) {
            toast({ variant: 'destructive', title: 'Invalid amount', description: `Enter a whole number between ${BULK_COIN_RULES.minAmount} and ${formatNumber(BULK_COIN_RULES.maxAmount)}.` });
            return;
        }
        setConfirmText('');
        setConfirmOpen(true);
    };

    const handleSend = async () => {
        if (!amountValid || isSubmitting) return;
        setIsSubmitting(true);
        try {
            const formData = new FormData();
            formData.set('amount', String(amount));
            formData.set('notify', notify ? 'on' : 'off');
            formData.set('message', notify ? message : '');
            formData.set('imageUrl', notify ? imageUrl.trim() : '');
            formData.set('isPopup', notify && isPopup ? 'on' : 'off');

            const result = await startBulkCoinSend(formData);
            if (!result.success) {
                toast({ variant: 'destructive', title: 'Could not start', description: result.message });
                return;
            }
            toast({ title: 'Started', description: result.message });
            setConfirmOpen(false);
            setConfirmText('');
            setAmountText('');
            setActiveRun(result.run);
            loadOverview();
        } finally {
            setIsSubmitting(false);
        }
    };

    const handleResume = async (runId: string) => {
        setResumingId(runId);
        try {
            const result = await resumeBulkCoinSend(runId);
            if (!result.success) {
                toast({ variant: 'destructive', title: 'Could not resume', description: result.message });
                return;
            }
            toast({ title: 'Resumed', description: result.message });
            setActiveRun(result.run);
            loadOverview();
        } finally {
            setResumingId(null);
        }
    };

    const confirmMatches = confirmText.trim() === String(amount);

    return (
        <>
            <Card className="mt-6">
                <CardHeader>
                    <CardTitle className="flex items-center gap-2">
                        <Users className="h-5 w-5" /> Send Coins to All Users
                    </CardTitle>
                    <CardDescription>
                        Give every user the same number of coins at once, for example as an event reward. Banned and hidden users are
                        skipped. Each user can also get a bell and push notification about the gift.
                    </CardDescription>
                </CardHeader>
                <CardContent className="space-y-6">
                    {/* Audience */}
                    <div className="rounded-lg border bg-muted/40 p-4">
                        <div className="flex items-center justify-between gap-2 mb-3">
                            <p className="text-sm font-medium">Who will receive coins</p>
                            <Button type="button" variant="ghost" size="sm" onClick={loadOverview} disabled={isRefreshing}>
                                {isRefreshing ? <Loader2 className="h-4 w-4 animate-spin" /> : <RefreshCw className="h-4 w-4" />}
                                <span className="ml-1">Refresh</span>
                            </Button>
                        </div>
                        {loadError ? (
                            <p className="text-sm text-destructive">{loadError}</p>
                        ) : overview ? (
                            <div className="grid grid-cols-3 gap-3 text-center">
                                <div>
                                    <p className="text-2xl font-bold">{formatNumber(overview.audience.eligible)}</p>
                                    <p className="text-xs text-muted-foreground">eligible users</p>
                                </div>
                                <div>
                                    <p className="text-2xl font-bold text-muted-foreground">{formatNumber(overview.audience.banned)}</p>
                                    <p className="text-xs text-muted-foreground">banned (skipped)</p>
                                </div>
                                <div>
                                    <p className="text-2xl font-bold text-muted-foreground">{formatNumber(overview.audience.hidden)}</p>
                                    <p className="text-xs text-muted-foreground">hidden (skipped)</p>
                                </div>
                            </div>
                        ) : (
                            <p className="text-sm text-muted-foreground flex items-center gap-2">
                                <Loader2 className="h-4 w-4 animate-spin" /> Counting users…
                            </p>
                        )}
                    </div>

                    {/* Form */}
                    <form onSubmit={openConfirm} className="space-y-6">
                        <div className="space-y-2">
                            <Label htmlFor="bulk-amount">Coins for each user</Label>
                            <Input
                                id="bulk-amount"
                                type="number"
                                inputMode="numeric"
                                min={BULK_COIN_RULES.minAmount}
                                max={BULK_COIN_RULES.maxAmount}
                                step={1}
                                required
                                placeholder="e.g., 500"
                                value={amountText}
                                onChange={(event) => setAmountText(event.target.value)}
                                disabled={sendingNow}
                            />
                            <p className="text-sm text-muted-foreground">
                                {amountValid && overview
                                    ? `${formatNumber(amount)} coins × ${formatNumber(eligible)} users = ${formatNumber(totalCoins)} coins in total.`
                                    : 'The total is shown here once you enter an amount.'}
                            </p>
                        </div>

                        <div className="space-y-4">
                            <div className="flex items-center space-x-2">
                                <Checkbox id="bulk-notify" checked={notify} onCheckedChange={(checked) => setNotify(checked === true)} disabled={sendingNow} />
                                <Label htmlFor="bulk-notify">Also notify users (bell + push notification)</Label>
                            </div>

                            {notify && (
                                <div className="space-y-4 rounded-lg border p-4">
                                    <div className="space-y-2">
                                        <Label htmlFor="bulk-message">Notification message</Label>
                                        <Textarea
                                            id="bulk-message"
                                            value={message}
                                            maxLength={BULK_COIN_RULES.maxMessageLength}
                                            onChange={(event) => setMessage(event.target.value)}
                                            placeholder={DEFAULT_BULK_COIN_MESSAGE}
                                            disabled={sendingNow}
                                        />
                                        <p className="text-xs text-muted-foreground">
                                            Write <code>{'{amount}'}</code> where the number of coins should appear. Preview: <span className="italic">{messagePreview}</span>
                                        </p>
                                    </div>
                                    <div className="space-y-2">
                                        <Label htmlFor="bulk-image">Image URL (optional)</Label>
                                        <Input
                                            id="bulk-image"
                                            value={imageUrl}
                                            onChange={(event) => setImageUrl(event.target.value)}
                                            placeholder="https://example.com/image.png"
                                            disabled={sendingNow}
                                        />
                                    </div>
                                    <div className="flex items-center space-x-2">
                                        <Checkbox id="bulk-popup" checked={isPopup} onCheckedChange={(checked) => setIsPopup(checked === true)} disabled={sendingNow} />
                                        <Label htmlFor="bulk-popup">Show as popup</Label>
                                    </div>
                                </div>
                            )}
                        </div>

                        <Button type="submit" className="w-full" disabled={sendingNow || !overview || eligible === 0 || !amountValid}>
                            {sendingNow ? (
                                <>
                                    <Loader2 className="mr-2 h-4 w-4 animate-spin" /> A send is in progress…
                                </>
                            ) : (
                                <>
                                    <Coins className="mr-2 h-4 w-4" />
                                    {amountValid && overview ? `Send ${formatNumber(amount)} Coins to ${formatNumber(eligible)} Users` : 'Send Coins to All Users'}
                                </>
                            )}
                        </Button>
                    </form>

                    {activeRun && <RunProgress run={activeRun} />}

                    {/* History */}
                    {overview && overview.history.length > 0 && (
                        <div className="space-y-3">
                            <p className="text-sm font-medium">Recent sends</p>
                            <div className="space-y-2">
                                {overview.history.map((run) => (
                                    <div key={run.id} className="flex flex-wrap items-center justify-between gap-3 rounded-md bg-muted/50 p-3 text-sm">
                                        <div className="min-w-0">
                                            <p className="font-medium flex items-center gap-1 flex-wrap">
                                                <Coins className="h-4 w-4 text-amber-500" />
                                                {formatNumber(run.amount)} coins × {formatNumber(run.creditedUsers)} users
                                                <span className="text-muted-foreground font-normal">= {formatNumber(run.totalCoins)} coins</span>
                                            </p>
                                            <p className="text-xs text-muted-foreground">
                                                {formatIstDate(run.createdAt)}
                                                {' · '}
                                                {run.notify ? 'with notification' : 'no notification'}
                                                {run.creditedUsers < run.targetUsers && run.status !== 'completed' ? ` · ${formatNumber(run.targetUsers - run.creditedUsers)} users still waiting` : ''}
                                                {run.resumedCount > 0 ? ` · resumed ${run.resumedCount}×` : ''}
                                            </p>
                                            {run.error && <p className="text-xs text-destructive mt-1">{run.error}</p>}
                                        </div>
                                        <div className="flex items-center gap-2">
                                            <StatusBadge run={run} />
                                            {run.canResume && (
                                                <Button
                                                    type="button"
                                                    size="sm"
                                                    variant="outline"
                                                    onClick={() => handleResume(run.id)}
                                                    disabled={resumingId === run.id || sendingNow}
                                                >
                                                    {resumingId === run.id ? <Loader2 className="mr-1 h-4 w-4 animate-spin" /> : <RotateCcw className="mr-1 h-4 w-4" />}
                                                    Resume
                                                </Button>
                                            )}
                                        </div>
                                    </div>
                                ))}
                            </div>
                        </div>
                    )}
                </CardContent>
            </Card>

            <AlertDialog open={confirmOpen} onOpenChange={(open) => !isSubmitting && setConfirmOpen(open)}>
                <AlertDialogContent>
                    <AlertDialogHeader>
                        <AlertDialogTitle>
                            Send {amountValid ? formatNumber(amount) : ''} coins to {formatNumber(eligible)} users?
                        </AlertDialogTitle>
                        <AlertDialogDescription>
                            Every eligible user&apos;s balance will increase by {amountValid ? formatNumber(amount) : ''} coins
                            ({formatNumber(totalCoins)} coins in total). This cannot be undone.
                            {notify ? ' Each user will also get a notification.' : ' No notification will be sent.'}
                        </AlertDialogDescription>
                    </AlertDialogHeader>
                    <div className="space-y-2">
                        <Label htmlFor="bulk-confirm">Type the amount ({amountValid ? formatNumber(amount) : ''}) to confirm</Label>
                        <Input
                            id="bulk-confirm"
                            inputMode="numeric"
                            autoComplete="off"
                            value={confirmText}
                            onChange={(event) => setConfirmText(event.target.value)}
                            placeholder={amountValid ? String(amount) : ''}
                            onKeyDown={(event) => {
                                if (event.key === 'Enter' && confirmMatches) {
                                    event.preventDefault();
                                    handleSend();
                                }
                            }}
                        />
                    </div>
                    <AlertDialogFooter className="mt-4">
                        <AlertDialogCancel disabled={isSubmitting}>Cancel</AlertDialogCancel>
                        <Button type="button" onClick={handleSend} disabled={!confirmMatches || isSubmitting}>
                            {isSubmitting ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <Coins className="mr-2 h-4 w-4" />}
                            {isSubmitting ? 'Starting…' : 'Yes, send to all users'}
                        </Button>
                    </AlertDialogFooter>
                </AlertDialogContent>
            </AlertDialog>
        </>
    );
}
