
'use client';

import { useSearchParams } from 'next/navigation';
import { Card, CardContent, CardFooter, CardHeader, CardTitle } from '@/components/ui/card';
import { ShieldBan, Mail, Loader2 } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Suspense, useEffect } from 'react';
import { track } from '@/lib/analytics/posthog-client';
import { AnalyticsEvents } from '@/lib/analytics/events';

function BlockedContent() {
  const searchParams = useSearchParams();
  const reason = searchParams.get('reason');

  // PostHog: how many visitors land on the access-denied screen, and why.
  useEffect(() => {
    track(AnalyticsEvents.blockedPageShown, { reason });
  }, [reason]);

  const handleReviewRequest = () => {
    track(AnalyticsEvents.blockedReviewRequested, { reason });
    const recipient = 'garenaffmaxstore@gmail.com';
    const subject = 'Access Denied - Review Request';
    const body = `
Dear Garena Support,

I am writing to request a review of a block on my access.

The reason I was shown for the block was:
"${reason || 'No reason provided.'}"

Please investigate this matter.

Thank you.
    `;
    const mailtoLink = `mailto:${recipient}?subject=${encodeURIComponent(subject)}&body=${encodeURIComponent(body)}`;
    window.location.href = mailtoLink;
  };

  return (
    <Card className="w-full max-w-md text-center">
      <CardHeader>
        <div className="mx-auto bg-destructive/10 p-3 rounded-full w-fit mb-4">
          <ShieldBan className="h-10 w-10 text-destructive" />
        </div>
        <CardTitle className="text-2xl font-headline text-destructive">
          Access Denied
        </CardTitle>
      </CardHeader>
      <CardContent>
        <p className="text-lg font-semibold text-foreground">
          {reason || 'Your access to this service has been restricted.'}
        </p>
        <p className="text-sm text-muted-foreground mt-2">
          If you believe this is a mistake, you can request a review from our support team.
        </p>
      </CardContent>
      <CardFooter>
          <Button onClick={handleReviewRequest} className="w-full">
              <Mail className="mr-2 h-4 w-4" />
              Request a Review
          </Button>
      </CardFooter>
    </Card>
  );
}

function LoadingFallback() {
  return (
    <Card className="w-full max-w-md text-center">
      <CardHeader>
        <div className="mx-auto p-3 rounded-full w-fit mb-4">
          <Loader2 className="h-10 w-10 text-muted-foreground animate-spin" />
        </div>
        <CardTitle className="text-2xl font-headline">
          Loading...
        </CardTitle>
      </CardHeader>
      <CardContent>
        <p className="text-lg font-semibold text-foreground">
          Please wait while we check your access status.
        </p>
      </CardContent>
    </Card>
  )
}

export default function BlockedPage() {
  return (
    <div className="flex items-center justify-center min-h-screen bg-muted/40 p-4">
        <Suspense fallback={<LoadingFallback />}>
            <BlockedContent />
        </Suspense>
    </div>
  );
}
