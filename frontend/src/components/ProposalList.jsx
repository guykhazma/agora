import ProposalCard from "./ProposalCard";

export default function ProposalList({ proposals, onSelect }) {
  if (proposals.length === 0) {
    return <p className="text-gray-500 text-sm py-8 text-center">No proposals match your filters.</p>;
  }
  return (
    <div className="flex flex-col gap-3">
      {proposals.map((p) => (
        <ProposalCard key={p.id} proposal={p} compact={false} onClick={() => onSelect(p)} />
      ))}
    </div>
  );
}
