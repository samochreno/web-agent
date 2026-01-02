import { useState, type FormEvent } from "react";

type Props = {
  onLogin: (email: string, name?: string) => Promise<void>;
};

export function LoginForm({ onLogin }: Props) {
  const [email, setEmail] = useState("");
  const [name, setName] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  const handleSubmit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setError(null);
    setSubmitting(true);
    void onLogin(email, name)
      .then(() => {
        setEmail("");
        setName("");
      })
      .catch((err) => {
        setError(err instanceof Error ? err.message : "Unable to log in");
      })
      .finally(() => setSubmitting(false));
  };

  return (
    <form
      onSubmit={(event) => handleSubmit(event)}
      className="space-y-3 rounded-xl border border-slate-200 bg-white p-4 shadow-sm"
    >
      <div>
        <label className="block text-sm font-medium text-slate-700">Email</label>
        <input
          className="mt-1 w-full rounded-lg border border-slate-300 px-3 py-2 text-sm shadow-inner focus:border-slate-900 focus:outline-none"
          type="email"
          required
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          placeholder="you@example.com"
        />
      </div>
      <div>
        <label className="block text-sm font-medium text-slate-700">Name (optional)</label>
        <input
        className="mt-1 w-full rounded-lg border border-slate-300 px-3 py-2 text-sm shadow-inner focus:border-slate-900 focus:outline-none"
        type="text"
        value={name}
        onChange={(e) => setName(e.target.value)}
        placeholder="Display name for the assistant"
      />
      </div>
      {error ? <p className="text-sm text-amber-700">{error}</p> : null}
      <div className="flex items-center justify-end">
        <button
          type="submit"
          disabled={submitting}
          className="rounded-lg bg-slate-900 px-4 py-2 text-sm font-semibold text-white hover:bg-slate-800 disabled:opacity-60"
        >
          {submitting ? "Signing in..." : "Sign in"}
        </button>
      </div>
    </form>
  );
}
