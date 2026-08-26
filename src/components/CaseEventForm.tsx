import { useState } from "react";
import type { CaseEventInput, CasePriority, CaseStatus } from "../lib/types";

const TRANSITIONS: Record<CaseStatus, CaseStatus[]> = {
  OPEN: ["IN_PROGRESS", "ON_HOLD", "CLOSED"],
  IN_PROGRESS: ["OPEN", "ON_HOLD", "CLOSED"],
  ON_HOLD: ["OPEN", "IN_PROGRESS", "CLOSED"],
  CLOSED: ["OPEN"],
};

const PRIORITIES: CasePriority[] = ["LOW", "MEDIUM", "HIGH", "CRITICAL"];

export default function CaseEventForm({
  currentStatus,
  onSubmit,
  submitting,
}: {
  currentStatus: CaseStatus;
  onSubmit: (input: CaseEventInput) => Promise<void>;
  submitting: boolean;
}) {
  const [note, setNote] = useState("");
  const [assignedTo, setAssignedTo] = useState("");
  const [priority, setPriority] = useState<CasePriority>("MEDIUM");
  const [newStatus, setNewStatus] = useState<CaseStatus | "">("");
  const [error, setError] = useState<string | null>(null);

  async function submit(input: CaseEventInput) {
    setError(null);
    try {
      await onSubmit(input);
      setNote("");
      setAssignedTo("");
      setNewStatus("");
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    }
  }

  const nextStatuses = currentStatus === "CLOSED" ? ["OPEN" as const] : TRANSITIONS[currentStatus];

  return (
    <div className="space-y-4 rounded-lg border border-brand-100 bg-white p-4">
      {error && <p className="rounded bg-rag-red/10 px-3 py-2 text-sm text-rag-red">{error}</p>}

      <div>
        <label className="mb-1 block text-sm font-medium text-brand-600">Add a note</label>
        <div className="flex gap-2">
          <input
            value={note}
            onChange={(e) => setNote(e.target.value)}
            className="flex-1 rounded border border-brand-200 px-3 py-1.5 text-sm"
            placeholder="Note text"
          />
          <button
            type="button"
            disabled={submitting || !note.trim()}
            onClick={() => submit({ eventType: "ADD_NOTE", note })}
            className="rounded bg-brand-600 px-3 py-1.5 text-sm font-medium text-white disabled:opacity-40"
          >
            Add note
          </button>
        </div>
      </div>

      <div>
        <label className="mb-1 block text-sm font-medium text-brand-600">Assign</label>
        <div className="flex gap-2">
          <input
            value={assignedTo}
            onChange={(e) => setAssignedTo(e.target.value)}
            className="flex-1 rounded border border-brand-200 px-3 py-1.5 text-sm"
            placeholder="assignee@autoprotectgroup.co.uk"
          />
          <button
            type="button"
            disabled={submitting || !assignedTo.trim()}
            onClick={() => submit({ eventType: "ASSIGN", assignedTo })}
            className="rounded bg-brand-600 px-3 py-1.5 text-sm font-medium text-white disabled:opacity-40"
          >
            Assign
          </button>
        </div>
      </div>

      <div>
        <label className="mb-1 block text-sm font-medium text-brand-600">Change status</label>
        <div className="flex gap-2">
          <select
            value={newStatus}
            onChange={(e) => setNewStatus(e.target.value as CaseStatus)}
            className="rounded border border-brand-200 px-3 py-1.5 text-sm"
          >
            <option value="">Select status…</option>
            {nextStatuses.map((s) => (
              <option key={s} value={s}>
                {s.replace("_", " ")}
              </option>
            ))}
          </select>
          <select
            value={priority}
            onChange={(e) => setPriority(e.target.value as CasePriority)}
            className="rounded border border-brand-200 px-3 py-1.5 text-sm"
          >
            {PRIORITIES.map((p) => (
              <option key={p} value={p}>
                {p}
              </option>
            ))}
          </select>
          <button
            type="button"
            disabled={submitting || !newStatus}
            onClick={() =>
              submit({
                eventType: newStatus === "CLOSED" ? "CLOSE" : newStatus === "OPEN" && currentStatus === "CLOSED" ? "REOPEN" : "CHANGE_STATUS",
                status: newStatus || undefined,
                priority,
              })
            }
            className="rounded bg-brand-600 px-3 py-1.5 text-sm font-medium text-white disabled:opacity-40"
          >
            Update
          </button>
        </div>
      </div>
    </div>
  );
}
