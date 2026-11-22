import { useEffect, useId, useState } from 'react';
import type { RefOption } from './preflight';

// Text commits on blur/Enter (one undo entry per edit, caret never jumps).
// Checkboxes commit immediately.
export function TextField({
  id: fieldId,
  label,
  value,
  onCommit,
  placeholder,
  description,
  error,
  multiline,
  readOnly,
  type,
  autoFocus,
  required,
  autoCapitalize,
  spellCheck,
  trimOnCommit,
}: {
  id?: string;
  label: string;
  value: string;
  onCommit: (v: string) => void;
  placeholder?: string;
  description?: string;
  error?: string;
  multiline?: boolean;
  readOnly?: boolean;
  type?: string;
  autoFocus?: boolean;
  required?: boolean;
  autoCapitalize?: string;
  spellCheck?: boolean;
  trimOnCommit?: boolean;
}) {
  const generatedId = useId();
  const id = fieldId ?? generatedId;
  const describedBy = [description && `${id}-description`, error && `${id}-error`].filter(Boolean).join(' ') || undefined;
  const [text, setText] = useState(value);
  useEffect(() => setText(value), [value]);
  const commit = () => {
    if (readOnly) return;
    const next = trimOnCommit ? text.trim() : text;
    if (next !== text) setText(next);
    if (next !== value) onCommit(next);
  };
  return (
    <div className="field">
      <span>
        <label htmlFor={id}>{label}</label>
        {description && <small id={`${id}-description`}>{description}</small>}
      </span>
      {multiline ? (
        <textarea
          id={id}
          aria-describedby={describedBy}
          aria-invalid={Boolean(error) || undefined}
          rows={3}
          value={text}
          readOnly={readOnly}
          placeholder={placeholder}
          onChange={(e) => setText(e.target.value)}
          onBlur={commit}
        />
      ) : (
        <input
          id={id}
          autoFocus={autoFocus}
          autoCapitalize={autoCapitalize}
          spellCheck={spellCheck}
          aria-required={required || undefined}
          aria-describedby={describedBy}
          aria-invalid={Boolean(error) || undefined}
          type={type ?? 'text'}
          value={text}
          readOnly={readOnly}
          placeholder={placeholder}
          onChange={(e) => setText(e.target.value)}
          onBlur={commit}
          onKeyDown={(e) => {
            if (e.key === 'Enter' && !e.nativeEvent.isComposing) {
              (e.target as HTMLInputElement).blur();
            }
          }}
        />
      )}
      {error && <small className="status-bad" id={`${id}-error`}>{error}</small>}
    </div>
  );
}

export function NumberField({
  label,
  value,
  min,
  integer = false,
  onCommit,
  onClear,
}: {
  label: string;
  value: number | undefined;
  min?: number;
  integer?: boolean;
  onCommit: (v: number) => void;
  onClear?: () => void;
}) {
  const id = useId();
  const [text, setText] = useState(value?.toString() ?? '');
  const [error, setError] = useState('');
  useEffect(() => {
    setText(value?.toString() ?? '');
    setError('');
  }, [value]);

  function commit(input: HTMLInputElement) {
    if (input.value === '' && !input.validity.badInput) {
      if (onClear) {
        if (value !== undefined) onClear();
      } else {
        setText(value?.toString() ?? '');
      }
      return;
    }
    const number = input.valueAsNumber;
    if (!Number.isFinite(number) || (integer && !Number.isInteger(number))) {
      setError(integer ? 'Enter a whole number.' : 'Enter a number.');
      return;
    }
    if (min !== undefined && number < min) {
      setError(`Enter a number of at least ${min}.`);
      return;
    }
    setText(number.toString());
    if (number !== value) onCommit(number);
  }

  return (
    <div className="field">
      <span>
        <label htmlFor={id}>{label}</label>
      </span>
      <input
        id={id}
        type="number"
        min={min}
        step={integer ? 1 : 'any'}
        value={text}
        aria-invalid={error ? true : undefined}
        aria-describedby={error ? `${id}-error` : undefined}
        onChange={(event) => {
          setText(event.target.value);
          setError('');
        }}
        onBlur={(event) => commit(event.currentTarget)}
        onKeyDown={(event) => {
          if (event.key === 'Enter') event.currentTarget.blur();
        }}
      />
      {error && <span id={`${id}-error`} className="number-field-error" role="alert">{error}</span>}
    </div>
  );
}

