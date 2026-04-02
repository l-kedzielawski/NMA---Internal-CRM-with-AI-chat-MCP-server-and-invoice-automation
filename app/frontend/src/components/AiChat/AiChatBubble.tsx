import { useMemo, useState } from 'react';
import { MessageSquare } from 'lucide-react';
import { useNavigate } from 'react-router-dom';
import axios from 'axios';
import { AiChat, type AiChatMessage } from './AiChat';
import { sendAiMessage, type AiHistoryItem } from '../../services/aiApi';

function nextId(): string {
  return `${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
}

function stringifyDetails(details: unknown): string {
  if (typeof details === 'string') return details;
  if (details === undefined || details === null) return '';
  try {
    return JSON.stringify(details);
  } catch {
    return String(details);
  }
}

function toHistory(messages: AiChatMessage[]): AiHistoryItem[] {
  return messages
    .filter((message) => message.role === 'user' || message.role === 'assistant')
    .map((message) => ({
      role: message.role,
      content: message.content,
    }));
}

export function AiChatBubble() {
  const navigate = useNavigate();
  const [isOpen, setIsOpen] = useState(false);
  const [isLoading, setIsLoading] = useState(false);
  const [unreadCount, setUnreadCount] = useState(0);
  const [messages, setMessages] = useState<AiChatMessage[]>([]);

  const hasUnread = unreadCount > 0;

  const openPanel = (): void => {
    setIsOpen(true);
    setUnreadCount(0);
  };

  const closePanel = (): void => {
    setIsOpen(false);
  };

  const clearChat = (): void => {
    setMessages([]);
    setUnreadCount(0);
  };

  const sendMessage = async (text: string): Promise<void> => {
    if (isLoading) return;

    const userMessage: AiChatMessage = {
      id: nextId(),
      role: 'user',
      content: text,
    };

    const nextMessages = [...messages, userMessage];
    setMessages(nextMessages);
    setIsLoading(true);

    try {
      const response = await sendAiMessage(text, toHistory(nextMessages));

      const assistantMessage: AiChatMessage = {
        id: nextId(),
        role: 'assistant',
        content: response.reply,
        action: response.action,
      };

      setMessages((previous) => [...previous, assistantMessage]);

      if (!isOpen) {
        setUnreadCount((count) => count + 1);
      }

      // Only auto-navigate for write/creation actions, not read-only queries
      // (so invoice lookups, lead searches etc. keep the chat visible with the answer)
      const autoNavigateTypes = new Set(['create_lead', 'create_task', 'update_lead', 'add_activity']);
      if (response.action?.success && response.action.navigate && autoNavigateTypes.has(response.action.type)) {
        navigate(response.action.navigate);
      }
    } catch (error: unknown) {
      let message = error instanceof Error && error.message
        ? error.message
        : 'AI request failed';

      if (axios.isAxiosError(error)) {
        const payload = error.response?.data as { error?: string; details?: unknown; reply?: string } | undefined;
        if (payload?.reply) {
          message = payload.reply;
        } else if (payload?.error && payload?.details) {
          message = `${payload.error}: ${stringifyDetails(payload.details)}`;
        } else if (payload?.error) {
          message = payload.error;
        }
      }

      const assistantError: AiChatMessage = {
        id: nextId(),
        role: 'assistant',
        content: message,
        error: true,
      };

      setMessages((previous) => [...previous, assistantError]);
      if (!isOpen) {
        setUnreadCount((count) => count + 1);
      }
    } finally {
      setIsLoading(false);
    }
  };

  const containerClass = useMemo(() => {
    return isOpen
      ? 'pointer-events-auto opacity-100 translate-y-0'
      : 'pointer-events-none opacity-0 translate-y-2';
  }, [isOpen]);

  return (
    <div className="fixed bottom-4 right-4 sm:bottom-6 sm:right-6 z-50 flex flex-col items-end gap-3 pointer-events-none">
      <div className={`transition-all duration-200 ${containerClass}`}>
        <AiChat
          isLoading={isLoading}
          messages={messages}
          onClose={closePanel}
          onClear={clearChat}
          onNavigate={navigate}
          onSend={(value) => {
            void sendMessage(value);
          }}
        />
      </div>

      <button
        type="button"
        onClick={isOpen ? closePanel : openPanel}
        className="relative h-14 w-14 rounded-full border border-[#7c9967] bg-[linear-gradient(145deg,#5ca67d,#d99648)] text-[#122217] shadow-[0_14px_30px_rgba(5,9,6,0.62)] hover:brightness-105 transition pointer-events-auto"
        aria-label="Toggle AI assistant"
      >
        <MessageSquare className="mx-auto" size={22} />
        {hasUnread ? (
          <span className="absolute -top-1 -right-1 min-w-5 h-5 px-1 rounded-full bg-danger text-[10px] font-bold text-white flex items-center justify-center">
            {unreadCount > 9 ? '9+' : unreadCount}
          </span>
        ) : null}
      </button>
    </div>
  );
}
