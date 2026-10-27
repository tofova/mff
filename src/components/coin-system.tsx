
'use client';

import { useState, useEffect, useActionState, useTransition, useCallback } from 'react';
import Link from 'next/link';
import { Card, CardContent } from './ui/card';
import { Coins, Tv, Shield, KeyRound, Loader2, Send, AlertCircle, RefreshCw, History } from 'lucide-react';
import type { User, Notification as GiftHistoryItem } from '@/lib/definitions';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter, DialogClose } from '@/components/ui/dialog';
import { Label } from './ui/label';
import { Input } from './ui/input';
import { useToast } from '@/hooks/use-toast';
import { transferCoins, setGiftPassword, getGiftHistoryForUser, getUserData } from '@/app/actions';
import { useFormStatus } from 'react-dom';
import GamingIdModal from './gaming-id-modal';
import { Button } from './ui/button';
import { Alert, AlertDescription, AlertTitle } from './ui/alert';
import { PasswordInput } from '@/app/account/_components/password-input';
import { ScrollArea } from './ui/scroll-area';
import { useRefresh } from '@/context/RefreshContext';
import Radar from './layout/radar';
import { isFfIndiaThemeActive } from '@/lib/ff-india-theme';
import { IndiaMapLoop } from '@/components/ff-india-theme';


interface CoinSystemProps {
  user: User | null;
}

function TransferSubmitButton() {
    const { pending } = useFormStatus();
    return (
        <Button type="submit" disabled={pending} className="gap-2">
            {pending ? <Loader2 className="animate-spin" /> : <Send />}
            {pending ? 'Sending...' : 'Send Coins'}
        </Button>
    )
}

function SetPasswordSubmitButton() {
    const { pending } = useFormStatus();
    return (
        <Button type="submit" className="w-full" disabled={pending}>
            {pending ? <Loader2 className="animate-spin" /> : 'Set Gift Password'}
        </Button>
    );
}

const GiftHistoryFormattedDate = ({ dateString }: { dateString: string }) => {
    const [mounted, setMounted] = useState(false);
    useEffect(() => setMounted(true), []);

    if (!mounted) {
        return null;
    }
    const date = new Date(dateString);
    return date.toLocaleString('en-IN', {
        timeZone: 'Asia/Kolkata',
        year: 'numeric',
        month: 'short',
        day: 'numeric',
        hour: 'numeric',
        minute: 'numeric',
    });
}


const initialState = { success: false, message: '' };

type View = 'transfer' | 'setPassword';

