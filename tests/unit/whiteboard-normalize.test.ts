import { describe, expect, it } from "vitest";

import {
  WhiteboardNormalizationError,
  normalizeExcalidrawScene,
} from "@/lib/whiteboard/normalize";

describe("whiteboard normalization", () => {
  it("preserves IDs, attaches bound labels, extracts bindings, and removes rendering fields", () => {
    const raw = [
      {
        id: "api-box",
        type: "rectangle",
        x: 0,
        y: 0,
        width: 100,
        height: 60,
        boundElements: [{ id: "api-label", type: "text" }],
        strokeColor: "#ff00ff",
        version: 4,
      },
      {
        id: "api-label",
        type: "text",
        text: "  API\r\nService  ",
        containerId: "api-box",
        x: 20,
        y: 20,
        width: 60,
        height: 20,
        version: 2,
      },
      {
        id: "redis-box",
        type: "rectangle",
        text: "Redis",
        x: 220,
        y: 0,
        width: 100,
        height: 60,
        version: 1,
      },
      {
        id: "api-to-redis",
        type: "arrow",
        x: 100,
        y: 30,
        width: 120,
        height: 0,
        startBinding: { elementId: "api-box", focus: 0, gap: 0 },
        endBinding: { elementId: "redis-box", focus: 0, gap: 0 },
        version: 3,
      },
    ];
    const original = structuredClone(raw);

    const scene = normalizeExcalidrawScene(raw, 1_000);
    const api = scene.elements.find((element) => element.id === "api-box")!;
    const redis = scene.elements.find((element) => element.id === "redis-box")!;
    const arrow = scene.elements.find((element) => element.id === "api-to-redis")!;

    expect(raw).toEqual(original);
    expect(scene.elements.map((element) => element.id)).toEqual([
      "api-box",
      "api-label",
      "api-to-redis",
      "redis-box",
    ]);
    expect(api.text).toBe("API\nService");
    expect(api.connectedToIds).toEqual(["redis-box"]);
    expect(redis.connectedFromIds).toEqual(["api-box"]);
    expect(arrow.connectedFromIds).toEqual(["api-box"]);
    expect(arrow.connectedToIds).toEqual(["redis-box"]);
    expect(api).not.toHaveProperty("strokeColor");
  });

  it("maps free-draw types and excludes unfinished strokes", () => {
    const scene = normalizeExcalidrawScene(
      [
        {
          id: "finished-stroke",
          type: "freedraw",
          x: 0,
          y: 0,
          width: 20,
          height: 20,
          lastCommittedPoint: null,
        },
        {
          id: "active-stroke",
          type: "freedraw",
          x: 0,
          y: 0,
          width: 10,
          height: 10,
          lastCommittedPoint: [5, 5],
        },
        {
          id: "pending-shape",
          type: "rectangle",
          x: 0,
          y: 0,
          width: 10,
          height: 10,
          status: "pending",
        },
      ],
      20,
    );

    expect(scene.elements).toHaveLength(1);
    expect(scene.elements[0]).toMatchObject({ id: "finished-stroke", type: "freehand" });
  });

  it("preserves deletion but removes bindings to deleted or missing elements", () => {
    const scene = normalizeExcalidrawScene(
      [
        {
          id: "source",
          type: "rectangle",
          x: 0,
          y: 0,
          width: 10,
          height: 10,
        },
        {
          id: "deleted-target",
          type: "rectangle",
          x: 20,
          y: 0,
          width: 10,
          height: 10,
          isDeleted: true,
        },
        {
          id: "dangling-arrow",
          type: "arrow",
          x: 10,
          y: 0,
          width: 10,
          height: 0,
          startBinding: { elementId: "source" },
          endBinding: { elementId: "deleted-target" },
        },
      ],
      30,
    );

    expect(scene.elements.find((element) => element.id === "deleted-target")?.deleted).toBe(true);
    expect(scene.elements.find((element) => element.id === "source")?.connectedToIds).toEqual([]);
    expect(scene.elements.find((element) => element.id === "dangling-arrow")).toMatchObject({
      connectedFromIds: ["source"],
      connectedToIds: [],
    });
  });

  it("rejects duplicate IDs, invalid geometry, and invalid capture time", () => {
    const element = {
      id: "duplicate",
      type: "rectangle",
      x: 0,
      y: 0,
      width: 10,
      height: 10,
    };

    expect(() => normalizeExcalidrawScene([element, element], 1)).toThrow(
      WhiteboardNormalizationError,
    );
    expect(() => normalizeExcalidrawScene([{ ...element, width: -1 }], 1)).toThrow();
    expect(() => normalizeExcalidrawScene([element], -1)).toThrow(
      WhiteboardNormalizationError,
    );
  });
});
