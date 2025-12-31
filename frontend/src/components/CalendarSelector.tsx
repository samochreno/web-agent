import { useEffect, useMemo, useState } from "react";
import type { CalendarOption } from "../lib/api";

type Props = {
  calendars: CalendarOption[];
  onChange: (selected: string[]) => Promise<void>;
};

export function CalendarSelector({ calendars, onChange }: Props) {
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    setSelected(new Set(calendars.filter((c) => c.selected).map((c) => c.id)));
  }, [calendars]);

  const summary = useMemo(() => {
    const total = calendars.length;
    const chosen = selected.size;
    return `${chosen} of ${total} calendars shared with the agent`;
  }, [calendars.length, selected]);

  const toggle = async (calendarId: string) => {
    const next = new Set(selected);
    if (next.has(calendarId)) {
      next.delete(calendarId);
    } else {
      next.add(calendarId);
    }

    setSelected(next);
    setError(null);
    setSaving(true);
    try {
      await onChange([...next]);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Unable to update calendar selection");
      setSelected(new Set(calendars.filter((c) => c.selected).map((c) => c.id)));
    } finally {
      setSaving(false);
    }
  };

  if (!calendars.length) {
    return <p className="text-sm text-slate-500">No calendars are available yet. Connect Google to load options.</p>;
  }

  return (
    <div className="rounded-xl border border-slate-200 bg-white p-4 shadow-sm">
      <div className="flex items-center justify-between gap-2 pb-3">
        <div>
          <p className="text-sm font-semibold text-slate-800">Shared calendars</p>
          <p className="text-xs text-slate-500">{summary}</p>
        </div>
        {saving ? <span className="text-xs text-slate-500">Saving…</span> : null}
      </div>
      <ul className="space-y-3">
        {calendars.map((calendar) => (
          <li key={calendar.id} className="flex items-start gap-3 rounded-lg border border-slate-100 p-3">
            <label className="flex flex-1 cursor-pointer items-start gap-2">
              <input
                type="checkbox"
                className="mt-1 h-4 w-4 rounded border-slate-400 text-slate-900 focus:ring-slate-900"
                checked={selected.has(calendar.id)}
                onChange={() => void toggle(calendar.id)}
              />
              <div className="flex flex-col">
                <span className="text-sm font-semibold text-slate-900">
                  {calendar.name || "Calendar"} {calendar.primary ? "(Primary)" : ""}
                </span>
                <span className="text-xs text-slate-500">
                  Access: {calendar.access_role ?? "unknown"} {calendar.readonly ? "• Read-only" : ""}
                </span>
              </div>
            </label>
            {calendar.readonly ? (
              <span className="rounded-full bg-slate-100 px-2 py-0.5 text-[11px] font-medium text-slate-700">
                View only
              </span>
            ) : null}
          </li>
        ))}
      </ul>
      {error ? <p className="pt-2 text-sm text-amber-700">{error}</p> : null}
      <p className="pt-3 text-xs text-slate-500">
        Calendar IDs stay masked with aliases so the model never sees raw Google identifiers. Read-only calendars are
        merged into event listings but cannot be edited.
      </p>
    </div>
  );
}
