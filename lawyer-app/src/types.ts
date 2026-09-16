/// <reference types="vite/client" />

export type LawHit = {
  id: string;
  heading: string;
  doc_type: string;
  author: string;
  doc_date: string;
  doc_number: string;
  status: string;
  snippet?: string;
  widely_used?: number;
};

export type ChatMessage = {
  role: 'user' | 'assistant';
  content: string;
  sources?: LawHit[];
};
