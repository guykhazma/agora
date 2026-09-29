import { describe, it, expect } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import { digestHighlights, generationLabel, highlightsMarkdown, observedChanges, initiativeHistory } from "./evidence";
import DigestHighlights from "../components/DigestHighlights";
import HealthPanel from "../components/HealthPanel";

const item = { id: "p", kind: "pr", title: "Add index", created_at: "2026-09-01T00:00:00Z", updated_at: "2026-09-20T00:00:00Z" };

describe("digest evidence", () => {
  it("renders legacy highlights without inventing citations or provenance", () => {
    const digest = { highlights: ["Old highlight"] };
    const html = renderToStaticMarkup(<DigestHighlights digest={digest} />);
    expect(html).toContain("Old highlight");
    expect(html).not.toContain("href=");
    expect(generationLabel()).toBeNull();
    expect(highlightsMarkdown(digest)).toEqual(["- Old highlight"]);
  });
  it("renders source links and exports them as Markdown", () => {
    const digest = { highlights: [{ text: "Index discussed", sources: [
      { id: "p", title: "Index discussion", url: "https://example.org/thread" },
    ] }] };
    const html = renderToStaticMarkup(<DigestHighlights digest={digest} />);
    expect(html).toContain('href="https://example.org/thread"');
    expect(html).toContain('aria-label="Source 1: Index discussion"');
    expect(html).not.toContain("[object Object]");
    expect(highlightsMarkdown(digest)).toEqual(["- Index discussed [Source 1](https://example.org/thread)"]);
  });
  it("does not render unsafe source URLs", () => {
    expect(digestHighlights({ highlights: [{ text: "Claim", sources: [{ url: "javascript:alert(1)" }] }] })[0].sources).toEqual([]);
    expect(generationLabel({ method: "local" })).toBe("Extracted from source summaries");
    expect(generationLabel({ method: "llm", model: "test-model" })).toContain("test-model");
  });
});

describe("source history", () => {
  it("does not treat a recently updated item as a meaningful change", () => {
    expect(observedChanges([item], Date.parse("2026-09-10"))).toEqual([]);
    expect(observedChanges([item], null)).toEqual([]);
  });
  it("uses observation time and distinguishes inferred vote tallies", () => {
    const changes = observedChanges([{ ...item, observed_history: [
      { field: "state", from: "open", to: "merged", observed_at: "2026-09-11" },
      { field: "vote_result", from: "open", to: "passed", observed_at: "2026-09-12" },
      { field: "llm_status", from: "discussion", to: "released", observed_at: "2026-09-13" },
    ] }], Date.parse("2026-09-10"));
    expect(changes.map(c => c.label)).toEqual([
      "Vote tally: approval threshold reached (inferred)", "PR: open → merged",
    ]);
    expect(observedChanges([item], Date.parse("2026-09-30"))).toEqual([]);
  });
  it("shows dated source openings without manufacturing state transition dates", () => {
    const events = initiativeHistory([{ ...item, state: "merged", llm_status: "released" },
      { id: "result", title: "[RESULT] Vote", created_at: "2026-09-02" },
      { id: "doc", kind: "document", created_at: "" },
    ]);
    expect(events.map(e => e.label)).toEqual(["Result thread posted", "PR opened"]);
    expect(events[1].date).toBe(item.created_at);
  });
});

it("labels the health proxy as discussion span rather than response speed", () => {
  const html = renderToStaticMarkup(<HealthPanel proposals={[item]} />);
  expect(html).toContain("Discussion span");
  expect(html).not.toContain("Typical response");
});
