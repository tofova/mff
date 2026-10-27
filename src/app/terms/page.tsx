'use client';

import { useState, useEffect } from 'react';

export default function TermsAndConditionsPage() {
  const [currentDate, setCurrentDate] = useState('');

  useEffect(() => {
    setCurrentDate(new Date().toLocaleDateString());
  }, []);

  return (
    <div className="ffi-clear bg-background">
      <div className="container mx-auto px-6 py-16">
        <div className="max-w-4xl mx-auto">
          <h1 className="text-4xl md:text-5xl font-bold font-headline text-primary mb-6 text-center">
            Terms &amp; Conditions
          </h1>
          <p className="text-center text-muted-foreground mb-8">Last Updated: {currentDate}</p>
          
          <div className="prose prose-lg max-w-none text-foreground space-y-6">
            <p>
              Please read these Terms and Conditions ("Terms") carefully before using the Garena website (the "Service") operated by Garena.
            </p>

            <h2 className="font-headline text-3xl font-semibold !mt-12 !mb-4">1. Accounts</h2>
            <p>
              When you create an account with us, you must provide us with information that is accurate, complete, and current at all times. Failure to do so constitutes a breach of the Terms, which may result in immediate termination of your account on our Service. You are responsible for safeguarding the password that you use to access the Service and for any activities or actions under your password.
            </p>

            <h2 className="font-headline text-3xl font-semibold !mt-12 !mb-4">2. Purchases and Payments</h2>
            <p>
              If you wish to purchase any product or service made available through the Service ("Purchase"), you may be asked to supply certain information relevant to your Purchase.
            </p>
            <ul className="list-disc list-outside space-y-2 pl-6">
              <li>
                <strong>Direct Payment:</strong> If you pay directly, the purchased item will be sent to your game account immediately upon successful transaction.
              </li>
              <li>
                <strong>Redeem Code:</strong> If you use a redeem code for your top-up, the process may take up to one (1) hour to complete. We are not responsible for delays caused by high traffic or technical issues on the game server's end.
              </li>
            </ul>

            <h2 className="font-headline text-3xl font-semibold !mt-12 !mb-4">3. Refund Policy</h2>
            <p>
              Users can request a refund in accordance with our Refund Policy. All refund requests are subject to review and approval. We reserve the right to deny any refund request that we deem fraudulent or abusive.
            </p>
            
            <h2 className="font-headline text-3xl font-semibold !mt-12 !mb-4">4. Referral Program</h2>
            <p>
              Our referral program allows you to earn rewards. If a new user signs up using your referral link and completes a top-up, 50% of their first top-up amount will be credited to your account as a reward. Garena reserves the right to change the terms of the referral program or terminate it at any time. Fraudulent activity will result in the forfeiture of rewards and potential account termination.
            </p>

            <h2 className="font-headline text-3xl font-semibold !mt-12 !mb-4">5. Changes to Terms</h2>
            <p>
              We reserve the right, at our sole discretion, to modify or replace these Terms at any time. We will provide notice of any changes by posting the new Terms on this page.
            </p>

            <h2 className="font-headline text-3xl font-semibold !mt-12 !mb-4">6. Contact Us</h2>
            <p>
              If you have any questions about these Terms, please contact us.
            </p>
          </div>
        </div>
      </div>
    </div>
  );
}
