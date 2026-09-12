import React from 'react';

export function TextInput({ value, onChange, placeholder, width }: {
  value: string; onChange: (v: string) => void; placeholder?: string; width?: number;
}) {
  return (
    <input
      className="cell-input"
      style={width ? { width } : undefined}
      value={value}
      placeholder={placeholder}
      onChange={(e) => onChange(e.target.value)}
    />
  );
}

/** Numeric input that keeps the raw text while typing so "1.", "" and "-" work. */
export function NumberInput({ value, onChange, step = 'any', width = 80, suffix }: {
  value: number; onChange: (v: number) => void; step?: string; width?: number; suffix?: string;
}) {
  const [draft, setDraft] = React.useState<string | null>(null);
  const shown = draft ?? (Number.isFinite(value) ? String(value) : '');
  return (
    <span className="num-wrap">
      <input
        className="cell-input num"
        style={{ width }}
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
      {suffix && <span className="suffix">{suffix}</span>}
    </span>
  );
}

/** Comma/plus separated list of time entries, e.g. "20+20+20+20" like the sheet. */
export function EntriesInput({ entries, onChange }: {
  entries: number[]; onChange: (v: number[]) => void;
}) {
  const [draft, setDraft] = React.useState<string | null>(null);
  const shown = draft ?? entries.filter((e) => e !== 0 || entries.length === 1).join(' + ');
  return (
    <input
      className="cell-input entries"
      value={shown}
      placeholder="20 + 20 + 20"
      title="Each time entry, separated by + or ,"
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
