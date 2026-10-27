
'use client';

import { useState, useEffect } from 'react';
import { Button } from '@/components/ui/button';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogTrigger } from '@/components/ui/dialog';
import { getLoginHistory } from '@/app/actions';
import { Loader2 } from 'lucide-react';
import { ScrollArea } from '@/components/ui/scroll-area';

type HistoryItem = {
  gamingId: string;
  timestamp: Date;
};

const FormattedDate = ({ dateString }: { dateString: Date }) => {
  const [mounted, setMounted] = useState(false);
  useEffect(() => setMounted(true), []);

  if (!mounted) {
    return null;
  }

  const date = new Date(dateString);
  return date.toLocaleString('en-IN', {
    timeZone: 'Asia/Kolkata',
    year: 'numeric',
    month: 'long',
    day: 'numeric',
    hour: 'numeric',
    minute: 'numeric',
  });
};


export default function PrivacyPolicyPage() {
  const [currentDate, setCurrentDate] = useState('');
  const [history, setHistory] = useState<HistoryItem[]>([]);
  const [isLoadingHistory, setIsLoadingHistory] = useState(false);
  const [isHistoryOpen, setIsHistoryOpen] = useState(false);

  useEffect(() => {
    setCurrentDate(new Date().toLocaleDateString());
  }, []);

  const handleFetchHistory = async () => {
    setIsLoadingHistory(true);
    try {
      const historyData = await getLoginHistory();
      
      // De-duplicate the history on the client, keeping the most recent entry for each ID
      const uniqueHistory: HistoryItem[] = [];
      const seenIds = new Set<string>();
      
      for (const item of historyData) {
        if (!seenIds.has(item.gamingId)) {
          uniqueHistory.push(item);
          seenIds.add(item.gamingId);
        }
      }

      setHistory(uniqueHistory);
    } catch (error) {
      console.error("Failed to fetch login history", error);
    }
    setIsLoadingHistory(false);
  };

  return (
    <div className="ffi-clear bg-background">
      <div className="container mx-auto px-6 py-16">
        <div className="max-w-4xl mx-auto">
          <h1 className="text-4xl md:text-5xl font-bold font-headline text-primary mb-6 text-center">
            Privacy Policy
          </h1>
          <p className="text-center text-muted-foreground mb-8">Last Updated: {currentDate}</p>

          <div className="prose prose-lg max-w-none text-foreground space-y-6">
            <p>
              Garena Gears ("we," "our," or "us") is committed to protecting your privacy. This Privacy Policy explains how we collect, use, disclose, and safeguard your information when you visit our website.
            </p>

            <h2 className="font-headline text-3xl font-semibold !mt-12 !mb-4">1. Information We Collect</h2>
            <p>
              We may collect personal information such as your name, email address, and in-game user ID when you make a purchase, create an account, or contact us. We also collect transaction data related to your purchases and may store a history of Gaming IDs used on your device for security and personalization purposes.
            </p>

            <h2 className="font-headline text-3xl font-semibold !mt-12 !mb-4">2. How We Use Your Information</h2>
            <p>We use the information we collect to:</p>
            <ul className="list-disc list-outside space-y-2 pl-6">
              <li>Process your transactions and deliver purchased items.</li>
              <li>Manage your account and provide customer support.</li>
              <li>Track orders and process refund requests.</li>
              <li>Administer our referral program.</li>
              <li>Improve our website and services.</li>
            </ul>

            <h2 className="font-headline text-3xl font-semibold !mt-12 !mb-4">3. Advertising</h2>
            <p>
              This website provides discounts on gaming items by showing ads to users. These ads may be delivered by our advertising partners, who may set cookies. These cookies allow the ad server to recognize your computer each time they send you an online advertisement to compile non-personal identification information about you or others who use your computer. This information allows ad networks to, among other things, deliver targeted advertisements that they believe will be of most interest to you. This privacy policy does not cover the use of cookies by any advertisers.
            </p>

            <h2 className="font-headline text-3xl font-semibold !mt-12 !mb-4">4. Security of Your Information</h2>
            <p>
              We use administrative, technical, and physical security measures to help protect your personal information. While we have taken reasonable steps to secure the personal information you provide to us, please be aware that despite our efforts, no security measures are perfect or impenetrable, and no method of data transmission can be guaranteed against any interception or other type of misuse.
            </p>
            
            <h2 className="font-headline text-3xl font-semibold !mt-12 !mb-4">5. Contact Us</h2>
            <p>
              If you have questions or comments about this Privacy Policy, please contact us through our contact page.
            </p>
          </div>
          <div className="text-center mt-12">
            <Dialog open={isHistoryOpen} onOpenChange={setIsHistoryOpen}>
              <DialogTrigger asChild>
                <Button variant="outline" onClick={handleFetchHistory}>
                  View Login History
                </Button>
              </DialogTrigger>
              <DialogContent>
                <DialogHeader>
                  <DialogTitle>Your Login History</DialogTitle>
                  <DialogDescription>
                    This is a list of previous Gaming IDs used on this device.
                  </DialogDescription>
                </DialogHeader>
                <div className="py-4">
                  {isLoadingHistory ? (
                    <div className="flex justify-center items-center h-40">
                      <Loader2 className="w-8 h-8 animate-spin text-primary" />
                    </div>
                  ) : history.length > 0 ? (
                    <ScrollArea className="h-64">
                      <div className="space-y-3 pr-4">
                        {history.map((item, index) => (
                          <div key={index} className="flex justify-between items-center text-sm p-3 rounded-md bg-muted/50">
                            <div>
                                <p className="font-semibold font-mono">{item.gamingId}</p>
                                <p className="text-xs text-muted-foreground">
                                  Logout Time: <FormattedDate dateString={item.timestamp} />
                                </p>
                            </div>
                          </div>
                        ))}
                      </div>
                    </ScrollArea>
                  ) : (
                    <p className="text-center text-muted-foreground py-8">
                      No previous login history found on this device.
                    </p>
                  )}
                </div>
              </DialogContent>
            </Dialog>
          </div>
        </div>
      </div>
    </div>
  );
}
