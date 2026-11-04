import { useEffect, useId, useState } from 'react';
import type { RefOption } from './preflight';

// Text commits on blur/Enter (one undo entry per edit, caret never jumps).
// Numbers and checkboxes commit immediately — 0 and false are real values.
export function TextField({ label, value, onCommit, placeholder, multiline, type }: {
  label: string;
  value: string;
  onCommit: (v: string) => void;
  placeholder?: string;
  multiline?: boolean;
  type?: string;
}) {
  const id = useId();
  const [text, setText] = useState(value);
  useEffect(() => setText(value), [value]);
  const commit = () => {
    if (text !== value) onCommit(text);
  };
  return (
    <div className="field">
      <span><label htmlFor={id}>{label}</label></span>
      {multiline ? (
        <textarea id={id} rows={3} value={text} placeholder={placeholder} onChange={(e) => setText(e.target.value)} onBlur={commit} />
      ) : (
        <input
          id={id}
          type={type ?? 'text'}
          value={text}
          placeholder={placeholder}
          onChange={(e) => setText(e.target.value)}
          onBlur={commit}
          onKeyDown={(e) => {
            if (e.key === 'Enter') (e.target as HTMLInputElement).blur();
          }}
        />
      )}
    </div>
  );
}

export function NumberField({ label, value, min, onCommit }: {
  label: string;
  value: number | undefined;
  min?: number;
  onCommit: (v: number) => void;
}) {
  const id = useId();
  return (
    <div className="field">
      <span><label htmlFor={id}>{label}</label></span>
      <input
        id={id}
        type="number"
        min={min}
        value={value ?? ''}
        onChange={(e) => {
          const n = Number(e.target.value);
          if (e.target.value !== '' && Number.isFinite(n)) onCommit(n);
        }}
      />
    </div>
  );
}

export function CheckField({ label, checked, onChange }: {
  label: string;
  checked: boolean;
  onChange: (v: boolean) => void;
}) {
  const id = useId();
  return (
    <div className="field check-row">
      <input id={id} type="checkbox" checked={checked} onChange={(e) => onChange(e.target.checked)} />
      <label htmlFor={id}>{label}</label>
    </div>
  );
}

export function SelectField({ label, value, options, onChange, emptyLabel }: {
  label: string;
  value: string;
  options: Array<{ value: string; label: string }>;
  onChange: (v: string) => void;
  emptyLabel?: string;
}) {
  const id = useId();
  return (
    <div className="field">
      <span><label htmlFor={id}>{label}</label></span>
      <select id={id} value={value} onChange={(e) => onChange(e.target.value)}>
        {emptyLabel !== undefined && <option value="">{emptyLabel}</option>}
        {options.map((o) => (
          <option key={o.value} value={o.value}>{o.label}</option>
        ))}
      </select>
    </div>
  );
}

// Searchable reference picker over declared inputs and earlier-step outputs.
// Free text stays possible; unmatched refs are labeled unknown-shape.
export function DataRefPicker({ label, value, options, onCommit, placeholder }: {
  label: string;
  value: string;
  options: RefOption[];
  onCommit: (v: string) => void;
  placeholder?: string;
}) {
  const id = useId();
  const [text, setText] = useState(value);
  useEffect(() => setText(value), [value]);
  const match = options.find((o) => o.ref === text);
  return (
    <div className="field">
      <span><label htmlFor={id}>{label}</label></span>
      <input
        id={id}
        type="text"
        list={`${id}-opts`}
        value={text}
        placeholder={placeholder ?? 'step.field or input name'}
        onChange={(e) => setText(e.target.value)}
        onBlur={() => {
          if (text !== value) onCommit(text);
        }}
      />
      <datalist id={`${id}-opts`}>
        {options.map((o) => (
          <option key={o.ref} value={o.ref}>{o.detail}</option>
        ))}
      </datalist>
      {text !== '' && match && (
        <span className="status-line">{match ? match.detail : 'Unknown shape — validation will confirm.'}</span>
      )}
    </div>
  );
}
