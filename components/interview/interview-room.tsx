"use client";

import dynamic from "next/dynamic";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useCallback, useEffect, useEffectEvent, useMemo, useRef, useState } from "react";
import type { ExcalidrawImperativeAPI } from "@excalidraw/excalidraw/types";

import { Brand } from "@/components/brand";
import { displayText } from "@/components/display-text";
import type {
  BoardSnapshotRecord,
  InterviewBlueprint,
  InterviewSession,
  ReasoningState,
  SessionEvent,
  TranscriptSegment,
} from "@/lib/interview/schemas";
import { normalizeExcalidrawScene } from "@/lib/whiteboard/normalize";
import {
  RATE_LIMITER_IDS,
} from "@/lib/whiteboard/rate-limiter-fixture";
import { createInitialBoardDiff } from "@/lib/whiteboard/semantic-diff";
import { useGeminiLive } from "@/lib/live/use-gemini-live";
import { useBrowserVoice } from "@/lib/live/use-browser-voice";
import {
  createLiveToolDispatcher,
  LiveToolApplicationError,
} from "@/lib/live/dispatcher";

import styles from "./interview-room.module.css";

const Excalidraw = dynamic(
  async () => (await import("@excalidraw/excalidraw")).Excalidraw,
  {
    ssr: false,
    loading: () => <div className={styles.canvasLoading}>Preparing the whiteboard…</div>,
  },
);

type ApiEnvelope<T> = {
  data?: T;
  error?: { message: string };
};

type SessionPayload = {
  session: InterviewSession;
  events: SessionEvent[];
  snapshots: BoardSnapshotRecord[];
  blueprint: InterviewBlueprint;
  reasoningState: ReasoningState | null;
  providerMode: "mock" | "real";
  liveEnabled: boolean;
};

type AnalyzePayload = {
  analysisVersion: number;
  snapshot: BoardSnapshotRecord;
  reasoningState: ReasoningState;
};

type ActionStatus = "idle" | "sending" | "analyzing" | "finishing";
type InteractionMode = "voice" | "text";

function boardVersionSignature(elements: readonly unknown[]): string {
  return elements
    .flatMap((element) => {
      if (!element || typeof element !== "object") return [];
      const candidate = element as { id?: unknown; version?: unknown; isDeleted?: unknown };
      if (typeof candidate.id !== "string") return [];
      return [`${candidate.id}:${String(candidate.version ?? 0)}:${candidate.isDeleted === true ? 1 : 0}`];
    })
    .sort()
    .join("|");
}

function frameBoard(
  api: ExcalidrawImperativeAPI,
  elements: Parameters<ExcalidrawImperativeAPI["scrollToContent"]>[0],
  focus = false,
) {
  if (!elements) return;
  const reveal = () => {
    const focusPanelOffset = focus && api.getAppState().width >= 700 ? 250 : 32;
    api.scrollToContent(elements, {
      fitToViewport: true,
      viewportZoomFactor: focus ? 0.7 : 0.64,
      maxZoom: focus ? 0.88 : 0.78,
      canvasOffsets: {
        top: 92,
        right: 40,
        bottom: 52,
        left: focusPanelOffset,
      },
      animate: false,
    });
  };
  requestAnimationFrame(() => requestAnimationFrame(reveal));
  window.setTimeout(reveal, 140);
}

const initialSkeleton = () => [
  {
    id: RATE_LIMITER_IDS.usApi,
    type: "rectangle" as const,
    x: 80,
    y: 100,
    width: 180,
    height: 88,
    label: { id: "us-api-label", text: "US API", fontSize: 22 },
    strokeColor: "#7ba2ff",
    backgroundColor: "#10234b",
    fillStyle: "solid" as const,
    roundness: { type: 3 as const },
  },
  {
    id: RATE_LIMITER_IDS.usRedis,
    type: "rectangle" as const,
    x: 390,
    y: 100,
    width: 190,
    height: 88,
    label: { id: "us-redis-label", text: "US counter\n(Redis)", fontSize: 20 },
    strokeColor: "#7ba2ff",
    backgroundColor: "#142647",
    fillStyle: "solid" as const,
    roundness: { type: 3 as const },
  },
  {
    id: RATE_LIMITER_IDS.euApi,
    type: "rectangle" as const,
    x: 80,
    y: 360,
    width: 180,
    height: 88,
    label: { id: "eu-api-label", text: "EU API", fontSize: 22 },
    strokeColor: "#7ba2ff",
    backgroundColor: "#10234b",
    fillStyle: "solid" as const,
    roundness: { type: 3 as const },
  },
  {
    id: RATE_LIMITER_IDS.euRedis,
    type: "rectangle" as const,
    x: 390,
    y: 360,
    width: 190,
    height: 88,
    label: { id: "eu-redis-label", text: "EU counter\n(Redis)", fontSize: 20 },
    strokeColor: "#7ba2ff",
    backgroundColor: "#142647",
    fillStyle: "solid" as const,
    roundness: { type: 3 as const },
  },
  {
    id: RATE_LIMITER_IDS.usRegionalArrow,
    type: "arrow" as const,
    x: 260,
    y: 144,
    start: { id: RATE_LIMITER_IDS.usApi },
    end: { id: RATE_LIMITER_IDS.usRedis },
    strokeColor: "#7ba2ff",
    strokeWidth: 2,
  },
  {
    id: RATE_LIMITER_IDS.euRegionalArrow,
    type: "arrow" as const,
    x: 260,
    y: 404,
    start: { id: RATE_LIMITER_IDS.euApi },
    end: { id: RATE_LIMITER_IDS.euRedis },
    strokeColor: "#7ba2ff",
    strokeWidth: 2,
  },
];

