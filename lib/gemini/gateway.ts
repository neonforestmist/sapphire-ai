import type {
  BlueprintInput,
  BoardAnalysisInput,
  FinalReport,
  FinalReportInput,
  InterviewBlueprint,
  LiveTokenInput,
  LiveTokenResult,
  ReasoningState,
} from "@/lib/interview/schemas";

export interface GeminiGateway {
  readonly mode: "real" | "mock";
  createInterviewBlueprint(input: BlueprintInput): Promise<InterviewBlueprint>;
  analyzeBoard(input: BoardAnalysisInput): Promise<ReasoningState>;
  generateFinalReport(input: FinalReportInput): Promise<FinalReport>;
  createLiveEphemeralToken(input: LiveTokenInput): Promise<LiveTokenResult>;
}
