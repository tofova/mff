'use client';

import { useState, useEffect, useRef, useCallback, Fragment } from 'react';
import { useRouter } from 'next/navigation';
import Image from 'next/image';
import { Button } from '@/components/ui/button';
import { Textarea } from '@/components/ui/textarea';
import { Card } from '@/components/ui/card';
import { useToast } from '@/hooks/use-toast';
import {
  ArrowLeft,
  Plus,
  Send,
  Loader2,
  MessageSquarePlus,
  CheckCheck,
  X,
  Paperclip,
  Image as ImageIcon,
  Film,
  FileText,
} from 'lucide-react';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import {
  createTicket,
  getMyTickets,
  getMyTicket,
  sendUserMessage,
  markTicketReadByUser,
} from '../actions';
import {
  getMyUploadLimit,
  requestUploadLimitIncrease,
  sendUserFileMessage,
} from '../file-actions';
import { requestCallback } from '../callback-actions';
import { CallButton, CallbackDialog } from './support-callback';
import {
  uploadFileInChunks,
  FileAttachments,
  SystemNotice,
  isSystemMessage,
  formatBytes,
  DEFAULT_UPLOAD_LIMIT_BYTES,
  AddAttachmentButton,
  StagedAttachmentsStrip,
  DeletedAttachmentTombstones,
  type StagedAttachment,
} from './support-attachments';
import type { SupportTicket, SupportMessage } from '@/lib/support-definitions';
import GamingIdModal from '@/components/gaming-id-modal';
import { track } from '@/lib/analytics/posthog-client';
import { AnalyticsEvents } from '@/lib/analytics/events';
import { makeNotificationLinksOpenInSameTab, handleNotificationCardClick } from '@/lib/same-tab-notification-links';

// A photo staged for sending: the real File (uploaded to GridFS in chunks) plus
// a data-URI preview shown in the thumbnail strip and optimistic chat bubble.
type StagedPhoto = { file: File; preview: string };

// Read a File as a base64 data URI.
function fileToDataUri(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onloadend = () => resolve(reader.result as string);
    reader.onerror = reject;
    reader.readAsDataURL(file);
  });
}

// WhatsApp-style album of one or more images inside a chat bubble.
// While `uploading` is true, a dimming overlay + spinner (and optional
// progress) is shown so the user knows the upload is in flight.
function ChatImages({
  images,
  onZoom,
  uploading = false,
  progress,
}: {
  images: { _id: string; url: string }[];
  onZoom: (url: string) => void;
  uploading?: boolean;
  progress?: { done: number; total: number } | null;
}) {
  if (!images || images.length === 0) return null;
  const isGrid = images.length > 1;
  return (
    <div
      className={`mb-1 ${isGrid ? 'grid grid-cols-2 gap-1' : ''}`}
      style={{ maxWidth: isGrid ? 260 : 240 }}
    >
      {images.map((img) => (
        <div
          key={img._id}
          className={`relative overflow-hidden rounded-md bg-black/5 ${isGrid ? 'aspect-square' : ''}`}
        >
          <button
            type="button"
            onClick={() => !uploading && onZoom(img.url)}
            className="block h-full w-full"
          >
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img
              src={img.url}
              alt="attachment"
              className={`${isGrid ? 'h-full w-full object-cover' : 'max-h-72 w-full object-cover rounded-md'} ${uploading ? 'blur-[1px]' : ''}`}
            />
          </button>
          {uploading && (
            <div className="absolute inset-0 flex items-center justify-center bg-black/30">
              <Loader2 className="h-7 w-7 text-white animate-spin" />
            </div>
          )}
        </div>
      ))}
      {uploading && progress && (
        <div className="col-span-2 text-[11px] text-gray-600 mt-0.5 flex items-center gap-1">
          <Loader2 className="h-3 w-3 animate-spin" />
          Uploading {progress.done}/{progress.total}…
        </div>
      )}
    </div>
  );
}

interface SupportClientProps {
  initialUser: { gamingId: string; visualGamingId?: string } | null;
  initialTickets: SupportTicket[];
}

// Whether two dates fall on the same calendar day (device local time).
function isSameDay(a: Date, b: Date) {
  return (
    a.getFullYear() === b.getFullYear() &&
    a.getMonth() === b.getMonth() &&
    a.getDate() === b.getDate()
  );
}

// WhatsApp-style day label: "Today", "Yesterday", or a full date.
function dayLabel(dateString: string) {
  const d = new Date(dateString);
  const today = new Date();
  if (isSameDay(d, today)) return 'Today';
  const yesterday = new Date(today);
  yesterday.setDate(today.getDate() - 1);
  if (isSameDay(d, yesterday)) return 'Yesterday';
  return d.toLocaleDateString('en-IN', { day: 'numeric', month: 'long', year: 'numeric' });
}

// Centered date chip shown between messages from different days.
function DateSeparator({ date }: { date: string }) {
  return (
    <div className="flex justify-center my-2">
      <span className="text-[11px] bg-[#E1F2FB] text-gray-600 px-3 py-1 rounded-md shadow-sm">
        {dayLabel(date)}
      </span>
    </div>
  );
}

// Renders message text, turning any URL into a clickable link. Used so the
// "refund accepted" message (which contains the /refundstatus link) is tappable
// in the chat, just like the notification bell auto-linkifies URLs.
function LinkifiedText({ text }: { text: string }) {
  const urlRegex = /(https?:\/\/[^\s]+)/g;
  const parts = text.split(urlRegex);
  return (
    <span className="whitespace-pre-wrap break-words font-sans">
      {parts.map((part, i) =>
        part.match(urlRegex) ? (
          <a
            key={i}
            href={part}
            target="_blank"
            rel="noopener noreferrer"
            className="text-blue-600 underline break-all"
            onClick={(e) => e.stopPropagation()}
          >
            {part}
          </a>
        ) : (
          <span key={i}>{part}</span>
        )
      )}
    </span>
  );
}

