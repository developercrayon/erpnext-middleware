export interface ChatMessage {
  role: 'user' | 'assistant' | 'system';
  content: string;
}

export class ChatOrderPromptDto {
  message: string;
  conversationHistory?: ChatMessage[];
  currentOrderDraft?: any;
  user?: string;
}

export class VoiceOrderDto {
  spokenText?: string;
  customerName?: string;
  currentOrderDraft?: any;
  user?: string;
}
