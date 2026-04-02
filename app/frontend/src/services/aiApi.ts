import api from './api';

export interface AiHistoryItem {
  role: 'user' | 'assistant';
  content: string;
}

export interface AiActionResult {
  type: string;
  success: boolean;
  reason?: string;
  data?: unknown;
  navigate?: string;
}

export interface AiResponse {
  reply: string;
  action: AiActionResult | null;
}

export async function sendAiMessage(message: string, history: AiHistoryItem[]): Promise<AiResponse> {
  const response = await api.post<AiResponse>('/ai/chat', {
    message,
    history,
  });

  return response.data;
}