// Centered "chat closed" notice.
function ClosedNotice() {
  return (
    <div className="flex justify-center my-3">
      <div className="max-w-[85%] text-center bg-[#FCF4CB] text-gray-700 px-4 py-2 rounded-lg shadow-sm text-[12px] leading-relaxed">
        This chat has been closed. If you want to reopen it, just send a message again.
      </div>
    </div>
  );
}

type View = 'list' | 'new' | 'chat';

// Format a timestamp like WhatsApp (only after mount to avoid hydration issues).
function MessageTime({ date }: { date: string }) {
  const [mounted, setMounted] = useState(false);
  useEffect(() => setMounted(true), []);
  if (!mounted) return null;
  return (
    <>
      {new Date(date).toLocaleTimeString('en-IN', {
        timeZone: 'Asia/Kolkata',
        hour: 'numeric',
        minute: '2-digit',
        hour12: true,
      })}
    </>
  );
}

// The chat header that mimics a WhatsApp contact: Garena logo + name + bluetick.
// `onCall` (when provided) shows a phone button in the top-right corner that
// lets the user request a callback from a support member.
function ChatHeader({ onBack, onCall }: { onBack: () => void; onCall?: () => void }) {
  return (
    <div className="flex items-center gap-3 bg-[#075E54] text-white px-3 py-2.5 shadow-md">
      <button
        onClick={onBack}
        className="p-1 -ml-1 rounded-full hover:bg-white/10 transition-colors"
        aria-label="Back"
      >
        <ArrowLeft className="h-5 w-5" />
      </button>
      <div className="relative h-10 w-10 rounded-full bg-white flex items-center justify-center overflow-hidden ring-2 ring-white/30">
        <Image src="/img/garena.png" alt="Garena" width={32} height={32} className="object-contain" />
      </div>
      <div className="flex flex-col leading-tight">
        <div className="flex items-center gap-1">
          <span className="font-semibold text-[15px]">Garena</span>
          <Image src="/img/bluetick.gif" alt="Verified" width={16} height={16} className="h-4 w-4" />
        </div>
        <span className="text-[11px] text-white/80">Official Support</span>
      </div>
      {onCall && <CallButton onClick={onCall} />}
    </div>
  );
}