const revisedSkeleton = () => [
  ...initialSkeleton(),
  {
    id: RATE_LIMITER_IDS.coordinator,
    type: "rectangle" as const,
    x: 720,
    y: 230,
    width: 250,
    height: 100,
    label: {
      id: "global-coordinator-label",
      text: "Global quota\ncoordinator",
      fontSize: 21,
    },
    strokeColor: "#63ddff",
    backgroundColor: "#12344c",
    fillStyle: "solid" as const,
    roundness: { type: 3 as const },
  },
  {
    id: RATE_LIMITER_IDS.usSyncArrow,
    type: "arrow" as const,
    x: 580,
    y: 144,
    start: { id: RATE_LIMITER_IDS.usRedis },
    end: { id: RATE_LIMITER_IDS.coordinator },
    strokeColor: "#63ddff",
    strokeWidth: 2,
  },
  {
    id: RATE_LIMITER_IDS.euSyncArrow,
    type: "arrow" as const,
    x: 580,
    y: 404,
    start: { id: RATE_LIMITER_IDS.euRedis },
    end: { id: RATE_LIMITER_IDS.coordinator },
    strokeColor: "#63ddff",
    strokeWidth: 2,
  },
];

function interviewIntroduction(blueprint: InterviewBlueprint): string {
  const boardGuidance = blueprint.interviewType === "system-design"
    ? " You can use the board whenever a diagram helps your answer."
    : "";
  return `Hey there! I’ll guide your ${blueprint.roleTitle} practice interview at the ${blueprint.seniority.toLowerCase()} level. You can answer by typing or speaking.${boardGuidance} Whenever you’re ready, let’s begin.`;
}

function fallbackInterviewerReply(
  blueprint: InterviewBlueprint,
  candidateTurnIndex: number,
): string | null {
  switch (blueprint.interviewType) {
    case "behavioral":
      return [
        "Thanks—that gives me the situation. What did you personally do, and why did you choose that approach?",
        "What changed because of your actions, and how did you measure the result?",
        "Looking back, what would you do differently next time?",
      ][candidateTurnIndex % 3] ?? null;
    case "case-study":
      return [
        "That’s a useful starting point. Which metric would prove response time improved without hurting answer quality?",
        "What is the first change you would test, and why would you prioritize it?",
        "What risk could make that recommendation backfire, and how would you watch for it?",
      ][candidateTurnIndex % 3] ?? null;
    case "technical-explanation":
      return [
        "Good start. What would your first test set include, and why would those examples be representative?",
        "How would you decide the assistant is safe and useful enough to launch?",
        "How would you explain the biggest trade-off to a teammate who is new to the topic?",
      ][candidateTurnIndex % 3] ?? null;
    case "system-design":
      return null;
  }
}

async function readApi<T>(response: Response): Promise<T> {
  const body = (await response.json()) as ApiEnvelope<T>;
  if (!response.ok || !body.data) {
    throw new Error(body.error?.message ?? "The request could not be completed.");
  }
  return body.data;
}

async function blobToBase64(blob: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onerror = () => reject(new Error("Could not encode the board snapshot."));
    reader.onload = () => {
      const result = String(reader.result);
      resolve(result.slice(result.indexOf(",") + 1));
    };
    reader.readAsDataURL(blob);
  });
}

