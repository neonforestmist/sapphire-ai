import { z } from "zod";

import {
  normalizedBoardSceneSchema,
  stableBoardElementIdSchema,
  type NormalizedBoardElement,
  type NormalizedBoardScene,
} from "./schemas";

const bindingSchema = z
  .object({
    elementId: stableBoardElementIdSchema,
  })
  .passthrough();

const boundElementSchema = z
  .object({
    id: stableBoardElementIdSchema,
    type: z.string().optional(),
  })
  .passthrough();

/**
 * The intentionally small subset of an Excalidraw element consumed by the
 * domain. Extra rendering/style fields are accepted but never persisted.
 */
export const excalidrawLikeElementSchema = z
  .object({
    id: stableBoardElementIdSchema,
    type: z.string().min(1).max(64),
    text: z.string().max(4_000).nullable().optional(),
    originalText: z.string().max(4_000).nullable().optional(),
    x: z.number().finite(),
    y: z.number().finite(),
    width: z.number().finite().nonnegative(),
    height: z.number().finite().nonnegative(),
    angle: z.number().finite().optional().default(0),
    isDeleted: z.boolean().optional(),
    deleted: z.boolean().optional(),
    groupIds: z.array(stableBoardElementIdSchema).max(256).optional().default([]),
    startBinding: bindingSchema.nullable().optional(),
    endBinding: bindingSchema.nullable().optional(),
    boundElements: z.array(boundElementSchema).max(256).nullable().optional(),
    containerId: stableBoardElementIdSchema.nullable().optional(),
    updatedAt: z.number().int().nonnegative().optional(),
    updated: z.number().int().nonnegative().optional(),
    version: z.number().int().nonnegative().optional(),
    isComplete: z.boolean().optional(),
    status: z.string().max(64).optional(),
    lastCommittedPoint: z.tuple([z.number().finite(), z.number().finite()]).nullable().optional(),
  })
  .passthrough();

export type ExcalidrawLikeElement = z.infer<typeof excalidrawLikeElementSchema>;

export class WhiteboardNormalizationError extends Error {
  public constructor(message: string) {
    super(message);
    this.name = "WhiteboardNormalizationError";
  }
}

const normalizeText = (text: string | null | undefined): string | null => {
  if (text === null || text === undefined) {
    return null;
  }

  const normalized = text.replace(/\r\n?/g, "\n").trim();
  return normalized.length === 0 ? null : normalized;
};

const normalizeElementType = (type: string): NormalizedBoardElement["type"] => {
  switch (type) {
    case "rectangle":
    case "ellipse":
    case "diamond":
    case "text":
    case "arrow":
    case "line":
      return type;
    case "draw":
    case "freedraw":
    case "freehand":
      return "freehand";
    default:
      return "other";
  }
};

const isTransientElement = (element: ExcalidrawLikeElement): boolean => {
  if (element.isComplete === false || element.status === "pending") {
    return true;
  }

  return (
    normalizeElementType(element.type) === "freehand" &&
    element.lastCommittedPoint !== null &&
    element.lastCommittedPoint !== undefined
  );
};

const uniqueSorted = (values: Iterable<string>): string[] =>
  [...new Set(values)].sort((left, right) => left.localeCompare(right));

const getUpdatedAt = (element: ExcalidrawLikeElement): number =>
  element.updatedAt ?? element.updated ?? element.version ?? 0;

const getOwnText = (element: ExcalidrawLikeElement): string | null =>
  normalizeText(element.text ?? element.originalText);

const findBoundText = (
  element: ExcalidrawLikeElement,
  elementsById: ReadonlyMap<string, ExcalidrawLikeElement>,
): string[] => {
  const candidateIds = new Set<string>();

  for (const boundElement of element.boundElements ?? []) {
    if (boundElement.type === undefined || boundElement.type === "text") {
      candidateIds.add(boundElement.id);
    }
  }

  for (const candidate of elementsById.values()) {
    if (candidate.type === "text" && candidate.containerId === element.id) {
      candidateIds.add(candidate.id);
    }
  }

  return uniqueSorted(candidateIds)
    .map((id) => elementsById.get(id))
    .filter((candidate): candidate is ExcalidrawLikeElement => candidate !== undefined)
    .filter((candidate) => !candidate.isDeleted && !candidate.deleted && !isTransientElement(candidate))
    .map(getOwnText)
    .filter((text): text is string => text !== null);
};

