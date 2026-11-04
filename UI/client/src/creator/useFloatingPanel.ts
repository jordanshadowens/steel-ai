import { useEffect, useRef, useState } from 'react';
import type { KeyboardEvent, PointerEvent } from 'react';
let panelLayer = 12;

export function clampPanel(x: number, y: number, width: number, height: number, parentWidth: number, parentHeight: number) {
  return { x: Math.max(8, Math.min(x, Math.max(8, parentWidth - width - 8))),
    y: Math.max(8, Math.min(y, Math.max(8, parentHeight - height - 8))) };
}

// Header-only dragging keeps selection, controls and scrolling usable.
export function useFloatingPanel(visible = true) {
  const ref = useRef<HTMLElement>(null);
  const [position, setPosition] = useState<{ x: number; y: number } | null>(null);
  const drag = useRef<{ x: number; y: number; left: number; top: number; id: number } | null>(null);
  const move = (x: number, y: number) => {
    const el = ref.current, parent = el?.parentElement;
    if (!el || !parent) return;
    setPosition(clampPanel(x, y, el.offsetWidth, el.offsetHeight, parent.clientWidth, parent.clientHeight));
  };
  useEffect(() => {
    const el = ref.current, parent = el?.parentElement;
    if (!el || !parent) return;
    const observer = new ResizeObserver(() => setPosition((p) => p
      ? clampPanel(p.x, p.y, el.offsetWidth, el.offsetHeight, parent.clientWidth, parent.clientHeight) : p));
    observer.observe(parent); observer.observe(el);
    return () => observer.disconnect();
  }, [visible]);
  return {
    ref,
    style: position ? { left: position.x, top: position.y, right: 'auto', bottom: 'auto' } : undefined,
    handle: {
      tabIndex: 0,
      'aria-label': 'Move panel. Use arrow keys to reposition; Home resets position.',
      onPointerDown: (e: PointerEvent<HTMLDivElement>) => {
        if (e.button !== 0 || (e.target as HTMLElement).closest('button,input,select,textarea,a')) return;
        const el = ref.current;
        if (!el) return;
        el.style.zIndex = String(++panelLayer);
        e.preventDefault();
        e.currentTarget.focus();
        drag.current = { x: e.clientX, y: e.clientY, left: el.offsetLeft, top: el.offsetTop, id: e.pointerId };
        e.currentTarget.setPointerCapture(e.pointerId);
      },
      onPointerMove: (e: PointerEvent<HTMLDivElement>) => {
        const d = drag.current;
        if (d && d.id === e.pointerId) move(d.left + e.clientX - d.x, d.top + e.clientY - d.y);
      },
      onPointerUp: (e: PointerEvent<HTMLDivElement>) => {
        drag.current = null;
        if (e.currentTarget.hasPointerCapture(e.pointerId)) e.currentTarget.releasePointerCapture(e.pointerId);
      },
      onLostPointerCapture: () => { drag.current = null; },
      onPointerCancel: () => { drag.current = null; },
      onKeyDown: (e: KeyboardEvent<HTMLDivElement>) => {
        if (e.target !== e.currentTarget) return;
        if (e.key === 'Home') { e.preventDefault(); setPosition(null); return; }
        if (!['ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown'].includes(e.key)) return;
        e.preventDefault(); e.stopPropagation();
        const el = ref.current;
        if (!el) return;
        const amount = e.shiftKey ? 1 : 16;
        move(el.offsetLeft + (e.key === 'ArrowLeft' ? -amount : e.key === 'ArrowRight' ? amount : 0),
          el.offsetTop + (e.key === 'ArrowUp' ? -amount : e.key === 'ArrowDown' ? amount : 0));
      },
    },
  };
}
