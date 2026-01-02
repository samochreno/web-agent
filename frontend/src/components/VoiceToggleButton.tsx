import { useMemo } from "react";

type Props = {
  active: boolean;
  status: "idle" | "preparing" | "listening" | "thinking" | "stopping";
  disabled?: boolean;
  onToggle: () => void;
};

export function VoiceToggleButton({ active, status, disabled, onToggle }: Props) {
  const pulse = useMemo(() => status === "listening" || status === "thinking", [status]);

  return (
    <button
      type="button"
      onClick={onToggle}
      disabled={disabled}
      aria-pressed={active}
      className={`flex h-12 w-12 items-center justify-center rounded-full transition-transform duration-150 shadow-md focus:outline-none focus-visible:ring-2 focus-visible:ring-slate-300
        ${active ? "bg-black text-white" : "bg-slate-900 text-white"}
        ${disabled ? "opacity-60" : "hover:scale-105"}
      `}
    >
      <span className="sr-only">Toggle voice mode</span>
      <svg
        xmlns="http://www.w3.org/2000/svg"
        viewBox="0 0 24 24"
        fill="none"
        stroke="currentColor"
        strokeWidth="2.5"
        strokeLinecap="round"
        strokeLinejoin="round"
        className={`h-5 w-5 transition-transform duration-150 ${pulse ? "scale-110" : ""}`}
      >
        <path d="M12 5v14" />
        <path d="m19 12-7-7-7 7" />
      </svg>
    </button>
  );
}
