'use client';

import Link from 'next/link';
import { Menu, ShoppingCart, LogOut, Home, Download } from 'lucide-react';
import { Button } from '@/components/ui/button';
import {
  Sheet,
  SheetContent,
  SheetTrigger,
  SheetTitle,
} from '@/components/ui/sheet';
import { useState } from 'react';
import NavigationLinks from './navigation-links';
import Image from 'next/image';
import type { User, Notification as NotificationType } from '@/lib/definitions';
import NotificationBell from './notification-bell';
import { logoutUser } from '@/app/actions';
import { usePathname, useRouter } from 'next/navigation';
import { useToast } from '@/hooks/use-toast';
import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle, AlertDialogTrigger } from '../ui/alert-dialog';
import { cn } from '@/lib/utils';
import { isFfIndiaThemeActive } from '@/lib/ff-india-theme';
import { FfIndiaRibbon } from '@/components/ff-india-theme';


interface HeaderProps {
  user: User | null;
  notifications: NotificationType[];
  notificationKey: number;
  onNotificationRefresh: () => void;
}

export default function Header({ user, notifications, notificationKey, onNotificationRefresh }: HeaderProps) {
  const [isSheetOpen, setIsSheetOpen] = useState(false);
  const router = useRouter();
  const pathname = usePathname();
  const { toast } = useToast();
  const ffIndia = isFfIndiaThemeActive();

  const handleLogout = async () => {
    const result = await logoutUser();
    if (result.success) {
      toast({
        title: "Logged Out",
        description: "You have been successfully logged out.",
      });
      // After a successful logout, send the user to the home page (full navigation
      // so server state is refreshed just like the previous reload behavior).
      window.location.href = '/';
    } else {
      toast({
        variant: "destructive",
        title: "Error",
        description: result.message,
      });
    }
  };

  return (
    <header className="sticky top-0 z-50 w-full border-b border-border/40 bg-background/95 backdrop-blur supports-[backdrop-filter]:bg-background/60">
      {ffIndia && <FfIndiaRibbon className="ffi-ribbon-glide" />}
      <div className="container px-4 md:px-6 flex h-16 items-center justify-between">
        <Link href="/" className="flex items-center gap-2">
           <Image src="/img/garena.png" alt="Garena Logo" width={32} height={23} className="w-8 h-auto" />
          <span className="font-bold font-headline text-lg">Garena</span>
        </Link>

        <div className="flex items-center gap-4">
          <nav className="hidden md:flex items-center gap-6 text-sm font-medium">
             <NavigationLinks 
                notifications={notifications} 
                user={user} 
                notificationKey={notificationKey}
                onNotificationRefresh={onNotificationRefresh}
              />
             {user && (
              <Button variant="ghost" onClick={handleLogout}>Logout</Button>
             )}
          </nav>

          <div className="flex items-center md:hidden">
             {notifications.length > 0 && <NotificationBell key={notificationKey} notifications={notifications} onRefresh={onNotificationRefresh} />}
            <Button variant="ghost" size="icon" asChild className={cn(pathname === '/' && 'text-primary bg-primary/10')}>
                <Link href="/">
                    <Home className="h-5 w-5" />
                    <span className="sr-only">Home</span>
                </Link>
            </Button>
            <Button variant="ghost" size="icon" asChild className={cn(pathname === '/order' && 'text-primary bg-primary/10')}>
              <Link href="/order">
                <ShoppingCart className="h-5 w-5" />
                <span className="sr-only">Order</span>
              </Link>
            </Button>
            <Sheet open={isSheetOpen} onOpenChange={setIsSheetOpen}>
              <SheetTrigger asChild>
                <Button variant="outline" size="icon">
                  <Menu className="h-5 w-5" />
                  <span className="sr-only">Toggle navigation menu</span>
                </Button>
              </SheetTrigger>
              <SheetContent side="right" className="ffi-panel">
                <SheetTitle className="sr-only">Navigation Menu</SheetTitle>
                <div className="flex flex-col gap-6 pt-10">
                  <Link
                    href="/"
                    className="flex items-center gap-2 mb-4"
                    onClick={() => setIsSheetOpen(false)}
                  >
                    <Image src="/img/garena.png" alt="Garena Logo" width={32} height={23} className="w-8 h-auto" />
                    <span className="font-bold font-headline text-lg">
                      Garena
                    </span>
                  </Link>
                  <NavigationLinks 
                    mobile 
                    onLinkClick={() => setIsSheetOpen(false)} 
                    notifications={notifications} user={user} 
                    notificationKey={notificationKey}
                    onNotificationRefresh={onNotificationRefresh}
                  />
                  {user && (
                    <Button variant="outline" onClick={async () => {
                      await handleLogout();
                      setIsSheetOpen(false);
                    }}>
                      <LogOut className="mr-2" /> Logout
                    </Button>
                  )}
                </div>
              </SheetContent>
            </Sheet>
          </div>
        </div>
      </div>
    </header>
  );
}
