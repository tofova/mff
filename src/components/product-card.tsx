

'use client';

import Image from 'next/image';
import { Button } from '@/components/ui/button';
import {
  Card,
  CardContent,
  CardFooter,
  CardHeader,
  CardTitle,
  CardDescription,
} from '@/components/ui/card';
import { useState, useEffect } from 'react';
import PurchaseModal from './purchase-modal';
import type { Product, User, UserProductControl, Order } from '@/lib/definitions';
import { Ban, Coins, Timer, CheckCircle2, Lock, PackageCheck, User as UserIcon, PackageX } from 'lucide-react';
import { useToast } from '@/hooks/use-toast';
import { cn } from '@/lib/utils';
import { type ObjectId } from 'mongodb';
import ProductTag from './product-tag';
import ProductMedia from './product-media';
import GamingIdModal from './gaming-id-modal';


interface ProductCardProps {
  product: Product & { _id: string | ObjectId };
  user: User | null;
  orders: Order[];
  control: UserProductControl | undefined;
}

const LiveStock = ({ product }: { product: Product }) => {
    const [displayStock, setDisplayStock] = useState(0);
    const [isMounted, setIsMounted] = useState(false);

    useEffect(() => {
        setIsMounted(true);
        if (!product.liveStock || !product.liveStockStart || !product.liveStockInterval) {
            return;
        }

        const calculateCurrentStock = () => {
            const elapsedSeconds = (new Date().getTime() - new Date(product.liveStockStart!).getTime()) / 1000;
            if (product.liveStockIncreases) {
                const stockIncreased = Math.floor(elapsedSeconds / product.liveStockInterval!);
                return Math.max(0, product.liveStock! + stockIncreased);
            } else {
                const stockDecreased = Math.floor(elapsedSeconds / product.liveStockInterval!);
                return Math.max(0, product.liveStock! - stockDecreased);
            }
        };

        // Set initial stock immediately
        const initialStock = calculateCurrentStock();
        setDisplayStock(initialStock);

        const calculateSmartStock = () => {
            const trueStock = calculateCurrentStock();

            if (product.liveStockIncreases) {
                setDisplayStock(currentDisplayStock => {
                    if (currentDisplayStock < trueStock - 5) {
                        return Math.min(trueStock, currentDisplayStock + Math.floor(Math.random() * 3) + 1);
                    }
                     if (currentDisplayStock >= trueStock) {
                        return trueStock;
                    }
                    const randomAction = Math.random();
                    if (randomAction < 0.25) { // Pause
                        return currentDisplayStock;
                    } else if (randomAction < 0.85) { // Increase by 1
                        return Math.min(trueStock, currentDisplayStock + 1);
                    } else { // Increase by 2 or 3
                        const jumpAmount = Math.random() < 0.7 ? 2 : 3;
                        return Math.min(trueStock, currentDisplayStock + jumpAmount);
                    }
                });
            } else {
                 setDisplayStock(currentDisplayStock => {
                    if (currentDisplayStock > trueStock + 5) {
                        return Math.max(trueStock, currentDisplayStock - Math.floor(Math.random() * 3) - 1);
                    }
                    if (currentDisplayStock <= trueStock) {
                        return trueStock;
                    }
                    const randomAction = Math.random();
                    if (randomAction < 0.25) { 
                        return currentDisplayStock;
                    } else if (randomAction < 0.85) { 
                        return Math.max(trueStock, currentDisplayStock - 1);
                    } else { 
                        const dropAmount = Math.random() < 0.7 ? 2 : 3;
                        return Math.max(trueStock, currentDisplayStock - dropAmount);
                    }
                });
            }
        };
        
        calculateSmartStock();
        const updateInterval = Math.min(Math.max(product.liveStockInterval * 1000, 200), 1000);
        const timer = setInterval(calculateSmartStock, updateInterval);

        return () => clearInterval(timer);
    }, [product]);

    if (!isMounted || !product.liveStock) {
        return null;
    }
    
    if (product.liveStockIncreases) {
        return (
            <p className="text-sm text-blue-600 font-bold flex items-center gap-2">
                <UserIcon className="w-4 h-4"/>
                {displayStock} people purchased
            </p>
        );
    }

    if (displayStock <= 0) {
      return <p className="text-sm text-destructive font-bold flex items-center gap-2"><PackageX className="w-4 h-4"/> Sold Out!</p>
    }

    return (
        <p className="text-sm text-green-600 font-bold flex items-center gap-2">
            <PackageCheck className="w-4 h-4"/>
            {displayStock} Available
        </p>
    );
};


