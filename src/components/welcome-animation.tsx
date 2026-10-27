
'use client';

import { useEffect } from 'react';
import { Coins } from 'lucide-react';
import Image from 'next/image';
import { isFfIndiaThemeActive } from '@/lib/ff-india-theme';
import { TricolourMark } from '@/components/ff-india-theme';

interface WelcomeAnimationProps {
  coins?: number;
}

export default function WelcomeAnimation({ coins }: WelcomeAnimationProps) {
  const ffIndia = isFfIndiaThemeActive();
  useEffect(() => {
    const timer = setTimeout(() => {
      window.location.reload();
    }, 3500); // A little longer than the animation to ensure it completes

    return () => clearTimeout(timer);
  }, []);

  return (
    <div className="fixed inset-0 z-[999] flex flex-col items-center justify-center bg-background/80 backdrop-blur-sm p-8">
        <div className="text-center p-8 pt-12 flex flex-col items-center">
            <Image src="/img/garena.png" alt="Garena Logo" width={80} height={80} className="mb-4 opacity-0 animate-[fade-in-up_0.5s_ease-out_0.2s_forwards]" />
             <div className="relative inline-block mb-6">
                <svg className="w-28 h-28" viewBox="0 0 100 100">
                    <path 
                        d="M 50, 5 A 45,45 0 1 1 49.9,5"
                        fill="none" 
                        stroke="hsl(var(--primary))" 
                        strokeWidth="5" 
                        strokeLinecap="round" 
                        className="animate-[draw-g_1s_ease-out_forwards]"
                        style={{ strokeDasharray: 283, strokeDashoffset: 283, animationDelay: '0.5s' }}
                    />
                     <path 
                        d="M 30 50 L 45 65 L 70 40" 
                        fill="none" 
                        stroke="hsl(var(--primary))" 
                        strokeWidth="5" 
                        strokeLinecap="round" 
                        strokeLinejoin="round" 
                        className="animate-[draw-g_0.5s_ease-out_forwards]"
                        style={{ strokeDasharray: 60, strokeDashoffset: 60, animationDelay: '1.2s' }}
                    />
                </svg>
            </div>

            <h1 className="text-4xl font-headline font-bold text-foreground animate-[fade-in-up_0.5s_ease-out_1.5s_forwards] opacity-0">
              {coins && coins > 0 ? 'Welcome!' : 'Welcome Back!'}
            </h1>
            {ffIndia && (
              <p className="mt-3 inline-flex items-center gap-2 font-headline text-sm font-semibold text-foreground/80 animate-[fade-in-up_0.5s_ease-out_1.6s_forwards] opacity-0">
                <TricolourMark className="h-3" />
                Free Fire India launch celebration
              </p>
            )}
            
            {coins && coins > 0 && (
              <div className="relative mt-4 h-24">
                 <p className="text-2xl font-semibold text-primary animate-[fade-in-up_0.5s_ease-out_1.7s_forwards] opacity-0">
                    Congratulations!
                </p>
                
                <div className="flex items-center justify-center gap-2 mt-2 text-xl text-muted-foreground animate-[fade-in-up_0.5s_ease-out_1.9s_forwards] opacity-0">
                  You've received
                  <div className="relative flex items-center justify-center gap-1 font-bold text-foreground">
                    <div className="relative z-10 flex items-center gap-1">
                        <Coins className="w-6 h-6 text-amber-500" />
                        {coins} Coins
                    </div>
                  </div>
                </div>
              </div>
            )}
            
            <div className={
              "w-full max-w-xs bg-muted rounded-full h-1.5 overflow-hidden " +
              (coins ? 'mt-0' : 'mt-8')
            }>
              <div
                className={ffIndia ? 'ffi-tricolour h-1.5 rounded-full animate-progress-smooth' : 'bg-primary h-1.5 rounded-full animate-progress-smooth'}
                style={{'--duration': '3s', animationDelay: '0.5s', transform: 'translateX(-100%)'} as React.CSSProperties}
              ></div>
            </div>
        </div>

      <style jsx>{`
        @keyframes draw-g { to { stroke-dashoffset: 0; } }
        
        @keyframes fade-in-up {
          from { opacity: 0; transform: translateY(20px); }
          to { opacity: 1; transform: translateY(0); }
        }
        @keyframes progress-smooth {
          from { transform: translateX(-100%); }
          to { transform: translateX(0); }
        }
      `}</style>
    </div>
  );
}
