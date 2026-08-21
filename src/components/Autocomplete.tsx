'use client';

import { useId, useMemo, useState } from 'react';
import { cx, inputClass } from './ui';

/**
 * Free text with suggestions drawn from what people at THIS event have
 * already typed.
 *
 * This is not a convenience. Criterion 1 is validated by comparing two
 * players' universities, so "IUG" and "Islamic University of Gaza" typed
 * by two people from the same campus would let them match on a square
 * neither should get. Nudging everyone onto the same spelling is a
 * correctness feature wearing a UX hat.
 */
export function Autocomplete({
  id, value, onChange, suggestions, placeholder, describedBy, invalid, maxLength = 60,
}: {
  id: string;
  value: string;
  onChange: (v: string) => void;
  suggestions: string[];
  placeholder?: string;
  describedBy?: string;
  invalid?: boolean;
  maxLength?: number;
}) {
  const [open, setOpen] = useState(false);
  const listId = useId();

  const matches = useMemo(() => {
    const q = value.trim().toLowerCase();
    const pool = suggestions.filter((s, i) => suggestions.indexOf(s) === i);
    if (!q) return pool.slice(0, 6);
    return pool.filter((s) => s.toLowerCase().includes(q) && s.toLowerCase() !== q).slice(0, 6);
  }, [value, suggestions]);

  const showList = open && matches.length > 0;

  return (
    <div className="relative">
      <input
        id={id}
        type="text"
        value={value}
        maxLength={maxLength}
        placeholder={placeholder}
        autoComplete="off"
        autoCorrect="off"
        spellCheck={false}
        aria-invalid={invalid || undefined}
        aria-describedby={describedBy}
        aria-expanded={showList}
        aria-controls={showList ? listId : undefined}
        aria-autocomplete="list"
        role="combobox"
        className={inputClass}
        onChange={(e) => { onChange(e.target.value); setOpen(true); }}
        onFocus={() => setOpen(true)}
        onBlur={() => window.setTimeout(() => setOpen(false), 120)}
        onKeyDown={(e) => { if (e.key === 'Escape') setOpen(false); }}
      />

      {showList && (
        <ul
          id={listId}
          role="listbox"
          className={cx(
            'absolute z-20 mt-1 w-full overflow-hidden rounded-lg',
            'border border-line-strong bg-surface-2 shadow-xl',
          )}
        >
          {matches.map((s) => (
            <li key={s}>
              <button
                type="button"
                role="option"
                aria-selected={s === value}
                // onMouseDown fires before the input's blur, so the tap lands
                onMouseDown={(e) => { e.preventDefault(); onChange(s); setOpen(false); }}
                className="w-full px-3 py-2.5 text-left text-[15px] hover:bg-surface-3 focus-visible:bg-surface-3"
              >
                {s}
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
