import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { Permission, ROLE_LABEL, canAny, can } from './permissions';

/**
 * The client mirrors the backend's permission matrix by hand.
 *
 * That mirror is how the navigation knows what to hide, and nothing was
 * checking it against the source. A permission renamed on the server would
 * silently start hiding a menu entry from everyone, or — worse — showing one
 * that only ever produces a 403.
 *
 * This reads the backend enum directly rather than duplicating it again. It is
 * a file-path coupling, which is ugly, but the alternative is a third copy of
 * the same list and a build step to generate it; in one repository, reading the
 * original is both simpler and harder to get wrong.
 */
const BACKEND_PERMISSIONS = join(
  __dirname,
  '../../../backend/src/common/authz/permissions.ts',
);

function backendPermissionValues(): Set<string> {
  const source = readFileSync(BACKEND_PERMISSIONS, 'utf8');
  const values = new Set<string>();
  // Matches `NAME = 'value',` inside the enum body.
  for (const match of source.matchAll(/^\s{2}[A-Z_0-9]+ = '([a-z_0-9:]+)',$/gm)) {
    values.add(match[1]);
  }
  return values;
}

describe('the client permission mirror', () => {
  it('finds the backend enum at all', () => {
    // A silent zero here would make every assertion below vacuously pass, which
    // is the classic way a mirror test stops testing anything.
    expect(backendPermissionValues().size).toBeGreaterThan(30);
  });

  it('names no permission the server does not have', () => {
    const server = backendPermissionValues();
    const unknown = Object.entries(Permission)
      .filter(([, value]) => !server.has(value))
      .map(([name, value]) => `${name} (${value})`);

    expect(unknown).toEqual([]);
  });

  it('mirrors every permission the server defines', () => {
    const client = new Set<string>(Object.values(Permission));
    const missing = [...backendPermissionValues()].filter((value) => !client.has(value));

    expect(missing).toEqual([]);
  });
});

describe('capability checks', () => {
  it('says yes only for a permission actually held', () => {
    const held = [Permission.BOOKING_CREATE, Permission.MATCH_BROWSE];
    expect(can(held, Permission.BOOKING_CREATE)).toBe(true);
    expect(can(held, Permission.ADMIN_ANALYTICS_READ)).toBe(false);
  });

  it('treats an empty permission set as holding nothing', () => {
    expect(can([], Permission.MATCH_BROWSE)).toBe(false);
    expect(canAny([], [Permission.MATCH_BROWSE, Permission.BOOKING_CREATE])).toBe(false);
  });

  it('is any-of, which is what the navigation needs', () => {
    // A nav entry shown to vendors *or* planners asks for either listing
    // permission; requiring both would hide it from each of them.
    const vendor = [Permission.VENDOR_LISTING_MANAGE];
    expect(canAny(vendor, [Permission.VENDOR_LISTING_MANAGE, Permission.PLANNER_LISTING_MANAGE])).toBe(
      true,
    );
  });
});

describe('role labels', () => {
  it('has a human-readable label for every role', () => {
    for (const [role, label] of Object.entries(ROLE_LABEL)) {
      expect(label, `${role} has no label`).toBeTruthy();
      // "in_person" reaching a screen would be a leaked internal name.
      expect(label).not.toContain('_');
    }
  });
});
