import { forwardRef, type TextareaHTMLAttributes } from 'react';

type Props = Omit<TextareaHTMLAttributes<HTMLTextAreaElement>, 'onChange' | 'rows' | 'value'> & {
  value: string;
  onValueChange: (value: string) => void;
  /** Enter pressed. Without it, Enter submits the form. */
  onEnter?: () => void;
};

/**
 * A one-line text field drawn as a textarea. Chrome on Android offers saved addresses, cards and
 * passwords above the keyboard for text inputs, whatever autocomplete says, but leaves textareas
 * alone. Newlines never get in (typed or pasted), Enter submits, and long text wraps rather than
 * scrolling sideways.
 */
export const LineInput = forwardRef<HTMLTextAreaElement, Props>(function LineInput(
  { value, onValueChange, onEnter, onKeyDown, className, ...rest },
  ref,
) {
  return (
    <textarea
      ref={ref}
      rows={1}
      autoComplete="off"
      spellCheck
      enterKeyHint={onEnter ? 'next' : 'done'}
      {...rest}
      className={`line-input${className ? ` ${className}` : ''}`}
      value={value}
      onChange={(e) => onValueChange(e.target.value.replace(/[\r\n]+/g, ' '))}
      onKeyDown={(e) => {
        onKeyDown?.(e);
        if (e.defaultPrevented || e.key !== 'Enter' || e.shiftKey || e.nativeEvent.isComposing) return;
        e.preventDefault();
        if (onEnter) onEnter();
        else e.currentTarget.form?.requestSubmit();
      }}
    />
  );
});
