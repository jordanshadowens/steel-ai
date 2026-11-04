import { createContext, useCallback, useContext, useEffect, useRef, useState } from 'react';
import type { ReactNode } from 'react';

export interface Notice {
  id: number;
  kind: 'ok' | 'error';
  text: string;
}

const NoticeContext = createContext<{ notify: (kind: Notice['kind'], text: string) => void }>({
  notify: () => {},
});

export function useNotify(): (kind: Notice['kind'], text: string) => void {
  return useContext(NoticeContext).notify;
}

export function NoticeProvider({ children }: { children: ReactNode }) {
  const [notices, setNotices] = useState<Notice[]>([]);
  const recent = useRef(new Map<string, number>());
  const timers = useRef(new Set<number>());
  useEffect(() => () => { for (const timer of timers.current) window.clearTimeout(timer); }, []);
  const notify = useCallback((kind: Notice['kind'], text: string) => {
    const now = Date.now();
    const key = `${kind}:${text.trim()}`;
    for (const [k, time] of recent.current) if (now - time >= 30000) recent.current.delete(k);
    if (recent.current.has(key)) return;
    recent.current.set(key, now);
    const id = Date.now() + Math.random();
    setNotices((prev) => [...prev.slice(-1), { id, kind, text }]);
    const timer = window.setTimeout(() => {
      setNotices((prev) => prev.filter((n) => n.id !== id));
      timers.current.delete(timer);
    }, 6000);
    timers.current.add(timer);
  }, []);
  return (
    <NoticeContext.Provider value={{ notify }}>
      {children}
      <div className="notices" aria-label="Workflow alerts" aria-live="polite">
        {notices.map((n) => (
          <div key={n.id} role={n.kind === 'error' ? 'alert' : 'status'} className={n.kind === 'error' ? 'notice notice-error' : 'notice notice-ok'}>
            {n.text}
            <button type="button" aria-label="Dismiss" onClick={() => setNotices((prev) => prev.filter((x) => x.id !== n.id))}>
              ×
            </button>
          </div>
        ))}
      </div>
    </NoticeContext.Provider>
  );
}
