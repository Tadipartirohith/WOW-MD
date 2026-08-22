import { BadRequestException } from '@nestjs/common';
import { AttributeScope, ServiceAttributeType } from '../../common/enums';
import { AttributeConstraints, ServiceAttribute } from './entities/service-attribute.entity';

/**
 * The engine that makes a configuration-driven catalog safe to store as jsonb.
 *
 * Every answer a vendor or a buyer gives is validated against the attribute
 * that asked for it, before it is written. Without this the catalog degenerates
 * into an untyped bag: a "guest count" that is sometimes 250, sometimes "250",
 * sometimes "around 250", and a search that can filter on none of them.
 *
 * The rule throughout is that a *missing* optional answer is dropped rather
 * than stored as null, so `attributes` only ever contains answers somebody
 * actually gave. That distinction matters for the same reason the horoscope
 * field did: "not asked" is not "answered no".
 */

/** A field-level failure, in the shape the API already returns for DTO errors. */
export interface AttributeError {
  key: string;
  label: string;
  message: string;
}

const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;
// 24-hour, and actually a clock time: a looser `\d{2}:\d{2}` accepts 25:00 and
// 09:75, which then sit in the database as answers nothing can order or render.
const ISO_TIME = /^([01]\d|2[0-3]):[0-5]\d(:[0-5]\d)?$/;

function fail(errors: AttributeError[], attr: ServiceAttribute, message: string): void {
  errors.push({ key: attr.key, label: attr.label, message });
}

function isBlank(value: unknown): boolean {
  return value === undefined || value === null || value === '';
}

function asNumber(value: unknown): number | null {
  if (typeof value === 'number' && Number.isFinite(value)) return value;
  if (typeof value === 'string' && value.trim() !== '' && Number.isFinite(Number(value))) {
    return Number(value);
  }
  return null;
}

function checkBounds(
  errors: AttributeError[],
  attr: ServiceAttribute,
  n: number,
  c: AttributeConstraints,
): void {
  if (c.min !== undefined && n < c.min) fail(errors, attr, `must be at least ${c.min}`);
  if (c.max !== undefined && n > c.max) fail(errors, attr, `must be at most ${c.max}`);
}

/**
 * Coerces and checks one answer.
 *
 * Returns the value to store, or `undefined` if it should not be stored at all.
 * Coercion is deliberate rather than lax: a number arriving as `"250"` from a
 * form field is stored as `250`, because the alternative is that every
 * comparison downstream has to guess.
 */
