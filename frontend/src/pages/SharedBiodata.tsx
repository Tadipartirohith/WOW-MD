import { useParams } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { api, apiMessage } from '../lib/api';
import BiodataCard, { Biodata } from '../components/BiodataCard';

/**
 * A biodata opened from a shared link.
 *
 * Public because the recipient is a family with no account — that is the whole
 * point of the link. The token is single-purpose, expiring and revocable, and
 * the agent can see whether it was ever opened.
 */
export default function SharedBiodata() {
  const { token = '' } = useParams();

  const { data, isLoading, isError, error } = useQuery({
    queryKey: ['biodata', token],
    queryFn: async () => (await api.get(`/circulation/biodata/${token}`)).data as Biodata,
    retry: false,
    enabled: Boolean(token),
  });

  if (isLoading) {
    return (
      <div className="flex min-h-screen items-center justify-center px-4">
        <p className="text-gray-500">Loading...</p>
      </div>
    );
  }

  if (isError || !data) {
    return (
      <div className="flex min-h-screen items-center justify-center px-4">
        <div className="card w-full max-w-md text-center">
          <h1 className="page-title">This biodata is not available</h1>
          <p className="mt-2 text-sm text-gray-600">
            {apiMessage(error, 'The link may have expired, or been withdrawn by the agent.')}
          </p>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-gray-50 px-4 py-8 print:bg-white print:p-0">
      <div className="mx-auto max-w-2xl space-y-4">
        <div className="flex items-center justify-between print:hidden">
          <p className="text-sm text-gray-500">Shared with you through WOW</p>
          <button className="btn-outline" onClick={() => window.print()}>
            Print
          </button>
        </div>
        <BiodataCard profile={data} print />
      </div>
    </div>
  );
}