export function InterviewRoom({ sessionId }: { sessionId: string }) {
  const router = useRouter();
  const boardApiRef = useRef<ExcalidrawImperativeAPI | null>(null);
  const rawElementsRef = useRef<readonly unknown[]>([]);
  const [payload, setPayload] = useState<SessionPayload | null>(null);
  const [reasoning, setReasoning] = useState<ReasoningState | null>(null);
  const [reasoningText, setReasoningText] = useState("");
  const [status, setStatus] = useState<ActionStatus>("idle");
  const [notice, setNotice] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [transcriptSent, setTranscriptSent] = useState(false);
  const [focusedIds, setFocusedIds] = useState<string[]>([]);
  const [scenarioLoaded, setScenarioLoaded] = useState(false);
  const [boardReady, setBoardReady] = useState(false);
  const [boardVisible, setBoardVisible] = useState(true);
  const [lastLiveReply, setLastLiveReply] = useState<string | null>(null);
  const [interactionMode, setInteractionMode] = useState<InteractionMode>("voice");
  const [boardIdleVersion, setBoardIdleVersion] = useState(0);
  const [speechOutputSupported, setSpeechOutputSupported] = useState(false);
  const boardPauseTimerRef = useRef<number | null>(null);
  const latestBoardSignatureRef = useRef("");
  const lastAnalyzedBoardSignatureRef = useRef("");
  const automaticAnalysisRef = useRef(false);
  const conversationLogRef = useRef<HTMLDivElement | null>(null);
  const lastSpokenTextRef = useRef("");

  const loadSession = useCallback(async () => {
    try {
      const data = await readApi<SessionPayload>(
        await fetch(`/api/interviews/${sessionId}`, { cache: "no-store" }),
      );
      setPayload(data);
      setReasoning(data.reasoningState);
      const hasTranscript = data.events.some((event) => event.type === "transcript.input.finalized");
      setTranscriptSent(hasTranscript);
      if (!hasTranscript) setReasoningText("");
      setBoardVisible(data.blueprint.interviewType === "system-design");
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Could not load the interview.");
    }
  }, [sessionId]);

  useEffect(() => {
    const timer = window.setTimeout(() => void loadSession(), 0);
    return () => window.clearTimeout(timer);
  }, [loadSession]);

  useEffect(() => {
    const timer = window.setTimeout(() => {
      setSpeechOutputSupported(
        "speechSynthesis" in window && "SpeechSynthesisUtterance" in window,
      );
    }, 0);
    return () => {
      window.clearTimeout(timer);
      window.speechSynthesis?.cancel();
    };
  }, []);

  const persistLiveTranscript = useCallback(async (
    speaker: "candidate" | "interviewer",
    text: string,
  ) => {
    const normalized = text.trim();
    if (!normalized) return;
    const now = Date.now();
    const segment: TranscriptSegment = {
      id: `transcript-${crypto.randomUUID().replaceAll("-", "")}`,
      sessionId,
      speaker,
      source: speaker === "candidate" ? "live_input" : "live_output",
      text: normalized,
      startedAt: now,
      endedAt: now,
      finalized: true,
    };
    await readApi(
      await fetch(`/api/interviews/${sessionId}/events`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          type: speaker === "candidate"
            ? "transcript.input.finalized"
            : "transcript.output.finalized",
          segment,
        }),
      }),
    );
    if (speaker === "candidate") {
      setTranscriptSent(true);
      setReasoningText(normalized);
    }
    await loadSession();
  }, [loadSession, sessionId]);

  async function dispatchLiveTool(call: unknown) {
    const unavailable = () => {
      throw new LiveToolApplicationError({
        publicMessage: "That interview action is not available in this browser session.",
      });
    };
    const dispatcher = createLiveToolDispatcher({
      getKnownBoardElementIds: () => rawElementsRef.current.flatMap((element) => {
        if (!element || typeof element !== "object") return [];
        const candidate = element as { id?: unknown; isDeleted?: boolean; deleted?: boolean };
        return typeof candidate.id === "string" && !candidate.isDeleted && !candidate.deleted
          ? [candidate.id]
          : [];
      }),
      handlers: {
        request_board_analysis: async () => {
          await analyzeBoard();
          return { analyzed: true };
        },
        focus_board_elements: async (args) => {
          setFocusedIds([...args.elementIds]);
          setNotice(args.message);
          return { focusedElementIds: args.elementIds };
        },
        request_candidate_reflection: async (args) => {
          setNotice(`Reflection: ${args.topic}`);
          return { requested: true };
        },
        record_interview_signal: unavailable,
        advance_interview_stage: unavailable,
        inject_constraint: unavailable,
        finish_interview: unavailable,
      },
    });
    return dispatcher.dispatch({ call });
  }

  const live = useGeminiLive({
    sessionId,
    enabled: payload?.liveEnabled ?? false,
    onInputTranscript: (text) => persistLiveTranscript("candidate", text),
    onOutputTranscript: async (text) => {
      setLastLiveReply(text);
      await persistLiveTranscript("interviewer", text);
    },
    onToolCall: dispatchLiveTool,
  });

  const persistBrowserCandidateTurn = useCallback(async (text: string) => {
    await persistLiveTranscript("candidate", text);
    if (payload && !payload.liveEnabled) {
      const candidateTurnIndex = payload.events.filter(
        (event) => event.type === "transcript.input.finalized",
      ).length;
      const reply = fallbackInterviewerReply(payload.blueprint, candidateTurnIndex);
      if (reply) await persistLiveTranscript("interviewer", reply);
    }
    setReasoningText("");
  }, [payload, persistLiveTranscript]);

  const browserVoice = useBrowserVoice({
    onDraft: setReasoningText,
    onFinalTranscript: persistBrowserCandidateTurn,
  });

  const transcriptMessages = useMemo(() => {
    if (!payload) return [];
    return payload.events.flatMap((event) =>
      event.type === "transcript.input.finalized" || event.type === "transcript.output.finalized"
        ? [event.payload.segment]
        : [],
    );
  }, [payload]);
  const hasPersistedLiveReply = lastLiveReply
    ? transcriptMessages.some(
        (segment) => segment.speaker === "interviewer" && segment.text === lastLiveReply,
      )
    : false;
  const contradiction = reasoning?.contradictions[0] ?? null;
  const probe = reasoning?.recommendedProbe ?? null;
  const introduction = payload ? interviewIntroduction(payload.blueprint) : "";
  const openingQuestion = payload
    ? `Here’s your first question: ${payload.blueprint.problemStatement}`
    : "";
  const latestPersistedInterviewerTurn = [...transcriptMessages]
    .reverse()
    .find((segment) => segment.speaker === "interviewer")?.text ?? null;
  const latestInterviewerTurn = probe?.question
    ?? lastLiveReply
    ?? latestPersistedInterviewerTurn
    ?? [introduction, openingQuestion].filter(Boolean).join(" ");

  const speakText = useCallback((text: string) => {
    if (!("speechSynthesis" in window) || !("SpeechSynthesisUtterance" in window)) return;
    window.speechSynthesis.cancel();
    const utterance = new SpeechSynthesisUtterance(text);
    utterance.rate = 0.96;
    utterance.pitch = 1;
    window.speechSynthesis.speak(utterance);
  }, []);

  useEffect(() => {
    if (
      interactionMode !== "voice" ||
      !speechOutputSupported ||
      !payload ||
      payload.liveEnabled ||
      !latestInterviewerTurn ||
      latestInterviewerTurn === lastSpokenTextRef.current
    ) return;
    const timer = window.setTimeout(() => {
      lastSpokenTextRef.current = latestInterviewerTurn;
      speakText(latestInterviewerTurn);
    }, 350);
    return () => window.clearTimeout(timer);
  }, [interactionMode, latestInterviewerTurn, payload, speakText, speechOutputSupported]);

  useEffect(() => {
    const log = conversationLogRef.current;
    if (log) log.scrollTop = log.scrollHeight;
  }, [lastLiveReply, probe?.question, transcriptMessages.length]);

  const handleBoardChange = useCallback((elements: readonly unknown[]) => {
    rawElementsRef.current = elements;
    const signature = boardVersionSignature(elements);
    if (!signature || signature === latestBoardSignatureRef.current) return;
    latestBoardSignatureRef.current = signature;
    if (boardPauseTimerRef.current !== null) {
      window.clearTimeout(boardPauseTimerRef.current);
    }
    boardPauseTimerRef.current = window.setTimeout(() => {
      boardPauseTimerRef.current = null;
      setBoardIdleVersion((version) => version + 1);
    }, 1_600);
  }, []);

  useEffect(() => () => {
    if (boardPauseTimerRef.current !== null) {
      window.clearTimeout(boardPauseTimerRef.current);
    }
  }, []);

  const focusLabels = useMemo(() => {
    const labels = new Map<string, string>([
      [RATE_LIMITER_IDS.usRedis, "US counter"],
      [RATE_LIMITER_IDS.euRedis, "EU counter"],
      [RATE_LIMITER_IDS.coordinator, "Global coordinator"],
    ]);
    const order: string[] = [
      RATE_LIMITER_IDS.usRedis,
      RATE_LIMITER_IDS.euRedis,
      RATE_LIMITER_IDS.coordinator,
    ];
    return [...focusedIds]
      .sort((left, right) => order.indexOf(left) - order.indexOf(right))
      .map((id) => labels.get(id) ?? id);
  }, [focusedIds]);

  async function placeScenario(revised: boolean) {
    const api = boardApiRef.current;
    if (!api) return;
    const { convertToExcalidrawElements } = await import("@excalidraw/excalidraw");
    const elements = convertToExcalidrawElements(
      revised ? revisedSkeleton() : initialSkeleton(),
      { regenerateIds: false },
    );
    api.updateScene({
      elements,
      appState: {
        theme: "dark",
        viewBackgroundColor: "#070d1b",
        selectedElementIds: {},
      },
    });
    rawElementsRef.current = elements;
    setFocusedIds([]);
    setScenarioLoaded(true);
    setNotice(
      revised
        ? "Revision placed. Explain the coordination choice, then analyze again."
        : "Regional architecture placed with stable element IDs.",
    );
    if (revised) {
      setReasoningText(
        "I’ll connect both regional counters to one coordinator so a student cannot use the limit twice.",
      );
    }
    frameBoard(api, elements);
  }

  async function sendReasoning() {
    const text = reasoningText.trim();
    if (!text || status !== "idle") return;
    setStatus("sending");
    setError(null);
    try {
      const now = Date.now();
      const segment: TranscriptSegment = {
        id: `transcript-${crypto.randomUUID().replaceAll("-", "")}`,
        sessionId,
        speaker: "candidate",
        source: "text",
        text,
        startedAt: now,
        endedAt: now,
        finalized: true,
      };
      await readApi(
        await fetch(`/api/interviews/${sessionId}/events`, {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({
            type: "transcript.input.finalized",
            segment,
          }),
        }),
      );
      setTranscriptSent(true);
      setNotice("Reasoning captured as finalized transcript evidence.");
      if (payload?.liveEnabled && interactionMode === "voice") {
        void live.sendText(text);
      } else if (payload) {
        const candidateTurnIndex = payload.events.filter(
          (event) => event.type === "transcript.input.finalized",
        ).length;
        const reply = fallbackInterviewerReply(payload.blueprint, candidateTurnIndex);
        if (reply) await persistLiveTranscript("interviewer", reply);
      }
      setReasoningText("");
      await loadSession();
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Could not capture reasoning.");
    } finally {
      setStatus("idle");
    }
  }

  async function createBoardImage() {
    const api = boardApiRef.current;
    if (!api || api.getSceneElements().length === 0) return null;
    const { exportToBlob } = await import("@excalidraw/excalidraw");
    const blob = await exportToBlob({
      elements: api.getSceneElements(),
      files: api.getFiles(),
      appState: {
        ...api.getAppState(),
        exportBackground: true,
        exportWithDarkMode: true,
      },
      maxWidthOrHeight: 1_400,
      mimeType: "image/png",
      exportPadding: 28,
    });
    return {
      dataBase64: await blobToBase64(blob),
      mimeType: "image/png" as const,
      width: 1_400,
      height: 1_000,
    };
  }

  const revealFocusedElements = useCallback(() => {
    const api = boardApiRef.current;
    if (!api || focusedIds.length === 0) return;
    const selectedElementIds = Object.fromEntries(
      focusedIds.map((id) => [id, true] as const),
    ) as Record<string, true>;
    const focusedElements = api
      .getSceneElements()
      .filter((element) => focusedIds.includes(element.id));
    api.updateScene({ appState: { selectedElementIds } });
    if (focusedElements.length > 0) {
      frameBoard(api, focusedElements, true);
    }
  }, [focusedIds]);

  useEffect(() => {
    const revealOnShortcut = (event: KeyboardEvent) => {
      if (event.key.toLowerCase() === "f" && event.altKey && focusedIds.length > 0) {
        event.preventDefault();
        revealFocusedElements();
      }
    };
    window.addEventListener("keydown", revealOnShortcut);
    return () => window.removeEventListener("keydown", revealOnShortcut);
  }, [focusedIds.length, revealFocusedElements]);

  async function analyzeBoard(
    triggerReason = "Candidate paused after a meaningful board change.",
  ) {
    const api = boardApiRef.current;
    if (!api || status !== "idle") return;
    if (!transcriptSent) {
      setError("Send your reasoning first so the analysis can ground its follow-up in transcript evidence.");
      return;
    }
    const raw = api.getSceneElementsIncludingDeleted();
    if (raw.length === 0) {
      setError("Add architecture to the whiteboard before requesting an analysis.");
      return;
    }
    setStatus("analyzing");
    setError(null);
    setNotice("Extracting stable elements and comparing the board with your reasoning…");
    try {
      const scene = normalizeExcalidrawScene(raw, Date.now());
      const boardImage = await createBoardImage();
      const result = await readApi<AnalyzePayload>(
        await fetch(`/api/interviews/${sessionId}/analyze-board`, {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({
            scene,
            diff: createInitialBoardDiff(scene),
            boardImage,
            triggerReason,
          }),
        }),
      );
      setReasoning(result.reasoningState);
      const ids = result.reasoningState.recommendedProbe.focusElementIds;
      setFocusedIds(ids);
      const selectedElementIds = Object.fromEntries(
        ids.map((id) => [id, true] as const),
      ) as Record<string, true>;
      const focusedElements = api
        .getSceneElements()
        .filter((element) => ids.includes(element.id));
      api.updateScene({ appState: { selectedElementIds } });
      if (focusedElements.length > 0) {
        frameBoard(api, focusedElements, true);
      }
      setNotice(
        result.reasoningState.contradictions.length > 0
          ? `Mismatch detected in analysis v${result.analysisVersion}. Exact board evidence is selected.`
          : `Analysis v${result.analysisVersion} recorded the board revision.`,
      );
      lastAnalyzedBoardSignatureRef.current = latestBoardSignatureRef.current;
      await loadSession();
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Could not analyze the board.");
    } finally {
      setStatus("idle");
    }
  }

  const analyzeBoardAfterPause = useEffectEvent(analyzeBoard);

  useEffect(() => {
    if (
      !payload ||
      payload.blueprint.interviewType !== "system-design" ||
      !scenarioLoaded ||
      !boardReady ||
      !transcriptSent ||
      status !== "idle" ||
      automaticAnalysisRef.current ||
      !latestBoardSignatureRef.current ||
      latestBoardSignatureRef.current === lastAnalyzedBoardSignatureRef.current
    ) {
      return;
    }
    automaticAnalysisRef.current = true;
    setNotice("You paused after changing the board. Sapphire is checking the conversation against it.");
    void analyzeBoardAfterPause("Candidate finished a meaningful board edit and paused.")
      .finally(() => {
        automaticAnalysisRef.current = false;
      });
  }, [
    boardIdleVersion,
    boardReady,
    payload,
    scenarioLoaded,
    status,
    transcriptSent,
  ]);

  async function toggleVoice() {
    if (interactionMode !== "voice") return;
    if (payload?.liveEnabled) {
      await (live.isListening ? live.mute() : live.unmute());
      return;
    }
    if (browserVoice.isListening) {
      browserVoice.stop();
      return;
    }
    const seed = transcriptSent ? reasoningText : "";
    if (!transcriptSent) setReasoningText("");
    await browserVoice.start(seed);
  }

  async function selectInteractionMode(nextMode: InteractionMode) {
    if (nextMode === interactionMode) return;
    if (nextMode === "text") {
      if (payload?.liveEnabled && live.isListening) await live.mute();
      if (browserVoice.isListening) browserVoice.stop();
      window.speechSynthesis?.cancel();
    } else {
      lastSpokenTextRef.current = "";
    }
    setInteractionMode(nextMode);
  }

  function playCurrentQuestion() {
    if (!latestInterviewerTurn || !speechOutputSupported) return;
    lastSpokenTextRef.current = latestInterviewerTurn;
    speakText(latestInterviewerTurn);
  }

  async function finishInterview() {
    if (status !== "idle") return;
    setStatus("finishing");
    setError(null);
    try {
      await readApi(
        await fetch(`/api/interviews/${sessionId}/finish`, {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ reason: "Candidate completed the flagship demo sequence." }),
        }),
      );
      router.push(`/interview/${sessionId}/report`);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Could not generate the report.");
      setStatus("idle");
    }
  }

  if (!payload && !error) {
    return <main className={styles.fullState} role="status" aria-live="polite" aria-busy="true">Opening your interview workspace…</main>;
  }

  if (!payload) {
    return (
      <main className={styles.fullState}>
        <Brand />
        <h1>This interview could not be opened.</h1>
        <p>{displayText(error ?? "The interview could not be loaded.")}</p>
        <Link className="button-primary" href="/interview/new">Start a new session</Link>
      </main>
    );
  }

  const voiceListening = payload.liveEnabled ? live.isListening : browserVoice.isListening;
  const voiceAvailable = payload.liveEnabled || browserVoice.supported;
  const voiceError = payload.liveEnabled ? live.error : browserVoice.error;
  const interviewerMode = interactionMode === "text"
    ? "Text conversation"
    : payload.liveEnabled
      ? "Gemini Live voice and transcript"
      : browserVoice.supported
        ? "Voice and transcript"
        : "Spoken interviewer with text replies";

  return (
    <main className={styles.page}>
      <header className={styles.header}>
        <Brand />
        <div className={styles.headerMeta}>
          <span className={styles.roleTitle}>
            {displayText(payload.blueprint.roleTitle)}, {displayText(payload.blueprint.seniority)}
          </span>
          <span className="status-pill">
            <span className="status-dot" />{payload.providerMode === "mock" ? "Deterministic mock" : "Gemini connected"}
          </span>
          <button className="button-quiet" onClick={() => setBoardVisible((visible) => !visible)}>
            {boardVisible ? "Hide board" : "Show board"}
          </button>
          <button className="button-secondary" onClick={finishInterview} disabled={status !== "idle"}>
            {status === "finishing" ? "Building report…" : "Finish & review"}
          </button>
        </div>
      </header>

      <div className={`${styles.workspace} ${boardVisible ? "" : styles.panelOnly}`}>
        {boardVisible && <section className={styles.boardColumn} aria-label="Interview whiteboard">
          <div className={styles.promptBar}>
            <div>
              <h1>{displayText(payload.blueprint.problemStatement)}</h1>
            </div>
            <div className={styles.boardActions}>
              {payload.blueprint.interviewType === "system-design" && <button className="button-secondary" onClick={() => void placeScenario(false)} disabled={!boardReady || status !== "idle"}>
                {scenarioLoaded ? "Reset example board" : "Load example board"}
              </button>}
              {payload.blueprint.interviewType === "system-design" && <button className={styles.revisionButton} onClick={() => void placeScenario(true)} disabled={!boardReady || !contradiction || status !== "idle"}>
                + Add coordination path
              </button>}
            </div>
          </div>
          <div className={styles.canvasShell} data-testid="whiteboard-shell">
            <Excalidraw
              excalidrawAPI={(api) => {
                boardApiRef.current = api;
                setBoardReady(true);
              }}
              onChange={handleBoardChange}
              initialData={{
                appState: {
                  theme: "dark",
                  viewBackgroundColor: "#070d1b",
                  currentItemStrokeColor: "#7ba2ff",
                  currentItemBackgroundColor: "#10234b",
                },
              }}
              theme="dark"
              autoFocus
              UIOptions={{
                canvasActions: {
                  changeViewBackgroundColor: false,
                  clearCanvas: true,
                  export: false,
                  loadScene: false,
                  saveAsImage: false,
                  saveToActiveFile: false,
                  toggleTheme: false,
                },
              }}
            />
            {focusedIds.length > 0 && (
              <button className={styles.focusLegend} onClick={revealFocusedElements} aria-live="polite" title="Reveal focused elements (Alt+F)">
                <span className={styles.focusPulse} />
                Evidence focus: {focusLabels.join(" + ")}
                <kbd>Alt F</kbd>
              </button>
            )}
          </div>
        </section>}

        <aside className={styles.sidePanel} aria-label="Interview evidence panel">
          <section className={styles.interviewerCard}>
            <div className={styles.interviewerHead}>
              <div className={styles.avatar}>S</div>
              <div><strong>Sapphire interviewer</strong><span>{interviewerMode}</span></div>
            </div>
            <div className={styles.modeSwitchWrap}>
              <div className={styles.modeSwitch} role="group" aria-label="Interview conversation mode">
                <button
                  type="button"
                  aria-pressed={interactionMode === "voice"}
                  onClick={() => void selectInteractionMode("voice")}
                >Voice</button>
                <button
                  type="button"
                  aria-pressed={interactionMode === "text"}
                  onClick={() => void selectInteractionMode("text")}
                >Text</button>
              </div>
              <p>{interactionMode === "voice" ? "Sapphire speaks; voice and typed replies both work." : "A quiet text conversation. Switch back to voice anytime."}</p>
            </div>
            {interactionMode === "voice" && <div className={styles.liveControls}>
              <button
                type="button"
                className={voiceListening ? styles.micLive : styles.micMuted}
                onClick={() => void toggleVoice()}
                disabled={!voiceAvailable || (payload.liveEnabled && live.status === "connecting")}
                aria-pressed={voiceListening}
              >
                <span aria-hidden="true">{voiceListening ? "■" : "●"}</span>
                {!voiceAvailable
                  ? "Voice unavailable"
                  : payload.liveEnabled && live.status === "connecting"
                    ? "Connecting voice"
                    : voiceListening
                      ? "Mute microphone"
                      : "Unmute microphone"}
              </button>
              <button
                type="button"
                className={styles.hearButton}
                onClick={playCurrentQuestion}
                disabled={!speechOutputSupported}
              >
                Replay last turn
              </button>
              <p>{voiceListening ? "Listening now" : "Microphone starts muted"}</p>
            </div>}

            <div ref={conversationLogRef} className={styles.conversationLog} aria-label="Interview conversation" aria-live="polite">
              <article className={`${styles.chatMessage} ${styles.assistantMessage}`} aria-label="Interviewer introduction">
                <span>Sapphire</span>
                <p>{displayText(introduction)}</p>
              </article>
              <article className={`${styles.chatMessage} ${styles.assistantMessage}`}>
                <span>Sapphire</span>
                <p>{displayText(openingQuestion)}</p>
              </article>

              {transcriptMessages.map((segment) => (
                <article
                  className={`${styles.chatMessage} ${segment.speaker === "candidate" ? styles.candidateMessage : styles.assistantMessage}`}
                  key={segment.id}
                  aria-label={segment.speaker === "candidate" ? "Candidate message" : "Interviewer message"}
                >
                  <span>{segment.speaker === "candidate" ? "You" : "Sapphire"}</span>
                  <p>{displayText(segment.text)}</p>
                </article>
              ))}

              {lastLiveReply && !hasPersistedLiveReply && (
                <article className={`${styles.chatMessage} ${styles.assistantMessage}`}>
                  <span>Sapphire</span>
                  <p>{displayText(lastLiveReply)}</p>
                </article>
              )}

              {probe?.question && (
                <article
                  className={`${styles.chatMessage} ${styles.assistantMessage} ${styles.followUpMessage}`}
                  data-testid="interviewer-probe"
                >
                  <span>{contradiction ? "Sapphire noticed a mismatch" : "Sapphire follow-up"}</span>
                  <p>{displayText(probe.question)}</p>
                </article>
              )}
            </div>

            <div className={styles.chatComposer}>
              <label htmlFor="candidate-reasoning">Message Sapphire</label>
              <textarea
                id="candidate-reasoning"
                value={reasoningText}
                onChange={(event) => setReasoningText(event.target.value)}
                rows={3}
                maxLength={8_000}
                placeholder="Type your answer"
              />
              <div className={`${styles.responseActions} ${boardVisible ? "" : styles.textOnlyActions}`}>
                <button className="button-primary" onClick={sendReasoning} disabled={!reasoningText.trim() || status !== "idle"}>
                  {status === "sending" ? "Sending…" : "Send message"}
                </button>
                {boardVisible && <button className="button-secondary" onClick={() => void analyzeBoard()} disabled={status !== "idle" || !scenarioLoaded}>
                  {status === "analyzing" ? "Checking board…" : "Analyze now"}
                </button>}
              </div>
            </div>
          </section>

          <section className={styles.evidenceCard}>
            <div className={styles.sectionHeading}>
              <h2 className={styles.panelTitle}>Evidence ledger</h2>
              <small>{payload.events.length} events</small>
            </div>
            {contradiction ? (
              <div className={styles.contradiction}>
                <span>High-confidence mismatch</span>
                <h2>{displayText(contradiction.description)}</h2>
                <p>{displayText(contradiction.whyItMatters)}</p>
                <div className={styles.evidenceTags}>
                  {contradiction.evidence.transcriptSegmentIds.map((id) => <em key={id}>Transcript</em>)}
                  {focusLabels.map((label) => <em key={label}>{label}</em>)}
                </div>
              </div>
            ) : reasoning?.observations.some((item) => item.category === "revision") ? (
              <div className={styles.resolved}>
                <span>Revision recognized</span>
                <h2>The coordination path now connects both regional counters.</h2>
                <p>The report will preserve the original mismatch, interviewer probe, and this board revision.</p>
              </div>
            ) : (
              <p className={styles.emptyEvidence}>No interview evidence has been recorded yet. Sapphire waits for a finalized answer before drawing conclusions.</p>
            )}
          </section>

          {(notice || error || voiceError) && (
            <p className={(error || voiceError) ? styles.error : styles.notice} role={(error || voiceError) ? "alert" : "status"}>
              {displayText(error ?? voiceError ?? notice ?? "")}
            </p>
          )}
          <p className={styles.privacy}>Board images are private session artifacts. Sapphire never stores raw microphone audio. Browser voice may use your browser&apos;s speech service when Gemini Live is off.</p>
        </aside>
      </div>
    </main>
  );
}
