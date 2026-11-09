
'use client';

import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { useToast } from '@/hooks/use-toast';
import { logoutUser } from '@/app/actions';
import { Loader2, ShieldAlert, Mail, LogOut } from 'lucide-react';
import { useIsMobile } from '@/hooks/use-mobile';
import { Alert, AlertTitle, AlertDescription } from './ui/alert';
import { useState, useEffect } from 'react';
import { resetAnalytics, track } from '@/lib/analytics/posthog-client';
import { AnalyticsEvents } from '@/lib/analytics/events';

interface BannedNoticeProps {
  isOpen: boolean;
  onOpenChange: (isOpen: boolean) => void;
  gamingId: string;
  banMessage: string;
}

export default function BannedNotice({ isOpen, onOpenChange, gamingId, banMessage }: BannedNoticeProps) {
  const [isLoggingOut, setIsLoggingOut] = useState(false);
  const isMobile = useIsMobile();
  const { toast } = useToast();

  // PostHog: how often people hit the ban screen.
  useEffect(() => {
    if (isOpen) track(AnalyticsEvents.bannedNoticeShown, { ban_message: banMessage });
  }, [isOpen, banMessage]);

  const handleLogout = async () => {
    setIsLoggingOut(true);
    const result = await logoutUser();
    if (result.success) {
        toast({
            title: "Logged Out",
            description: "You have been successfully logged out.",
        });
        // PostHog: record the logout under this user, then detach the browser from them.
        track(AnalyticsEvents.logout, { source: 'banned_notice' }, { instant: true });
        resetAnalytics();
        // Reloading the page will clear all state and effectively log the user out from the client-side perspective
        window.location.reload(); 
    } else {
        toast({
            variant: "destructive",
            title: "Error",
            description: result.message,
        });
        setIsLoggingOut(false);
    }
  };
  
  const handleUnbanRequest = () => {
    const recipient = 'garenaffmaxstore@gmail.com';
    const subject = `Unban Request - Gaming ID: ${gamingId}`;
    const body = `
Dear Garena Support,

I am writing to request that my account be unbanned.

My Gaming ID is: ${gamingId}

The reason I received for the ban was: "${banMessage}"

Reason for my appeal:
[Please explain why you believe the ban should be lifted]

Thank you for your consideration.
    `;
    if (isMobile) {
      const mailtoLink = `mailto:${recipient}?subject=${encodeURIComponent(subject)}&body=${encodeURIComponent(body)}`;
      window.location.href = mailtoLink;
    } else {
      const gmailUrl = `https://mail.google.com/mail/?view=cm&fs=1&to=${recipient}&su=${encodeURIComponent(subject)}&body=${encodeURIComponent(body)}`;
      window.open(gmailUrl, '_blank');
    }
  };
  
  return (
    <Dialog open={isOpen} onOpenChange={onOpenChange}>
      <DialogContent 
        className="sm:max-w-md"
        onOpenAutoFocus={(e) => e.preventDefault()}
        onEscapeKeyDown={(e) => e.preventDefault()}
        onPointerDownOutside={(e) => e.preventDefault()}
        hideCloseButton={true}
      >
        <DialogHeader>
            <DialogTitle className="text-2xl font-headline flex items-center gap-2">
                <ShieldAlert className="text-destructive h-7 w-7"/> 
                Account Suspended
            </DialogTitle>
        </DialogHeader>
        <Alert variant="destructive">
            <AlertTitle>Access Denied for ID: {gamingId}</AlertTitle>
            <AlertDescription>
                {banMessage}
            </AlertDescription>
        </Alert>
        <p className="text-sm text-muted-foreground pt-2">
            If you believe this is a mistake, you can request a review from our support team.
        </p>
        <DialogFooter className="grid grid-cols-2 gap-2 mt-2">
            <Button onClick={handleUnbanRequest} variant="outline" className="w-full">
                <Mail className="mr-2"/>
                Request Unban
            </Button>
             <Button onClick={handleLogout} variant="secondary" className="w-full" disabled={isLoggingOut}>
                {isLoggingOut ? <Loader2 className="animate-spin" /> : <LogOut className="mr-2"/>}
                Logout
            </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
