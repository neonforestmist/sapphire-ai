import { describe, expect, it } from "vitest";

import {
  browserSpeechErrorMessage,
  mergeSpeechTranscript,
} from "@/lib/live/use-browser-voice";

describe("browser voice fallback", () => {
  it("joins an existing draft, finalized speech, and interim speech without awkward spacing", () => {
    expect(
      mergeSpeechTranscript("Existing idea", ["first spoken point", "second point"], "still talking"),
    ).toBe("Existing idea first spoken point second point still talking");
  });

  it("turns browser speech errors into actionable messages", () => {
    expect(browserSpeechErrorMessage("not-allowed")).toMatch(/allow microphone access/i);
    expect(browserSpeechErrorMessage("audio-capture")).toMatch(/microphone/i);
    expect(browserSpeechErrorMessage("network")).toMatch(/speech service/i);
  });
});
