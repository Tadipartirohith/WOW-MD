import {
  CONSENT_METHOD_LABEL,
  CONSENT_RELATION_LABEL,
  ConsentMethod,
  ConsentRelation,
} from '../lib/permissions';

export interface ConsentDraft {
  method: ConsentMethod;
  givenByRelation: ConsentRelation;
  givenByName: string;
  givenByPhone: string;
  givenAt: string;
  notes: string;
  allowsCirculation: boolean;
}

export const emptyConsent = (): ConsentDraft => ({
  method: 'in_person',
  givenByRelation: 'father',
  givenByName: '',
  givenByPhone: '',
  givenAt: new Date().toISOString().slice(0, 10),
  notes: '',
  allowsCirculation: false,
});

/** Strips the empty optionals so the API sees a clean payload. */
export function consentPayload(c: ConsentDraft, includeCirculation = true) {
  const out: Record<string, unknown> = {
    method: c.method,
    givenByRelation: c.givenByRelation,
    givenByName: c.givenByName,
    givenAt: c.givenAt,
  };
  if (c.givenByPhone) out.givenByPhone = c.givenByPhone;
  if (c.notes) out.notes = c.notes;
  if (includeCirculation) out.allowsCirculation = c.allowsCirculation;
  return out;
}

/**
 * Consent capture at the desk.
 *
 * Deliberately two questions, not one. A family agreeing to the agency holding
 * their details has not agreed to those details being passed around, and the
 * second permission is the one that matters when the biodata starts moving.
 */
export default function ConsentFields({
  value,
  onChange,
  showCirculation = true,
}: {
  value: ConsentDraft;
  onChange: (next: ConsentDraft) => void;
  showCirculation?: boolean;
}) {
  const set = <K extends keyof ConsentDraft>(key: K) => (v: ConsentDraft[K]) =>
    onChange({ ...value, [key]: v });

  return (
    <fieldset className="rounded-lg border border-gray-200 p-4">
      <legend className="px-1 text-sm font-medium text-gray-700">Consent</legend>
      <p className="mb-3 text-xs text-gray-500">
        Record how this family gave permission. This is kept with the profile and cannot be edited
        afterwards. A change of mind is recorded as a new entry.
      </p>

      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
        <div>
          <label className="label">How was it given?</label>
          <select
            className="input"
            value={value.method}
            onChange={(e) => set('method')(e.target.value as ConsentMethod)}
          >
            {Object.entries(CONSENT_METHOD_LABEL).map(([k, label]) => (
              <option key={k} value={k}>
                {label}
              </option>
            ))}
          </select>
        </div>
        <div>
          <label className="label">Who gave it?</label>
          <select
            className="input"
            value={value.givenByRelation}
            onChange={(e) => set('givenByRelation')(e.target.value as ConsentRelation)}
          >
            {Object.entries(CONSENT_RELATION_LABEL).map(([k, label]) => (
              <option key={k} value={k}>
                {label}
              </option>
            ))}
          </select>
        </div>
        {/*
          Not asked when there is nobody else to name.
          
          "Who gave it?" answered as the person themselves already names them —
          the profile is theirs. Asking again, and refusing to save without it,
          made the obvious answer the one that could not be recorded.
        */}
        {value.givenByRelation !== 'self' && (
          <div>
            <label className="label">Their name</label>
            <input
              className="input"
              value={value.givenByName}
              onChange={(e) => set('givenByName')(e.target.value)}
              minLength={2}
              required
            />
          </div>
        )}
        <div>
          <label className="label">
            Their number <span className="font-normal text-gray-400">(optional)</span>
          </label>
          <input
            className="input"
            placeholder="+919876543210"
            value={value.givenByPhone}
            onChange={(e) => set('givenByPhone')(e.target.value)}
          />
          <p className="mt-1 text-xs text-gray-500">So you can call back to confirm.</p>
        </div>
        <div>
          <label className="label">Date given</label>
          <input
            className="input"
            type="date"
            value={value.givenAt}
            onChange={(e) => set('givenAt')(e.target.value)}
            required
          />
        </div>
      </div>

      <div className="mt-3">
        <label className="label">
          Notes <span className="font-normal text-gray-400">(optional)</span>
        </label>
        <input
          className="input"
          placeholder="Father visited the office with the biodata."
          maxLength={1000}
          value={value.notes}
          onChange={(e) => set('notes')(e.target.value)}
        />
      </div>

      {showCirculation && (
        <label className="mt-4 flex items-start gap-2 rounded-lg bg-brand-light p-3">
          <input
            type="checkbox"
            className="mt-0.5"
            checked={value.allowsCirculation}
            onChange={(e) => set('allowsCirculation')(e.target.checked)}
          />
          <span className="text-sm text-brand-dark">
            They are happy for this profile to be circulated: shared with other agents, put into
            the network, or sent out as a biodata.
            <span className="mt-1 block text-xs">
              Without this you can still hold the profile and match it yourself, but nothing leaves
              the agency. You can add it later.
            </span>
          </span>
        </label>
      )}
    </fieldset>
  );
}
