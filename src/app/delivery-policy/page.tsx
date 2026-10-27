
'use client';

import { useState, useEffect } from 'react';
import Link from 'next/link';

export default function DeliveryPolicyPage() {
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
            Digital Delivery Policy
          </h1>
          <p className="text-center text-muted-foreground mb-8">Last Updated: {currentDate}</p>
          
          <div className="prose prose-lg max-w-none text-foreground space-y-6">
            <p>
              At Garena, all our products are digital and delivered directly to your in-game account. As the official and trusted store, we are committed to a transparent and efficient delivery process. This policy outlines how you will receive your purchased items.
            </p>

            <h2 className="font-headline text-3xl font-semibold !mt-12 !mb-4">1. Product Delivery</h2>
            <p>
              All items purchased on our website, such as diamonds and other in-game content, are delivered digitally to the Free Fire Gaming ID you provide during the purchase process. There is no physical shipping involved.
            </p>

            <h2 className="font-headline text-3xl font-semibold !mt-12 !mb-4">2. Delivery Timeframes</h2>
            <p>
              Delivery speed depends on the payment method you choose:
            </p>
            <ul className="list-disc list-outside space-y-2 pl-6">
              <li>
                <strong>UPI Payments:</strong> For purchases made directly via UPI, items are typically delivered to your game account instantly upon a successful transaction. Your order status will be marked as "Completed" right away.
              </li>
              <li>
                <strong>Redeem Code Payments:</strong> For purchases made using a Redeem Code, the delivery and verification process can take up to <strong>one (1) hour</strong> to complete. Your order will be in "Processing" status until our team verifies the code and completes the delivery. We are not responsible for delays caused by high server traffic or other external technical issues.
              </li>
            </ul>

            <h2 className="font-headline text-3xl font-semibold !mt-12 !mb-4">3. Order Confirmation & Tracking</h2>
            <p>
             After completing your purchase, you will see a confirmation on the screen. You can view the real-time status of all your purchases, including "Processing" or "Completed," on your <Link href="/order" className="text-primary hover:underline font-semibold">Order Page</Link> at any time.
            </p>
            
            <h2 className="font-headline text-3xl font-semibold !mt-12 !mb-4">4. Important: Correct Gaming ID</h2>
            <p>
              It is crucial that you enter your Free Fire Gaming ID correctly. We are not responsible for items delivered to an incorrect Gaming ID provided by the user. Please double-check your ID before confirming your purchase.
            </p>

            <h2 className="font-headline text-3xl font-semibold !mt-12 !mb-4">Contact Us</h2>
            <p>
              If you have not received your items within the specified timeframe or have any other questions about your order, please <Link href="/contact" className="text-primary hover:underline font-semibold">contact us</Link> immediately.
            </p>
          </div>
        </div>
      </div>
    </div>
  );
}
