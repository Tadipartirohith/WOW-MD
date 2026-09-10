import { View } from 'react-native';

import { dateTime, shortDate } from '@/lib/format';
import type { VerificationRequest } from '@/lib/verification';
import { Caption } from '@/components/ui';
import { radius, rgb, space, useTheme } from '@/theme';

/**
 * The 72-hour clock.
 *
 * The server has computed and stored `slaDeadline` since the verification
 * schema was written and returned it on every request; nothing displayed it for
 * a long time. A deadline nobody can see is not a deadline — it is a column —
 * and the whole point of the SLA is that the officer holding the request and
 * the administrator watching the queue both know how long is left before
 * anybody has to ask.
 *
 * Three states rather than a countdown to the second. A ticking timer implies a
 * precision this does not have and makes a queue of twenty cards restless; what
 * somebody needs is whether this one is fine, tight, or already late.
 */
export function Sla({ request }: { request: VerificationRequest }) {
  const theme = useTheme();
  const decided = request.status === 'approved' || request.status === 'rejected';
  if (!request.slaDeadline || decided) return null;

  const deadline = new Date(request.slaDeadline);
  const hours = Math.round((deadline.getTime() - Date.now()) / 3_600_000);
  const breached = Boolean(request.slaBreachedAt) || hours < 0;
  // Six hours is roughly the point at which a visit can no longer be arranged
  // for today, which is what makes it the moment to say something.
  const urgent = !breached && hours <= 6;

  const ground = breached
    ? theme.criticalBg
    : urgent
      ? theme.cautionBg
      : theme.surfaceSunken;
  const ink = breached ? theme.criticalFg : urgent ? theme.cautionFg : theme.ink[600];

  const label = breached
    ? `Overdue by ${Math.abs(hours)}h`
    : urgent
      ? `Due in ${hours}h`
      : `${hours}h left`;

  return (
    <View
      style={{
        backgroundColor: rgb(ground),
        borderRadius: radius.sm,
        paddingHorizontal: space(2.5),
        paddingVertical: space(2),
        gap: space(0.5),
      }}
    >
      <Caption style={{ color: rgb(ink), fontWeight: '600' }}>{label}</Caption>
      <Caption style={{ color: rgb(ink) }}>
        72-hour deadline {dateTime(request.slaDeadline)}
        {request.verificationStartedAt
          ? ` · visit started ${shortDate(request.verificationStartedAt)}`
          : ''}
      </Caption>
    </View>
  );
}
