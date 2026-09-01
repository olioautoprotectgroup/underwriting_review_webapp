import { Suspense, lazy, useEffect, useState, useCallback } from "react";
import { useNavigate, useParams } from "react-router-dom";
import { getDealerDetail, openCase, type DealerDetail as DealerDetailData } from "../lib/api";
import DealerSummary from "../components/DealerSummary";
import ElrTrendChart from "../components/ElrTrendChart";

// Lazy-loaded: this panel pulls in Recharts, which roughly triples the bundle.
// It is only ever rendered on this page, so code-splitting keeps the dashboard
// list, case pages and sign-in as light as they were before charts existed.
const DealerDashboardPanel = lazy(() => import("../components/dashboard/DealerDashboardPanel"));
import CaseCard from "../components/CaseCard";
import type { OpenCaseInput } from "../lib/types";

export default function DealerDetail() {
  const { dealerCode } = useParams<{ dealerCode: string }>();
  const navigate = useNavigate();
  const [detail, setDetail] = useState<DealerDetailData | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [openingCase, setOpeningCase] = useState(false);
  const [title, setTitle] = useState("");

  const load = useCallback(() => {
    if (!dealerCode) return;
    getDealerDetail(dealerCode)
      .then(setDetail)
      .catch((err) => setError(err instanceof Error ? err.message : String(err)));
  }, [dealerCode]);

  useEffect(() => {
    load();
  }, [load]);

  if (error) return <p className="p-6 text-rag-red">Failed to load dealer: {error}</p>;
  if (!detail) return <p className="p-6 text-brand-400">Loading…</p>;

  const currentPosition = detail.elrCurrent[0];
  const activeCase = detail.cases.find((c) => c.status !== "CLOSED");
  const canOpenCase =
    currentPosition &&
    (currentPosition.ragStatus === "Amber" || currentPosition.ragStatus === "Red") &&
    !activeCase;

  async function handleOpenCase(e: React.FormEvent) {
    e.preventDefault();
    if (!dealerCode || !currentPosition) return;
    const input: OpenCaseInput = {
      dealerCode,
      product: currentPosition.product,
      contractYear: currentPosition.contractYear,
      title,
      description: null,
      priority: currentPosition.ragStatus === "Red" ? "HIGH" : "MEDIUM",
    };
    const created = await openCase(input);
    navigate(`/cases/${encodeURIComponent(created.caseId)}`);
  }

  return (
    <div className="mx-auto max-w-6xl space-y-6 p-6">
      {currentPosition && <DealerSummary dealer={detail.dealer} position={currentPosition} />}

      <Suspense
        fallback={
          <p className="rounded-xl bg-white p-5 text-sm text-brand-400 shadow-sm ring-1 ring-brand-100">
            Loading dashboard…
          </p>
        }
      >
        <DealerDashboardPanel dashboard={detail.dashboard} />
      </Suspense>

      <section className="rounded-xl bg-white p-5 shadow-sm ring-1 ring-brand-100">
        <h2 className="mb-3 text-sm font-bold uppercase tracking-wide text-brand-400">
          ELR trend
        </h2>
        <ElrTrendChart history={detail.elrHistory} />
      </section>

      <section className="rounded-xl bg-white p-5 shadow-sm ring-1 ring-brand-100">
        <h2 className="mb-3 text-sm font-bold uppercase tracking-wide text-brand-400">
          Claim mix
        </h2>
        {detail.claimMix.length === 0 ? (
          <p className="text-sm text-brand-400">No claim data.</p>
        ) : (
          <table className="min-w-full divide-y divide-brand-100 text-sm">
            <thead className="text-left text-xs font-semibold uppercase tracking-wide text-brand-400">
              <tr>
                <th className="py-1.5">Loss type</th>
                <th className="py-1.5">Claim count</th>
                <th className="py-1.5">Paid (GBP)</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-brand-50">
              {detail.claimMix.map((entry) => (
                <tr key={entry.lossType}>
                  <td className="py-1.5">{entry.lossType}</td>
                  <td className="py-1.5">{entry.claimCount}</td>
                  <td className="py-1.5">
                    {new Intl.NumberFormat("en-GB", { style: "currency", currency: "GBP" }).format(
                      entry.paidGbp,
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </section>

      <section>
        <h2 className="mb-3 text-lg font-bold text-brand-800">Cases</h2>
        {detail.cases.length === 0 ? (
          <p className="text-sm text-brand-400">No cases for this dealer.</p>
        ) : (
          <div className="space-y-3">
            {detail.cases.map((c) => (
              <CaseCard key={c.caseId} caseItem={c} />
            ))}
          </div>
        )}

        {canOpenCase && (
          <form onSubmit={handleOpenCase} className="mt-4 flex gap-2 rounded-lg border border-brand-100 bg-white p-4">
            <input
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              required
              placeholder="Case title"
              className="flex-1 rounded border border-brand-200 px-3 py-1.5 text-sm"
            />
            <button
              type="submit"
              disabled={openingCase}
              onClick={() => setOpeningCase(true)}
              className="rounded bg-highlight px-4 py-1.5 text-sm font-bold text-white disabled:opacity-40"
            >
              Open case
            </button>
          </form>
        )}
      </section>
    </div>
  );
}