const getElementText = (
  element: ExcalidrawLikeElement,
  elementsById: ReadonlyMap<string, ExcalidrawLikeElement>,
): string | null => {
  const parts = [getOwnText(element), ...findBoundText(element, elementsById)].filter(
    (text): text is string => text !== null,
  );
  const uniqueParts = [...new Set(parts)];
  return uniqueParts.length === 0 ? null : uniqueParts.join("\n");
};

/** Normalize a scene without changing any source element IDs. */
export const normalizeExcalidrawScene = (
  input: readonly unknown[],
  capturedAt: number,
): NormalizedBoardScene => {
  if (!Number.isSafeInteger(capturedAt) || capturedAt < 0) {
    throw new WhiteboardNormalizationError("capturedAt must be a non-negative integer");
  }

  const parsedElements = input.map((element) => excalidrawLikeElementSchema.parse(element));
  const elementsById = new Map<string, ExcalidrawLikeElement>();

  for (const element of parsedElements) {
    if (elementsById.has(element.id)) {
      throw new WhiteboardNormalizationError(`Duplicate element ID '${element.id}'`);
    }
    elementsById.set(element.id, element);
  }

  const retainedElements = parsedElements.filter((element) => !isTransientElement(element));
  const retainedIds = new Set(retainedElements.map((element) => element.id));
  const activeIds = new Set(
    retainedElements
      .filter((element) => !element.isDeleted && !element.deleted)
      .map((element) => element.id),
  );

  const incoming = new Map<string, Set<string>>();
  const outgoing = new Map<string, Set<string>>();

  for (const element of retainedElements) {
    if (element.isDeleted || element.deleted) {
      continue;
    }

    const normalizedType = normalizeElementType(element.type);
    if (normalizedType !== "arrow" && normalizedType !== "line") {
      continue;
    }

    const from = element.startBinding?.elementId;
    const to = element.endBinding?.elementId;
    if (from === undefined || to === undefined || !activeIds.has(from) || !activeIds.has(to)) {
      continue;
    }

    const outgoingIds = outgoing.get(from) ?? new Set<string>();
    outgoingIds.add(to);
    outgoing.set(from, outgoingIds);

    const incomingIds = incoming.get(to) ?? new Set<string>();
    incomingIds.add(from);
    incoming.set(to, incomingIds);
  }

  const normalized = retainedElements.map<NormalizedBoardElement>((element) => {
    const isDeleted = element.isDeleted ?? element.deleted ?? false;
    const normalizedType = normalizeElementType(element.type);
    const connectorFrom =
      !isDeleted &&
      (normalizedType === "arrow" || normalizedType === "line") &&
      element.startBinding?.elementId !== undefined &&
      activeIds.has(element.startBinding.elementId)
        ? [element.startBinding.elementId]
        : [];
    const connectorTo =
      !isDeleted &&
      (normalizedType === "arrow" || normalizedType === "line") &&
      element.endBinding?.elementId !== undefined &&
      activeIds.has(element.endBinding.elementId)
        ? [element.endBinding.elementId]
        : [];

    return {
      id: element.id,
      type: normalizedType,
      text: getElementText(element, elementsById),
      x: element.x,
      y: element.y,
      width: element.width,
      height: element.height,
      angle: element.angle,
      deleted: isDeleted,
      groupIds: uniqueSorted(element.groupIds.filter((id) => id !== element.id)),
      connectedFromIds: uniqueSorted([
        ...(incoming.get(element.id) ?? []),
        ...connectorFrom,
      ]).filter((id) => retainedIds.has(id) && id !== element.id),
      connectedToIds: uniqueSorted([
        ...(outgoing.get(element.id) ?? []),
        ...connectorTo,
      ]).filter((id) => retainedIds.has(id) && id !== element.id),
      updatedAt: getUpdatedAt(element),
    };
  });

  normalized.sort((left, right) => left.id.localeCompare(right.id));
  return normalizedBoardSceneSchema.parse({ elements: normalized, capturedAt });
};
