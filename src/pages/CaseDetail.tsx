import { useEffect, useState, useCallback } from "react";
import { useParams } from "react-router-dom";
import { addCaseEvent, getCase } from "../lib/api";
import type { CaseDetail as CaseDetailData, CaseEventInput } from "../lib/types";
import CaseEventForm from "../components/CaseEventForm";

export default function CaseDetail() {
  const { caseId } = useParams<{ caseId: string }>();
  const [detail, setDetail] = useState<CaseDetailData | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  const load = useCallback(() => {
    if (!caseId) return;
    getCase(caseId)
      .then(setDetail)
      .catch((err) => setError(err instanceof Error ? err.message : String(err)));
  }, [caseId]);

  useEffect(() => {
    load();
  }, [load]);

  async function handleSubmit(input: CaseEventInput) {
    if (!caseId) return;
    setSubmitting(true);
    try {
      await addCaseEvent(caseId, input);
      load();
    } finally {
      setSubmitting(false);
    }
  }

  if (error) return <p className="p-6 text-rag-red">Failed to load case: {error}</p>;
  if (!detail) return <p className="p-6 text-brand-400">Loading…</p>;

  const { case: caseItem, events } = detail;

  return (
    <div className="mx-auto max-w-3xl space-y-6 p-6">
      <div className="rounded-xl bg-white p-5 shadow-sm ring-1 ring-brand-100">
        <h1 className="text-xl font-bold text-brand-800">{caseItem.title}</h1>
        <p className="mt-1 text-sm text-brand-400">
          {caseItem.dealerCode} · {caseItem.product} · {caseItem.contractYear} · Opened by{" "}
          {caseItem.openedBy} on {new Date(caseItem.openedAt).toLocaleDateString("en-GB")}
        </p>
        <dl className="mt-4 grid grid-cols-2 gap-3 text-sm sm:grid-cols-4">
          <div>
            <dt className="text-brand-400">Status</dt>
            <dd className="font-semibold text-brand-800">{caseItem.status.replace("_", " ")}</dd>
          </div>
          <div>
            <dt className="text-brand-400">Priority</dt>
            <dd className="font-semibold text-brand-800">{caseItem.priority}</dd>
          </div>
          <div>
            <dt className="text-brand-400">Assigned to</dt>
            <dd className="font-semibold text-brand-800">{caseItem.assignedTo ?? "Unassigned"}</dd>
          </div>
          <div>
            <dt className="text-brand-400">Due date</dt>
            <dd className="font-semibold text-brand-800">
              {caseItem.dueDate ? new Date(caseItem.dueDate).toLocaleDateString("en-GB") : "—"}
            </dd>
          </div>
        </dl>
      </div>

      <CaseEventForm currentStatus={caseItem.status} onSubmit={handleSubmit} submitting={submitting} />

      <div>
        <h2 className="mb-3 text-sm font-bold uppercase tracking-wide text-brand-400">
          History
        </h2>
        <ol className="space-y-3">
          {[...events]
            .sort((a, b) => new Date(b.eventAt).getTime() - new Date(a.eventAt).getTime())
            .map((event) => (
              <li key={event.eventId} className="rounded-lg border border-brand-100 bg-white p-3 text-sm">
                <p className="font-semibold text-brand-800">
                  {event.eventType.replace("_", " ")} by {event.actor}
                </p>
                <p className="text-brand-400">{new Date(event.eventAt).toLocaleString("en-GB")}</p>
                {event.note && <p className="mt-1 text-brand-700">{event.note}</p>}
              </li>
            ))}
        </ol>
      </div>
    </div>
  );
}
