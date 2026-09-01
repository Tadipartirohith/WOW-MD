import { useQuery } from '@tanstack/react-query';
import { Envelope, Phone, WhatsappLogo, LinkSimple } from '@phosphor-icons/react';
import { api } from '../lib/api';

/**
 * How to reach a human.
 *
 * Rendered on the sign-in page as well as inside the app, because being locked
 * out is one of the main reasons to want it and a contact address only visible
 * once you are signed in is no use to the person who most needs it.
 *
 * Nothing here is written into the client. Every channel comes from the
 * server's configuration, and one that is not configured is absent from the
 * response rather than empty — so an operator with no WhatsApp desk simply has
 * no WhatsApp row, instead of a row nobody answers.
 */

interface Contact {
  email?: string;
  phone?: string;
  whatsapp?: string;
  url?: string;
  hours?: string;
  responseTime?: string;
  configured: boolean;
}

export default function SupportContact({ compact = false }: { compact?: boolean }) {
  const { data } = useQuery<Contact>({
    queryKey: ['support-contact'],
    queryFn: async () => (await api.get('/support/contact')).data,
    staleTime: 30 * 60 * 1000,
    retry: false,
  });

  // Nothing set is a real state, not a loading one: say so rather than showing
  // an empty card that looks like it failed to load.
  if (!data) return null;
  if (!data.configured && !data.url) {
    return compact ? null : (
      <p className="text-xs text-gray-400">
        Support contact details have not been configured for this environment.
      </p>
    );
  }

  const rows = [
    data.phone && { icon: Phone, label: data.phone, href: `tel:${data.phone.replace(/\s/g, '')}` },
    data.whatsapp && {
      icon: WhatsappLogo,
      label: 'WhatsApp',
      href: `https://wa.me/${data.whatsapp.replace(/[^\d]/g, '')}`,
    },
    data.email && { icon: Envelope, label: data.email, href: `mailto:${data.email}` },
    data.url && { icon: LinkSimple, label: 'Help centre', href: data.url },
  ].filter(Boolean) as { icon: typeof Phone; label: string; href: string }[];

  if (compact) {
    return (
      <div className="flex flex-wrap items-center gap-x-4 gap-y-1 text-xs text-gray-500">
        <span>Need help?</span>
        {rows.map((r) => (
          <a key={r.href} className="inline-flex items-center gap-1 text-brand" href={r.href}>
            <r.icon size={13} aria-hidden />
            {r.label}
          </a>
        ))}
      </div>
    );
  }

  return (
    <div className="card">
      <h2 className="section-title">Talk to somebody</h2>
      {data.hours && <p className="mt-0.5 text-sm text-gray-500">{data.hours}</p>}
      <ul className="mt-3 space-y-2">
        {rows.map((r) => (
          <li key={r.href}>
            <a className="inline-flex items-center gap-2 text-sm text-brand-strong" href={r.href}>
              <r.icon size={16} aria-hidden />
              {r.label}
            </a>
          </li>
        ))}
      </ul>
      {data.responseTime && (
        <p className="mt-3 text-xs text-gray-500">Replies {data.responseTime}.</p>
      )}
    </div>
  );
}
