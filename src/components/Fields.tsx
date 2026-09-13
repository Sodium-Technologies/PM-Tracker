import React from 'react';

export function TextInput({ id, value, onChange, placeholder, className = '' }: {
  id?: string; value: string; onChange: (v: string) => void; placeholder?: string; className?: string;
}) {
  return (
    <input
      id={id}
      className={`cell-input ${className}`}
      value={value}
      placeholder={placeholder}
      onChange={(e) => onChange(e.target.value)}
    />
  );
}

/** Numeric input that keeps the raw text while typing, so "1.", "" and "-" work,
 *  with the unit shown beside it rather than inside the value. */
export function NumberInput({ id, value, onChange, unit, width = 72, step = 'any' }: {
  id?: string; value: number; onChange: (v: number) => void;
  unit?: string; width?: number; step?: string;
}) {
  const [draft, setDraft] = React.useState<string | null>(null);
  const shown = draft ?? (Number.isFinite(value) ? String(value) : '');
  return (
    <span className="unit">
      <input
        id={id}
        className="cell-input num"
        style={{ width, minWidth: width }}
        type="number"
        step={step}
        value={shown}
        onChange={(e) => {
          setDraft(e.target.value);
          const n = parseFloat(e.target.value);
          onChange(Number.isFinite(n) ? n : 0);
        }}
        onBlur={() => setDraft(null)}
      />
      {unit && <span className="tag">{unit}</span>}
    </span>
  );
}

/** The individual time entries, written the way the sheet writes them:
 *  `20 + 20 + 20 + 20`. */
export function EntriesInput({ id, entries, onChange }: {
  id?: string; entries: number[]; onChange: (v: number[]) => void;
}) {
  const [draft, setDraft] = React.useState<string | null>(null);
  const shown = draft ?? entries.filter((e) => e !== 0 || entries.length === 1).join(' + ');
  return (
    <input
      id={id}
      className="cell-input num entries"
      value={shown}
      placeholder="20 + 20 + 20"
      title="Each time entry, separated by +"
      onChange={(e) => {
        setDraft(e.target.value);
        const parts = e.target.value
          .split(/[+,;]/)
          .map((p) => parseFloat(p.trim()))
          .filter((n) => Number.isFinite(n));
        onChange(parts.length ? parts : [0]);
      }}
      onBlur={() => setDraft(null)}
    />
  );
}
