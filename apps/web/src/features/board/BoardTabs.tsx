import { useEffect, useRef, useState, type CSSProperties } from 'react';

export interface BoardTab {
  bin: string;
  name: string;
  icon: string | null;
  color: string | null;
  count: number;
}

/**
 * One tab per panel, stuck to the top while the board scrolls. A tap scrolls to that panel; the
 * tab of the panel in view is marked as you scroll.
 */
export function BoardTabs({ tabs, onJump }: { tabs: BoardTab[]; onJump: (bin: string) => void }) {
  const stripRef = useRef<HTMLElement>(null);
  const [active, setActive] = useState(tabs[0]?.bin ?? null);
  // After a tap the tapped tab stays marked until the user scrolls by hand: a short panel at the
  // end of the page never reaches the top, so the scroll position alone would mark another one.
  const tapped = useRef<string | null>(null);
  const bins = tabs.map((t) => t.bin).join(' ');

  useEffect(() => {
    let frame = 0;
    const update = () => {
      frame = 0;
      if (tapped.current) return;
      const line = (stripRef.current?.getBoundingClientRect().bottom ?? 0) + 12;
      let best: { bin: string; top: number } | null = null;
      for (const bin of bins.split(' ')) {
        const r = document.getElementById(`bin-${bin}`)?.getBoundingClientRect();
        if (!r || r.bottom <= line) continue;
        if (!best || r.top < best.top - 1) best = { bin, top: r.top };
      }
      if (best) setActive(best.bin);
    };
    const onScroll = () => {
      if (!frame) frame = requestAnimationFrame(update);
    };
    const release = () => {
      tapped.current = null;
    };
    update();
    window.addEventListener('scroll', onScroll, { passive: true });
    window.addEventListener('resize', onScroll, { passive: true });
    window.addEventListener('wheel', release, { passive: true });
    window.addEventListener('touchstart', release, { passive: true });
    window.addEventListener('keydown', release);
    return () => {
      cancelAnimationFrame(frame);
      window.removeEventListener('scroll', onScroll);
      window.removeEventListener('resize', onScroll);
      window.removeEventListener('wheel', release);
      window.removeEventListener('touchstart', release);
      window.removeEventListener('keydown', release);
    };
  }, [bins]);

  // Keep the marked tab in sight within the strip.
  useEffect(() => {
    const strip = stripRef.current;
    const tab = strip?.querySelector<HTMLElement>('[aria-current="true"]');
    if (!strip || !tab) return;
    const left = tab.offsetLeft - (strip.clientWidth - tab.offsetWidth) / 2;
    strip.scrollTo({ left, behavior: reducedMotion() ? 'auto' : 'smooth' });
  }, [active]);

  return (
    <nav className="board-tabs" aria-label="Projects" ref={stripRef}>
      {tabs.map((t) => (
        <button
          key={t.bin}
          type="button"
          className="board-tab"
          style={t.color ? ({ '--bin': t.color } as CSSProperties) : undefined}
          aria-current={active === t.bin ? 'true' : undefined}
          onClick={(e) => {
            // The tap's own touchstart already ran; mark this tab until the next manual scroll.
            e.stopPropagation();
            setActive(t.bin);
            onJump(t.bin);
            requestAnimationFrame(() => {
              tapped.current = t.bin;
            });
          }}
        >
          {t.icon && (
            <span className="board-tab-icon" aria-hidden="true">
              {t.icon}
            </span>
          )}
          <span className="board-tab-name">{t.name}</span>
          {t.count > 0 && <span className="board-tab-count">{t.count}</span>}
        </button>
      ))}
    </nav>
  );
}

export function reducedMotion(): boolean {
  return typeof matchMedia === 'function' && matchMedia('(prefers-reduced-motion: reduce)').matches;
}
