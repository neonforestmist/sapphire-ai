import {
  boardDiffSchema,
  normalizedBoardSceneSchema,
  type BoardConnection,
  type BoardDiff,
  type NormalizedBoardElement,
  type NormalizedBoardScene,
} from "./schemas";

const compareStrings = (left: string, right: string): number => left.localeCompare(right);

const arraysEqual = (left: readonly string[], right: readonly string[]): boolean =>
  left.length === right.length && left.every((value, index) => value === right[index]);

const isActive = (element: NormalizedBoardElement | undefined): element is NormalizedBoardElement =>
  element !== undefined && !element.deleted;

const connectionKey = (connection: BoardConnection): string =>
  `${connection.from}\u0000${connection.to}`;

const collectConnections = (scene: NormalizedBoardScene): Map<string, BoardConnection> => {
  const connections = new Map<string, BoardConnection>();

  const add = (from: string, to: string): void => {
    if (from === to) {
      return;
    }
    const connection = { from, to };
    connections.set(connectionKey(connection), connection);
  };

  for (const element of scene.elements) {
    if (element.deleted) {
      continue;
    }

    if (element.connectedFromIds.length > 0 && element.connectedToIds.length > 0) {
      for (const from of element.connectedFromIds) {
        for (const to of element.connectedToIds) {
          add(from, to);
        }
      }
      continue;
    }

    for (const to of element.connectedToIds) {
      add(element.id, to);
    }
    for (const from of element.connectedFromIds) {
      add(from, element.id);
    }
  }

  return connections;
};

const sortConnections = (connections: Iterable<BoardConnection>): BoardConnection[] =>
  [...connections].sort((left, right) =>
    compareStrings(connectionKey(left), connectionKey(right)),
  );

const hasStructuralChange = (
  before: NormalizedBoardElement,
  after: NormalizedBoardElement,
): boolean =>
  before.type !== after.type || !arraysEqual(before.groupIds, after.groupIds);

const hasSemanticElementChange = (
  before: NormalizedBoardElement,
  after: NormalizedBoardElement,
): boolean =>
  before.text !== after.text ||
  hasStructuralChange(before, after) ||
  !arraysEqual(before.connectedFromIds, after.connectedFromIds) ||
  !arraysEqual(before.connectedToIds, after.connectedToIds);

const isMeaningfulAddition = (element: NormalizedBoardElement): boolean =>
  element.text !== null || element.type === "arrow" || element.type === "line";

/**
 * Compare board meaning rather than rendering metadata. Geometry-only movement,
 * style changes, selection, and viewport state do not create a semantic diff.
 */
export const createSemanticBoardDiff = (
  previousInput: NormalizedBoardScene,
  currentInput: NormalizedBoardScene,
): BoardDiff => {
  const previous = normalizedBoardSceneSchema.parse(previousInput);
  const current = normalizedBoardSceneSchema.parse(currentInput);
  const previousById = new Map(previous.elements.map((element) => [element.id, element]));
  const currentById = new Map(current.elements.map((element) => [element.id, element]));
  const allIds = [...new Set([...previousById.keys(), ...currentById.keys()])].sort(compareStrings);

  const addedElementIds: string[] = [];
  const removedElementIds: string[] = [];
  const changedElementIds: string[] = [];
  const changedText: BoardDiff["changedText"] = [];
  let structuralChange = false;

  for (const id of allIds) {
    const before = previousById.get(id);
    const after = currentById.get(id);

    if (!isActive(before) && isActive(after)) {
      addedElementIds.push(id);
      continue;
    }
    if (isActive(before) && !isActive(after)) {
      removedElementIds.push(id);
      continue;
    }
    if (!isActive(before) || !isActive(after)) {
      continue;
    }

    if (hasSemanticElementChange(before, after)) {
      changedElementIds.push(id);
    }
    if (before.text !== after.text) {
      changedText.push({ id, before: before.text, after: after.text });
    }
    if (hasStructuralChange(before, after)) {
      structuralChange = true;
    }
  }

  const previousConnections = collectConnections(previous);
  const currentConnections = collectConnections(current);
  const addedConnections = sortConnections(
    [...currentConnections.entries()]
      .filter(([key]) => !previousConnections.has(key))
      .map(([, connection]) => connection),
  );
  const removedConnections = sortConnections(
    [...previousConnections.entries()]
      .filter(([key]) => !currentConnections.has(key))
      .map(([, connection]) => connection),
  );

  const meaningfulAddedElement = addedElementIds.some((id) => {
    const element = currentById.get(id);
    return element !== undefined && isMeaningfulAddition(element);
  });

  return boardDiffSchema.parse({
    addedElementIds,
    removedElementIds,
    changedElementIds,
    addedConnections,
    removedConnections,
    changedText,
    isMeaningful:
      meaningfulAddedElement ||
      removedElementIds.length > 0 ||
      addedConnections.length > 0 ||
      removedConnections.length > 0 ||
      changedText.length > 0 ||
      structuralChange,
  });
};

export const createInitialBoardDiff = (scene: NormalizedBoardScene): BoardDiff =>
  createSemanticBoardDiff({ elements: [], capturedAt: scene.capturedAt }, scene);
