import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { supabase, withTimeout } from '../lib/supabase';
import { useAuth } from '../contexts/AuthContext.jsx';
import LoadingSpinner from '../components/LoadingSpinner.jsx';

// Dashboard — at-a-glance counts + quick links. Phase 2+ will add
// surfaces for upcoming birthdays, recent interactions, follow-ups, etc.

export default function Dashboard() {
  const { user, profile } = useAuth();
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [stats, setStats] = useState({
    total: 0,
    members: 0,
    activeVisitors: 0,
    extendedFamily: 0,
    christmasCard: 0,
    deceased: 0,
  });

  useEffect(() => {
    if (!user?.id) return;
    let cancelled = false;
    (async () => {
      setLoading(true);
      setError(null);
      try {
        const queries = await Promise.all([
          withTimeout(
            supabase
              .from('pastoral_people')
              .select('id', { count: 'exact', head: true })
          ),
          withTimeout(
            supabase
              .from('pastoral_people')
              .select('id', { count: 'exact', head: true })
              .eq('is_church_member', true)
          ),
          withTimeout(
            supabase
              .from('pastoral_people')
              .select('id', { count: 'exact', head: true })
              .eq('is_active_visitor', true)
          ),
          withTimeout(
            supabase
              .from('pastoral_people')
              .select('id', { count: 'exact', head: true })
              .eq('is_extended_family', true)
          ),
          withTimeout(
            supabase
              .from('pastoral_people')
              .select('id', { count: 'exact', head: true })
              .eq('on_christmas_card_list', true)
          ),
          withTimeout(
            supabase
              .from('pastoral_people')
              .select('id', { count: 'exact', head: true })
              .eq('is_deceased', true)
          ),
        ]);
        if (cancelled) return;
        setStats({
          total: queries[0].count ?? 0,
          members: queries[1].count ?? 0,
          activeVisitors: queries[2].count ?? 0,
          extendedFamily: queries[3].count ?? 0,
          christmasCard: queries[4].count ?? 0,
          deceased: queries[5].count ?? 0,
        });
      } catch (e) {
        if (!cancelled) setError(e.message || String(e));
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [user?.id]);

  if (loading) return <LoadingSpinner label="Loading dashboard…" />;

  return (
    <div className="space-y-6 max-w-4xl">
      <div>
        <h1 className="font-serif text-2xl text-umc-900">
          Welcome, {profile?.full_name || 'Pastor'}
        </h1>
        <p className="text-sm text-gray-600 mt-1">
          Your private pastoral directory. Records live in Supabase under
          your account only — locked by row-level security to your user ID.
        </p>
      </div>

      {error && (
        <p className="text-sm text-red-700 bg-red-50 border border-red-200 rounded px-3 py-2">
          {error}
        </p>
      )}

      <div className="grid grid-cols-2 md:grid-cols-3 gap-3">
        <StatCard label="Total people" value={stats.total} />
        <StatCard label="Church members" value={stats.members} />
        <StatCard label="Active visitors" value={stats.activeVisitors} />
        <StatCard label="Extended family" value={stats.extendedFamily} />
        <StatCard label="Christmas card list" value={stats.christmasCard} />
        <StatCard label="Deceased" value={stats.deceased} />
      </div>

      <div className="card space-y-2">
        <h2 className="font-serif text-lg text-umc-900">Quick actions</h2>
        <div className="flex flex-wrap gap-2">
          <Link to="/people" className="btn-secondary">
            Browse people
          </Link>
          <Link to="/people/new" className="btn-primary">
            + Add person
          </Link>
          <Link to="/import" className="btn-secondary">
            Import directory
          </Link>
        </div>
      </div>

      <div className="card text-sm text-gray-600 space-y-2">
        <h2 className="font-serif text-lg text-umc-900">What's coming</h2>
        <p>
          This is Phase 1 of the Pastoral Records app — just the core
          directory. Future phases will add:
        </p>
        <ul className="list-disc pl-6 space-y-1 text-gray-700">
          <li>Photos + family relationship links</li>
          <li>
            Pastoral interaction logs (office visits, hospital visits,
            conversations) with audio import + Claude summarization
          </li>
          <li>"Core pastoral issues" with one-click promote</li>
          <li>Linked prayer requests from the bulletin app</li>
          <li>Document/screenshot archive</li>
          <li>Eulogy preparation tool with Claude synthesis</li>
        </ul>
      </div>
    </div>
  );
}

function StatCard({ label, value }) {
  return (
    <div className="bg-white rounded-lg border border-gray-200 px-4 py-3">
      <div className="text-2xl font-serif text-umc-900">{value}</div>
      <div className="text-xs text-gray-500 mt-0.5">{label}</div>
    </div>
  );
}