export default function CoinSystem({ user: initialUser }: CoinSystemProps) {
  const [currentUser, setCurrentUser] = useState(initialUser);
  const [isModalOpen, setIsModalOpen] = useState(false);
  const [isRegisterModalOpen, setIsRegisterModalOpen] = useState(false);
  const [hasModalBeenDismissed, setHasModalBeenDismissed] = useState(false);
  const [isHistoryOpen, setIsHistoryOpen] = useState(false);
  const [historyItems, setHistoryItems] = useState<GiftHistoryItem[]>([]);
  const [isHistoryLoading, startHistoryTransition] = useTransition();
  const [view, setView] = useState<View>('transfer');
  const { toast } = useToast();
  const { refreshKey } = useRefresh();

  const [setPasswordState, setPasswordFormAction] = useActionState(setGiftPassword, initialState);
  const [transferState, transferFormAction] = useActionState(transferCoins, initialState);
  
  const fetchUserData = useCallback(async () => {
    const updatedUser = await getUserData();
    setCurrentUser(updatedUser);
  }, []);

  useEffect(() => {
    const interval = setInterval(fetchUserData, 15000); // Poll every 15 seconds
    return () => clearInterval(interval);
  }, [fetchUserData]);

  useEffect(() => {
    if (refreshKey > 0) {
      fetchUserData();
    }
  }, [refreshKey, fetchUserData]);

  useEffect(() => {
    if (currentUser?.giftPassword) {
      setView('transfer');
    } else {
      setView('setPassword');
    }
  }, [currentUser, isModalOpen]);

  useEffect(() => {
    if (!currentUser && !hasModalBeenDismissed) {
      const timer = setTimeout(() => setIsRegisterModalOpen(true), 1500); 
      return () => clearTimeout(timer);
    }
  }, [currentUser, hasModalBeenDismissed]);
  
  useEffect(() => {
    if (setPasswordState.message) {
      toast({
        variant: setPasswordState.success ? 'default' : 'destructive',
        title: setPasswordState.success ? 'Success' : 'Error',
        description: setPasswordState.message,
      });
      if (setPasswordState.success) {
        setIsModalOpen(false);
      }
    }
  }, [setPasswordState, toast]);

  useEffect(() => {
    if (transferState.message) {
      toast({
        variant: transferState.success ? 'default' : 'destructive',
        title: transferState.success ? 'Success' : 'Error',
        description: transferState.message,
      });
      if (transferState.success) {
        setIsModalOpen(false);
      }
    }
  }, [transferState, toast]);

  const handleUnregisteredClick = (e: React.MouseEvent) => {
    if (!currentUser) {
        e.preventDefault();
        setIsRegisterModalOpen(true);
    }
  };

  const handleModalOpenChange = (isOpen: boolean) => {
    setIsRegisterModalOpen(isOpen);
    if (!isOpen && !currentUser) {
      setHasModalBeenDismissed(true);
    }
  };
  
  const handleShowHistory = () => {
    startHistoryTransition(async () => {
        const history = await getGiftHistoryForUser();
        setHistoryItems(history);
        setIsHistoryOpen(true);
    });
  };

  const renderSetPasswordView = () => (
     <form action={setPasswordFormAction}>
        <DialogHeader>
            <DialogTitle className="flex items-center gap-2"><KeyRound /> {currentUser?.giftPassword ? 'Reset' : 'Set'} Your Gift Password</DialogTitle>
            <DialogDescription>Create a secure password to protect your coin transfers. You will need this password every time you send coins to another player.</DialogDescription>
        </DialogHeader>
        <div className="py-4 space-y-4">
            <div className="space-y-2">
            <Label htmlFor="gift-password">New Gift Password</Label>
            <PasswordInput id="gift-password" name="giftPassword" required minLength={6} />
            </div>
        </div>
        <DialogFooter>
            <DialogClose asChild><Button variant="ghost">Cancel</Button></DialogClose>
            <SetPasswordSubmitButton />
        </DialogFooter>
    </form>
  )

  const renderTransferView = () => (
    <form action={transferFormAction}>
        <DialogHeader>
            <DialogTitle>Transfer Coins</DialogTitle>
            <DialogDescription>
                Send coins to another user. This action is irreversible. Your current balance is {currentUser?.coins}.
            </DialogDescription>
        </DialogHeader>
        <div className="space-y-4 py-4">
            <div className="space-y-2">
                <Label htmlFor="recipientId">Recipient's Gaming ID</Label>
                <Input id="recipientId" name="recipientId" required />
            </div>
            <div className="space-y-2">
                <Label htmlFor="amount">Amount</Label>
                <Input id="amount" name="amount" type="number" required min="1" max={currentUser?.coins} />
            </div>
            <div className="space-y-2">
                <Label htmlFor="transfer-gift-password">Your Gift Password</Label>
                <PasswordInput id="transfer-gift-password" name="giftPassword" required />
            </div>
        </div>
        <DialogFooter className="flex-wrap !justify-between gap-2">
            <div className="flex items-center gap-2">
                <Button variant="outline" type="button" onClick={handleShowHistory} disabled={isHistoryLoading} className="gap-2">
                    {isHistoryLoading ? <Loader2 className="animate-spin"/> : <History/>}
                    History
                </Button>
                {currentUser?.canSetGiftPassword && (
                    <Button variant="outline" type="button" onClick={() => setView('setPassword')} className="gap-2">
                        <RefreshCw /> Reset Password
                    </Button>
                 )}
            </div>
            <div className="flex gap-2 justify-end">
                <DialogClose asChild><Button variant="ghost">Cancel</Button></DialogClose>
                <TransferSubmitButton />
            </div>
        </DialogFooter>
    </form>
  )
  
   const renderEligibilityCheckView = () => (
    <>
        <DialogHeader>
            <DialogTitle className="flex items-center gap-2"><Shield /> Secure Your Gifting</DialogTitle>
            <DialogDescription>To enable coin transfers, you first need to set a gift password.</DialogDescription>
        </DialogHeader>
        <Alert variant="destructive" className="my-4">
            <AlertCircle className="h-4 w-4" />
            <AlertTitle>Action Required to Enable Gifting</AlertTitle>
            <AlertDescription>
                To set your gift password, you must first use all of your available coins during a single purchase. Once that order is marked as "Completed" by our admin team, you will be able to set your password here. This is a one-time security verification step to enable this feature.
            </AlertDescription>
        </Alert>
        <DialogFooter>
            <DialogClose asChild><Button>Got it</Button></DialogClose>
        </DialogFooter>
    </>
  )
  

  const renderModalContent = () => {
    if (!currentUser) return null;

    if (view === 'setPassword') {
        return currentUser.canSetGiftPassword ? renderSetPasswordView() : renderEligibilityCheckView();
    }
    
    if (view === 'transfer') {
        return currentUser.giftPassword ? renderTransferView() : renderEligibilityCheckView();
    }
    
    return null;
  };
  
  return (
    <>
      <GamingIdModal isOpen={isRegisterModalOpen} onOpenChange={handleModalOpenChange} />
      <Dialog open={isHistoryOpen} onOpenChange={setIsHistoryOpen}>
        <DialogContent className="max-w-md">
            <DialogHeader>
                <DialogTitle>Your Gift History</DialogTitle>
                <DialogDescription>A record of all the coins you've sent.</DialogDescription>
            </DialogHeader>
            <ScrollArea className="h-96">
                <div className="space-y-3 pr-4 py-2">
                    {historyItems.length > 0 ? historyItems.map(item => {
                        // Extract amount and recipient from message
                        const match = item.message.match(/sent you (\d+) coin/);
                        const amount = match ? parseInt(match[1], 10) : 0;
                        return (
                            <div key={item._id.toString()} className="flex justify-between items-center text-sm p-3 rounded-md bg-muted/50">
                                <div>
                                    <p className="font-medium font-sans">Sent to: <span className="font-mono">{item.gamingId}</span></p>
                                    <p className="text-xs text-muted-foreground">
                                        <GiftHistoryFormattedDate dateString={item.createdAt as unknown as string} />
                                    </p>
                                </div>
                                <div className="font-bold font-sans text-right text-amber-500 flex items-center gap-1">
                                    {amount} <Coins className="w-4 h-4"/>
                                </div>
                            </div>
                        )
                    }) : (
                        <p className="text-sm text-muted-foreground text-center py-8">You haven't sent any gifts yet.</p>
                    )}
                </div>
            </ScrollArea>
        </DialogContent>
      </Dialog>
      <section className="w-full py-6 bg-muted/40 border-b">
        <div className="container mx-auto px-4 md:px-6">
          <div className="flex justify-center items-stretch gap-4">
            
            <Link 
              href="/watch-ad"
              onClick={handleUnregisteredClick} 
              className="flex-1 max-w-[100px] sm:max-w-[120px]"
            >
              <Card className="hover:bg-primary/5 transition-colors h-full">
                <CardContent className="p-2 flex flex-col items-center justify-center text-center min-h-[60px] w-[100px] sm:w-[120px]">
                    <Tv className="w-5 h-5 mx-auto text-primary" />
                    <p className="font-semibold mt-1 text-xs">Watch Ad</p>
                    <p className="text-xs text-muted-foreground">(+5 Coins)</p>
                </CardContent>
              </Card>
            </Link>
            
            <Dialog open={isModalOpen} onOpenChange={setIsModalOpen}>
                {/* Coin gifting feature temporarily hidden: guests still get the login popup, but logged-in users' clicks do nothing (modal never opens). Code remains intact. */}
                <div onClick={(e) => { handleUnregisteredClick(e); }} className="flex-1 max-w-[100px] sm:max-w-[120px] cursor-pointer">
                    <Card className="hover:bg-primary/5 transition-colors h-full">
                    <CardContent className="p-2 flex flex-col items-center justify-center text-center min-h-[60px] w-[100px] sm:w-[120px]">
                        <Coins className="w-5 h-5 mx-auto text-amber-500" />
                        <p className="font-semibold mt-1 text-xs">{currentUser ? `${currentUser.coins} Coins` : "0 Coins"}</p>
                        <p className="text-xs text-muted-foreground">&nbsp;</p>
                    </CardContent>
                    </Card>
                </div>

              {currentUser && (
                  <DialogContent>
                    {renderModalContent()}
                  </DialogContent>
              )}
            </Dialog>
          </div>
          <div className="flex justify-center items-center gap-2 pt-6">
            {isFfIndiaThemeActive() ? <IndiaMapLoop /> : <Radar />}
            <span className="text-primary font-semibold">India</span>
          </div>
        </div>
      </section>
    </>
  );
}
