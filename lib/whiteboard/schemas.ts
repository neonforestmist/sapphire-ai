import { z } from "zod";

const hasUniqueValues = (values: readonly string[]): boolean =>
  new Set(values).size === values.length;

export const stableBoardElementIdSchema = z
  .string()
  .min(1)
  .max(128)
  .regex(/^[A-Za-z0-9_-]+$/, "Element IDs may only contain letters, numbers, '_' and '-'");

export const boardElementTypeSchema = z.enum([
  "rectangle",
  "ellipse",
  "diamond",
  "text",
  "arrow",
  "line",
  "freehand",
  "other",
]);

const uniqueElementIdArraySchema = z
  .array(stableBoardElementIdSchema)
  .max(256)
  .refine(hasUniqueValues, "Element ID lists must not contain duplicates");

export const normalizedBoardElementSchema = z
  .object({
    id: stableBoardElementIdSchema,
    type: boardElementTypeSchema,
    text: z.string().max(4_000).nullable(),
    x: z.number().finite(),
    y: z.number().finite(),
    width: z.number().finite().nonnegative(),
    height: z.number().finite().nonnegative(),
    angle: z.number().finite(),
    deleted: z.boolean(),
    groupIds: uniqueElementIdArraySchema,
    connectedFromIds: uniqueElementIdArraySchema,
    connectedToIds: uniqueElementIdArraySchema,
    updatedAt: z.number().int().nonnegative(),
  })
  .strict();

export type NormalizedBoardElement = z.infer<typeof normalizedBoardElementSchema>;

export const normalizedBoardSceneSchema = z
  .object({
    elements: z.array(normalizedBoardElementSchema).max(2_000),
    capturedAt: z.number().int().nonnegative(),
  })
  .strict()
  .superRefine((scene, context) => {
    const ids = new Set<string>();

    for (const [index, element] of scene.elements.entries()) {
      if (ids.has(element.id)) {
        context.addIssue({
          code: z.ZodIssueCode.custom,
          message: `Duplicate element ID '${element.id}'`,
          path: ["elements", index, "id"],
        });
      }
      ids.add(element.id);
    }

    for (const [index, element] of scene.elements.entries()) {
      for (const [field, references] of [
        ["connectedFromIds", element.connectedFromIds],
        ["connectedToIds", element.connectedToIds],
      ] as const) {
        for (const [referenceIndex, reference] of references.entries()) {
          if (!ids.has(reference)) {
            context.addIssue({
              code: z.ZodIssueCode.custom,
              message: `Unknown connected element ID '${reference}'`,
              path: ["elements", index, field, referenceIndex],
            });
          }
        }
      }
    }
  });

export type NormalizedBoardScene = z.infer<typeof normalizedBoardSceneSchema>;

export const boardConnectionSchema = z
  .object({
    from: stableBoardElementIdSchema,
    to: stableBoardElementIdSchema,
  })
  .strict();

export type BoardConnection = z.infer<typeof boardConnectionSchema>;

export const changedBoardTextSchema = z
  .object({
    id: stableBoardElementIdSchema,
    before: z.string().max(4_000).nullable(),
    after: z.string().max(4_000).nullable(),
  })
  .strict();

export const boardDiffSchema = z
  .object({
    addedElementIds: uniqueElementIdArraySchema,
    removedElementIds: uniqueElementIdArraySchema,
    changedElementIds: uniqueElementIdArraySchema,
    addedConnections: z.array(boardConnectionSchema).max(4_000),
    removedConnections: z.array(boardConnectionSchema).max(4_000),
    changedText: z.array(changedBoardTextSchema).max(2_000),
    isMeaningful: z.boolean(),
  })
  .strict();

export type BoardDiff = z.infer<typeof boardDiffSchema>;
