"use client";

import { useCallback, useEffect, useRef, useState } from "react";

import type { LiveTokenResult } from "@/lib/interview/schemas";
import { base64ToPcm16, downsampleToPcm16 } from "./audio";
import type { LiveClientEvent } from "./client-adapter";
import type { LiveToolResponse } from "./dispatcher";
import { GeminiLiveClientAdapter } from "./gemini-client";

type LiveStatus = "offline" | "connecting" | "muted" | "listening" | "error";

type UseGeminiLiveOptions = {
  sessionId: string;
  enabled: boolean;
  onInputTranscript: (text: string) => Promise<void>;
  onOutputTranscript: (text: string) => Promise<void>;
  onToolCall?: (call: unknown) => Promise<LiveToolResponse>;
};

type TokenEnvelope = { data?: LiveTokenResult; error?: { message?: string } };

export function useGeminiLive(options: UseGeminiLiveOptions) {
  const [status, setStatus] = useState<LiveStatus>("offline");
  const [error, setError] = useState<string | null>(null);
  const adapterRef = useRef<GeminiLiveClientAdapter | null>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const inputContextRef = useRef<AudioContext | null>(null);
  const processorRef = useRef<ScriptProcessorNode | null>(null);
  const outputContextRef = useRef<AudioContext | null>(null);
  const outputCursorRef = useRef(0);
  const outputSourcesRef = useRef(new Set<AudioBufferSourceNode>());
  const callbacksRef = useRef(options);

  useEffect(() => {
    callbacksRef.current = options;
  }, [options]);

  const clearPlayback = useCallback(() => {
    outputSourcesRef.current.forEach((source) => {
      try {
        source.stop();
      } catch {
        // A source that has already ended cannot be stopped twice.
      }
    });
    outputSourcesRef.current.clear();
    outputCursorRef.current = outputContextRef.current?.currentTime ?? 0;
  }, []);

  const playAudio = useCallback((dataBase64: string, sampleRate: number) => {
    const context = outputContextRef.current ?? new AudioContext({ sampleRate });
    outputContextRef.current = context;
    void context.resume();
    const samples = base64ToPcm16(dataBase64);
    if (samples.length === 0) return;
    const buffer = context.createBuffer(1, samples.length, sampleRate);
    const channel = buffer.getChannelData(0);
    for (let index = 0; index < samples.length; index += 1) {
      channel[index] = (samples[index] ?? 0) / 32_768;
    }
    const source = context.createBufferSource();
    source.buffer = buffer;
    source.connect(context.destination);
    const startAt = Math.max(context.currentTime + 0.02, outputCursorRef.current);
    source.start(startAt);
    outputCursorRef.current = startAt + buffer.duration;
    outputSourcesRef.current.add(source);
    source.addEventListener("ended", () => outputSourcesRef.current.delete(source), { once: true });
  }, []);

  const handleEvent = useCallback((event: LiveClientEvent) => {
    switch (event.type) {
      case "audio_output":
        playAudio(event.dataBase64, event.sampleRate);
        break;
      case "input_transcript_final":
        if (event.text) void callbacksRef.current.onInputTranscript(event.text);
        break;
      case "output_transcript_final":
        if (event.text) void callbacksRef.current.onOutputTranscript(event.text);
        break;
      case "tool_call":
        if (callbacksRef.current.onToolCall && adapterRef.current) {
          void callbacksRef.current.onToolCall(event.call).then((response) =>
            adapterRef.current?.sendToolResponse(response),
          );
        }
        break;
      case "interrupted":
        clearPlayback();
        break;
      case "closed":
        setStatus(event.retryable ? "error" : "offline");
        if (event.retryable) setError("The Live connection closed. You can reconnect without losing the text path.");
        break;
      case "error":
        setStatus("error");
        setError("Gemini Live could not continue. Text input still works.");
        break;
      default:
        break;
    }
  }, [clearPlayback, playAudio]);

  const connect = useCallback(async (): Promise<GeminiLiveClientAdapter> => {
    if (!callbacksRef.current.enabled) throw new Error("Gemini Live is not enabled for this server.");
    if (adapterRef.current) return adapterRef.current;
    setStatus("connecting");
    setError(null);
    const response = await fetch("/api/live-token", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ sessionId: callbacksRef.current.sessionId }),
    });
    const body = (await response.json()) as TokenEnvelope;
    if (!response.ok || !body.data) {
      throw new Error(body.error?.message ?? "Could not create a Gemini Live connection.");
    }
    const adapter = new GeminiLiveClientAdapter();
    adapter.subscribe(handleEvent);
    await adapter.connect({
      ephemeralToken: body.data.token,
      model: body.data.model,
    });
    adapterRef.current = adapter;
    setStatus("muted");
    return adapter;
  }, [handleEvent]);

  const stopMicrophone = useCallback(() => {
    processorRef.current?.disconnect();
    processorRef.current = null;
    streamRef.current?.getTracks().forEach((track) => track.stop());
    streamRef.current = null;
    void inputContextRef.current?.close();
    inputContextRef.current = null;
    adapterRef.current?.endAudioStream();
    if (adapterRef.current) setStatus("muted");
  }, []);

  const unmute = useCallback(async () => {
    try {
      const adapter = await connect();
      const stream = await navigator.mediaDevices.getUserMedia({
        audio: { channelCount: 1, echoCancellation: true, noiseSuppression: true },
        video: false,
      });
      const context = new AudioContext();
      const source = context.createMediaStreamSource(stream);
      const processor = context.createScriptProcessor(2_048, 1, 1);
      processor.onaudioprocess = (event) => {
        const samples = event.inputBuffer.getChannelData(0);
        adapter.sendPcm16Audio(downsampleToPcm16(samples, context.sampleRate));
      };
      source.connect(processor);
      processor.connect(context.destination);
      streamRef.current = stream;
      inputContextRef.current = context;
      processorRef.current = processor;
      setStatus("listening");
      setError(null);
    } catch (caught) {
      stopMicrophone();
      setStatus("error");
      setError(caught instanceof Error ? caught.message : "Microphone access could not be started.");
    }
  }, [connect, stopMicrophone]);

  const sendText = useCallback(async (text: string) => {
    if (!callbacksRef.current.enabled) return;
    try {
      const adapter = await connect();
      await adapter.sendText(text);
    } catch (caught) {
      setStatus("error");
      setError(caught instanceof Error ? caught.message : "The typed turn could not reach Gemini Live.");
    }
  }, [connect]);

  useEffect(() => () => {
    processorRef.current?.disconnect();
    streamRef.current?.getTracks().forEach((track) => track.stop());
    void inputContextRef.current?.close();
    void outputContextRef.current?.close();
    void adapterRef.current?.disconnect();
  }, []);

  return {
    status,
    error,
    isListening: status === "listening",
    isConnected: status === "muted" || status === "listening",
    unmute,
    mute: stopMicrophone,
    sendText,
  };
}
