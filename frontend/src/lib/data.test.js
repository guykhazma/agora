import { describe, it, expect } from "vitest";
import { getItemType, trendScore, matchesGlobalSearch, getStatus } from "./data";

describe("getItemType", () => {
  it("classifies active votes", () => {
    expect(getItemType({ title: "[VOTE] Adopt spec v2" })).toBe("vote");
  });
  it("treats a concluded [RESULT] vote as an announcement", () => {
    expect(getItemType({ title: "[RESULT] [VOTE] Adopt spec v2" })).toBe("announcement");
  });
  it("classifies proposals/RFCs", () => {
    expect(getItemType({ title: "[PROPOSAL] New table format" })).toBe("proposal");
    expect(getItemType({ title: "[SPIP] Improve Spark" })).toBe("proposal");
  });
  it("maps sources and kinds", () => {
    expect(getItemType({ title: "Talk", source: "youtube" })).toBe("video");
    expect(getItemType({ title: "Notes", source: "google_doc" })).toBe("doc");
    expect(getItemType({ title: "Fix bug", kind: "pr" })).toBe("pr");
    expect(getItemType({ title: "v1.2.0", kind: "release" })).toBe("release");
  });
  it("treats untagged mailing-list threads as discussions", () => {
    expect(getItemType({ title: "Random question", source: "mailing_list" })).toBe("discussion");
  });
  it("falls back to other", () => {
    expect(getItemType({ title: "Something", source: "unknown" })).toBe("other");
  });
});

describe("trendScore", () => {
  const now = new Date().toISOString();
  const old = new Date(Date.now() - 200 * 86400000).toISOString();

  it("rewards comments and recency", () => {
    expect(trendScore({ comment_count: 5, updated_at: now })).toBe(5 * 2 + 10);
  });
  it("ranks a fresh, discussed item above a stale, quiet one", () => {
    const fresh = trendScore({ comment_count: 3, updated_at: now });
    const stale = trendScore({ comment_count: 0, updated_at: old });
    expect(fresh).toBeGreaterThan(stale);
  });
  it("handles missing fields defensively", () => {
    expect(trendScore({})).toBe(0);
  });
});

describe("matchesGlobalSearch", () => {
  const p = {
    title: "Iceberg REST catalog",
    llm_summary: "A catalog spec",
    author: "Alice",
    llm_topics: ["catalog", "rest"],
    labels: ["kind/proposal"],
  };
  it("returns true for an empty query", () => {
    expect(matchesGlobalSearch(p, "")).toBe(true);
    expect(matchesGlobalSearch(p, "   ")).toBe(true);
  });
  it("matches title, topics and labels case-insensitively", () => {
    expect(matchesGlobalSearch(p, "iceberg")).toBe(true);
    expect(matchesGlobalSearch(p, "REST")).toBe(true);
    expect(matchesGlobalSearch(p, "kind/proposal")).toBe(true);
  });
  it("returns false when nothing matches", () => {
    expect(matchesGlobalSearch(p, "nonexistent-token")).toBe(false);
  });
});

describe("getStatus", () => {
  it("uses the LLM status when present", () => {
    expect(getStatus({ llm_status: "released" })).toBe("released");
  });
  it("defaults to discussion", () => {
    expect(getStatus({})).toBe("discussion");
  });
});
