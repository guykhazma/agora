import { useEffect } from "react";

/**
 * j/k to move through proposals, Enter to open, Escape to close.
 */
export function useProposalKeyboard({ proposals, selected, onSelect, onClose }) {
  useEffect(() => {
    const handler = (e) => {
      // Don't fire when typing in an input
      if (e.target.tagName === "INPUT") return;

      if (e.key === "Escape") {
        if (selected) onClose();
        return;
      }

      if (e.key === "Enter" && !selected && proposals.length > 0) {
        onSelect(proposals[0]);
        return;
      }

      if (!selected) {
        if (e.key === "j") { onSelect(proposals[0]); }
        return;
      }

      const idx = proposals.findIndex((p) => p.id === selected.id);
      if (idx === -1) return;

      if (e.key === "j") {
        e.preventDefault();
        const next = proposals[idx + 1];
        if (next) onSelect(next);
      } else if (e.key === "k") {
        e.preventDefault();
        const prev = proposals[idx - 1];
        if (prev) onSelect(prev);
      }
    };

    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, [proposals, selected, onSelect, onClose]);
}
