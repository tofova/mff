
'use client';

import { useState, useEffect } from 'react';
import Link from 'next/link';

export default function RefundPolicyPage() {
  const [currentDate, setCurrentDate] = useState('');

  useEffect(() => {
    setCurrentDate(new Date().toLocaleDateString('en-IN', {
      year: 'numeric',
      month: 'long',
      day: 'numeric',
    }));
  }, []);

  return (
    <div className="ffi-clear bg-background">
      <div className="container mx-auto px-6 py-16">
        <div className="max-w-4xl mx-auto">
          <h1 className="text-4xl md:text-5xl font-bold font-headline text-primary mb-6 text-center">
            Refund Policy
          </h1>
          <p className="text-center text-muted-foreground mb-8">Last Updated: {currentDate}</p>

          <div className="flex justify-center mb-8">
            <Link
              href="/refundstatus"
              className="inline-flex items-center justify-center rounded-md bg-primary px-6 py-3 text-sm font-semibold text-primary-foreground shadow transition-colors hover:bg-primary/90"
            >
              Check Refund Status
            </Link>
          </div>

          <div className="prose prose-lg max-w-none text-foreground space-y-6">
            <p>
              At Garena, we strive to ensure a seamless and satisfactory experience for all our users. As the official and trusted store, we are committed to transparency. This policy outlines the conditions under which refunds can be processed for purchases made on our website.
            </p>

            <h2 className="font-headline text-3xl font-semibold !mt-12 !mb-4">1. General Policy</h2>
            <p>
              Due to the digital nature of our products (in-game items and currency), all sales are generally considered final. However, we understand that exceptional circumstances can occur. Refund requests are reviewed on a case-by-case basis and are subject to the terms outlined below.
            </p>

            <h2 className="font-headline text-3xl font-semibold !mt-12 !mb-4">2. UPI Payments</h2>
            <p>
              You are eligible for a full refund under the following conditions:
            </p>
            <ul className="list-disc list-outside space-y-2 pl-6">
              <li>
                Your payment was successful, but the purchased item was not delivered to your game account, and the order status is marked as "Failed" in your order history.
              </li>
              <li>
                In the event of a "Failed" order, any coins used for that purchase will be automatically returned to your coin wallet. If the coins are not returned, please contact us.
              </li>
            </ul>

            <h2 className="font-headline text-3xl font-semibold !mt-12 !mb-4">3. Redeem Code Purchases</h2>
            <p>
              Purchases made using a Redeem Code are typically non-refundable once the code has been submitted and the order is in "Processing" or "Completed" status. This is because the codes are processed through third-party systems. However, if you believe there was a technical error during the redemption process, you may still submit a refund request for review.
            </p>
            
            <h2 className="font-headline text-3xl font-semibold !mt-12 !mb-4">4. Non-Refundable Situations</h2>
            <p>
              We are unable to provide refunds in the following situations:
            </p>
             <ul className="list-disc list-outside space-y-2 pl-6">
              <li>
                You entered the wrong Free Fire Gaming ID during purchase. It is the user's responsibility to ensure the ID is correct.
              </li>
              <li>
                You have changed your mind after a successful purchase and delivery of the item.
              </li>
               <li>
                Bans or restrictions on your game account due to violations of Garena's game policies.
              </li>
               <li>
                Issues related to in-game mechanics or items after successful delivery.
              </li>
            </ul>

            <h2 className="font-headline text-3xl font-semibold !mt-12 !mb-4">5. How to Request a Refund</h2>
            <p>
              All refund requests must be submitted through our official refund request page. Please provide the UTR/Transaction ID or the Redeem Code and a clear reason for the request.
            </p>
             <p>
              You can access the form here: <Link href="/refund-request" className="text-primary hover:underline font-semibold">Refund Request Page</Link>.
            </p>
            <p>
              Our team will review your request and typically respond within 3-5 business days. Approved refunds will be processed back to the original payment method where possible.
            </p>

            <h2 className="font-headline text-3xl font-semibold !mt-12 !mb-4">Contact Us</h2>
            <p>
              If you have any questions about our Refund Policy, please <Link href="/contact" className="text-primary hover:underline font-semibold">contact us</Link>.
            </p>
          </div>
        </div>
      </div>
    </div>
  );
}
