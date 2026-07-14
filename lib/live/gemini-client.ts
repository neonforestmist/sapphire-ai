"use client";

import {
  GoogleGenAI,
  Modality,
  type FunctionResponse,
  type LiveServerMessage,
  type Session,
} from "@google/genai";

import { LIVE_OUTPUT_SAMPLE_RATE, pcm16ToBase64 } from "./audio";
import type {
  LiveClientAdapter,
  LiveClientConnection,
  LiveClientEvent,
} from "./client-adapter";
import type { LiveToolResponse } from "./dispatcher";

function durationToMilliseconds(value: string | undefined): number {
  if (!value) return 0;
  const seconds = Number.parseFloat(value.replace(/s$/, ""));
  return Number.isFinite(seconds) ? Math.max(0, seconds * 1_000) : 0;
}

export class GeminiLiveClientAdapter implements LiveClientAdapter {
  private session: Session | null = null;
  private readonly listeners = new Set<(event: LiveClientEvent) => void>();
  private inputTranscript = "";
  private outputTranscript = "";

  private emit(event: LiveClientEvent) {
    this.listeners.forEach((listener) => listener(event));
  }

  private handleMessage(message: LiveServerMessage) {
    const content = message.serverContent;
    if (content?.inputTranscription?.text) {
      this.inputTranscript += content.inputTranscription.text;
      if (content.inputTranscription.finished) {
        this.emit({ type: "input_transcript_final", text: this.inputTranscript.trim() });
        this.inputTranscript = "";
      }
    }
    if (content?.outputTranscription?.text) {
      this.outputTranscript += content.outputTranscription.text;
      if (content.outputTranscription.finished) {
        this.emit({ type: "output_transcript_final", text: this.outputTranscript.trim() });
        this.outputTranscript = "";
      }
    }
    if (content?.turnComplete) {
      const input = this.inputTranscript.trim();
      const output = this.outputTranscript.trim();
      if (input) this.emit({ type: "input_transcript_final", text: input });
      if (output) this.emit({ type: "output_transcript_final", text: output });
      this.inputTranscript = "";
      this.outputTranscript = "";
    }
    if (content?.interrupted) this.emit({ type: "interrupted" });

    for (const part of content?.modelTurn?.parts ?? []) {
      if (part.inlineData?.data && part.inlineData.mimeType?.startsWith("audio/")) {
        this.emit({
          type: "audio_output",
          dataBase64: part.inlineData.data,
          sampleRate: LIVE_OUTPUT_SAMPLE_RATE,
        });
      }
    }

    for (const call of message.toolCall?.functionCalls ?? []) {
      this.emit({
        type: "tool_call",
        call: { id: call.id, name: call.name, args: call.args ?? {} },
      });
    }

    if (message.goAway) {
      this.emit({
        type: "go_away",
        reconnectByMs: durationToMilliseconds(message.goAway.timeLeft),
      });
    }
    const resumption = message.sessionResumptionUpdate;
    if (resumption?.resumable && resumption.newHandle) {
      this.emit({ type: "resumption_handle", handle: resumption.newHandle });
    }
  }

  async connect(connection: LiveClientConnection): Promise<void> {
    if (this.session) await this.disconnect();
    const client = new GoogleGenAI({
      apiKey: connection.ephemeralToken,
      httpOptions: { apiVersion: "v1alpha" },
    });
    this.session = await client.live.connect({
      model: connection.model,
      callbacks: {
        onmessage: (message) => this.handleMessage(message),
        onerror: () => this.emit({ type: "error", code: "LIVE_SOCKET_ERROR", retryable: true }),
        onclose: (event) => this.emit({ type: "closed", retryable: event.code !== 1000 }),
      },
      config: {
        responseModalities: [Modality.AUDIO],
        inputAudioTranscription: {},
        outputAudioTranscription: {},
        sessionResumption: {
          ...(connection.resumptionHandle ? { handle: connection.resumptionHandle } : {}),
        },
      },
    });
    if (connection.signal) {
      connection.signal.addEventListener("abort", () => void this.disconnect(), { once: true });
    }
  }

  async disconnect(): Promise<void> {
    this.session?.close();
    this.session = null;
    this.inputTranscript = "";
    this.outputTranscript = "";
  }

  sendPcm16Audio(chunk: Int16Array): void {
    this.session?.sendRealtimeInput({
      audio: { data: pcm16ToBase64(chunk), mimeType: "audio/pcm;rate=16000" },
    });
  }

  endAudioStream(): void {
    this.session?.sendRealtimeInput({ audioStreamEnd: true });
  }

  async sendText(text: string): Promise<void> {
    if (!this.session) throw new Error("Gemini Live is not connected.");
    this.session.sendClientContent({ turns: text, turnComplete: true });
  }

  async sendToolResponse(response: LiveToolResponse): Promise<void> {
    if (!this.session) throw new Error("Gemini Live is not connected.");
    this.session.sendToolResponse({ functionResponses: response as FunctionResponse });
  }

  subscribe(listener: (event: LiveClientEvent) => void): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }
}
