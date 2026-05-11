import { useState } from 'react';
import { useNavigate, Link } from 'react-router-dom';
import { useAuth } from '../contexts/AuthContext.jsx';
import { createPerson } from '../lib/people';

// Quick-create form: just enough to get a row stamped, then we
// redirect to the full detail editor so the pastor can fill in
// everything else without re-typing.

const STATUS_OPTIONS = [
  { value: 'is_church_member', label: 'Church member' },
  { value: 'is_active_visitor', label: 'Active visitor' },
  { value: 'is_extended_family', label: 'Extended family' },
  { value: 'is_non_active_visitor', label: 'Non-active visitor' },
];

export default function PersonNew() {
  const { user } = useAuth();
  const navigate = useNavigate();
  const [error, setError] = useState(null);
  const [busy, setBusy] = useState(false);
  const [form, setForm] = useState({
    first_name: '',
    middle_name: '',
    last_name: '',
    preferred_name: '',
    email: '',
    cell_phone: '',
    status: '', // one of the radio values; empty = unset
  });

  const update = (k, v) => setForm((f) => ({ ...f, [k]: v }));

  const handleSubmit = async (e) => {
    e.preventDefault();
    if (!user?.id) return;
    if (!form.first_name.trim()) {
      setError('First name is required.');
      return;
    }
    setBusy(true);
    setError(null);
    try {
      const patch = {
        first_name: form.first_name,
        middle_name: form.middle_name,
        last_name: form.last_name,
        preferred_name: form.preferred_name,
        email: form.email,
        cell_phone: form.cell_phone,
      };
      // Apply the chosen status checkbox if any.
      if (form.status) patch[form.status] = true;
      const created = await createPerson({
        ownerUserId: user.id,
        patch,
      });
      navigate(`/people/${created.id}`, { replace: true });
    } catch (err) {
      setError(err.message || String(err));
      setBusy(false);
    }
  };

  return (
    <div className="space-y-4 max-w-xl">
      <div>
        <Link
          to="/people"
          className="text-sm text-gray-500 hover:text-gray-700"
        >
          ← People
        </Link>
        <h1 className="font-serif text-2xl text-umc-900 mt-1">
          Add person
        </h1>
        <p className="text-sm text-gray-600 mt-1">
          Fill in the basics. You'll get the full editor next, where every
          other field (address, baptism, anniversary, social media, etc.)
          can be filled in.
        </p>
      </div>

      {error && (
        <p className="text-sm text-red-700 bg-red-50 border border-red-200 rounded px-3 py-2">
          {error}
        </p>
      )}

      <form onSubmit={handleSubmit} className="card space-y-3">
        <div className="grid grid-cols-2 gap-3">
          <div>
            <label className="label">First name *</label>
            <input
              type="text"
              className="input"
              value={form.first_name}
              onChange={(e) => update('first_name', e.target.value)}
              required
            />
          </div>
          <div>
            <label className="label">Last name</label>
            <input
              type="text"
              className="input"
              value={form.last_name}
              onChange={(e) => update('last_name', e.target.value)}
            />
          </div>
          <div>
            <label className="label">Middle name</label>
            <input
              type="text"
              className="input"
              value={form.middle_name}
              onChange={(e) => update('middle_name', e.target.value)}
            />
          </div>
          <div>
            <label className="label">Preferred name</label>
            <input
              type="text"
              className="input"
              value={form.preferred_name}
              onChange={(e) => update('preferred_name', e.target.value)}
              placeholder="e.g. nickname"
            />
          </div>
        </div>

        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
          <div>
            <label className="label">Email</label>
            <input
              type="email"
              className="input"
              value={form.email}
              onChange={(e) => update('email', e.target.value)}
            />
          </div>
          <div>
            <label className="label">Cell phone</label>
            <input
              type="tel"
              className="input"
              value={form.cell_phone}
              onChange={(e) => update('cell_phone', e.target.value)}
            />
          </div>
        </div>

        <fieldset>
          <legend className="label">Status (pick one — adjust later)</legend>
          <div className="flex flex-wrap gap-3">
            {STATUS_OPTIONS.map((o) => (
              <label
                key={o.value}
                className="inline-flex items-center gap-1.5 text-sm cursor-pointer"
              >
                <input
                  type="radio"
                  name="status"
                  value={o.value}
                  checked={form.status === o.value}
                  onChange={(e) => update('status', e.target.value)}
                />
                <span>{o.label}</span>
              </label>
            ))}
            <label className="inline-flex items-center gap-1.5 text-sm cursor-pointer">
              <input
                type="radio"
                name="status"
                value=""
                checked={form.status === ''}
                onChange={() => update('status', '')}
              />
              <span className="text-gray-500">Skip / unsure</span>
            </label>
          </div>
        </fieldset>

        <div className="flex items-center justify-end gap-2 pt-2">
          <Link to="/people" className="btn-secondary text-sm">
            Cancel
          </Link>
          <button
            type="submit"
            disabled={busy}
            className="btn-primary text-sm disabled:opacity-50"
          >
            {busy ? 'Creating…' : 'Create + open editor'}
          </button>
        </div>
      </form>
    </div>
  );
}
