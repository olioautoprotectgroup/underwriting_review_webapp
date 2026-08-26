import type { Dealer, ElrPosition } from "../lib/types";
import RagBadge from "./RagBadge";

function formatGbp(value: number): string {
  return new Intl.NumberFormat("en-GB", { style: "currency", currency: "GBP" }).format(value);
}

function formatPercent(value: number | null): string {
  if (value === null) return "—";
  return `${(value * 100).toFixed(1)}%`;
}

export default function DealerSummary({
  dealer,
  position,
}: {
  dealer: Dealer;
  position: ElrPosition;
}) {
  return (
    <div className="rounded-xl bg-white p-5 shadow-sm ring-1 ring-brand-100">
      <div className="flex items-start justify-between gap-4">
        <div>
          <h2 className="text-lg font-bold text-brand-800">
            {dealer.dealerName ?? dealer.dealerCode} ({dealer.dealerCode})
          </h2>
          <p className="text-sm text-brand-400">{dealer.dealerFinancialGroupName ?? "—"}</p>
        </div>
        <RagBadge status={position.ragStatus} />
      </div>
      <dl className="mt-4 grid grid-cols-2 gap-x-6 gap-y-2 text-sm sm:grid-cols-4">
        <div>
          <dt className="text-brand-400">Earned Loss Ratio</dt>
          <dd className="font-semibold text-brand-800">{formatPercent(position.earnedLossRatio)}</dd>
        </div>
        <div>
          <dt className="text-brand-400">ITD Claim Value</dt>
          <dd className="font-semibold text-brand-800">{formatGbp(position.itdClaimValue)}</dd>
        </div>
        <div>
          <dt className="text-brand-400">ITD Earned Premium</dt>
          <dd className="font-semibold text-brand-800">{formatGbp(position.itdEarnedPremium)}</dd>
        </div>
        <div>
          <dt className="text-brand-400">Contract Year</dt>
          <dd className="font-semibold text-brand-800">{position.contractYear}</dd>
        </div>
        <div>
          <dt className="text-brand-400">FSA Type</dt>
          <dd className="font-semibold text-brand-800">{dealer.fsaType ?? "—"}</dd>
        </div>
        <div>
          <dt className="text-brand-400">FSA Number</dt>
          <dd className="font-semibold text-brand-800">{dealer.fsaNumber ?? "—"}</dd>
        </div>
        <div>
          <dt className="text-brand-400">Self-Authorised</dt>
          <dd className="font-semibold text-brand-800">
            {dealer.isSelfAuthorised === null ? "—" : dealer.isSelfAuthorised ? "Yes" : "No"}
          </dd>
        </div>
        <div>
          <dt className="text-brand-400">Self-Authorisation Limit</dt>
          <dd className="font-semibold text-brand-800">
            {dealer.selfAuthorisationLimit === null ? "—" : formatGbp(dealer.selfAuthorisationLimit)}
          </dd>
        </div>
      </dl>
      <p className="mt-3 text-xs text-brand-300">
        Snapshot as of {new Date(position.snapshotGeneratedAt).toLocaleString("en-GB")}
      </p>
    </div>
  );
}
