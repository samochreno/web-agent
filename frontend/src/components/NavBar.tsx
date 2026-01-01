import type { SessionState } from "../types";

type Props = {
  currentPath: string;
  onNavigate: (path: string) => void;
  session: SessionState;
};

const links: { label: string; path: string }[] = [
  { label: "Chat", path: "/" },
  { label: "Settings", path: "/settings" },
];

export function NavBar({ currentPath, onNavigate, session }: Props) {
  return (
    <header className="w-full border-b border-slate-200 bg-white">
      <div className="mx-auto flex max-w-6xl items-center justify-between px-4 py-3">
        <div className="flex items-center gap-3">
          <nav className="flex items-center gap-2">
            {links.map((link) => {
              const active = currentPath === link.path;
              return (
                <button
                  key={link.path}
                  onClick={() => onNavigate(link.path)}
                  className={`rounded-lg px-3 py-1.5 text-sm font-medium ${
                    active
                      ? "bg-slate-900 text-white"
                      : "text-slate-700 hover:bg-slate-100"
                  }`}
                >
                  {link.label}
                </button>
              );
            })}
          </nav>
        </div>
        <div className="flex items-center gap-3 text-sm text-slate-600">
          {session.user ? (
            <>
              <span className="rounded-full bg-slate-100 px-2.5 py-1 text-xs font-semibold text-slate-800">
                Logged in
              </span>
              {/* <span className="font-medium text-slate-800">
                {session.user.email}
              </span> */}
            </>
          ) : (
            <span className="text-slate-500">Not logged in</span>
          )}
        </div>
      </div>
    </header>
  );
}
