import { describe, expect, it } from "vitest";

import {
  applyAnalysisVersionedValue,
  createAnalysisVersionState,
  isCurrentAnalysisVersion,
  requestNextAnalysisVersion,
} from "@/lib/interview/analysis-version";

describe("analysis version guard", () => {
  it("issues monotonic versions and accepts only the latest response", () => {
    const initial = createAnalysisVersionState<string>();
    const first = requestNextAnalysisVersion(initial);
    const second = requestNextAnalysisVersion(first.state);

    expect(first.analysisVersion).toBe(1);
    expect(second.analysisVersion).toBe(2);
    expect(isCurrentAnalysisVersion(1, second.state.latestRequestedVersion)).toBe(false);

    const stale = applyAnalysisVersionedValue(second.state, 1, "stale");
    expect(stale).toEqual({ state: second.state, accepted: false });

    const current = applyAnalysisVersionedValue(second.state, 2, "current");
    expect(current.accepted).toBe(true);
    expect(current.state).toMatchObject({ latestAppliedVersion: 2, value: "current" });
  });

  it("ignores duplicate and unrequested responses", () => {
    const requested = requestNextAnalysisVersion(createAnalysisVersionState<string>()).state;
    const applied = applyAnalysisVersionedValue(requested, 1, "accepted").state;

    expect(applyAnalysisVersionedValue(applied, 1, "duplicate").accepted).toBe(false);
    expect(applyAnalysisVersionedValue(applied, 2, "unrequested").accepted).toBe(false);
  });

  it("rejects malformed versions", () => {
    expect(() => isCurrentAnalysisVersion(-1, 0)).toThrow(RangeError);
    expect(() => applyAnalysisVersionedValue(createAnalysisVersionState(), 1.5, null)).toThrow(
      RangeError,
    );
  });
});
