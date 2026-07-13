export type AnalysisVersionState<T> = Readonly<{
  latestRequestedVersion: number;
  latestAppliedVersion: number;
  value: T | null;
}>;

export const createAnalysisVersionState = <T>(): AnalysisVersionState<T> => ({
  latestRequestedVersion: 0,
  latestAppliedVersion: 0,
  value: null,
});

const assertVersion = (version: number, label: string): void => {
  if (!Number.isSafeInteger(version) || version < 0) {
    throw new RangeError(`${label} must be a non-negative safe integer`);
  }
};

export const requestNextAnalysisVersion = <T>(
  state: AnalysisVersionState<T>,
): { state: AnalysisVersionState<T>; analysisVersion: number } => {
  assertVersion(state.latestRequestedVersion, "latestRequestedVersion");
  assertVersion(state.latestAppliedVersion, "latestAppliedVersion");
  const analysisVersion = state.latestRequestedVersion + 1;

  if (!Number.isSafeInteger(analysisVersion)) {
    throw new RangeError("analysisVersion exceeded the maximum safe integer");
  }

  return {
    state: { ...state, latestRequestedVersion: analysisVersion },
    analysisVersion,
  };
};

export const isCurrentAnalysisVersion = (
  responseVersion: number,
  latestRequestedVersion: number,
): boolean => {
  assertVersion(responseVersion, "responseVersion");
  assertVersion(latestRequestedVersion, "latestRequestedVersion");
  return responseVersion === latestRequestedVersion;
};

/** Accept only the latest requested response; stale and unrequested versions are ignored. */
export const applyAnalysisVersionedValue = <T>(
  state: AnalysisVersionState<T>,
  responseVersion: number,
  value: T,
): { state: AnalysisVersionState<T>; accepted: boolean } => {
  assertVersion(responseVersion, "responseVersion");
  assertVersion(state.latestRequestedVersion, "latestRequestedVersion");
  assertVersion(state.latestAppliedVersion, "latestAppliedVersion");

  if (
    responseVersion !== state.latestRequestedVersion ||
    responseVersion <= state.latestAppliedVersion
  ) {
    return { state, accepted: false };
  }

  return {
    state: {
      latestRequestedVersion: state.latestRequestedVersion,
      latestAppliedVersion: responseVersion,
      value,
    },
    accepted: true,
  };
};
