import { describe, expect, it } from "vitest";

import {
  base64ToPcm16,
  downsampleToPcm16,
  pcm16ToBase64,
} from "@/lib/live/audio";

describe("Gemini Live audio conversion", () => {
  it("downsamples browser float audio to bounded 16 kHz PCM16", () => {
    const source = new Float32Array(48_000);
    source.fill(0.5);

    const result = downsampleToPcm16(source, 48_000);

    expect(result).toHaveLength(16_000);
    expect(result[0]).toBe(16_384);
    expect(result.at(-1)).toBe(16_384);
  });

  it("clips microphone samples before PCM conversion", () => {
    const result = downsampleToPcm16(new Float32Array([2, -2]), 16_000);

    expect(result).toEqual(new Int16Array([32_767, -32_768]));
  });

  it("round-trips little-endian PCM16 through the Live base64 wire format", () => {
    const samples = new Int16Array([-32_768, -1, 0, 1, 32_767]);

    expect(base64ToPcm16(pcm16ToBase64(samples))).toEqual(samples);
  });

  it("rejects invalid sample-rate transformations", () => {
    expect(() => downsampleToPcm16(new Float32Array([0]), 8_000)).toThrow(/upsampled/i);
    expect(() => downsampleToPcm16(new Float32Array([0]), 0)).toThrow(/positive/i);
  });
});
