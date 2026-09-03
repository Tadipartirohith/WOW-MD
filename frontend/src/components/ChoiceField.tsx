import { useId, useState } from 'react';
import { OTHER, isOffList } from '../lib/reference';

/**
 * A dropdown that cannot tell somebody they do not exist.
 *
 * These fields were free text, so the same community was typed five ways and
 * nothing matched on it. A plain list fixes that and introduces a worse
 * problem: India has thousands of communities, sub-castes and gothrams, and a
 * family whose own is missing from the list is being told their answer is not
 * a valid one. So the list is the fast path and "Other" opens a text box.
 *
 * A value already stored that is not on the list — everything saved before
 * these lists existed — reopens as "Other" with the text filled in, rather
 * than being silently dropped the next time somebody saves the section.
 */
export default function ChoiceField({
  label,
  value,
  onChange,
  options,
  hint,
  required,
  allowOther = true,
  placeholder = 'Not stated',
}: {
  label: string;
  value: string;
  onChange: (value: string) => void;
  options: readonly string[];
  hint?: string;
  required?: boolean;
  /** Off for lists that really are closed, like the twelve rashis. */
  allowOther?: boolean;
  placeholder?: string;
}) {
  const id = useId();
  // A stored value that is not on the list reopens as "Other, already filled in".
  const offList = allowOther && isOffList(value, options);
  // But an "Other" the user has *just* picked clears the value to '', and an
  // empty value is off-list to nobody — so without remembering the pick, the
  // select snaps back to "Not stated", the box never opens, and a required
  // field reports "Please select an item in the list" on save. Remember it.
  const [otherPicked, setOtherPicked] = useState(false);
  const showOther = offList || otherPicked;
  const selectValue = showOther ? OTHER : value;

  return (
    <div>
      <label className="label" htmlFor={id}>
        {label}
      </label>
      <select
        id={id}
        className="input mt-1"
        value={selectValue}
        required={required}
        onChange={(e) => {
          // Choosing "Other" clears the value rather than storing the word
          // "Other" — the box below is what carries the answer, and a profile
          // whose caste literally reads "Other" is a profile nobody can match.
          // The select still shows "Other" (via otherPicked) so a required
          // field stays satisfied while the box is being typed into.
          if (e.target.value === OTHER) {
            setOtherPicked(true);
            onChange('');
          } else {
            setOtherPicked(false);
            onChange(e.target.value);
          }
        }}
      >
        <option value="">{placeholder}</option>
        {options.map((o) => (
          <option key={o} value={o}>
            {o}
          </option>
        ))}
        {allowOther && !options.includes(OTHER) && <option value={OTHER}>{OTHER}</option>}
      </select>

      {showOther && (
        <input
          className="input mt-2"
          value={value}
          placeholder={`Type the ${label.toLowerCase()}`}
          maxLength={60}
          onChange={(e) => onChange(e.target.value)}
        />
      )}

      {hint && <p className="mt-1 text-xs text-gray-500">{hint}</p>}
    </div>
  );
}
