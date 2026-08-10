import { Link } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { api } from '../lib/api';

const TILES = [
  { to: '/profile', title: 'Your Profile', desc: 'Complete your details to get better matches' },
  { to: '/matches', title: 'Find Matches', desc: 'Discover compatible partners' },
  { to: '/chat', title: 'Messages', desc: 'Chat with your accepted matches' },
  { to: '/vendors', title: 'Vendors', desc: 'Browse venues, catering, photography & more' },
  { to: '/planner', title: 'Wedding Planner', desc: 'Auto-generated timeline & tasks' },
  { to: '/bookings', title: 'Bookings', desc: 'Manage vendor bookings & escrow' },
  { to: '/genie', title: 'WOW Genie', desc: 'AI budget insights & planning help' },
];

export default function Dashboard() {
  const { data: profile } = useQuery({
    queryKey: ['me'],
    queryFn: async () => (await api.get('/users/me')).data,
    retry: false,
  });

  return (
    <div className="space-y-6">
      <div className="rounded-lg bg-brand p-6 text-white">
        <h1 className="text-2xl font-bold">Welcome to WOW</h1>
        <p className="opacity-90">
          {profile?.profileCompleted
            ? 'Your profile is complete, explore matches and start planning.'
            : 'Finish your profile to unlock personalised matches.'}
        </p>
      </div>
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
        {TILES.map((t) => (
          <Link key={t.to} to={t.to} className="card transition hover:shadow-md">
            <h2 className="font-semibold text-brand-dark">{t.title}</h2>
            <p className="mt-1 text-sm text-gray-600">{t.desc}</p>
          </Link>
        ))}
      </div>
    </div>
  );
}
