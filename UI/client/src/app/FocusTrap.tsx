import { useEffect, useRef } from 'react';
import type { ReactNode } from 'react';

// Focus trap for modal dialogs: focus the first control on open, keep Tab
// inside, restore focus on close.
export function FocusTrap({ children, onEscape }: { children: ReactNode; onEscape: () => void }) {
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const root = ref.current;
    if (!root) return;
    const previous = document.activeElement as HTMLElement | null;
    const first = root.querySelector<HTMLElement>('button, input, select, textarea, [tabindex]');
    first?.focus();
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.stopPropagation();
        onEscape();
        return;
      }
      if (e.key !== 'Tab') return;
      const items = [...root.querySelectorAll<HTMLElement>('button, input, select, textarea, [tabindex]')].filter(
        (el) => !el.hasAttribute('disabled'),
      );
      if (items.length === 0) return;
      const firstEl = items[0];
      const lastEl = items[items.length - 1];
      if (e.shiftKey && document.activeElement === firstEl) {
        e.preventDefault();
        lastEl.focus();
      } else if (!e.shiftKey && document.activeElement === lastEl) {
        e.preventDefault();
        firstEl.focus();
      }
    };
    document.addEventListener('keydown', onKey, true);
    return () => {
      document.removeEventListener('keydown', onKey, true);
      previous?.focus?.();
    };
  }, [onEscape]);

  return <div ref={ref}>{children}</div>;
}

export function ModalDialog({ label, wide, onClose, children }: { label: string; wide?: boolean; onClose: () => void; children: ReactNode }) {
  return (
    <div className="dialog-backdrop" onClick={onClose}>
      <div className={wide ? 'dialog dialog-wide' : 'dialog'} role="dialog" aria-modal="true" aria-label={label} onClick={(e) => e.stopPropagation()}>
        <FocusTrap onEscape={onClose}>{children}</FocusTrap>
      </div>
    </div>
  );
}
