import type { RagStatus } from "../lib/types";

const STYLES: Record<RagStatus, string> = {
  Green: "bg-rag-green/10 text-rag-green ring-1 ring-inset ring-rag-green/30",
  Amber: "bg-rag-amber/10 text-rag-amber ring-1 ring-inset ring-rag-amber/30",
  Red: "bg-rag-red/10 text-rag-red ring-1 ring-inset ring-rag-red/30",
  "No status": "bg-rag-none/10 text-rag-none ring-1 ring-inset ring-rag-none/30",
};

export default function RagBadge({ status }: { status: RagStatus }) {
  return (
    <span
      className={`inline-flex items-center rounded-full px-2.5 py-0.5 text-xs font-bold ${STYLES[status]}`}
    >
      {status}
    </span>
  );
}
