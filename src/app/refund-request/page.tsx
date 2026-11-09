
'use client';

import { useState, useEffect } from 'react';
import { useRouter } from 'next/navigation';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { Label } from '@/components/ui/label';
import { Card, CardContent, CardHeader, CardTitle, CardDescription, CardFooter } from '@/components/ui/card';
import { getUserData } from '@/app/actions';
import { createTicket } from '@/app/support/actions';
import { getMyUploadLimit, sendUserFileMessage, requestUploadLimitIncrease } from '@/app/support/file-actions';
import {
  uploadFileInChunks,
  AddAttachmentButton,
  StagedAttachmentsStrip,
  formatBytes,
  DEFAULT_UPLOAD_LIMIT_BYTES,
  type StagedAttachment,
} from '@/app/support/_components/support-attachments';
import { Loader2 } from 'lucide-react';
import { cn } from '@/lib/utils';
import { useToast } from '@/hooks/use-toast';
import GamingIdModal from '@/components/gaming-id-modal';
import RefundStatusFloating from '@/components/refund-status-floating';
import { track } from '@/lib/analytics/posthog-client';
import { AnalyticsEvents } from '@/lib/analytics/events';

export default function RefundRequestPage() {
  const [transactionId, setTransactionId] = useState('');
  const [gamingId, setGamingId] = useState('');
  const [contactNumber, setContactNumber] = useState('');
  const [message, setMessage] = useState('');
  const [isLoadingId, setIsLoadingId] = useState(true);
  const [isSubmitting, setIsSubmitting] = useState(false);
  // Attachments of any type (photos/videos/files). `oversize` remembers a too-big
  // pick so the fallback notice can be posted after the report is created.
  const [attachments, setAttachments] = useState<StagedAttachment[]>([]);
  const [oversize, setOversize] = useState<{ name: string; size: number } | null>(null);
  const [uploadLimitBytes, setUploadLimitBytes] = useState(DEFAULT_UPLOAD_LIMIT_BYTES);
  // True once the user taps the (disabled) attach button before filling the form,
  // which flags the still-empty required fields red.
  const [attachAttempted, setAttachAttempted] = useState(false);
  const [isLoggedIn, setIsLoggedIn] = useState(false);
  const [showLogin, setShowLogin] = useState(false);
  const router = useRouter();
  const { toast } = useToast();

  useEffect(() => {
    async function fetchUserId() {
      setIsLoadingId(true);
      const user = await getUserData();
      if (user) {
        setGamingId(user.visualGamingId || user.gamingId);
        setIsLoggedIn(true);
        try {
          const { limitBytes } = await getMyUploadLimit();
          setUploadLimitBytes(limitBytes);
        } catch {
          /* keep default 10MB on failure */
        }
      } else {
        // Not logged in — show the same Gaming ID login popup as the home page.
        setShowLogin(true);
      }
      setIsLoadingId(false);
    }
    fetchUserId();
  }, []);

  const allRequiredFilled = Boolean(gamingId && contactNumber && transactionId && message);

  const handleContactNumberChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const value = e.target.value;
    // Only allow digits
    const numericValue = value.replace(/\D/g, '');
    setContactNumber(numericValue);
  };

  const handleSubmitRequest = async () => {
    // Not logged in: show the Gaming ID register popup instead of submitting.
    if (!isLoggedIn) {
      setShowLogin(true);
      return;
    }

    setIsSubmitting(true);

    const reportMessage = `🧾 Refund Request

Gaming ID: ${gamingId}
Contact Number: ${contactNumber}
UTR / Transaction ID: ${transactionId}

Reason for refund:
${message}`;

    // Reports created here are named "Refund Request 1", "Refund Request 2", ...
    const result = await createTicket(reportMessage, 'Refund Request');

    if (!result.success || !result.ticketId) {
      setIsSubmitting(false);
      track(AnalyticsEvents.refundRequestFailed, { reason: result.message });
      toast({
        variant: 'destructive',
        title: 'Could not submit request',
        description: result.message,
      });
      return;
    }

    track(AnalyticsEvents.refundRequestSubmitted, {
      ticket_id: result.ticketId,
      has_attachments: attachments.length > 0,
      has_transaction_id: transactionId.trim().length > 0,
    });

    // Upload any attachments (photos/videos/files) via GridFS, then post them.
    const toSend = [...attachments];
    if (toSend.length > 0) {
      const uploadedIds: string[] = [];
      for (const att of toSend) {
        const up = await uploadFileInChunks(att.file, result.ticketId);
        if (up.success && up.fileId) {
          uploadedIds.push(up.fileId);
        } else {
          toast({ variant: 'destructive', title: 'Could not send attachment', description: up.message || 'Upload failed.' });
          break;
        }
      }
      if (uploadedIds.length > 0) {
        await sendUserFileMessage(result.ticketId, uploadedIds, '');
      }
    }

    // A too-big pick doesn't block the request — the report is still created and
    // we post the "limit reached / higher limit requested" fallback notice.
    if (oversize) {
      await requestUploadLimitIncrease(result.ticketId, oversize.name, oversize.size);
    }

    setIsSubmitting(false);
    toast({
      title: 'Refund request submitted',
      description: 'Your request has been sent to our support team. You can track replies in Garena Support.',
    });

    // Clear the fields
    setTransactionId('');
    setContactNumber('');
    setMessage('');
    setAttachments([]);
    setOversize(null);
    setAttachAttempted(false);

    // Open the new report's chat (inbox) directly; the chat's back button
    // then returns the user to the support page.
    router.push(`/support?ticket=${result.ticketId}`);
  };

  return (
    <div className="container mx-auto px-6 py-16 flex justify-center">
      <Card className="w-full max-w-2xl">
        <CardHeader>
          <CardTitle className="text-3xl font-headline">Refund Request</CardTitle>
          <CardDescription>
            Fill out the form below to submit a refund request. Your request will be sent directly to our
            support team and you can track their replies in Garena Support — no email needed.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-6">
           <div className="space-y-2">
            <Label htmlFor="gaming-id">Your Gaming ID</Label>
            <Input
              id="gaming-id"
              placeholder="Enter your Gaming ID"
              value={gamingId}
              onChange={(e) => setGamingId(e.target.value.replace(/\D/g, ''))}
              type="tel"
              pattern="[0-9]*"
              className={cn(attachAttempted && !gamingId && 'border-red-500 focus-visible:ring-red-500')}
            />
          </div>
          <div className="space-y-2">
            <Label htmlFor="contact-number">Contact Number</Label>
            <Input
              id="contact-number"
              placeholder="Enter your contact number"
              value={contactNumber}
              onChange={handleContactNumberChange}
              type="tel"
              pattern="[0-9]*"
              className={cn(attachAttempted && !contactNumber && 'border-red-500 focus-visible:ring-red-500')}
            />
          </div>
          <div className="space-y-2">
            <Label htmlFor="transaction-id">UTR/Transaction ID</Label>
            <Input
              id="transaction-id"
              placeholder="Enter your transaction ID"
              value={transactionId}
              onChange={(e) => setTransactionId(e.target.value)}
              className={cn(attachAttempted && !transactionId && 'border-red-500 focus-visible:ring-red-500')}
            />
          </div>
          <div className="space-y-2">
            <Label htmlFor="message">Why do you want a refund?</Label>
            <Textarea
              id="message"
              placeholder="Please describe the issue..."
              rows={5}
              value={message}
              onChange={(e) => setMessage(e.target.value)}
              className={cn('font-sans', attachAttempted && !message && 'border-red-500 focus-visible:ring-red-500')}
            />
          </div>
          <div className="space-y-2">
            <Label>Add Attachment (optional)</Label>
            <AddAttachmentButton
              limitBytes={uploadLimitBytes}
              disabled={!allRequiredFilled}
              onBlocked={() => {
                setAttachAttempted(true);
                toast({
                  variant: 'destructive',
                  title: 'Fill the required fields first',
                  description: 'Please complete Gaming ID, Contact Number, Transaction ID and the reason before adding an attachment.',
                });
              }}
              onPick={(accepted, over) => {
                if (accepted.length > 0) setAttachments((prev) => [...prev, ...accepted]);
                if (over) {
                  setOversize(over);
                  toast({
                    variant: 'destructive',
                    title: 'File too large',
                    description: `"${over.name}" is ${formatBytes(over.size)} (limit ${formatBytes(uploadLimitBytes)}). Your request will still be submitted and a higher limit requested.`,
                  });
                }
              }}
            />
            <p className="text-xs text-muted-foreground">
              Photos, videos or files up to {formatBytes(uploadLimitBytes)} each.
            </p>
            <StagedAttachmentsStrip
              items={attachments}
              onRemove={(id) => setAttachments((prev) => prev.filter((a) => a.id !== id))}
            />
            {oversize && (
              <p className="text-[11px] text-amber-600">
                “{oversize.name}” ({formatBytes(oversize.size)}) exceeds your {formatBytes(uploadLimitBytes)} limit — your request will be submitted and a higher limit requested.
              </p>
            )}
          </div>
        </CardContent>
        <CardFooter>
          <Button onClick={handleSubmitRequest} size="lg" className="w-full" disabled={isSubmitting || !gamingId || !transactionId || !message || !contactNumber}>
            {isSubmitting && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
            {isSubmitting ? 'Submitting...' : 'Submit Refund Request'}
          </Button>
        </CardFooter>
      </Card>

      {/* Login popup (same as the home page). It is dismissible — if the user
          doesn't want to log in right now they can close it and look around.
          The modal reloads the page on successful login. */}
      <GamingIdModal isOpen={showLogin} onOpenChange={setShowLogin} />

      {/* Floating nudge: if the user already has an accepted refund in progress,
          point them to /refundstatus instead of re-submitting the same request. */}
      <RefundStatusFloating />
    </div>
  );
}
