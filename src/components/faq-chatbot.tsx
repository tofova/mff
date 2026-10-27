
'use client';

import { useState, useRef, type FormEvent, useEffect, useCallback } from 'react';
import { useRouter } from 'next/navigation';
import { Bot, Loader2, Send, Sparkles, Image as ImageIcon, X } from 'lucide-react';
import { Button } from '@/components/ui/button';
import {
  Sheet,
  SheetContent,
  SheetHeader,
  SheetTitle,
  SheetDescription,
  SheetFooter,
  SheetTrigger,
} from '@/components/ui/sheet';
import { Textarea } from '@/components/ui/textarea';
import { useToast } from '@/hooks/use-toast';
import { askQuestion, getChatHistory } from '@/app/actions';
import { ScrollArea } from './ui/scroll-area';
import { type AiLog } from '@/lib/definitions';
import { handleNotificationCardClick } from '@/lib/same-tab-notification-links';
import { isFfIndiaThemeActive } from '@/lib/ff-india-theme';
import { TricolourMark } from '@/components/ff-india-theme';
import Image from 'next/image';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogClose,
} from '@/components/ui/dialog';

interface Message {
  role: 'user' | 'assistant';
  content: string;
  timestamp?: Date;
  mediaDataUri?: string;
}

const FormattedDate = ({ date }: { date?: Date }) => {
    const [mounted, setMounted] = useState(false);
    useEffect(() => setMounted(true), []);
    if (!mounted || !date) return null;

    const d = new Date(date);
    return d.toLocaleString('en-IN', {
      timeZone: 'Asia/Kolkata',
      hour: 'numeric',
      minute: 'numeric',
    });
}

const ClickableMessageContent = ({ text }: { text: string }) => {
  const router = useRouter();
  const urlRegex = /(https?:\/\/[^\s]+|[\w-.]+@[\w-]+\.[\w-.]+)/g;
  const parts = text.split(urlRegex);

  return (
    <>
      {parts.map((part, index) => {
        if (part && part.match(urlRegex)) {
          const href = part.startsWith('http') ? part : `mailto:${part}`;
          return (
            <a
              key={index}
              href={href}
              target="_blank"
              rel="noopener noreferrer"
              className="text-blue-500 hover:underline break-all"
              // Same-site links (e.g. /order, /support the AI suggests) route
              // silently in the same tab — no reload. External links and mailto:
              // are left alone by the helper and keep their normal behaviour.
              onClick={(e) => handleNotificationCardClick(e, (path) => router.push(path))}
            >
              {part}
            </a>
          );
        }
        return <span key={index} className="break-words">{part}</span>;
      })}
    </>
  );
};


