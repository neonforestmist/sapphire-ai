import { describe, expect, it } from "vitest";

import { normalizeExcalidrawScene } from "@/lib/whiteboard/normalize";
import {
  RATE_LIMITER_IDS,
  RATE_LIMITER_INITIAL_SCENE,
  RATE_LIMITER_REVISED_SCENE,
} from "@/lib/whiteboard/rate-limiter-fixture";
import {
  createInitialBoardDiff,
  createSemanticBoardDiff,
} from "@/lib/whiteboard/semantic-diff";

describe("semantic board diff", () => {
  it("records labeled elements and connectors in an initial meaningful scene", () => {
    const diff = createInitialBoardDiff(RATE_LIMITER_INITIAL_SCENE);

    expect(diff.addedElementIds).toContain(RATE_LIMITER_IDS.usRedis);
    expect(diff.addedConnections).toContainEqual({
      from: RATE_LIMITER_IDS.usApi,
      to: RATE_LIMITER_IDS.usRedis,
    });
    expect(diff.isMeaningful).toBe(true);
  });

  it("ignores geometry-only movement", () => {
    const before = normalizeExcalidrawScene(
      [{ id: "shape", type: "rectangle", text: null, x: 0, y: 0, width: 100, height: 50 }],
      10,
    );
    const after = normalizeExcalidrawScene(
      [{ id: "shape", type: "rectangle", text: null, x: 400, y: 200, width: 120, height: 50 }],
      20,
    );

    expect(createSemanticBoardDiff(before, after)).toEqual({
      addedElementIds: [],
      removedElementIds: [],
      changedElementIds: [],
      addedConnections: [],
      removedConnections: [],
      changedText: [],
      isMeaningful: false,
    });
  });

  it("captures text edits without treating updatedAt alone as meaningful", () => {
    const before = normalizeExcalidrawScene(
      [{ id: "shape", type: "rectangle", text: "Cache", x: 0, y: 0, width: 100, height: 50, version: 1 }],
      10,
    );
    const timestampOnly = normalizeExcalidrawScene(
      [{ id: "shape", type: "rectangle", text: "Cache", x: 0, y: 0, width: 100, height: 50, version: 2 }],
      20,
    );
    const renamed = normalizeExcalidrawScene(
      [{ id: "shape", type: "rectangle", text: "Global cache", x: 0, y: 0, width: 100, height: 50, version: 3 }],
      30,
    );

    expect(createSemanticBoardDiff(before, timestampOnly).isMeaningful).toBe(false);
    expect(createSemanticBoardDiff(before, renamed)).toMatchObject({
      changedElementIds: ["shape"],
      changedText: [{ id: "shape", before: "Cache", after: "Global cache" }],
      isMeaningful: true,
    });
  });

  it("captures synchronization components and exact new connections", () => {
    const diff = createSemanticBoardDiff(
      RATE_LIMITER_INITIAL_SCENE,
      RATE_LIMITER_REVISED_SCENE,
    );

    expect(diff.addedElementIds).toEqual(
      expect.arrayContaining([
        RATE_LIMITER_IDS.coordinator,
        RATE_LIMITER_IDS.usSyncArrow,
        RATE_LIMITER_IDS.euSyncArrow,
      ]),
    );
    expect(diff.addedConnections).toEqual(
      expect.arrayContaining([
        { from: RATE_LIMITER_IDS.usRedis, to: RATE_LIMITER_IDS.coordinator },
        { from: RATE_LIMITER_IDS.euRedis, to: RATE_LIMITER_IDS.coordinator },
      ]),
    );
    expect(diff.isMeaningful).toBe(true);
  });

  it("treats absent and tombstoned elements as removals", () => {
    const before = normalizeExcalidrawScene(
      [{ id: "shape", type: "rectangle", text: "Redis", x: 0, y: 0, width: 10, height: 10 }],
      10,
    );
    const tombstoned = normalizeExcalidrawScene(
      [{ id: "shape", type: "rectangle", text: "Redis", x: 0, y: 0, width: 10, height: 10, isDeleted: true }],
      20,
    );
    const missing = normalizeExcalidrawScene([], 20);

    expect(createSemanticBoardDiff(before, tombstoned).removedElementIds).toEqual(["shape"]);
    expect(createSemanticBoardDiff(before, missing).removedElementIds).toEqual(["shape"]);
  });
});
