import { useEffect, useState } from 'react';

// Reusable card section with a click-to-expand header. Persists open
// state per `storageKey` in localStorage so a refresh keeps the page
// laid out the way the pastor left it.
//
// Props:
//   title          - visible header text
//   defaultOpen    - initial state (overridden by saved preference)
//   storageKey     - if set, persist open/closed state under this key
//   badge          - optional small text/element shown right of the title
//   children       - body content
export default function CollapsibleSection({
  title,
  defaultOpen = false,
  storageKey,
  badge,
  children,
}) {
  const [open, setOpen] = useState(() => {
    if (storageKey) {
      try {
        const stored = localStorage.getItem(storageKey);
        if (stored === '1') return true;
        if (stored === '0') return false;
      } catch {
        /* noop */
      }
    }
    return defaultOpen;
  });

  useEffect(() => {
    if (!storageKey) return;
    try {
      localStorage.setItem(storageKey, open ? '1' : '0');
    } catch {
      /* noop */
    }
  }, [open, storageKey]);

  return (
    <section className="bg-white rounded-lg shadow-sm border border-gray-200">
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        className="w-full flex items-center justify-between gap-2 px-5 py-3 text-left hover:bg-gray-50 rounded-t-lg"
        aria-expanded={open}
      >
        <span className="flex items-baseline gap-2">
          <span className="text-gray-400 text-xs w-4 inline-block">
            {open ? '▾' : '▸'}
          </span>
          <span className="font-serif text-lg text-umc-900">{title}</span>
          {badge && (
            <span className="ml-1 text-xs text-gray-500">{badge}</span>
          )}
        </span>
      </button>
      {open && <div className="px-5 pb-5 pt-1 space-y-3">{children}</div>}
    </section>
  );
}