export function CheckField({
  label,
  checked,
  onChange,
}: {
  label: string;
  checked: boolean;
  onChange: (v: boolean) => void;
}) {
  const id = useId();
  return (
    <div className="field check-row">
      <input
        id={id}
        type="checkbox"
        checked={checked}
        onChange={(e) => onChange(e.target.checked)}
      />
      <label htmlFor={id}>{label}</label>
    </div>
  );
}

export function SelectField({
  id: fieldId,
  required,
  label,
  value,
  options,
  onChange,
  emptyLabel,
  description,
  error,
}: {
  label: string;
  value: string;
  options: Array<{ value: string; label: string }>;
  onChange: (v: string) => void;
  emptyLabel?: string;
  id?: string;
  required?: boolean;
  description?: string;
  error?: string;
}) {
  const generatedId = useId();
  const id = fieldId ?? generatedId;
  const describedBy = [description && `${id}-description`, error && `${id}-error`].filter(Boolean).join(' ') || undefined;
  return (
    <div className="field">
      <span>
        <label htmlFor={id}>{label}</label>
        {description && <small id={`${id}-description`}>{description}</small>}
      </span>
      <select id={id} aria-describedby={describedBy} aria-invalid={Boolean(error) || undefined} aria-required={required || undefined} value={value} onChange={(e) => onChange(e.target.value)}>
        {emptyLabel !== undefined && <option value="">{emptyLabel}</option>}
        {options.map((o) => (
          <option key={o.value} value={o.value}>
            {o.label}
          </option>
        ))}
      </select>
      {error && <small id={`${id}-error`} className="status-bad">{error}</small>}
    </div>
  );
}

// Searchable reference picker over declared inputs and earlier-step outputs.
// Keep free text available for fields the picker cannot infer.
export function DataRefPicker({
  autoFocus,
  trimOnCommit,
  label,
  value,
  options,
  onCommit,
  onEdit,
  placeholder,
  error,
  description,
  required,
}: {
  autoFocus?: boolean;
  trimOnCommit?: boolean;
  label: string;
  value: string;
  options: RefOption[];
  onCommit: (v: string) => void;
  onEdit?: (v: string) => void;
  placeholder?: string;
  error?: string;
  description?: string;
  required?: boolean;
}) {
  const id = useId();
  const [text, setText] = useState(value);
  useEffect(() => setText(value), [value]);
  const matchingText = trimOnCommit ? text.trim() : text;
  const match = options.find((o) => o.ref === matchingText);
  const describedBy = [description && `${id}-description`, error ? `${id}-error` : text && match && `${id}-detail`].filter(Boolean).join(' ') || undefined;
  return (
    <div className="field">
      <span>
        <label htmlFor={id}>{label}</label>
        {description && <small id={`${id}-description`}>{description}</small>}
      </span>
      <input
        id={id}
        type="text"
        list={`${id}-opts`}
        autoFocus={autoFocus}
        autoCapitalize="none"
        spellCheck={false}
        aria-invalid={Boolean(error) || undefined}
        aria-describedby={describedBy}
        aria-required={required || undefined}
        value={text}
        placeholder={placeholder ?? 'step.field or input name'}
        onKeyUp={(event) => {
          if (event.key !== 'Enter' || event.nativeEvent.isComposing || text === value) return;
          event.currentTarget.blur();
        }}
        onChange={(e) => {
          setText(e.target.value);
          onEdit?.(e.target.value);
        }}
        onBlur={() => {
          const next = trimOnCommit ? text.trim() : text;
          if (next !== text) setText(next);
          if (next !== value) onCommit(next);
        }}
      />
      <datalist id={`${id}-opts`}>
        {options.map((o) => (
          <option key={o.ref} value={o.ref}>
            {o.detail}
          </option>
        ))}
      </datalist>
      {error && <span id={`${id}-error`} className="status-bad">{error}</span>}
      {text !== '' && match && (
        <span id={`${id}-detail`} className="status-line">
          {match.detail}
        </span>
      )}
    </div>
  );
}
