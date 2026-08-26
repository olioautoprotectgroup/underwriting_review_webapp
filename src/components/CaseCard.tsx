import { Link } from "react-router-dom";
import type { CaseWithCurrentState } from "../lib/types";

const STATUS_STYLES: Record<string, string> = {
  OPEN: "bg-periwinkle/10 text-periwinkle",
  IN_PROGRESS: "bg-brand-500/10 text-brand-500",
  ON_HOLD: "bg-rag-amber/10 text-rag-amber",
  CLOSED: "bg-rag-none/10 text-rag-none",
};

export default function CaseCard({ caseItem }: { caseItem: CaseWithCurrentState }) {
  return (
    <Link
      to={`/cases/${encodeURIComponent(caseItem.caseId)}`}
      className="block rounded-lg border border-brand-100 bg-white p-4 transition hover:border-brand-300 hover:shadow-sm"
    >
      <div className="flex items-start justify-between gap-3">
        <div>
          <h3 className="font-semibold text-brand-800">{caseItem.title}</h3>
          <p className="text-sm text-brand-400">
            {caseItem.dealerCode} · {caseItem.product} · {caseItem.contractYear}
          </p>
        </div>
        <span
          className={`shrink-0 rounded-full px-2.5 py-0.5 text-xs font-bold ${STATUS_STYLES[caseItem.status] ?? ""}`}
        >
          {caseItem.status.replace("_", " ")}
        </span>
      </div>
      <dl className="mt-3 flex flex-wrap gap-x-6 gap-y-1 text-xs text-brand-400">
        <div>
          <dt className="inline font-medium">Priority: </dt>
          <dd className="inline">{caseItem.priority}</dd>
        </div>
        <div>
          <dt className="inline font-medium">Assigned to: </dt>
          <dd className="inline">{caseItem.assignedTo ?? "Unassigned"}</dd>
        </div>
        <div>
          <dt className="inline font-medium">Last updated: </dt>
          <dd className="inline">
            {new Date(caseItem.lastUpdatedAt).toLocaleDateString("en-GB")} by {caseItem.lastUpdatedBy}
          </dd>
        </div>
      </dl>
    </Link>
  );
}
