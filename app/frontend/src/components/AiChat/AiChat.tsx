import { useEffect, useMemo, useRef, useState } from 'react';
import { ArrowRight, Loader2, SendHorizonal, Trash2, X } from 'lucide-react';
import type { AiActionResult } from '../../services/aiApi';

export interface AiChatMessage {
  id: string;
  role: 'user' | 'assistant';
  content: string;
  action?: AiActionResult | null;
  error?: boolean;
}

interface AiChatProps {
  isLoading: boolean;
  messages: AiChatMessage[];
  onClose: () => void;
  onClear: () => void;
  onNavigate: (path: string) => void;
  onSend: (message: string) => void;
}

function getActionLabel(action: AiActionResult): string {
  if (!action.success) {
    return 'Action blocked or failed';
  }

  switch (action.type) {
    case 'create_lead':
      return 'Lead created';
    case 'update_lead':
      return 'Lead updated';
    case 'add_activity':
      return 'Activity added';
    case 'create_task':
      return 'Task created';
    case 'list_leads':
    case 'search_leads':
    case 'get_lead':
      return 'CRM data loaded';
    case 'list_tasks':
      return 'Task list loaded';
    case 'list_invoices':
      return 'Invoice list loaded';
    case 'get_dashboard':
      return 'Dashboard summary loaded';
    case 'list_products':
    case 'search_products':
      return 'Product data loaded';
    case 'list_customers':
    case 'search_customers':
      return 'Customer data loaded';
    default:
      return 'Action completed';
  }
}

export function AiChat({ isLoading, messages, onClose, onClear, onNavigate, onSend }: AiChatProps) {
  const [input, setInput] = useState('');
  const viewportRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const viewport = viewportRef.current;
    if (!viewport) return;
    viewport.scrollTop = viewport.scrollHeight;
  }, [messages, isLoading]);

  const canSend = useMemo(() => {
    return input.trim().length > 0 && !isLoading;
  }, [input, isLoading]);

  const handleSubmit = (): void => {
    const trimmed = input.trim();
    if (!trimmed || isLoading) return;
    setInput('');
    onSend(trimmed);
  };

  return (
    <section className="w-[calc(100vw-2rem)] sm:w-[430px] h-[70vh] max-h-[680px] rounded-2xl border border-border bg-[linear-gradient(165deg,rgba(17,31,22,0.96),rgba(41,36,25,0.9))] shadow-[0_24px_44px_rgba(4,8,5,0.62)] backdrop-blur-md overflow-hidden flex flex-col">
      <header className="px-4 py-3 border-b border-border/80 bg-[linear-gradient(120deg,rgba(54,95,70,0.45),rgba(130,83,37,0.38))]">
        <div className="flex items-center justify-between gap-3">
          <div>
            <p className="font-semibold text-text">AI Assistant</p>
            <p className="text-xs text-text-muted">Polish + English. Safe mode enabled.</p>
          </div>
          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={onClear}
              className="btn-secondary px-2 py-2 text-xs"
              title="Clear chat"
              aria-label="Clear chat"
            >
              <Trash2 size={14} />
            </button>
            <button
              type="button"
              onClick={onClose}
              className="btn-secondary px-2 py-2 text-xs"
              title="Close"
              aria-label="Close"
            >
              <X size={14} />
            </button>
          </div>
        </div>
      </header>

      <div ref={viewportRef} className="flex-1 overflow-y-auto p-4 space-y-3">
        {messages.length === 0 ? (
          <div className="card text-sm">
            <p className="font-semibold mb-1">Try commands like:</p>
            <p className="text-text-muted">"dodaj lead Jan Kowalski z firmy Acme"</p>
            <p className="text-text-muted">"show my tasks for today"</p>
          </div>
        ) : null}

        {messages.map((message) => {
          const isUser = message.role === 'user';
          const bubbleBase = isUser
            ? 'ml-10 bg-[linear-gradient(135deg,#6ab58a,#e89a45)] text-[#182216]'
            : message.error
              ? 'mr-10 bg-[linear-gradient(135deg,rgba(130,35,53,0.8),rgba(101,28,39,0.9))] text-[#ffe8ed] border border-[#ba4d66]'
              : 'mr-10 bg-[linear-gradient(145deg,rgba(30,43,32,0.95),rgba(51,44,31,0.9))] text-text border border-border/85';

          return (
            <article key={message.id} className="space-y-2">
              <div className={`rounded-xl px-3 py-2 text-sm shadow-sm ${bubbleBase}`}>
                {message.content}
              </div>

              {!isUser && message.action ? (
                <div className="mr-10 rounded-xl border border-border/80 bg-surface-1/80 px-3 py-2 text-xs text-text-muted space-y-2">
                  <p className={message.action.success ? 'text-success' : 'text-warning'}>{getActionLabel(message.action)}</p>
                  {message.action.navigate ? (
                    <button
                      type="button"
                      className="btn-secondary text-xs px-2 py-1 inline-flex items-center gap-1"
                      onClick={() => onNavigate(message.action!.navigate!)}
                    >
                      Open page
                      <ArrowRight size={13} />
                    </button>
                  ) : null}
                </div>
              ) : null}
            </article>
          );
        })}

        {isLoading ? (
          <div className="mr-10 inline-flex items-center gap-2 rounded-xl px-3 py-2 text-sm border border-border/80 bg-surface-1/80 text-text-muted">
            <Loader2 size={14} className="animate-spin" />
            Thinking...
          </div>
        ) : null}
      </div>

      <footer className="p-3 border-t border-border/80 bg-surface-0/85">
        <div className="flex items-end gap-2">
          <textarea
            value={input}
            rows={2}
            maxLength={4000}
            onChange={(event) => setInput(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === 'Enter' && !event.shiftKey) {
                event.preventDefault();
                handleSubmit();
              }
            }}
            placeholder="Ask AI to help with CRM, invoices, products..."
            className="input min-h-[56px] resize-none text-sm"
          />
          <button
            type="button"
            className="btn-primary px-3 py-3 rounded-xl disabled:opacity-50"
            onClick={handleSubmit}
            disabled={!canSend}
          >
            <SendHorizonal size={15} />
          </button>
        </div>
      </footer>
    </section>
  );
}
