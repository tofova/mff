
'use client';

import { useState, useEffect, useMemo, useCallback } from 'react';
import { useRouter } from 'next/navigation';
import { Bell } from 'lucide-react';
import { Button } from '@/components/ui/button';
import {
  Sheet,
  SheetContent,
  SheetHeader,
  SheetTitle,
  SheetDescription,
  SheetTrigger,
} from '@/components/ui/sheet';
import { ScrollArea } from '@/components/ui/scroll-area';
import { markNotificationsAsRead, getNotificationsForUser } from '@/app/actions';
import type { Notification } from '@/lib/definitions';
import ProductMedia from '../product-media';
import { makeNotificationLinksOpenInSameTab, handleNotificationCardClick } from '@/lib/same-tab-notification-links';

interface NotificationBellProps {
  notifications: Notification[];
  onRefresh: () => void;
}

const FormattedDate = ({ dateString }: { dateString: string }) => {
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

const ClickableMessage = ({ message }: { message: string }) => {
  const urlRegex = /(https?:\/\/[^\s]+)/g;
  const parts = message.split(urlRegex);

  return (
    <p className="text-sm mb-2 font-sans break-words">
      {parts.map((part, index) => {
        if (part.match(urlRegex)) {
          return (
            <a
              key={index}
              href={part}
              target="_blank"
              rel="noopener noreferrer"
              className="text-blue-600 hover:underline break-all"
              onClick={(e) => e.stopPropagation()} // Prevent sheet from closing
            >
              {part}
            </a>
          );
        }
        return part;
      })}
    </p>
  );
};


export default function NotificationBell({ notifications: initialNotifications, onRefresh }: NotificationBellProps) {
  const router = useRouter();
  const [isOpen, setIsOpen] = useState(false);
  const [currentNotifications, setCurrentNotifications] = useState(initialNotifications);

  const unreadCount = useMemo(() => {
    return currentNotifications.filter(n => !n.isRead).length;
  }, [currentNotifications]);
  
  useEffect(() => {
    setCurrentNotifications(initialNotifications);
  }, [initialNotifications]);

  const handleOpenChange = async (open: boolean) => {
    setIsOpen(open);
    if (open && unreadCount > 0) {
      // Optimistically update the UI
      setCurrentNotifications(prev => prev.map(n => ({ ...n, isRead: true })));
      // Update the server in the background
      await markNotificationsAsRead();
    }
    
    // Refresh data from server when closing to ensure consistency
    if (!open) {
      onRefresh();
    }
  }

  if (initialNotifications.length === 0) {
    return null;
  }

  return (
    <Sheet open={isOpen} onOpenChange={handleOpenChange}>
      <SheetTrigger asChild>
        <Button variant="ghost" size="icon" className="relative">
          <Bell className="h-5 w-5" />
          {unreadCount > 0 && (
            <span className="absolute top-0 right-0 inline-flex items-center justify-center px-1.5 py-0.5 text-[10px] font-bold leading-none text-red-100 transform translate-x-1/3 -translate-y-1/3 bg-red-600 rounded-full">
              {unreadCount}
            </span>
          )}
          <span className="sr-only">Notifications</span>
        </Button>
      </SheetTrigger>
      <SheetContent className="ffi-panel">
        <SheetHeader className="mb-4">
          <SheetTitle>Notifications</SheetTitle>
          <SheetDescription>Here are your recent notifications from Garena.</SheetDescription>
        </SheetHeader>
        <ScrollArea className="h-[calc(100vh-150px)] pr-4 -mr-6">
          <div className="space-y-4 pb-8">
            {currentNotifications.map((notification) => (
              <div key={notification._id.toString()} className="p-4 rounded-lg border bg-card text-card-foreground shadow-sm">
                {notification.html ? (
                  // Rich, server-generated HTML body (e.g. refund-accepted card).
                  // Trusted content built on the server; constrained so it can never
                  // overflow the notification sheet.
                  <div
                    className="max-w-full overflow-hidden [&_img]:max-w-full [&_a]:break-words"
                    onClick={(e) =>
                      handleNotificationCardClick(e, (path) => {
                        // Close the bell sheet, then route client-side (no reload).
                        setIsOpen(false);
                        router.push(path);
                      })
                    }
                    dangerouslySetInnerHTML={{ __html: makeNotificationLinksOpenInSameTab(notification.html) }}
                  />
                ) : (
                  <ClickableMessage message={notification.message} />
                )}
                {notification.imageUrl && (
                  <div className="relative aspect-video w-full mb-2 rounded-md overflow-hidden">
                    <ProductMedia src={notification.imageUrl} alt="Notification media" />
                  </div>
                )}
                <p className="text-xs text-muted-foreground mt-2">
                  <FormattedDate dateString={notification.createdAt as unknown as string} />
                </p>
              </div>
            ))}
          </div>
        </ScrollArea>
      </SheetContent>
    </Sheet>
  );
}
