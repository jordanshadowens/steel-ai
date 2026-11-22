import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useRef,
  useState,
} from 'react';
import type { ReactNode } from 'react';
import { createPortal } from 'react-dom';

export interface Notice {
  id: number;
  kind: 'ok' | 'error';
  text: string;
  replaceKey?: string;
}

type Notify = (kind: Notice['kind'], text: string, replaceKey?: string) => void;

const NoticeContext = createContext<{
  notify: Notify;
}>({
  notify: () => {},
});

export function useNotify(): Notify {
  return useContext(NoticeContext).notify;
}

export function NoticeProvider({ children, target }: { children: ReactNode; target?: HTMLElement | null }) {
  const [notices, setNotices] = useState<Notice[]>([]);
  const recent = useRef(new Map<string, number>());
  const timers = useRef(new Set<number>());
  useEffect(
    () => () => {
      for (const timer of timers.current) {
        window.clearTimeout(timer);
      }
    },
    [],
  );
  const notify = useCallback<Notify>((kind, text, replaceKey) => {
    const now = Date.now();
    const key = `${kind}:${text.trim()}`;
    for (const [k, time] of recent.current) {
      if (now - time >= 30000) {
        recent.current.delete(k);
      }
    }
    if (replaceKey === undefined && recent.current.has(key)) {
      return;
    }
    recent.current.set(key, now);
    const id = Date.now() + Math.random();
    setNotices((prev) => [
      ...prev.filter((notice) => replaceKey === undefined || notice.replaceKey !== replaceKey).slice(-1),
      { id, kind, text, replaceKey },
    ]);
    const timer = window.setTimeout(() => {
      setNotices((prev) => prev.filter((n) => n.id !== id));
      timers.current.delete(timer);
    }, 6000);
    timers.current.add(timer);
  }, []);
  function dismiss(notice: Notice) {
    recent.current.delete(`${notice.kind}:${notice.text.trim()}`);
    setNotices((current) => current.filter(({ id }) => id !== notice.id));
  }

  const alerts = (
    <div className="notices" aria-live="polite">
      {notices.map((notice) => (
        <div
          key={notice.id}
          role={notice.kind === 'error' ? 'alert' : 'status'}
          className={`notice notice-${notice.kind}`}
        >
          {notice.text}
          <button type="button" aria-label="Dismiss" onClick={() => dismiss(notice)}>
            ×
          </button>
        </div>
      ))}
    </div>
  );
  return (
    <NoticeContext.Provider value={{ notify }}>
      {children}
      {target ? createPortal(alerts, target) : alerts}
    </NoticeContext.Provider>
  );
}
