import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { api } from '../lib/api';

const CATEGORIES = ['', 'venue', 'catering', 'photography', 'decor', 'makeup', 'entertainment'];

interface Vendor {
  id: string;
  name: string;
  category: string;
  city?: string;
  description?: string;
  ratingAvg: number;
  ratingCount: number;
}

export default function Vendors() {
  const [category, setCategory] = useState('');
  const { data, isLoading } = useQuery({
    queryKey: ['vendors', category],
    queryFn: async () =>
      (await api.get('/vendors/search', { params: category ? { category } : {} })).data,
  });

  const vendors: Vendor[] = data?.data ?? [];

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <h1 className="text-xl font-bold text-brand-dark">Vendor Marketplace</h1>
        <select className="input max-w-xs" value={category} onChange={(e) => setCategory(e.target.value)}>
          {CATEGORIES.map((c) => (
            <option key={c} value={c}>{c ? c : 'All categories'}</option>
          ))}
        </select>
      </div>
      {isLoading && <p className="text-gray-500">Loading...</p>}
      {!isLoading && vendors.length === 0 && <p className="text-gray-500">No vendors found.</p>}
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
        {vendors.map((v) => (
          <div key={v.id} className="card">
            <div className="flex items-center justify-between">
              <h2 className="font-semibold">{v.name}</h2>
              <span className="text-sm text-amber-600">Rating {v.ratingAvg} ({v.ratingCount})</span>
            </div>
            <p className="text-xs uppercase tracking-wide text-gray-400">{v.category}</p>
            <p className="text-sm text-gray-500">{v.city}</p>
            {v.description && <p className="mt-2 text-sm text-gray-600">{v.description}</p>}
          </div>
        ))}
      </div>
    </div>
  );
}
