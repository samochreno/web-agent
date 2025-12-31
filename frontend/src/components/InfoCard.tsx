import type { ReactNode } from "react";

type Props = {
  title: string;
  children: ReactNode;
  footer?: ReactNode;
  tone?: "default" | "warning";
};

export function InfoCard({ title, children, footer, tone = "default" }: Props) {
  const border =
    tone === "warning" ? "border-amber-300 bg-amber-50 text-amber-900" : "border-slate-200 bg-white";

  return (
    <div className={`rounded-xl border shadow-sm p-4 ${border}`}>
      <div className="flex items-center justify-between gap-2 pb-2">
        <h3 className="text-base font-semibold text-slate-900">{title}</h3>
        {tone === "warning" ? (
          <span className="rounded-full bg-amber-100 px-2 py-0.5 text-xs font-medium text-amber-800">
            Heads up
          </span>
        ) : null}
      </div>
      <div className="text-sm leading-relaxed text-slate-700">{children}</div>
      {footer ? <div className="pt-3 text-xs text-slate-500">{footer}</div> : null}
    </div>
  );
}
