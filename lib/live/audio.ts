export const LIVE_INPUT_SAMPLE_RATE = 16_000;
export const LIVE_OUTPUT_SAMPLE_RATE = 24_000;

export function downsampleToPcm16(
  input: Float32Array,
  sourceSampleRate: number,
  targetSampleRate = LIVE_INPUT_SAMPLE_RATE,
): Int16Array {
  if (!Number.isFinite(sourceSampleRate) || sourceSampleRate <= 0) {
    throw new Error("The source sample rate must be positive.");
  }
  if (!Number.isFinite(targetSampleRate) || targetSampleRate <= 0) {
    throw new Error("The target sample rate must be positive.");
  }
  if (targetSampleRate > sourceSampleRate) {
    throw new Error("Microphone audio must not be upsampled.");
  }

  const ratio = sourceSampleRate / targetSampleRate;
  const outputLength = Math.max(1, Math.floor(input.length / ratio));
  const output = new Int16Array(outputLength);

  for (let outputIndex = 0; outputIndex < outputLength; outputIndex += 1) {
    const start = Math.floor(outputIndex * ratio);
    const end = Math.min(input.length, Math.floor((outputIndex + 1) * ratio));
    let sum = 0;
    const sampleCount = Math.max(1, end - start);
    for (let inputIndex = start; inputIndex < end; inputIndex += 1) {
      sum += input[inputIndex] ?? 0;
    }
    const normalized = Math.max(-1, Math.min(1, sum / sampleCount));
    output[outputIndex] = Math.round(normalized * (normalized < 0 ? 32_768 : 32_767));
  }

  return output;
}
export function pcm16ToBase64(samples: Int16Array): string {
  const bytes = new Uint8Array(samples.length * 2);
  const view = new DataView(bytes.buffer);
  samples.forEach((sample, index) => view.setInt16(index * 2, sample, true));

  let binary = "";
  const chunkSize = 0x8000;
  for (let offset = 0; offset < bytes.length; offset += chunkSize) {
    binary += String.fromCharCode(...bytes.subarray(offset, offset + chunkSize));
  }
  return btoa(binary);
}

export function base64ToPcm16(data: string): Int16Array {
  const binary = atob(data);
  const sampleCount = Math.floor(binary.length / 2);
  const output = new Int16Array(sampleCount);
  for (let index = 0; index < sampleCount; index += 1) {
    const low = binary.charCodeAt(index * 2);
    const high = binary.charCodeAt(index * 2 + 1);
    const unsigned = low | (high << 8);
    output[index] = unsigned >= 0x8000 ? unsigned - 0x10000 : unsigned;
  }
  return output;
}
