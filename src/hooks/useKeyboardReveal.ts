import { useCallback, useEffect, useRef, useState } from 'react';
import { Keyboard, NativeScrollEvent, NativeSyntheticEvent, ScrollView } from 'react-native';
import { TextInput } from '../components/AppText';

/**
 * Keep the field you are typing into on screen.
 *
 * Tap the fourth exercise's weight in a free workout and the keyboard covers
 * it: nothing scrolls, and you are typing into a box you cannot see ("alempaa
 * ei pysty kirjaamaan vakava bugi siis", #bugs 2026-08-28).
 *
 * The manifest sets `adjustResize`, so the obvious reading is that the window
 * shrinks and only the scroll offset is stale. It does not. Under edge-to-edge
 * the window keeps its full height and the keyboard is drawn over it — proved
 * on the emulator by asking the scroll view to jump to the bottom on focus and
 * watching it refuse, because the list was already at its maximum offset. That
 * is the whole bug: there is no room below the last row to scroll into.
 *
 * So this does two things, and needs both:
 *
 *   1. Reports the keyboard's height, which the caller adds as bottom padding.
 *      Without it the scroll view cannot reach far enough, whatever it is told.
 *   2. Scrolls the focused field above the keyboard's top edge, once the
 *      padding from (1) is in the layout.
 */

/**
 * Air left between the field and the keyboard.
 *
 * Not decoration, and not just taste. `endCoordinates.screenY` reports the
 * keyboard's top about a toolbar-row lower than where it is actually drawn —
 * measured on the emulator, the field landed exactly at the keyboard's visible
 * edge while the arithmetic considered it clear. A gap of roughly one row
 * absorbs that and is what you want anyway: a field flush against the keyboard
 * is technically visible and horrible to type into.
 */
const REVEAL_GAP = 120;
/** Corrections after the first scroll. Two is enough; three is a loop guard. */
const MAX_REVEAL_PASSES = 3;

interface KeyboardRevealField {
  ref: (node: TextInput | null) => void;
  onFocus: () => void;
}

export function useKeyboardReveal() {
  const scrollRef = useRef<ScrollView>(null);
  const offsetRef = useRef(0);
  const inputsRef = useRef(new Map<string, TextInput>());
  const focusedRef = useRef<string | null>(null);
  /**
   * One stable pair of handlers per field key.
   *
   * Built fresh every render they would be a new `ref` callback every render,
   * which React answers by detaching and reattaching every input in the list —
   * on the screen where the reader is typing.
   */
  const handlersRef = useRef(new Map<string, KeyboardRevealField>());

  /**
   * The keyboard's top edge, in screen coordinates.
   *
   * The line the field has to stay above, and the one number both the keyboard
   * event and `measureInWindow` express the same way. Null while the keyboard
   * is down, which is also the signal that there is nothing to avoid.
   */
  const keyboardTopRef = useRef<number | null>(null);
  /** Bottom padding the caller must add, so the list can scroll that far. */
  const [keyboardInset, setKeyboardInset] = useState(0);

  /**
   * Measure, scroll, measure again.
   *
   * One pass lands close but short: the reported scroll offset trails the
   * animation, and the keyboard event and `measureInWindow` do not have to
   * agree about where the window starts. Rather than model those, this checks
   * its own work and corrects — on the emulator the first pass got within a
   * row and the second closed it. Bounded, because a layout that cannot
   * satisfy the request must not loop forever.
   */
  const reveal = useCallback((attempt = 0) => {
    const keyboardTop = keyboardTopRef.current;
    const key = focusedRef.current;
    const input = key ? inputsRef.current.get(key) : undefined;
    const scroll = scrollRef.current;
    if (keyboardTop === null || !input || !scroll) {
      return;
    }
    input.measureInWindow((_x, y, _width, height) => {
      const hidden = y + height + REVEAL_GAP - keyboardTop;
      if (hidden <= 1) {
        return;
      }
      scroll.scrollTo({ y: offsetRef.current + hidden, animated: attempt === 0 });
      if (attempt < MAX_REVEAL_PASSES) {
        // Long enough for the scroll to settle and report its offset back.
        setTimeout(() => reveal(attempt + 1), 220);
      }
    });
  }, []);

  useEffect(() => {
    const shown = Keyboard.addListener('keyboardDidShow', (event) => {
      keyboardTopRef.current = event.endCoordinates.screenY;
      setKeyboardInset(event.endCoordinates.height);
    });
    const hidden = Keyboard.addListener('keyboardDidHide', () => {
      keyboardTopRef.current = null;
      setKeyboardInset(0);
    });
    return () => {
      shown.remove();
      hidden.remove();
    };
  }, []);

  /**
   * Scrolled after the padding is in the layout, not before.
   *
   * Scrolling straight from the keyboard event is clamped to the old maximum
   * offset — the list moves partway and stops, which is what the first attempt
   * at this did. An effect on the inset runs after the render that applied it,
   * which is the first moment the scroll view can reach far enough.
   */
  useEffect(() => {
    if (keyboardInset > 0) {
      reveal();
    }
  }, [keyboardInset, reveal]);

  const onScroll = useCallback((event: NativeSyntheticEvent<NativeScrollEvent>) => {
    offsetRef.current = event.nativeEvent.contentOffset.y;
  }, []);

  const field = useCallback(
    (key: string): KeyboardRevealField => {
      const existing = handlersRef.current.get(key);
      if (existing) {
        return existing;
      }
      const created: KeyboardRevealField = {
        ref: (node) => {
          if (node) {
            inputsRef.current.set(key, node);
          } else {
            inputsRef.current.delete(key);
          }
        },
        onFocus: () => {
          focusedRef.current = key;
          // Moving between fields while the keyboard is already up: no inset
          // change is coming, so this is the only pass there will be.
          reveal();
        },
      };
      handlersRef.current.set(key, created);
      return created;
    },
    [reveal],
  );

  return { scrollRef, onScroll, field, keyboardInset };
}
