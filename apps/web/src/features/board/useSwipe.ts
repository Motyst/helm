import { useEffect, useRef, useState, type MouseEvent, type PointerEvent } from 'react';
import { reducedMotion } from './BoardTabs.tsx';

/** How far (px, capped at this share of the card's width) a swipe must go to count. */
const COMMIT_PX = 96;
const COMMIT_SHARE = 0.32;
/** Movement before we decide between a sideways swipe and a vertical scroll. */
const DECIDE_PX = 10;
const SLIDE_OUT_MS = 160;

interface SwipeOptions {
  /** Off while the card is being dragged (a long press), or in the drag overlay. */
  enabled: boolean;
  /** Swiped right past the line. The card slides out first; if it is still here after this settles, it slides back. */
  onRight: () => Promise<unknown> | void;
  /** Swiped left past the line. The card springs back. */
  onLeft: () => void;
}

/**
 * Touch swipe on a board card. A sideways move locks into a swipe; a vertical one is left to the
 * page scroll (the slot has `touch-action: pan-y`), and a still long press is left to dnd-kit's
 * drag. Mouse is ignored: on a computer the card's buttons and keys do the same.
 */
export function useSwipe({ enabled, onRight, onLeft }: SwipeOptions) {
  const [dx, setDx] = useState(0);
  const [settling, setSettling] = useState(false);
  const gesture = useRef<{ id: number; x: number; y: number; line: number; locked: boolean; past: boolean } | null>(null);
  const swiped = useRef(false);
  const mounted = useRef(true);

  useEffect(
    () => () => {
      mounted.current = false;
    },
    [],
  );

  // A long press turned into a drag: drop the swipe.
  useEffect(() => {
    if (!enabled && gesture.current) {
      gesture.current = null;
      setDx(0);
    }
  }, [enabled]);

  const reset = () => {
    gesture.current = null;
    setSettling(true);
    setDx(0);
  };

  const handlers = {
    onPointerDown(e: PointerEvent<HTMLElement>) {
      swiped.current = false;
      if (!enabled || e.pointerType === 'mouse' || !e.isPrimary) return;
      const width = e.currentTarget.getBoundingClientRect().width;
      gesture.current = {
        id: e.pointerId,
        x: e.clientX,
        y: e.clientY,
        line: Math.min(COMMIT_PX, width * COMMIT_SHARE),
        locked: false,
        past: false,
      };
    },
    onPointerMove(e: PointerEvent<HTMLElement>) {
      const g = gesture.current;
      if (!g || e.pointerId !== g.id) return;
      const mx = e.clientX - g.x;
      const my = e.clientY - g.y;
      if (!g.locked) {
        if (Math.abs(my) > DECIDE_PX && Math.abs(my) >= Math.abs(mx)) {
          gesture.current = null;
          return;
        }
        if (Math.abs(mx) < DECIDE_PX || Math.abs(mx) < Math.abs(my) * 1.5) return;
        g.locked = true;
        try {
          e.currentTarget.setPointerCapture(e.pointerId);
        } catch {
          /* the pointer is already gone */
        }
      }
      const past = Math.abs(mx) >= g.line;
      if (past !== g.past) {
        g.past = past;
        if (past) buzz();
      }
      setSettling(false);
      setDx(mx);
    },
    onPointerUp(e: PointerEvent<HTMLElement>) {
      const g = gesture.current;
      if (!g || e.pointerId !== g.id) return;
      if (!g.locked) {
        gesture.current = null;
        return;
      }
      swiped.current = true;
      const mx = e.clientX - g.x;
      if (mx >= g.line) {
        gesture.current = null;
        setSettling(true);
        setDx(e.currentTarget.getBoundingClientRect().width);
        setTimeout(async () => {
          try {
            await onRight();
          } finally {
            // Still on the board a moment later (it failed): bring the card back.
            setTimeout(() => mounted.current && reset(), 120);
          }
        }, reducedMotion() ? 0 : SLIDE_OUT_MS);
      } else {
        reset();
        if (mx <= -g.line) onLeft();
      }
    },
    onPointerCancel() {
      if (gesture.current) reset();
    },
    // A swipe that ends over a button shouldn't also press it.
    onClickCapture(e: MouseEvent<HTMLElement>) {
      if (!swiped.current) return;
      swiped.current = false;
      e.preventDefault();
      e.stopPropagation();
    },
  };

  const line = gesture.current?.line ?? COMMIT_PX;
  return { dx, settling, past: Math.abs(dx) >= line, handlers };
}

function buzz() {
  try {
    navigator.vibrate?.(8);
  } catch {
    /* not allowed here */
  }
}