const CountdownTimer = ({ endDate, isComingSoon }: { endDate: Date; isComingSoon?: boolean }) => {
  const [timeLeft, setTimeLeft] = useState({
    days: 0,
    hours: 0,
    minutes: 0,
    seconds: 0,
  });
  const [isMounted, setIsMounted] = useState(false);

  useEffect(() => {
    setIsMounted(true);
    const timer = setInterval(() => {
      const now = new Date();
      const difference = new Date(endDate).getTime() - now.getTime();

      if (difference > 0) {
        setTimeLeft({
          days: Math.floor(difference / (1000 * 60 * 60 * 24)),
          hours: Math.floor((difference / (1000 * 60 * 60)) % 24),
          minutes: Math.floor((difference / 1000 / 60) % 60),
          seconds: Math.floor((difference / 1000) % 60),
        });
      } else {
        setTimeLeft({ days: 0, hours: 0, minutes: 0, seconds: 0 });
        clearInterval(timer);
      }
    }, 1000);

    return () => clearInterval(timer);
  }, [endDate]);
  
  if (!isMounted) {
    return null;
  }

  const { days, hours, minutes, seconds } = timeLeft;

  const hasEnded = days === 0 && hours === 0 && minutes === 0 && seconds === 0;

  if (hasEnded) {
    return null; // When the timer finishes, render nothing.
  }

  const timerLabel = isComingSoon ? "Coming Soon:" : "Ending soon:";
  const timerColor = isComingSoon ? "text-teal-600 border-teal-500/20" : "text-destructive border-destructive/20";


  return (
    <div className={cn(
        "absolute top-2 right-2 bg-background/80 backdrop-blur-sm font-bold text-xs px-2 py-1 rounded-full shadow-md flex items-center gap-1.5 border",
        timerColor
      )}>
        <Timer className="w-3.5 h-3.5" />
        <>
            <span>{timerLabel}</span>
            <div className="flex items-center gap-1 font-mono tracking-tighter">
                {days > 0 && <span>{String(days).padStart(2, '0')}d</span>}
                <span>{String(hours).padStart(2, '0')}h</span>
                <span>{String(minutes).padStart(2, '0')}m</span>
                <span>{String(seconds).padStart(2, '0')}s</span>
            </div>
        </>
       
    </div>
  );
};