export default function SupportClient({ initialUser, initialTickets }: SupportClientProps) {
  const { toast } = useToast();
  const router = useRouter();
  const [view, setView] = useState<View>('list');
  const [tickets, setTickets] = useState<SupportTicket[]>(initialTickets);
  const [activeTicket, setActiveTicket] = useState<SupportTicket | null>(null);

  // New report compose state
  const [newMessage, setNewMessage] = useState('');

  // Chat input state
  const [chatInput, setChatInput] = useState('');

  const [isSending, setIsSending] = useState(false);

  // Image attachment state. Photos now go through the GridFS upload path (so the
  // same 10MB→250MB limit applies and they share one storage system), so we keep
  // the real File for chunked upload alongside a data-URI `preview` for the
  // staged thumbnail / optimistic bubble.
  const [stagedImages, setStagedImages] = useState<StagedPhoto[]>([]); // chat compose
  // Create-report form: any attachment type (photos/videos/files). `newOversize`
  // remembers a too-big pick so the fallback notice can be posted after the
  // report is created. `createAttachAttempted` flags the message box red when the
  // user taps the (disabled) attach button before typing.
  const [newAttachments, setNewAttachments] = useState<StagedAttachment[]>([]);
  const [newOversize, setNewOversize] = useState<{ name: string; size: number } | null>(null);
  const [createAttachAttempted, setCreateAttachAttempted] = useState(false);
  const [zoomedImage, setZoomedImage] = useState<string | null>(null);
  // Upload progress for the optimistic image message ({ done, total }).
  const [uploadProgress, setUploadProgress] = useState<{ done: number; total: number } | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const newTextareaRef = useRef<HTMLTextAreaElement>(null);
  // Chat input box: auto-grows as the user types (WhatsApp-style).
  const chatTextareaRef = useRef<HTMLTextAreaElement>(null);
  // Separate hidden inputs for the new Videos / Files options.
  const videoInputRef = useRef<HTMLInputElement>(null);
  const docInputRef = useRef<HTMLInputElement>(null);

  // Per-file upload limit (videos & files). Default 10MB; admin can grant 250MB.
  const [uploadLimitBytes, setUploadLimitBytes] = useState<number>(DEFAULT_UPLOAD_LIMIT_BYTES);
  // Progress (0..1) of an in-flight video/file upload, keyed nowhere because
  // only one large upload runs at a time.
  const [fileProgress, setFileProgress] = useState<number | null>(null);

  // Login popup (shown only when a logged-out user tries to create a report).
  const [showLogin, setShowLogin] = useState(false);

  // "Request a callback" popup state (shown from the chat header phone button).
  const [showCallback, setShowCallback] = useState(false);
  const [callbackSubmitting, setCallbackSubmitting] = useState(false);

  const messagesContainerRef = useRef<HTMLDivElement>(null);
  const pollRef = useRef<NodeJS.Timeout | null>(null);
  const listPollRef = useRef<NodeJS.Timeout | null>(null);
  // True while a send/upload is in progress, so the poll won't overwrite
  // the optimistic message (which caused images to flicker/vanish).
  const sendingRef = useRef(false);

  // Scroll only the inner messages box to the bottom (never the whole page).
  const scrollToBottom = useCallback((smooth = true) => {
    const el = messagesContainerRef.current;
    if (el) {
      el.scrollTo({ top: el.scrollHeight, behavior: smooth ? 'smooth' : 'auto' });
    }
  }, []);

  // Auto scroll when the active conversation changes / grows.
  useEffect(() => {
    if (view === 'chat') {
      // Defer so the DOM has painted the new messages before we scroll.
      requestAnimationFrame(() => scrollToBottom(false));
    }
  }, [activeTicket?.messages.length, view, scrollToBottom]);

  // WhatsApp-style auto-growing chat input: the box grows one line at a time as
  // the user types and caps at ~7 lines, after which it scrolls internally so
  // the upper text can be reviewed by scrolling up within the box.
  const CHAT_INPUT_MAX_HEIGHT = 160; // ~7 visible lines, then it starts scrolling
  const autoResizeChatInput = useCallback(() => {
    const el = chatTextareaRef.current;
    if (!el) return;
    el.style.height = 'auto'; // reset so shrinking works when text is deleted
    const next = Math.min(el.scrollHeight, CHAT_INPUT_MAX_HEIGHT);
    el.style.height = `${next}px`;
    el.style.overflowY = el.scrollHeight > CHAT_INPUT_MAX_HEIGHT ? 'auto' : 'hidden';
  }, []);

  // Keep the box sized correctly as the value changes (typing, sending/clearing,
  // or first entering the chat view).
  useEffect(() => {
    autoResizeChatInput();
  }, [chatInput, view, autoResizeChatInput]);

  // Poll the open ticket every 2s so admin replies appear (and are marked seen)
  // quickly — fast enough that an actively-watching user reliably registers a
  // "seen" before the server's 3-second notification check fires.
  //
  // Crucially we SKIP the poll while the tab is hidden (browser minimised, phone
  // locked, switched apps) and swallow network errors. In all those cases the
  // read receipt deliberately stays stale, so the user is treated as "not
  // present" and the unseen-reply notification is allowed to fire.
  useEffect(() => {
    if (view === 'chat' && activeTicket) {
      const ticketId = activeTicket._id.toString();
      pollRef.current = setInterval(async () => {
        if (sendingRef.current) return; // don't clobber an in-flight send
        // Hidden tab → not genuinely "seeing" the chat; let the notification fire.
        if (typeof document !== 'undefined' && document.hidden) return;
        try {
          const fresh = await getMyTicket(ticketId);
          if (sendingRef.current) return; // a send started while we were fetching
          if (typeof document !== 'undefined' && document.hidden) return;
          if (fresh) {
            setActiveTicket(fresh);
            if (fresh.userUnread > 0) {
              await markTicketReadByUser(ticketId);
            }
          }
        } catch {
          /* offline / fetch failed — keep read receipt stale so user gets notified */
        }
      }, 2000);
    }
    return () => {
      if (pollRef.current) clearInterval(pollRef.current);
    };
  }, [view, activeTicket?._id]);

  const refreshList = useCallback(async () => {
    const fresh = await getMyTickets();
    setTickets(fresh);
  }, []);

  const refreshUploadLimit = useCallback(async () => {
    try {
      const { limitBytes } = await getMyUploadLimit();
      setUploadLimitBytes(limitBytes);
    } catch {
      /* keep current limit on failure */
    }
  }, []);

  // Keep the upload limit fresh whenever a chat or the create form is open, so a
  // limit the admin just granted shows up (and the menu reflects the new size).
  useEffect(() => {
    if (view === 'chat' || view === 'new') {
      refreshUploadLimit();
      const id = setInterval(refreshUploadLimit, 60000);
      return () => clearInterval(id);
    }
  }, [view, activeTicket?._id, refreshUploadLimit]);

  // While viewing the report list, poll so admin replies / unread badges
  // show up live without the user manually refreshing the page.
  useEffect(() => {
    if (view === 'list') {
      listPollRef.current = setInterval(() => {
        refreshList();
      }, 5000);
    }
    return () => {
      if (listPollRef.current) clearInterval(listPollRef.current);
    };
  }, [view, refreshList]);

  // Auto-focus the textarea when the create-report form opens, so the
  // mobile keyboard comes up and the user knows to start typing.
  useEffect(() => {
    if (view === 'new') {
      const t = setTimeout(() => newTextareaRef.current?.focus(), 150);
      return () => clearTimeout(t);
    }
  }, [view]);

  // If we arrived with ?ticket=<id> (e.g. from the refund form), open that
  // report's chat directly so the user lands in the inbox. Arriving with ?new=1
  // (e.g. from a failed refund's "contact support" link) opens the create-report
  // form straight away.
  useEffect(() => {
    if (typeof window === 'undefined' || !initialUser) return;
    const params = new URLSearchParams(window.location.search);
    const ticketId = params.get('ticket');
    if (params.get('new') === '1' && !ticketId) {
      setView('new');
      return;
    }
    if (!ticketId) return;
    (async () => {
      const fresh = await getMyTicket(ticketId);
      if (fresh) {
        setActiveTicket(fresh);
        setView('chat');
      }
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const openTicket = useCallback(async (ticket: SupportTicket) => {
    setActiveTicket(ticket);
    setView('chat');
    const ticketId = ticket._id.toString();
    if (ticket.userUnread > 0) {
      await markTicketReadByUser(ticketId);
      setTickets((prev) =>
        prev.map((t) => (t._id.toString() === ticketId ? { ...t, userUnread: 0 } : t))
      );
    }
  }, []);

  // User confirmed "Yes" in the callback popup: post the system notice into the
  // active report, then refresh the chat so it appears centered immediately.
  const handleRequestCallback = async () => {
    if (!activeTicket) return;
    const ticketId = activeTicket._id.toString();
    setCallbackSubmitting(true);
    const res = await requestCallback(ticketId);
    setCallbackSubmitting(false);
    setShowCallback(false);

    if (!res.success) {
      toast({ variant: 'destructive', title: 'Error', description: res.message });
      return;
    }

    const fresh = await getMyTicket(ticketId);
    if (fresh) setActiveTicket(fresh);
    refreshList();
    toast({ title: 'Callback requested', description: res.message });
    track(AnalyticsEvents.supportCallbackRequested, { ticket_id: ticketId });
  };

  const handleCreate = async () => {
    if (!newMessage.trim()) {
      toast({ variant: 'destructive', title: 'Empty message', description: 'Please write a message.' });
      return;
    }
    setIsSending(true);
    // Reports created here are named "Support Report 1", "Support Report 2", ...
    const result = await createTicket(newMessage, 'Support Report');

    if (!result.success || !result.ticketId) {
      setIsSending(false);
      toast({ variant: 'destructive', title: 'Error', description: result.message });
      return;
    }

    const ticketId = result.ticketId;
    track(AnalyticsEvents.supportTicketCreated, {
      ticket_id: ticketId,
      message_length: newMessage.trim().length,
      has_attachments: newAttachments.length > 0,
    });

    // Upload any attachments (photos/videos/files) via GridFS, then post them.
    const toSend = [...newAttachments];
    if (toSend.length > 0) {
      const uploadedIds: string[] = [];
      for (const att of toSend) {
        const up = await uploadFileInChunks(att.file, ticketId);
        if (up.success && up.fileId) {
          uploadedIds.push(up.fileId);
        } else {
          toast({ variant: 'destructive', title: 'Could not send attachment', description: up.message || 'Upload failed.' });
          break;
        }
      }
      if (uploadedIds.length > 0) {
        await sendUserFileMessage(ticketId, uploadedIds, '');
      }
    }

    // A too-big pick doesn't block the report — it's still created, and we post
    // the "limit reached / higher limit requested" fallback notice into it.
    if (newOversize) {
      await requestUploadLimitIncrease(ticketId, newOversize.name, newOversize.size);
    }

    setNewMessage('');
    setNewAttachments([]);
    setNewOversize(null);
    setCreateAttachAttempted(false);
    setIsSending(false);

    const fresh = await getMyTicket(ticketId);
    await refreshList();
    if (fresh) {
      setActiveTicket(fresh);
      setView('chat');
    } else {
      setView('list');
    }
  };

  // Open the device photo picker.
  const handleAttachClick = () => {
    fileInputRef.current?.click();
  };

  // Validate + stage the chosen photos (size-checked against the upload limit).
  // Any photo over the limit is dropped and triggers the same "limit reached /
  // higher limit requested" system notice as videos & files.
  const handleFileSelect = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const files = Array.from(e.target.files || []);
    e.target.value = ''; // allow re-selecting the same file later
    if (files.length === 0) return;

    const accepted: StagedPhoto[] = [];
    let oversize: File | null = null;

    for (const file of files) {
      if (!file.type.startsWith('image/')) continue;
      if (file.size > uploadLimitBytes) {
        if (!oversize) oversize = file;
        continue;
      }
      try {
        accepted.push({ file, preview: await fileToDataUri(file) });
      } catch {
        /* ignore unreadable file */
      }
    }

    if (accepted.length > 0) {
      setStagedImages((prev) => [...prev, ...accepted]);
    }

    // An over-limit photo cancels (like videos/files) and requests a bigger limit.
    if (oversize && activeTicket) {
      toast({
        variant: 'destructive',
        title: 'Upload limit reached',
        description: `This photo is ${formatBytes(oversize.size)}. Your limit is ${formatBytes(uploadLimitBytes)}. A higher limit has been requested.`,
      });
      const ticketId = activeTicket._id.toString();
      const res = await requestUploadLimitIncrease(ticketId, oversize.name, oversize.size);
      if (!res.success) {
        toast({ variant: 'destructive', title: 'Error', description: res.message });
      }
      const fresh = await getMyTicket(ticketId);
      if (fresh) setActiveTicket(fresh);
      refreshList();
    }
  };

  const removeStagedImage = (index: number) => {
    setStagedImages((prev) => prev.filter((_, i) => i !== index));
  };

  const handleSend = async () => {
    if (!activeTicket) return;
    const ticketId = activeTicket._id.toString();
    const text = chatInput.trim();
    const imagesToSend = [...stagedImages];

    if (!text && imagesToSend.length === 0) return;

    setIsSending(true);
    sendingRef.current = true;
    track(AnalyticsEvents.supportMessageSent, { ticket_id: ticketId, has_text: text.length > 0, images_count: imagesToSend.length });

    // --- Send photos (if any) — uploaded to GridFS in chunks ---
    if (imagesToSend.length > 0) {
      const tempId = `temp-${Date.now()}`;
      // Optimistically show the album immediately (stays visible while uploading).
      const optimistic: SupportTicket = {
        ...activeTicket,
        messages: [
          ...activeTicket.messages,
          {
            _id: tempId as any,
            sender: 'user',
            text,
            images: imagesToSend.map((p, i) => ({ _id: `temp-img-${i}`, url: p.preview })),
            uploading: true,
            createdAt: new Date().toISOString() as any,
          } as SupportMessage,
        ],
        lastSenderRole: 'user',
      };
      setActiveTicket(optimistic);
      setChatInput('');
      setStagedImages([]);
      setUploadProgress({ done: 0, total: imagesToSend.length });

      // Upload each photo (in chunks), then post a single album message.
      const uploadedIds: string[] = [];
      for (const photo of imagesToSend) {
        const up = await uploadFileInChunks(photo.file, ticketId);
        if (up.success && up.fileId) {
          uploadedIds.push(up.fileId);
          setUploadProgress((p) => (p ? { ...p, done: p.done + 1 } : p));
        } else if (up.code === 'LIMIT_EXCEEDED') {
          await requestUploadLimitIncrease(ticketId, photo.file.name, photo.file.size);
          toast({ variant: 'destructive', title: 'Upload limit reached', description: 'A higher limit has been requested.' });
          break;
        } else {
          toast({ variant: 'destructive', title: 'Could not send photo', description: up.message || 'Upload failed.' });
          break;
        }
      }

      if (uploadedIds.length > 0) {
        await sendUserFileMessage(ticketId, uploadedIds, text);
      }

      const fresh = await getMyTicket(ticketId);
      if (fresh) setActiveTicket(fresh);
      setUploadProgress(null);
      refreshList();
      sendingRef.current = false;
      setIsSending(false);
      return;
    }

    // --- Text-only message ---
    const optimistic: SupportTicket = {
      ...activeTicket,
      messages: [
        ...activeTicket.messages,
        {
          _id: `temp-${Date.now()}` as any,
          sender: 'user',
          text,
          createdAt: new Date().toISOString() as any,
        } as SupportMessage,
      ],
      lastSenderRole: 'user',
    };
    setActiveTicket(optimistic);
    setChatInput('');

    const result = await sendUserMessage(ticketId, text);

    if (result.success) {
      const fresh = await getMyTicket(ticketId);
      if (fresh) setActiveTicket(fresh);
      refreshList();
    } else {
      toast({ variant: 'destructive', title: 'Error', description: result.message });
    }
    sendingRef.current = false;
    setIsSending(false);
  };

  // Send a single video or document. If it exceeds the current limit we DON'T
  // upload — we immediately post the "limit reached / higher limit requested"
  // system notice in the chat (admin sees it as a new message and can grant a
  // bigger limit). Within the limit, we upload in chunks with a progress bar.
  const handleSendFile = async (file: File, kind: 'video' | 'file') => {
    if (!activeTicket) return;
    const ticketId = activeTicket._id.toString();

    // --- Over the limit → cancel + request a higher limit ---
    if (file.size > uploadLimitBytes) {
      toast({
        variant: 'destructive',
        title: 'Upload limit reached',
        description: `This ${kind} is ${formatBytes(file.size)}. Your limit is ${formatBytes(uploadLimitBytes)}. A higher limit has been requested.`,
      });
      const res = await requestUploadLimitIncrease(ticketId, file.name, file.size);
      if (!res.success) {
        toast({ variant: 'destructive', title: 'Error', description: res.message });
      }
      const fresh = await getMyTicket(ticketId);
      if (fresh) setActiveTicket(fresh);
      refreshList();
      return;
    }

    setIsSending(true);
    sendingRef.current = true;
    setFileProgress(0);

    // Optimistic bubble showing the upload in flight.
    const tempId = `temp-${Date.now()}`;
    const optimistic: SupportTicket = {
      ...activeTicket,
      messages: [
        ...activeTicket.messages,
        {
          _id: tempId as any,
          sender: 'user',
          text: '',
          files: [{ _id: 'temp-file', filename: file.name, contentType: file.type, size: file.size, kind }],
          uploading: true,
          createdAt: new Date().toISOString() as any,
        } as SupportMessage,
      ],
      lastSenderRole: 'user',
    };
    setActiveTicket(optimistic);

    const up = await uploadFileInChunks(file, ticketId, (f) => setFileProgress(f));

    if (up.success && up.fileId) {
      await sendUserFileMessage(ticketId, [up.fileId], '');
    } else if (up.code === 'LIMIT_EXCEEDED') {
      // Race: limit changed mid-upload. Fall back to a limit request.
      await requestUploadLimitIncrease(ticketId, file.name, file.size);
      toast({ variant: 'destructive', title: 'Upload limit reached', description: 'A higher limit has been requested.' });
    } else {
      toast({ variant: 'destructive', title: 'Could not send', description: up.message || 'Upload failed.' });
    }

    const fresh = await getMyTicket(ticketId);
    if (fresh) setActiveTicket(fresh);
    setFileProgress(null);
    refreshList();
    sendingRef.current = false;
    setIsSending(false);
  };

  // Validate + send a chosen video/document (one at a time).
  const handleMediaSelect = async (e: React.ChangeEvent<HTMLInputElement>, kind: 'video' | 'file') => {
    const file = (e.target.files || [])[0];
    e.target.value = '';
    if (!file) return;
    await handleSendFile(file, kind);
  };

  // Open the create-report form, but require login first for logged-out users.
  const handleCreateReportClick = () => {
    if (!initialUser) {
      setShowLogin(true);
      return;
    }
    setView('new');
  };

  // -------------------------------------------------------------------------
  // CHAT VIEW (WhatsApp-style)
  // -------------------------------------------------------------------------
  if (view === 'chat' && activeTicket) {
    // A user's own message counts as "seen" only once the support team has
    // replied AFTER it (i.e. there is an admin message later in the thread).
    // The admin merely opening/reading the chat does NOT mark it seen — this is
    // intentional so support can read & verify without committing to a reply.
    const lastAdminIdx = (() => {
      const msgs = activeTicket.messages;
      for (let i = msgs.length - 1; i >= 0; i--) {
        if (msgs[i].sender === 'admin') return i;
      }
      return -1;
    })();
    return (
      // Full-screen overlay: covers the site header & footer so the chat
      // behaves like a real messaging app and only the messages scroll.
      // h-[100dvh] adapts to the device's actual visible screen height.
      <div className="fixed inset-0 z-[60] bg-[#ECE5DD] flex justify-center">
        <div className="flex flex-col w-full max-w-2xl h-[100dvh] min-h-0 bg-[#ECE5DD] sm:border-x sm:shadow-2xl">
          <ChatHeader
            onBack={() => { setView('list'); setActiveTicket(null); setStagedImages([]); setChatInput(''); refreshList(); }}
            onCall={() => setShowCallback(true)}
          />

          {/* Messages area with WhatsApp-like background */}
          <div
            ref={messagesContainerRef}
            className="flex-1 min-h-0 overflow-y-auto px-3 py-4 space-y-1.5"
            style={{
              backgroundColor: '#ECE5DD',
              backgroundImage:
                'url("data:image/svg+xml,%3Csvg xmlns=%27http://www.w3.org/2000/svg%27 width=%2740%27 height=%2740%27 viewBox=%270 0 40 40%27%3E%3Cg fill=%27%23d9cfc4%27 fill-opacity=%270.35%27%3E%3Cpath d=%27M0 38h2v2H0zM38 0h2v2h-2z%27/%3E%3C/g%3E%3C/svg%3E")',
            }}
          >
            <div className="flex justify-center mb-2">
              <span className="text-[11px] bg-[#FCF4CB] text-gray-600 px-3 py-1 rounded-md shadow-sm">
                {activeTicket.subject}
              </span>
            </div>

            {/* System notice shown in the middle of the chat for every report */}
            <div className="flex justify-center mb-3">
              <div className="max-w-[88%] text-center bg-white/95 text-gray-700 px-4 py-3 rounded-xl shadow-sm border border-gray-200">
                <p className="text-[13px] font-semibold text-[#075E54] mb-1 flex items-center justify-center gap-1.5">
                  <CheckCheck className="h-4 w-4" /> Report Created
                </p>
                <p className="text-[12.5px] leading-relaxed">
                  Our customer support team will reach out to you soon after reviewing and identifying
                  your issue. Our typical reply time is within{' '}
                  <span className="font-semibold">32 working hours</span>. Thank you for your patience.
                </p>
              </div>
            </div>

            {activeTicket.messages.map((msg, idx) => {
              const isUser = msg.sender === 'user';
              const prev = idx > 0 ? activeTicket.messages[idx - 1] : null;
              const showDate =
                !prev || !isSameDay(new Date(prev.createdAt as any), new Date(msg.createdAt as any));

              // System notices (limit requested / granted) render as a centered banner.
              if (isSystemMessage(msg)) {
                return (
                  <Fragment key={msg._id?.toString() || idx}>
                    {showDate && <DateSeparator date={msg.createdAt as any} />}
                    <SystemNotice message={msg.text} type={(msg as any).systemType} />
                  </Fragment>
                );
              }

              // Image-kind GridFS files render as a zoomable album (reusing the
              // existing image UI); only videos/documents go to FileAttachments.
              const imageFiles = (msg.files || [])
                .filter((f) => f.kind === 'image')
                .map((f) => ({ _id: f._id, url: `/api/support/file/${f._id}` }));
              const docFiles = (msg.files || []).filter((f) => f.kind !== 'image');
              return (
                <Fragment key={msg._id?.toString() || idx}>
                  {showDate && <DateSeparator date={msg.createdAt as any} />}
                  <div className={`flex ${isUser ? 'justify-end' : 'justify-start'}`}>
                    <div
                      className={`relative max-w-[78%] p-1 rounded-lg shadow-sm text-[14px] leading-snug ${
                        isUser
                          ? 'bg-[#DCF8C6] text-gray-900 rounded-tr-none'
                          : 'bg-white text-gray-900 rounded-tl-none'
                      }`}
                    >
                      {!isUser && (
                        <div className="px-1.5 pt-0.5">
                          <span className="block text-[12px] font-semibold text-[#075E54] mb-0.5">
                            Garena Support
                          </span>
                        </div>
                      )}
                      {msg.images && msg.images.length > 0 && (
                        <ChatImages
                          images={msg.images}
                          onZoom={(url) => setZoomedImage(url)}
                          uploading={(msg as any).uploading}
                          progress={(msg as any).uploading ? uploadProgress : null}
                        />
                      )}
                      {imageFiles.length > 0 && (
                        <ChatImages images={imageFiles} onZoom={(url) => setZoomedImage(url)} />
                      )}
                      {docFiles.length > 0 && (
                        <FileAttachments
                          files={docFiles}
                          uploading={(msg as any).uploading}
                          progress={(msg as any).uploading ? fileProgress : null}
                        />
                      )}
                      {msg.deletedAttachmentKinds && msg.deletedAttachmentKinds.length > 0 && (
                        <DeletedAttachmentTombstones kinds={msg.deletedAttachmentKinds} />
                      )}
                      <div className="px-1.5 pb-1 pt-0.5">
                        {msg.html ? (
                          // Rich, server-generated HTML bubble (e.g. refund-accepted
                          // card). Trusted content built on the server; constrained so
                          // it stays inside the chat bubble.
                          <div
                            className="max-w-full overflow-hidden [&_img]:max-w-full"
                            onClick={(e) =>
                              handleNotificationCardClick(e, (path) => router.push(path))
                            }
                            dangerouslySetInnerHTML={{ __html: makeNotificationLinksOpenInSameTab(msg.html) }}
                          />
                        ) : (
                          msg.text && <LinkifiedText text={msg.text} />
                        )}
                        <span className="float-right ml-2 mt-1 text-[10px] text-gray-500 flex items-center gap-0.5">
                          <MessageTime date={msg.createdAt as any} />
                          {isUser &&
                            (lastAdminIdx > idx ? (
                              // Support replied after this message → seen.
                              <CheckCheck className="h-3 w-3 text-[#34B7F1]" />
                            ) : (
                              // Delivered, but not yet replied to → grey double tick.
                              <CheckCheck className="h-3 w-3 text-gray-400" />
                            ))}
                        </span>
                      </div>
                    </div>
                  </div>
                </Fragment>
              );
            })}

            {activeTicket.status === 'closed' && <ClosedNotice />}
          </div>

          {/* Staged image previews (before sending) */}
          {stagedImages.length > 0 && (
            <div className="bg-[#F0F0F0] border-t px-2.5 pt-2.5 flex gap-2 overflow-x-auto">
              {stagedImages.map((photo, i) => (
                <div key={i} className="relative shrink-0">
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  <img src={photo.preview} alt="preview" className="h-16 w-16 object-cover rounded-md border" />
                  <button
                    onClick={() => removeStagedImage(i)}
                    className="absolute -top-1.5 -right-1.5 bg-black/70 text-white rounded-full p-0.5"
                    aria-label="Remove image"
                  >
                    <X className="h-3.5 w-3.5" />
                  </button>
                </div>
              ))}
            </div>
          )}

          {/* Input bar */}
          <div className="flex items-end gap-2 bg-[#F0F0F0] px-2.5 py-2 border-t">
            {/* Hidden inputs: one per attachment type. */}
            <input
              ref={fileInputRef}
              type="file"
              accept="image/*"
              multiple
              className="hidden"
              onChange={handleFileSelect}
            />
            <input
              ref={videoInputRef}
              type="file"
              accept="video/*"
              className="hidden"
              onChange={(e) => handleMediaSelect(e, 'video')}
            />
            <input
              ref={docInputRef}
              type="file"
              className="hidden"
              onChange={(e) => handleMediaSelect(e, 'file')}
            />
            {/* Gallery / attachment menu: Photos, Videos, Files. */}
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <Button
                  size="icon"
                  variant="ghost"
                  title="Attach"
                  disabled={isSending}
                  className="h-11 w-11 rounded-full shrink-0 text-[#075E54] hover:bg-black/5"
                >
                  <Paperclip className="h-5 w-5" />
                </Button>
              </DropdownMenuTrigger>
              {/* z-[80] keeps the menu above the fixed chat overlay (z-[60]),
                  otherwise it renders in its portal behind the chat and is invisible. */}
              <DropdownMenuContent align="start" side="top" className="z-[80] mb-1">
                <DropdownMenuItem onClick={handleAttachClick}>
                  <ImageIcon className="h-4 w-4 mr-2 text-violet-600" />
                  Photos
                  <span className="ml-auto pl-3 text-[10px] text-muted-foreground">{formatBytes(uploadLimitBytes)}</span>
                </DropdownMenuItem>
                <DropdownMenuItem onClick={() => videoInputRef.current?.click()}>
                  <Film className="h-4 w-4 mr-2 text-rose-600" />
                  Videos
                  <span className="ml-auto pl-3 text-[10px] text-muted-foreground">{formatBytes(uploadLimitBytes)}</span>
                </DropdownMenuItem>
                <DropdownMenuItem onClick={() => docInputRef.current?.click()}>
                  <FileText className="h-4 w-4 mr-2 text-sky-600" />
                  Files
                  <span className="ml-auto pl-3 text-[10px] text-muted-foreground">{formatBytes(uploadLimitBytes)}</span>
                </DropdownMenuItem>
              </DropdownMenuContent>
            </DropdownMenu>
            <Textarea
              ref={chatTextareaRef}
              value={chatInput}
              onChange={(e) => setChatInput(e.target.value)}
              placeholder="Type a message"
              rows={1}
              className="flex-1 resize-none bg-white rounded-2xl px-4 py-2.5 min-h-[44px] border-0 focus-visible:ring-0 text-[14px] leading-snug shadow-sm font-sans"
            />
            <Button
              onClick={handleSend}
              disabled={isSending || (!chatInput.trim() && stagedImages.length === 0)}
              size="icon"
              className="h-11 w-11 rounded-full bg-[#075E54] hover:bg-[#0a7d6f] shrink-0"
            >
              {isSending ? <Loader2 className="h-5 w-5 animate-spin" /> : <Send className="h-5 w-5" />}
            </Button>
          </div>
        </div>

        {/* Full-screen image viewer */}
        {zoomedImage && (
          <div
            className="fixed inset-0 z-[70] bg-black/90 flex items-center justify-center p-4"
            onClick={() => setZoomedImage(null)}
          >
            <button
              className="absolute top-4 right-4 text-white p-2"
              onClick={() => setZoomedImage(null)}
              aria-label="Close"
            >
              <X className="h-7 w-7" />
            </button>
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src={zoomedImage} alt="attachment" className="max-h-full max-w-full object-contain rounded" />
          </div>
        )}

        {/* "Request a callback" confirmation popup */}
        <CallbackDialog
          open={showCallback}
          submitting={callbackSubmitting}
          onConfirm={handleRequestCallback}
          onClose={() => setShowCallback(false)}
        />
      </div>
    );
  }

  // -------------------------------------------------------------------------
  // NEW REPORT VIEW
  // -------------------------------------------------------------------------
  if (view === 'new') {
    return (
      <div className="container mx-auto px-6 py-10 max-w-xl">
        <Button variant="ghost" className="mb-4 -ml-2" onClick={() => { setNewAttachments([]); setNewOversize(null); setCreateAttachAttempted(false); setView('list'); }}>
          <ArrowLeft className="h-4 w-4 mr-2" /> Back
        </Button>
        <Card className="overflow-hidden">
          {/* Branded header */}
          <div className="bg-[#075E54] text-white p-6 flex items-center gap-3">
            <div className="relative h-12 w-12 rounded-full bg-white flex items-center justify-center overflow-hidden shrink-0">
              <Image src="/img/garena.png" alt="Garena" width={32} height={32} className="object-contain" />
            </div>
            <div>
              <div className="flex items-center gap-1.5">
                <h1 className="text-xl font-bold font-headline">Create a Report</h1>
                <Image src="/img/bluetick.gif" alt="Verified" width={18} height={18} className="h-[18px] w-[18px]" />
              </div>
              <p className="text-sm text-white/80">Describe your issue and our team will help you.</p>
            </div>
          </div>

          <div className="p-6 space-y-5">
            <div className="space-y-2">
              <label className="text-sm font-medium flex items-center gap-1.5">
                <MessageSquarePlus className="h-4 w-4 text-primary" />
                Describe your issue
              </label>
              <Textarea
                ref={newTextareaRef}
                autoFocus
                value={newMessage}
                onChange={(e) => {
                  setNewMessage(e.target.value);
                  if (e.target.value.trim()) setCreateAttachAttempted(false);
                }}
                placeholder="Please describe your issue in as much detail as possible — include your order, payment UTR, or Free Fire ID if related. The more details you share, the faster we can help you."
                rows={7}
                maxLength={2000}
                className={`resize-none text-[15px] leading-relaxed font-sans ${
                  createAttachAttempted && !newMessage.trim()
                    ? 'border-red-500 focus-visible:ring-red-500'
                    : ''
                }`}
              />
              <div className="flex justify-between text-xs">
                <span className={createAttachAttempted && !newMessage.trim() ? 'text-red-500 font-medium' : 'text-muted-foreground'}>
                  {createAttachAttempted && !newMessage.trim()
                    ? 'Please describe your issue first, then add attachments.'
                    : 'Be clear and specific so we can resolve it quickly.'}
                </span>
                <span className="text-muted-foreground">{newMessage.length}/2000</span>
              </div>
            </div>

            {/* Attach photos / videos / files */}
            <div className="space-y-2">
              <AddAttachmentButton
                limitBytes={uploadLimitBytes}
                disabled={!newMessage.trim()}
                onBlocked={() => {
                  setCreateAttachAttempted(true);
                  newTextareaRef.current?.focus();
                  toast({ variant: 'destructive', title: 'Describe your issue first', description: 'Please write your message before adding attachments.' });
                }}
                onPick={(accepted, oversize) => {
                  if (accepted.length > 0) setNewAttachments((prev) => [...prev, ...accepted]);
                  if (oversize) {
                    setNewOversize(oversize);
                    toast({
                      variant: 'destructive',
                      title: 'File too large',
                      description: `"${oversize.name}" is ${formatBytes(oversize.size)} (limit ${formatBytes(uploadLimitBytes)}). The report will still be created and a higher limit requested.`,
                    });
                  }
                }}
              />
              <StagedAttachmentsStrip
                items={newAttachments}
                onRemove={(id) => setNewAttachments((prev) => prev.filter((a) => a.id !== id))}
              />
              {newOversize && (
                <p className="text-[11px] text-amber-600">
                  “{newOversize.name}” ({formatBytes(newOversize.size)}) exceeds your {formatBytes(uploadLimitBytes)} limit — the report will be created and a higher limit requested.
                </p>
              )}
            </div>

            <Button onClick={handleCreate} disabled={isSending || !newMessage.trim()} size="lg" className="w-full">
              {isSending ? (
                <Loader2 className="h-5 w-5 mr-2 animate-spin" />
              ) : (
                <Send className="h-5 w-5 mr-2" />
              )}
              Send Report
            </Button>
          </div>
        </Card>
      </div>
    );
  }

  // -------------------------------------------------------------------------
  // LIST VIEW (the "blank page with create report option")
  // -------------------------------------------------------------------------
  return (
    <div className="container mx-auto px-6 py-10 max-w-2xl">
      <div className="flex items-center gap-3 mb-2">
        <div className="relative h-12 w-12 rounded-full bg-white border flex items-center justify-center overflow-hidden">
          <Image src="/img/garena.png" alt="Garena" width={32} height={32} className="object-contain" />
        </div>
        <div>
          <div className="flex items-center gap-1.5">
            <h1 className="text-2xl font-bold font-headline">Garena Support</h1>
            <Image src="/img/bluetick.gif" alt="Verified" width={20} height={20} className="h-5 w-5" />
          </div>
          <p className="text-sm text-muted-foreground ph-mask">
            {initialUser
              ? `Logged in as ${initialUser.visualGamingId || initialUser.gamingId}`
              : 'Create a report and chat with our team'}
          </p>
        </div>
      </div>

      <Button onClick={handleCreateReportClick} className="w-full my-6" size="lg">
        <Plus className="h-5 w-5 mr-2" /> Create Report
      </Button>

      {tickets.length === 0 ? (
        <div className="text-center py-16 text-muted-foreground">
          <MessageSquarePlus className="h-12 w-12 mx-auto mb-3 opacity-40" />
          <p className="font-medium">No reports yet</p>
          <p className="text-sm">Create a report and our team will reply here.</p>
        </div>
      ) : (
        <div className="space-y-2">
          <h2 className="text-sm font-semibold text-muted-foreground uppercase tracking-wide px-1">
            Your Reports
          </h2>
          {tickets.map((ticket) => {
            const last = ticket.messages[ticket.messages.length - 1];
            return (
              <button
                key={ticket._id.toString()}
                onClick={() => openTicket(ticket)}
                className="w-full text-left flex items-center gap-3 p-3 rounded-xl border bg-card hover:bg-muted/60 transition-colors"
              >
                <div className="relative h-12 w-12 rounded-full bg-white border flex items-center justify-center overflow-hidden shrink-0">
                  <Image src="/img/garena.png" alt="Garena" width={28} height={28} className="object-contain" />
                </div>
                <div className="flex-1 min-w-0">
                  <div className="flex items-center justify-between gap-2">
                    <span className="font-semibold truncate flex items-center gap-1">
                      {ticket.subject}
                      {ticket.status === 'closed' && (
                        <span className="text-[10px] font-normal text-muted-foreground border rounded px-1">
                          Closed
                        </span>
                      )}
                    </span>
                  </div>
                  <p className="text-sm text-muted-foreground truncate font-sans">
                    {!last
                      ? 'No messages'
                      : (last as any).kind === 'system'
                      ? last.text
                      : `${last.sender === 'admin' ? 'Garena: ' : 'You: '}${
                          last.text ||
                          (last.imageIds && last.imageIds.length > 0
                            ? '📷 Photo'
                            : last.fileIds && last.fileIds.length > 0
                            ? '📎 Attachment'
                            : '')
                        }`}
                  </p>
                </div>
                {ticket.userUnread > 0 && (
                  <span className="shrink-0 h-5 min-w-5 px-1.5 rounded-full bg-[#25D366] text-white text-xs font-bold flex items-center justify-center">
                    {ticket.userUnread}
                  </span>
                )}
              </button>
            );
          })}
        </div>
      )}

      {/* Login popup — dismissible, shown only when a logged-out user taps
          "Create Report". The modal reloads the page on successful login. */}
      <GamingIdModal isOpen={showLogin} onOpenChange={setShowLogin} />
    </div>
  );
}
