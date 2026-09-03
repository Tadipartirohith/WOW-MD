import ChoiceField from './ChoiceField';
import { COUNTRIES } from '../lib/reference';
import { statesForCountry, districtsForState } from '../lib/locations';

/**
 * Country → State → District/City, where each level narrows the next.
 *
 * The three location fields used to be independent dropdowns off flat lists, so
 * choosing Australia still offered Indian states and cities. Here the state list
 * is derived from the chosen country and the district/city list from the chosen
 * state; changing a parent clears its children (via `key`, which also resets the
 * "Other" box each child may have opened) so a stale India→Telangana can never
 * survive a switch to Australia. Where no finite child list exists — a country
 * we do not enumerate, or a state without a district list — the field falls back
 * to the free-text "Other" box, so nobody is ever blocked from entering a place.
 */
export default function DependentLocation({
  country,
  state,
  city,
  onCountry,
  onState,
  onCity,
  labels = { country: 'Country', state: 'State', city: 'City' },
}: {
  country: string;
  state: string;
  city: string;
  onCountry: (v: string) => void;
  onState: (v: string) => void;
  onCity: (v: string) => void;
  labels?: { country: string; state: string; city: string };
}) {
  const stateOptions = statesForCountry(country);
  const cityOptions = districtsForState(state);

  return (
    <>
      <ChoiceField
        label={labels.country}
        value={country}
        options={COUNTRIES}
        onChange={(v) => {
          onCountry(v);
          // A country change invalidates whatever state and city were chosen.
          onState('');
          onCity('');
        }}
      />
      <ChoiceField
        key={`state-${country}`}
        label={labels.state}
        value={state}
        options={stateOptions}
        onChange={(v) => {
          onState(v);
          onCity('');
        }}
      />
      <ChoiceField
        key={`city-${country}-${state}`}
        label={labels.city}
        value={city}
        options={cityOptions}
        onChange={onCity}
      />
    </>
  );
}
