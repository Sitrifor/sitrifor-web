import { useEffect, useMemo, useRef, useState, type FormEvent } from 'react';
import { motion } from 'motion/react';
import { Loader2, Scale, Search, Send } from 'lucide-react';
import type { ChatMessage, LawHit } from './types';

const BG_SRC = '/img/lawyer/bg-angels-judges.png';

async function apiSearch(q: string, context = ''): Promise<LawHit[]> {
  const params = new URLSearchParams({ q, limit: '8' });
  if (context.trim()) params.set('context', context.trim());
  const res = await fetch(`/api/lawyer/search?${params}`);
  if (!res.ok) throw new Error('search failed');
  const data = await res.json();
  return data.hits || [];
}

async function apiConsult(question: string, context?: string): Promise<{
  answer: string;
  sources: LawHit[];
}> {
  const res = await fetch('/api/lawyer/consult', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ question, context: context || '' }),
  });
  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    throw new Error(err.error || 'consult failed');
  }
  return res.json();
}

export default function App() {
  const [query, setQuery] = useState('');
  const [hits, setHits] = useState<LawHit[]>([]);
  const [searching, setSearching] = useState(false);
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [contextNote, setContextNote] = useState('');
  const chatEndRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    chatEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages, busy]);

  const canAsk = useMemo(() => query.trim().length >= 4 && !busy, [query, busy]);

  async function onSearchOnly(e?: FormEvent) {
    e?.preventDefault();
    const q = query.trim();
    if (q.length < 2) return;
    setSearching(true);
    setError('');
    try {
      const found = await apiSearch(q, contextNote.trim());
      setHits(found);
    } catch {
      setError('Не удалось выполнить поиск по базе актов.');
    } finally {
      setSearching(false);
    }
  }

  async function onConsult(e?: FormEvent) {
    e?.preventDefault();
    const q = query.trim();
    if (q.length < 4 || busy) return;
    setBusy(true);
    setError('');
    setMessages((m) => [...m, { role: 'user', content: q }]);
    setQuery('');
    try {
      const result = await apiConsult(q, contextNote.trim());
      if (result.sources?.length) setHits(result.sources);
      setMessages((m) => [
        ...m,
        {
          role: 'assistant',
          content: result.answer,
          sources: result.sources || [],
        },
      ]);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Ошибка консультации');
      setMessages((m) => [
        ...m,
        {
          role: 'assistant',
          content:
            'Сейчас не удалось получить ответ модели. Попробуйте переформулировать вопрос или повторите позже.',
        },
      ]);
    } finally {
      setBusy(false);
    }
  }

  return (
    <main className="relative w-full min-h-[115vh] overflow-x-hidden flex flex-col items-center font-sans selection:bg-white/20 selection:text-white">
      <img
        className="fixed inset-0 w-full h-full object-cover z-[0]"
        src={BG_SRC}
        alt=""
        aria-hidden
      />
      <div className="fixed inset-0 z-[1] bg-black/50 pointer-events-none" />

      <div className="relative z-10 w-full max-w-7xl px-4 md:px-8 pt-16 md:pt-24 pb-10 flex flex-col flex-1">
        <section className="liquid-glass rounded-3xl p-6 md:p-10 text-white">
          <div className="flex items-center gap-3 mb-4 text-white/80">
            <Scale size={22} />
            <p className="text-xs uppercase tracking-[0.2em]">Sitrifor Lawyer</p>
          </div>
          <h1 className="text-3xl md:text-5xl font-medium tracking-tight max-w-3xl">
            Законодательство РФ
          </h1>
          <p className="mt-4 text-sm md:text-base text-white/70 max-w-2xl leading-relaxed">
            Поиск по открытым источникам и ответы локального AI с опорой на найденные акты.
            Это справочный инструмент, а не юридическая услуга.
          </p>

          <form onSubmit={onConsult} className="mt-8 space-y-3">
            <label className="block text-xs uppercase tracking-wider text-white/50 mb-2">
              Контекст вашей ситуации (необязательно)
            </label>
            <textarea
              value={contextNote}
              onChange={(e) => setContextNote(e.target.value)}
              rows={2}
              placeholder="Например: ИП на УСН, спор по договору аренды помещения студии"
              className="w-full rounded-2xl bg-white/5 border border-white/10 px-4 py-3 text-sm text-white placeholder:text-white/35 outline-none focus:border-white/30 resize-y"
            />
            <div className="flex flex-col md:flex-row gap-3">
              <div className="relative flex-1">
                <Search className="absolute left-4 top-1/2 -translate-y-1/2 opacity-50" size={18} />
                <input
                  value={query}
                  onChange={(e) => setQuery(e.target.value)}
                  placeholder="Задайте вопрос или найдите акт по ключевым словам"
                  className="w-full rounded-2xl bg-white/10 border border-white/15 pl-11 pr-4 py-3.5 text-sm md:text-base text-white placeholder:text-white/40 outline-none focus:border-white/40"
                />
              </div>
              <div className="flex gap-2">
                <button
                  type="button"
                  onClick={onSearchOnly}
                  disabled={searching || query.trim().length < 2}
                  className="rounded-2xl px-5 py-3.5 text-sm border border-white/20 text-white/80 hover:text-white hover:border-white/40 disabled:opacity-40 transition-colors"
                >
                  {searching ? <Loader2 className="animate-spin" size={18} /> : 'Найти'}
                </button>
                <button
                  type="submit"
                  disabled={!canAsk}
                  className="rounded-2xl px-5 py-3.5 text-sm bg-white text-black font-medium hover:bg-white/90 disabled:opacity-40 transition-colors inline-flex items-center gap-2"
                >
                  {busy ? <Loader2 className="animate-spin" size={18} /> : <Send size={16} />}
                  Спросить
                </button>
              </div>
            </div>
          </form>

          {error ? <p className="mt-4 text-sm text-red-300">{error}</p> : null}

          {hits.length > 0 ? (
            <div className="mt-8">
              <p className="text-xs uppercase tracking-wider text-white/50 mb-3">Найденные акты</p>
              <ul className="space-y-2 max-h-56 overflow-y-auto pr-1">
                {hits.map((h) => (
                  <li
                    key={h.id}
                    className="rounded-xl bg-white/5 border border-white/10 px-4 py-3 text-sm text-white/80"
                  >
                    <div className="flex flex-wrap gap-2 text-[10px] uppercase tracking-wider text-white/45 mb-1">
                      <span>{h.doc_type || 'Акт'}</span>
                      {h.doc_date ? <span>{h.doc_date}</span> : null}
                      {h.doc_number ? <span>№ {h.doc_number}</span> : null}
                      {h.status ? <span>{h.status}</span> : null}
                    </div>
                    <p className="leading-snug">{h.heading}</p>
                  </li>
                ))}
              </ul>
            </div>
          ) : null}

          {messages.length > 0 ? (
            <div className="mt-8 space-y-4">
              <p className="text-xs uppercase tracking-wider text-white/50">Диалог</p>
              {messages.map((m, i) => (
                <div
                  key={`${m.role}-${i}`}
                  className={`rounded-2xl px-4 py-3 text-sm leading-relaxed whitespace-pre-wrap ${
                    m.role === 'user'
                      ? 'bg-white/15 text-white ml-0 md:ml-16'
                      : 'bg-black/30 border border-white/10 text-white/85 mr-0 md:mr-8'
                  }`}
                >
                  {m.content}
                  {m.sources && m.sources.length > 0 ? (
                    <div className="mt-3 pt-3 border-t border-white/10 text-[11px] text-white/50 space-y-1">
                      <p className="uppercase tracking-wider">Источники</p>
                      {m.sources.slice(0, 5).map((s) => (
                        <p key={s.id}>
                          {s.doc_type} {s.doc_number ? `№ ${s.doc_number}` : ''} от {s.doc_date}:{' '}
                          {s.heading}
                        </p>
                      ))}
                    </div>
                  ) : null}
                </div>
              ))}
              {busy ? (
                <div className="inline-flex items-center gap-2 text-white/60 text-sm">
                  <Loader2 className="animate-spin" size={16} /> Готовим ответ по найденным актам…
                </div>
              ) : null}
              <div ref={chatEndRef} />
            </div>
          ) : null}
        </section>

        <motion.footer
          initial={{ opacity: 0, y: 40 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 1, delay: 0.4, ease: 'easeOut' }}
          className="liquid-glass w-full rounded-3xl p-6 md:p-8 text-white/70 mt-32 md:mt-64"
        >
          <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
            <a href="/" className="text-xl font-medium text-white hover:opacity-90 transition-opacity">
              Sitrifor
            </a>
            <p className="text-sm text-white/55">экспериментальная функция</p>
          </div>
        </motion.footer>
      </div>
    </main>
  );
}