export default function FaqChatbot() {
  const [isOpen, setIsOpen] = useState(false);
  const [messages, setMessages] = useState<Message[]>([]);
  const [isLoading, setIsLoading] = useState(false);
  const [isHistoryLoading, setIsHistoryLoading] = useState(false);
  const [media, setMedia] = useState<{ uri: string; type: 'image' } | null>(null);
  const [zoomedMedia, setZoomedMedia] = useState<{ uri: string; type: 'image' } | null>(null);

  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const scrollAreaRef = useRef<HTMLDivElement>(null);
  const { toast } = useToast();

  const scrollToBottom = useCallback(() => {
    setTimeout(() => {
      const scrollViewport = scrollAreaRef.current?.querySelector('[data-radix-scroll-area-viewport]');
      if (scrollViewport) {
        scrollViewport.scrollTo({ top: scrollViewport.scrollHeight, behavior: 'smooth' });
      }
    }, 100);
  }, []);

  const fetchHistory = useCallback(async () => {
    setIsHistoryLoading(true);
    const historyLogs = await getChatHistory();
    const formattedHistory: Message[] = historyLogs.flatMap(log => {
        const historyMessages: Message[] = [];
        historyMessages.push({ role: 'user', content: log.question, timestamp: new Date(log.createdAt), mediaDataUri: log.mediaDataUri });
        historyMessages.push({ role: 'assistant', content: log.answer, timestamp: new Date(log.createdAt) });
        return historyMessages;
    });
    setMessages(formattedHistory);
    setIsHistoryLoading(false);
  }, []);

  useEffect(() => {
    if (isOpen) {
      fetchHistory();
    } else {
      setMessages([]); // Clear messages when closing
    }
  }, [isOpen, fetchHistory]);
  
  useEffect(() => {
    if (!isHistoryLoading) {
      scrollToBottom();
    }
  }, [isHistoryLoading, scrollToBottom]);

  useEffect(() => {
    if (messages.length > 0) {
      scrollToBottom();
    }
  }, [messages, scrollToBottom]);

  const handleTextareaInput = (event: React.ChangeEvent<HTMLTextAreaElement>) => {
    const textarea = event.target;
    textarea.style.height = 'auto'; // Reset height
    textarea.style.height = `${textarea.scrollHeight}px`; // Set to content height
  };
  
  const handleFileChange = (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    if (file) {
      if (file.size > 8 * 1024 * 1024) { // 8MB limit
        toast({
          variant: 'destructive',
          title: 'File too large',
          description: 'Please select an image smaller than 8MB.',
        });
        return;
      }

      const reader = new FileReader();
      reader.onloadend = () => {
        setMedia({ uri: reader.result as string, type: 'image' });
      };
      reader.readAsDataURL(file);
    }
  };

  const handleSubmit = async (e: FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    const question = textareaRef.current?.value;

    if ((!question && !media) || isLoading) return;

    setIsLoading(true);
    const userMessage: Message = { 
      role: 'user', 
      content: question || 'Please analyze this image.', 
      timestamp: new Date(), 
      mediaDataUri: media?.uri,
    };
    setMessages((prev) => [...prev, userMessage]);

    if (textareaRef.current) {
      textareaRef.current.value = '';
      textareaRef.current.style.height = 'auto'; // Reset height after submit
    }
    setMedia(null);
    
    const historyForAI = messages.map(m => ({ role: m.role, content: m.content }));

    const result = await askQuestion({ question: userMessage.content, history: historyForAI, mediaDataUri: userMessage.mediaDataUri });

    if (result.success && result.answer) {
      const assistantMessage: Message = { role: 'assistant', content: result.answer!, timestamp: new Date() };
      setMessages((prev) => [...prev, assistantMessage]);
    } else {
      toast({
        variant: 'destructive',
        title: 'Error',
        description: result.error,
      });
      setMessages((prev) => prev.slice(0, -1));
    }
    setIsLoading(false);
  };

  return (
    <>
    <Sheet open={isOpen} onOpenChange={setIsOpen}>
      <SheetTrigger asChild>
        <Button
          size="lg"
          className="fixed bottom-6 right-6 rounded-full w-16 h-16 shadow-lg bg-primary/30 backdrop-blur-sm hover:bg-primary/40 transition-transform duration-300 hover:scale-110 z-20 p-0"
          aria-label="Open FAQ Chatbot"
        >
          <Image src="/img/robo.gif" alt="Chatbot" layout="fill" className="object-cover"/>
        </Button>
      </SheetTrigger>
      <SheetContent className="flex flex-col ffi-panel">
        <SheetHeader className="mb-4">
          <SheetTitle className="font-headline text-xl flex items-center gap-2">
            <Sparkles className="text-primary w-6 h-6" />
            Garena Assistant
          </SheetTitle>
          <SheetDescription>
          Have a question? Ask me anything about our services. You can also upload an image (max 8MB).
          {isFfIndiaThemeActive() && (
            <span className="mt-1.5 flex items-center gap-1.5 text-xs font-semibold text-foreground">
              <TricolourMark className="h-2.5" />
              Celebrating the Free Fire India launch
            </span>
          )}
          </SheetDescription>
        </SheetHeader>
        <div className="flex-grow mb-4 overflow-hidden">
            <ScrollArea className="h-full pr-4" ref={scrollAreaRef}>
             {isHistoryLoading ? (
                 <div className="flex justify-center items-center h-full">
                    <Loader2 className="w-8 h-8 animate-spin text-primary" />
                 </div>
             ) : (
                <div className="space-y-4">
                    {messages.map((message, index) => (
                    <div
                        key={index}
                        className={`flex flex-col gap-1 ${
                        message.role === 'user' ? 'items-end' : 'items-start'
                        }`}
                    >
                        <div
                        className={`max-w-xs lg:max-w-md rounded-xl p-3 text-sm font-sans ${
                            message.role === 'user'
                            ? 'bg-primary text-primary-foreground rounded-br-none'
                            : 'bg-muted rounded-bl-none'
                        }`}
                        >
                        {message.mediaDataUri && (
                          <div 
                            className="relative w-full aspect-square mb-2 rounded-lg overflow-hidden cursor-pointer"
                            onClick={() => setZoomedMedia({ uri: message.mediaDataUri!, type: 'image' })}
                          >
                            <Image src={message.mediaDataUri} alt="User upload" fill className="object-cover" />
                          </div>
                        )}
                        <ClickableMessageContent text={message.content} />
                        </div>
                        <p className="text-xs text-muted-foreground px-1"><FormattedDate date={message.timestamp} /></p>
                    </div>
                    ))}
                    {isLoading && (
                    <div className="flex justify-start gap-2">
                        <div className="bg-muted rounded-xl p-3">
                        <Loader2 className="w-5 h-5 animate-spin" />
                        </div>
                    </div>
                    )}
                </div>
            )}
            </ScrollArea>
        </div>
        <SheetFooter>
          <form onSubmit={handleSubmit} className="flex flex-col w-full gap-2">
             {media && (
              <div className="relative w-24 h-24 rounded-md border p-1 bg-muted/50">
                 <Image src={media.uri} alt="Preview" fill className="object-cover rounded-md" />
                <Button 
                  size="icon" 
                  variant="destructive" 
                  className="absolute -top-2 -right-2 h-6 w-6 rounded-full"
                  onClick={() => setMedia(null)}
                >
                  <X className="h-4 w-4" />
                </Button>
              </div>
            )}
            <div className="flex w-full items-end space-x-1.5">
              <input type="file" ref={fileInputRef} onChange={handleFileChange} accept="image/*" className="hidden" />
              <Button type="button" variant="ghost" size="icon" onClick={() => fileInputRef.current?.click()} disabled={isLoading || isHistoryLoading}>
                <ImageIcon className="h-5 w-5" />
              </Button>
              <Textarea
                ref={textareaRef}
                placeholder="Ask a question..."
                disabled={isLoading || isHistoryLoading}
                className="resize-none max-h-32 min-h-10"
                rows={1}
                onInput={handleTextareaInput}
              />
              <Button type="submit" size="icon" disabled={isLoading || isHistoryLoading}>
                {isLoading ? <Loader2 className="h-4 w-4 animate-spin" /> : <Send className="h-4 w-4" />}
              </Button>
            </div>
          </form>
        </SheetFooter>
      </SheetContent>
    </Sheet>
    <Dialog open={!!zoomedMedia} onOpenChange={() => setZoomedMedia(null)}>
        <DialogContent className="max-w-3xl w-full p-0 bg-transparent border-none shadow-none" hideCloseButton={true}>
            <DialogHeader>
                <DialogTitle className="sr-only">Zoomed Media</DialogTitle>
            </DialogHeader>
            <div className="relative flex items-center justify-center">
                 <DialogClose asChild>
                    <button
                        type="button"
                        className="absolute top-0 right-0 z-10 rounded-full p-1.5 bg-white text-black transition-opacity hover:opacity-80 focus:outline-none"
                        aria-label="Close"
                    >
                        <X className="h-5 w-5" />
                    </button>
                </DialogClose>
                {zoomedMedia?.uri && (
                  <Image src={zoomedMedia.uri} alt="Zoomed media" width={1200} height={800} className="max-w-full max-h-[70vh] object-contain rounded-lg" />
                )}
            </div>
        </DialogContent>
    </Dialog>
    </>
  );
}