function coerceOne(
  attr: ServiceAttribute,
  raw: unknown,
  errors: AttributeError[],
): unknown | undefined {
  const c = attr.constraints ?? {};

  switch (attr.type) {
    case ServiceAttributeType.TEXT:
    case ServiceAttributeType.URL: {
      if (typeof raw !== 'string') {
        fail(errors, attr, 'must be text');
        return undefined;
      }
      const text = raw.trim();
      if (c.maxLength !== undefined && text.length > c.maxLength) {
        fail(errors, attr, `must be ${c.maxLength} characters or fewer`);
        return undefined;
      }
      if (attr.type === ServiceAttributeType.URL && !/^https?:\/\/\S+$/i.test(text)) {
        fail(errors, attr, 'must be a http or https address');
        return undefined;
      }
      return text;
    }

    case ServiceAttributeType.NUMBER: {
      const n = asNumber(raw);
      if (n === null || !Number.isInteger(n)) {
        fail(errors, attr, 'must be a whole number');
        return undefined;
      }
      checkBounds(errors, attr, n, c);
      return n;
    }

    case ServiceAttributeType.DECIMAL:
    case ServiceAttributeType.CURRENCY: {
      const n = asNumber(raw);
      if (n === null) {
        fail(errors, attr, 'must be a number');
        return undefined;
      }
      if (attr.type === ServiceAttributeType.CURRENCY && n < 0) {
        fail(errors, attr, 'cannot be negative');
        return undefined;
      }
      checkBounds(errors, attr, n, c);
      // Currency is money, so two places unless the attribute says otherwise.
      const places = c.precision ?? (attr.type === ServiceAttributeType.CURRENCY ? 2 : 4);
      return Number(n.toFixed(places));
    }

    case ServiceAttributeType.DURATION: {
      const n = asNumber(raw);
      if (n === null || n <= 0) {
        fail(errors, attr, 'must be a positive amount of time');
        return undefined;
      }
      checkBounds(errors, attr, n, c);
      return n;
    }

    case ServiceAttributeType.BOOLEAN: {
      if (typeof raw === 'boolean') return raw;
      if (raw === 'true') return true;
      if (raw === 'false') return false;
      fail(errors, attr, 'must be yes or no');
      return undefined;
    }

    case ServiceAttributeType.SINGLE_SELECT: {
      const allowed = (c.options ?? []).map((o) => o.value);
      if (typeof raw !== 'string' || !allowed.includes(raw)) {
        fail(errors, attr, `must be one of: ${allowed.join(', ') || '(no options configured)'}`);
        return undefined;
      }
      return raw;
    }

    case ServiceAttributeType.MULTI_SELECT: {
      if (!Array.isArray(raw)) {
        fail(errors, attr, 'must be a list of choices');
        return undefined;
      }
      const allowed = (c.options ?? []).map((o) => o.value);
      const bad = raw.filter((v) => typeof v !== 'string' || !allowed.includes(v));
      if (bad.length > 0) {
        fail(errors, attr, `contains a choice that is not offered: ${String(bad[0])}`);
        return undefined;
      }
      // Duplicates are a client bug, not a user error — silently collapse them.
      const unique = Array.from(new Set(raw as string[]));
      if (c.minSelections !== undefined && unique.length < c.minSelections) {
        fail(errors, attr, `choose at least ${c.minSelections}`);
        return undefined;
      }
      if (c.maxSelections !== undefined && unique.length > c.maxSelections) {
        fail(errors, attr, `choose at most ${c.maxSelections}`);
        return undefined;
      }
      return unique;
    }

    case ServiceAttributeType.DATE: {
      if (typeof raw !== 'string' || !ISO_DATE.test(raw) || Number.isNaN(Date.parse(raw))) {
        fail(errors, attr, 'must be a date (YYYY-MM-DD)');
        return undefined;
      }
      return raw;
    }

    case ServiceAttributeType.TIME: {
      if (typeof raw !== 'string' || !ISO_TIME.test(raw)) {
        fail(errors, attr, 'must be a time (HH:MM)');
        return undefined;
      }
      return raw.length === 5 ? raw : raw.slice(0, 5);
    }

    case ServiceAttributeType.DATE_TIME: {
      if (typeof raw !== 'string' || Number.isNaN(Date.parse(raw))) {
        fail(errors, attr, 'must be a date and time');
        return undefined;
      }
      return new Date(raw).toISOString();
    }

    case ServiceAttributeType.FILE: {
      if (typeof raw !== 'string' || !/^https?:\/\/\S+$/i.test(raw)) {
        fail(errors, attr, 'must be an uploaded file');
        return undefined;
      }
      if (c.accept && c.accept.length > 0) {
        const lower = raw.toLowerCase().split('?')[0];
        if (!c.accept.some((ext) => lower.endsWith(ext.toLowerCase()))) {
          fail(errors, attr, `must be one of: ${c.accept.join(', ')}`);
          return undefined;
        }
      }
      return raw;
    }

    case ServiceAttributeType.LOCATION: {
      const v = raw as { label?: unknown; city?: unknown; lat?: unknown; lng?: unknown };
      if (typeof v !== 'object' || v === null) {
        fail(errors, attr, 'must be a place');
        return undefined;
      }
      const city = typeof v.city === 'string' ? v.city.trim() : '';
      if (!city) {
        fail(errors, attr, 'needs at least a city');
        return undefined;
      }
      const lat = asNumber(v.lat);
      const lng = asNumber(v.lng);
      // Coordinates are optional; a city name is what people actually search by.
      if ((lat === null) !== (lng === null)) {
        fail(errors, attr, 'needs both a latitude and a longitude, or neither');
        return undefined;
      }
      return {
        label: typeof v.label === 'string' ? v.label.trim() : city,
        city,
        ...(lat !== null && lng !== null ? { lat, lng } : {}),
      };
    }

    case ServiceAttributeType.RANGE: {
      const v = raw as { from?: unknown; to?: unknown };
      if (typeof v !== 'object' || v === null) {
        fail(errors, attr, 'must be a range');
        return undefined;
      }
      const from = asNumber(v.from);
      const to = asNumber(v.to);
      if (from === null || to === null) {
        fail(errors, attr, 'needs a from and a to');
        return undefined;
      }
      if (from > to) {
        fail(errors, attr, 'starts after it ends');
        return undefined;
      }
      checkBounds(errors, attr, from, c);
      checkBounds(errors, attr, to, c);
      return { from, to };
    }

    default: {
      // Unreachable while the enum and this switch agree. If they ever stop
      // agreeing, refusing the write is safer than storing something no
      // validator has looked at.
      fail(errors, attr, 'is configured with a type this server does not understand');
      return undefined;
    }
  }
}

/**
 * Validates a whole answer bag against a definition's attributes for one scope.
 *
 * Unknown keys are dropped rather than rejected. An administrator retiring an
 * attribute should not turn every listing that still carries its answer into a
 * 400; the answer simply stops being read.
 */
export function validateAttributes(
  attributes: ServiceAttribute[],
  scope: AttributeScope,
  input: Record<string, unknown> | undefined,
): Record<string, unknown> {
  const relevant = attributes.filter((a) => a.scope === scope);
  const given = input ?? {};
  const errors: AttributeError[] = [];
  const stored: Record<string, unknown> = {};

  for (const attr of relevant) {
    const raw = given[attr.key];

    if (isBlank(raw) || (Array.isArray(raw) && raw.length === 0)) {
      if (attr.required) fail(errors, attr, 'is required');
      continue;
    }

    const value = coerceOne(attr, raw, errors);
    if (value !== undefined) stored[attr.key] = value;
  }

  if (errors.length > 0) {
    throw new BadRequestException({
      message: `${errors[0].label} ${errors[0].message}`,
      code: 'ATTRIBUTE_VALIDATION_FAILED',
      errors,
    });
  }

  return stored;
}

/**
 * The form to render, for a buyer or for a vendor.
 *
 * Handed to the client whole so the request form is generated from the same
 * rows the server validates against. A form built from a second, hand-written
 * list is a form that drifts.
 */
export function describeForm(attributes: ServiceAttribute[], scope: AttributeScope) {
  return attributes
    .filter((a) => a.scope === scope)
    .sort((a, b) => a.sortOrder - b.sortOrder || a.label.localeCompare(b.label))
    .map((a) => ({
      key: a.key,
      label: a.label,
      helpText: a.helpText,
      type: a.type,
      required: a.required,
      constraints: a.constraints ?? {},
      filterable: a.filterable,
    }));
}