export default function ProductCard({ product, user, orders, control }: ProductCardProps) {
  const [isPurchaseModalOpen, setIsPurchaseModalOpen] = useState(false);
  const [isRegisterModalOpen, setIsRegisterModalOpen] = useState(false);
  const { toast } = useToast();

  const finalPrice = product.isCoinProduct 
    ? product.purchasePrice || product.price 
    : product.price - (product.coinsApplicable || 0);

  const handleBuyClick = () => {
    if (!user) {
        toast({
            variant: 'destructive',
            title: 'Please Register',
            description: 'You need to enter your Gaming ID to make a purchase.',
        });
        setIsRegisterModalOpen(true);
        return;
    }
    setIsPurchaseModalOpen(true);
  }

  const productWithStrId = { ...product, _id: product._id.toString() };
  
  const getBuyButton = () => {
    let isLiveStockSoldOut = false;
    if (product.liveStock && product.liveStockStart && product.liveStockInterval && !product.liveStockIncreases) {
        const elapsedSeconds = (new Date().getTime() - new Date(product.liveStockStart).getTime()) / 1000;
        const stockDecreased = Math.floor(elapsedSeconds / product.liveStockInterval);
        isLiveStockSoldOut = (product.liveStock - stockDecreased) <= 0;
    }

    if(isLiveStockSoldOut) {
      return <Button className="w-full font-bold text-base" disabled variant="secondary"><PackageX className="mr-2 h-4 w-4" />Sold Out</Button>;
    }


    const isEventActive = product.endDate && new Date(product.endDate) > new Date();

    if (product.isComingSoon && isEventActive) {
        return <Button className="w-full font-bold text-base" disabled variant="secondary"><Timer className="mr-2 h-4 w-4" />Coming Soon</Button>;
    }
    
    if (!product.isComingSoon && isEventActive === false && !product.isAvailable) {
      return <Button className="w-full font-bold text-base" disabled variant="secondary"><PackageX className="mr-2 h-4 w-4" />Expired</Button>;
    }
    
    if (!product.isAvailable) {
      return <Button className="w-full font-bold text-base" disabled variant="secondary"><PackageX className="mr-2 h-4 w-4" />Item Unavailable</Button>;
    }

    if (control?.type === 'block') {
      return <Button className="w-full font-bold text-base" disabled variant="secondary"><Ban className="mr-2 h-4 w-4" />{control.blockReason}</Button>;
    }

    const nonFailedOrders = orders.filter(o => o.status !== 'Failed' && o.productId === product._id.toString());
    const completedPurchases = orders.filter(o => o.status === 'Completed' && o.productId === product._id.toString()).length;

    // Rule 3: `limitPurchase` is the ultimate authority
    if (control?.type === 'limitPurchase' && control.limitCount && nonFailedOrders.length >= control.limitCount) {
        return <Button className="w-full font-bold text-base" disabled variant="secondary"><Lock className="mr-2 h-4 w-4" />Purchase Limit Reached</Button>;
    }
    
    // Rule 1: Strict check for "one-time purchase" items
    if (product.oneTimeBuy) {
        const allowance = control?.type === 'allowPurchase' ? (control.allowanceCount || 0) : 0;
        const totalAllowed = 1 + allowance;
        if (nonFailedOrders.length >= totalAllowed) {
            return <Button className="w-full font-bold text-base" disabled variant="secondary"><CheckCircle2 className="mr-2 h-4 w-4" />Already Purchased</Button>;
        }
    }

    return (
        <Button 
          className="w-full bg-accent hover:bg-accent/90 text-accent-foreground font-bold text-base transition-transform duration-200 hover:scale-105 font-sans relative overflow-hidden animate-glowing-ray"
          onClick={handleBuyClick}
        >
          Buy {product.price && <span className="line-through ml-2 text-accent-foreground/80">₹{product.price}</span>} <span className="ml-1">₹{finalPrice}</span>
        </Button>
    );
  }

  return (
    <>
      <div className="relative">
        {product.tag && (
          <ProductTag tag={product.tag} color={product.tagColor} />
        )}
        <Card className="product-card flex flex-col overflow-hidden transition-all duration-300 hover:shadow-lg hover:-translate-y-1">
          <CardHeader className="p-0">
            <div className="relative aspect-video">
              <ProductMedia src={product.imageUrl} alt={product.name} dataAiHint={product.dataAiHint} />
              {product.endDate && <CountdownTimer endDate={new Date(product.endDate)} isComingSoon={product.isComingSoon} />}
            </div>
          </CardHeader>
          <CardContent className="flex-grow p-4">
            <CardTitle className="text-lg font-headline font-semibold">{product.name}</CardTitle>
            <div className="mt-1 space-y-1">
                <CardDescription className="text-sm">
                  Quantity: {product.quantity}
                </CardDescription>
                {product.liveStock && product.liveStockInterval && <LiveStock product={product} />}
            </div>
            {product.coinsApplicable > 0 && !product.isCoinProduct && (
              <div className="text-xs text-amber-600 font-semibold mt-1 flex items-center font-sans gap-1">
                <Coins className="w-3 h-3" />
                Use {product.coinsApplicable} Coins & Get it for ₹{finalPrice}
              </div>
            )}
          </CardContent>
          <CardFooter className="p-4 pt-0">
            {getBuyButton()}
          </CardFooter>
        </Card>
      </div>
      {isPurchaseModalOpen && <PurchaseModal product={productWithStrId} user={user} onClose={() => setIsPurchaseModalOpen(false)} />}
      <GamingIdModal isOpen={isRegisterModalOpen} onOpenChange={setIsRegisterModalOpen} />
    </>
  );
}
