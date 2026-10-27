import type { ScrollView } from 'react-native';

import { SCROLL_SETTLE_MS, scrollOffsetForTarget, TourRect, TourSurface, TourTargetId } from '../../lib/firstRunTour';

/**
 * Where the tour's targets are, right now.
 *
 * Screens and the bar register the native views the tour points at; the
 * overlay asks for their window rectangles when a beat starts, and again
 * when the page under it scrolls. This is the one piece of shared, mutable,
 * React-free wiring the tour needs — a map of refs — and it lives here rather
 * than in lib because it holds live views, not data.
 *
 * Measurements are in window coordinates. The overlay subtracts its own
 * origin, so a target measured under a status-bar inset lands where the
 * reader sees it.
 */

interface TourMeasurable {
  measureInWindow: (callback: (x: number, y: number, width: number, height: number) => void) => void;
}

interface TourScroller {
  /** The scroll view's own node, measured to turn a window y into an offset. */
  viewport: TourMeasurable | null;
  getOffset: () => number;
  scrollToOffset: (offset: number, animated: boolean) => void;
  /**
   * The bottom of the list. A last section cannot be lifted by an offset —
   * there is no content under it to scroll into — so the only way to show
   * all of it is to ask the list how far it goes.
   */
  scrollToEnd: (animated: boolean) => void;
}

export interface TourTargetRegistry {
  /**
   * Takes whatever a ref callback hands over. Animated.View's ref is typed
   * as a legacy ref union; at runtime it is the host view, and only a node
   * that can measure itself is kept.
   */
  register: (id: TourTargetId, node: unknown) => void;
  /** Null when the target is not on screen — the beat is skipped, not hung on. */
  measure: (id: TourTargetId) => Promise<TourRect | null>;
  registerScroller: (surface: TourSurface, scroller: TourScroller | null) => void;
  /**
   * Scroll the surface so `id` has room for its callout, then resolve once
   * the scroll has settled — which is when the target may be measured. A
   * mock measured 400 ms into a smooth scroll and drew its ring over two
   * sections; the settle wait is the whole point of this method.
   */
  scrollIntoView: (
    surface: TourSurface,
    id: TourTargetId,
    prefer: 'above' | 'below',
    animated: boolean,
    mode?: 'target' | 'end',
  ) => Promise<void>;
  /** Screens call this from onScroll; the overlay re-measures after it. */
  notifyScroll: () => void;
  subscribeScroll: (listener: () => void) => () => void;
}

function isMeasurable(node: unknown): node is TourMeasurable {
  return (
    typeof node === 'object' &&
    node !== null &&
    typeof (node as { measureInWindow?: unknown }).measureInWindow === 'function'
  );
}

/**
 * One view's window rectangle, or null: for a missing node, a node that
 * never answers (a view mid-detach can), a throw, or a NaN in the answer.
 */
export function measureNode(node: TourMeasurable | null | undefined): Promise<TourRect | null> {
  return new Promise((resolve) => {
    if (!node) {
      resolve(null);
      return;
    }
    let settled = false;
    const finish = (rect: TourRect | null) => {
      if (!settled) {
        settled = true;
        resolve(rect);
      }
    };
    const timer = setTimeout(() => finish(null), 300);
    try {
      node.measureInWindow((x, y, width, height) => {
        clearTimeout(timer);
        if ([x, y, width, height].some((value) => typeof value !== 'number' || Number.isNaN(value))) {
          finish(null);
          return;
        }
        finish({ x, y, width, height });
      });
    } catch {
      clearTimeout(timer);
      finish(null);
    }
  });
}

/**
 * A ScrollView as something the registry can measure. The ScrollView
 * instance itself has no `measureInWindow`; its native scroll node does.
 */
export function viewportOf(ref: { current: ScrollView | null }): TourMeasurable {
  return {
    measureInWindow: (callback) => {
      const node = ref.current?.getNativeScrollRef?.();
      if (node && typeof node.measureInWindow === 'function') {
        node.measureInWindow(callback);
      }
    },
  };
}

export function createTourTargetRegistry(): TourTargetRegistry {
  const nodes = new Map<TourTargetId, TourMeasurable>();
  const scrollers = new Map<TourSurface, TourScroller>();
  const listeners = new Set<() => void>();

  return {
    register(id, node) {
      if (isMeasurable(node)) {
        nodes.set(id, node);
      } else {
        nodes.delete(id);
      }
    },
    measure(id) {
      return measureNode(nodes.get(id));
    },
    registerScroller(surface, scroller) {
      if (scroller) {
        scrollers.set(surface, scroller);
      } else {
        scrollers.delete(surface);
      }
    },
    async scrollIntoView(surface, id, prefer, animated, mode = 'target') {
      const scroller = scrollers.get(surface);
      const target = nodes.get(id);
      if (!scroller || !target) {
        return;
      }
      if (mode === 'end') {
        scroller.scrollToEnd(animated);
        await new Promise<void>((resolve) => setTimeout(resolve, animated ? SCROLL_SETTLE_MS : 32));
        return;
      }
      const [targetRect, viewportRect] = await Promise.all([measureNode(target), measureNode(scroller.viewport)]);
      if (!targetRect || !viewportRect) {
        return;
      }
      const offset = scrollOffsetForTarget(scroller.getOffset(), targetRect.y - viewportRect.y, prefer);
      if (Math.abs(offset - scroller.getOffset()) < 1) {
        return;
      }
      scroller.scrollToOffset(offset, animated);
      await new Promise<void>((resolve) => setTimeout(resolve, animated ? SCROLL_SETTLE_MS : 32));
    },
    notifyScroll() {
      listeners.forEach((listener) => listener());
    },
    subscribeScroll(listener) {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },
  };
}
