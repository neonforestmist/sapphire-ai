"use client";

import { useCallback, useEffect, useRef, useState } from "react";

type BrowserSpeechAlternative = Readonly<{ transcript: string }>;

type BrowserSpeechResult = Readonly<{
  isFinal: boolean;
  0?: BrowserSpeechAlternative;
}>;

type BrowserSpeechEvent = Readonly<{
  resultIndex: number;
  results: ArrayLike<BrowserSpeechResult>;
}>;

type BrowserSpeechErrorEvent = Readonly<{ error?: string }>;

type BrowserSpeechRecognition = {
  continuous: boolean;
  interimResults: boolean;
  lang: string;
  onresult: ((event: BrowserSpeechEvent) => void) | null;
  onerror: ((event: BrowserSpeechErrorEvent) => void) | null;
  onend: (() => void) | null;
  start(): void;
  stop(): void;
  abort(): void;
};

type BrowserSpeechRecognitionConstructor = new () => BrowserSpeechRecognition;

declare global {
  interface Window {
    SpeechRecognition?: BrowserSpeechRecognitionConstructor;
    webkitSpeechRecognition?: BrowserSpeechRecognitionConstructor;
  }
}

type BrowserVoiceStatus = "checking" | "idle" | "listening" | "unsupported" | "error";

export function mergeSpeechTranscript(
  seed: string,
  finalParts: readonly string[],
  interim: string,
): string {
  return [seed.trim(), ...finalParts.map((part) => part.trim()), interim.trim()]
    .filter(Boolean)
    .join(" ");
}

export function browserSpeechErrorMessage(code: string | undefined): string {
  switch (code) {
    case "not-allowed":
    case "service-not-allowed":
      return "Microphone permission was denied. Allow microphone access and try again.";
    case "audio-capture":
      return "No working microphone was found.";
    case "network":
      return "Browser voice recognition could not reach its speech service.";
    case "no-speech":
      return "No speech was detected. Try again when you are ready.";
    default:
      return "Browser voice recognition could not continue.";
  }
}

export function useBrowserVoice(options: {
  onDraft: (text: string) => void;
  onFinalTranscript: (text: string) => Promise<void>;
}) {
  const [status, setStatus] = useState<BrowserVoiceStatus>("checking");
  const [error, setError] = useState<string | null>(null);
  const recognitionRef = useRef<BrowserSpeechRecognition | null>(null);
  const callbacksRef = useRef(options);

  useEffect(() => {
    callbacksRef.current = options;
  }, [options]);

  useEffect(() => {
    const timer = window.setTimeout(() => {
      const Recognition = window.SpeechRecognition ?? window.webkitSpeechRecognition;
      setStatus(Recognition ? "idle" : "unsupported");
    }, 0);
    return () => {
      window.clearTimeout(timer);
      recognitionRef.current?.abort();
    };
  }, []);

  const start = useCallback(async (seed = "") => {
    const Recognition = window.SpeechRecognition ?? window.webkitSpeechRecognition;
    if (!Recognition) {
      setStatus("unsupported");
      setError("Browser voice input is unavailable here. Use Chrome or configure Gemini Live.");
      return;
    }
    recognitionRef.current?.abort();
    const recognition = new Recognition();
    const finalParts: string[] = [];
    recognition.continuous = true;
    recognition.interimResults = true;
    recognition.lang = document.documentElement.lang || navigator.language || "en-US";
    recognition.onresult = (event) => {
      let interim = "";
      for (let index = event.resultIndex; index < event.results.length; index += 1) {
        const result = event.results[index];
        const transcript = result?.[0]?.transcript.trim() ?? "";
        if (!transcript) continue;
        if (result?.isFinal) {
          finalParts.push(transcript);
          void callbacksRef.current.onFinalTranscript(transcript);
        } else {
          interim = `${interim} ${transcript}`.trim();
        }
      }
      callbacksRef.current.onDraft(mergeSpeechTranscript(seed, finalParts, interim));
    };
    recognition.onerror = (event) => {
      setError(browserSpeechErrorMessage(event.error));
      setStatus("error");
    };
    recognition.onend = () => {
      recognitionRef.current = null;
      setStatus((current) => current === "error" ? current : "idle");
    };
    recognitionRef.current = recognition;
    setError(null);
    setStatus("listening");
    recognition.start();
  }, []);

  const stop = useCallback(() => {
    recognitionRef.current?.stop();
    recognitionRef.current = null;
    setStatus((current) => current === "unsupported" ? current : "idle");
  }, []);

  return {
    status,
    error,
    supported: status !== "checking" && status !== "unsupported",
    isListening: status === "listening",
    start,
    stop,
  };
}
