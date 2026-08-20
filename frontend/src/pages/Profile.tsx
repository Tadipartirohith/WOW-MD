import { FormEvent, useEffect, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { api } from '../lib/api';
import IdentityPanel from '../components/IdentityPanel';

export default function Profile() {
  const { data } = useQuery({
    queryKey: ['me'],
    queryFn: async () => (await api.get('/users/me')).data,
    retry: false,
  });

  const [form, setForm] = useState({
    displayName: '',
    gender: '',
    dateOfBirth: '',
    city: '',
    bio: '',
  });
  const [saved, setSaved] = useState(false);

  useEffect(() => {
    if (data) {
      setForm({
        displayName: data.displayName ?? '',
        gender: data.gender ?? '',
        dateOfBirth: data.dateOfBirth ?? '',
        city: data.city ?? '',
        bio: data.bio ?? '',
      });
    }
  }, [data]);

  async function submit(e: FormEvent) {
    e.preventDefault();
    await api.put('/users/me/profile', form);
    setSaved(true);
    setTimeout(() => setSaved(false), 2000);
  }

  return (
    <div className="mx-auto max-w-lg space-y-4">
      <form onSubmit={submit} className="card space-y-4">
      <h1 className="text-xl font-bold text-brand-dark">Your Profile</h1>
      {saved && <p className="rounded bg-green-50 p-2 text-sm text-green-700">Saved!</p>}
      <div>
        <label className="label">Display name</label>
        <input className="input" value={form.displayName} onChange={(e) => setForm({ ...form, displayName: e.target.value })} required />
      </div>
      <div className="grid grid-cols-2 gap-3">
        <div>
          <label className="label">Gender</label>
          <select className="input" value={form.gender} onChange={(e) => setForm({ ...form, gender: e.target.value })}>
            <option value="">Select</option>
            <option value="Female">Female</option>
            <option value="Male">Male</option>
          </select>
        </div>
        <div>
          <label className="label">Date of birth</label>
          <input className="input" type="date" value={form.dateOfBirth} onChange={(e) => setForm({ ...form, dateOfBirth: e.target.value })} />
        </div>
      </div>
      <div>
        <label className="label">City</label>
        <input className="input" value={form.city} onChange={(e) => setForm({ ...form, city: e.target.value })} />
      </div>
      <div>
        <label className="label">Bio</label>
        <textarea className="input" rows={3} value={form.bio} onChange={(e) => setForm({ ...form, bio: e.target.value })} />
      </div>
      <button className="btn">Save profile</button>
      </form>

      {data?.id && <IdentityPanel profileId={data.id} />}
    </div>
  );
}
