import { useState, type ReactNode } from "react";

export type ViewMode = "chart" | "table";

/**
 * A dashboard section with a chart/table toggle.
 *
 * Both views render the same numbers from the same rolled-up rows — the toggle
 * only changes presentation. The table is the authoritative view (it's what the
 * Power BI report shows, and what people reconcile against), so sections that
 * carry precise figures default to it; the chart is for spotting shape.
 */
export default function SectionPanel({
  title,
  subtitle,
  defaultView = "table",
  toolbar,
  children,
}: {
  title: string;
  subtitle?: string;
  defaultView?: ViewMode;
  /** Extra controls (e.g. a measure selector) shown next to the toggle. */
  toolbar?: (view: ViewMode) => ReactNode;
  children: (view: ViewMode) => ReactNode;
}) {
  const [view, setView] = useState<ViewMode>(defaultView);

  return (
    <section className="rounded-xl bg-white p-5 shadow-sm ring-1 ring-brand-100">
      <div className="mb-4 flex flex-wrap items-start justify-between gap-3">
        <div>
          <h3 className="text-sm font-bold uppercase tracking-wide text-brand-400">{title}</h3>
          {subtitle && <p className="mt-0.5 text-xs text-brand-300">{subtitle}</p>}
        </div>
        <div className="flex items-center gap-2">
          {toolbar?.(view)}
          <div
            className="inline-flex overflow-hidden rounded-md ring-1 ring-brand-200"
            role="group"
            aria-label={`${title} view`}
          >
            {(["table", "chart"] as const).map((mode) => (
              <button
                key={mode}
                type="button"
                onClick={() => setView(mode)}
                aria-pressed={view === mode}
                className={`px-3 py-1 text-xs font-semibold capitalize transition-colors ${
                  view === mode
                    ? "bg-brand-600 text-white"
                    : "bg-white text-brand-500 hover:bg-brand-50"
                }`}
              >
                {mode}
              </button>
            ))}
          </div>
        </div>
      </div>
      {children(view)}
    </section>
  );
}
