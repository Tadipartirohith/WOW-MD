import { useQueryClient } from '@tanstack/react-query';
import { useBusinesses } from '../store/business';

/**
 * Which business you are looking at, for an account that holds more than one.
 *
 * Rendered in the header rather than on each page, because that is what makes
 * the choice mean something: the same business is current on My Business, the
 * catalog, the calendar, the bookings and the money, and switching it switches
 * all of them at once.
 *
 * Absent for an account with a single business. A dropdown with one option is
 * a decision the reader has to make and cannot get wrong, which is the worst
 * kind of control to put in front of somebody.
 */
export default function BusinessSwitcher() {
  const { businesses, activeId, setBusinessId } = useBusinesses();
  const qc = useQueryClient();

  if (businesses.length < 2) return null;

  return (
    <label className="flex items-center gap-2 text-sm">
      <span className="sr-only">Business</span>
      <select
        className="rounded border border-gray-300 px-2 py-1 text-sm"
        value={activeId ?? ''}
        onChange={(e) => {
          setBusinessId(e.target.value);
          // Everything on screen is about the old business. Dropping the cached
          // answers is cheaper than listing which queries were affected, and it
          // cannot go stale as new screens are added.
          qc.invalidateQueries();
        }}
      >
        {businesses.map((b) => (
          <option key={b.id} value={b.id}>
            {b.name}
            {b.isApproved ? '' : ' — not live'}
          </option>
        ))}
      </select>
    </label>
  );
}
