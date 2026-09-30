interface VirtualKeyboard {
  show(): void;
}
type PolicyElement = HTMLElement & { virtualKeyboardPolicy?: string };

/**
 * Focus a text field and ask for the on-screen keyboard. Android Chrome only opens it for a page
 * the user has already touched, so it opens when Helm was already running (a home-screen shortcut
 * then reuses it) but not on a cold start: there the field is focused and one tap brings it up.
 */
export function focusWithKeyboard(el: PolicyElement | null) {
  if (!el) return;
  el.focus();
  const vk = (navigator as Navigator & { virtualKeyboard?: VirtualKeyboard }).virtualKeyboard;
  if (!vk || !('virtualKeyboardPolicy' in el)) return;
  // show() only acts on a field whose keyboard is managed by hand; switch back once it has run,
  // so taps open the keyboard as usual.
  const previous = el.virtualKeyboardPolicy ?? '';
  el.virtualKeyboardPolicy = 'manual';
  vk.show();
  setTimeout(() => {
    el.virtualKeyboardPolicy = previous;
  }, 800);
}
