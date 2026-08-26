import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { getDashboard, listCases } from "../lib/api";
import type { CaseWithCurrentState, DashboardData } from "../lib/types";
import RagBadge from "../components/RagBadge";

const RAG_ORDER: Record<string, number> = { Red: 0, Amber: 1, Green: 2, "No status": 3 };

function formatPercent(value: number | null): string {
  if (value === null) return "—";
  return `${(value * 100).toFixed(1)}%`;
}

export default function Dashboard() {
  const [dashboard, setDashboard] = useState<DashboardData | null>(null);
  const [cases, setCases] = useState<CaseWithCurrentState[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    Promise.all([getDashboard(), listCases()])
      .then(([d, c]) => {
        setDashboard(d);
        setCases(c);
      })
      .catch((err) => setError(err instanceof Error ? err.message : String(err)));
  }, []);

  if (error) {
    return <p className="p-6 text-rag-red">Failed to load dashboard: {error}</p>;
  }
  if (!dashboard || !cases) {
    return <p className="p-6 text-brand-400">Loading…</p>;
  }

  const rows = [...dashboard.elrCurrent].sort(
    (a, b) => RAG_ORDER[a.ragStatus] - RAG_ORDER[b.ragStatus],
  );
  const activeCases = cases.filter((c) => c.status !== "CLOSED");

  return (
    <div className="mx-auto max-w-6xl space-y-8 p-6">
      <section>
        <h2 className="mb-3 text-lg font-bold text-brand-800">
          Active cases ({activeCases.length})
        </h2>
        {activeCases.length === 0 ? (
          <p className="text-sm text-brand-400">No active cases.</p>
        ) : (
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
            {activeCases.map((c) => (
              <Link
                key={c.caseId}
                to={`/cases/${encodeURIComponent(c.caseId)}`}
                className="block rounded-lg border border-brand-100 bg-white p-3 text-sm hover:border-brand-300"
              >
                <p className="font-semibold text-brand-800">{c.title}</p>
                <p className="text-brand-400">
                  {c.dealerCode} · {c.status.replace("_", " ")} · {c.priority}
                </p>
              </Link>
            ))}
          </div>
        )}
      </section>

      <section>
        <h2 className="mb-3 text-lg font-bold text-brand-800">Dealer RAG / ELR position</h2>
        <div className="overflow-x-auto rounded-xl bg-white shadow-sm ring-1 ring-brand-100">
          <table className="min-w-full divide-y divide-brand-100 text-sm">
            <thead className="bg-brand-50 text-left text-xs font-semibold uppercase tracking-wide text-brand-400">
              <tr>
                <th className="px-4 py-2">Dealer</th>
                <th className="px-4 py-2">Contract Year</th>
                <th className="px-4 py-2">ELR</th>
                <th className="px-4 py-2">RAG</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-brand-50">
              {rows.map((row) => (
                <tr key={`${row.dealerCode}-${row.contractYear}`} className="hover:bg-brand-50/50">
                  <td className="px-4 py-2">
                    <Link
                      to={`/dealers/${encodeURIComponent(row.dealerCode)}`}
                      className="font-medium text-brand-600 hover:underline"
                    >
                      {row.dealerName ?? row.dealerCode} ({row.dealerCode})
                    </Link>
                  </td>
                  <td className="px-4 py-2">{row.contractYear}</td>
                  <td className="px-4 py-2">{formatPercent(row.earnedLossRatio)}</td>
                  <td className="px-4 py-2">
                    <RagBadge status={row.ragStatus} />
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>
    </div>
  );
}
