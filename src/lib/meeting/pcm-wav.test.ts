import { describe, expect, it } from "vitest";
import {
  downsampleTo16k,
  encodeWavPcm16le,
  frameRms,
  LIVE_ASR_SAMPLE_RATE,
  MAX_UTTERANCE_SAMPLES,
  mixToMono,
  PcmUtteranceBuffer,
  SPEECH_RMS_THRESHOLD,
} from "./pcm-wav";

function tone(n: number, amp = 0.3): Float32Array {
  const out = new Float32Array(n);
  for (let i = 0; i < n; i += 1) {
    out[i] = Math.sin((i / n) * Math.PI * 8) * amp;
  }
  return out;
}

function silence(n: number): Float32Array {
  return new Float32Array(n);
}

describe("pcm-wav", () => {
  it("mixes stereo to mono", () => {
    const left = new Float32Array([1, 0.5]);
    const right = new Float32Array([-1, 0.5]);
    const mono = mixToMono([left, right]);
    expect(Array.from(mono)).toEqual([0, 0.5]);
  });

  it("downsamples 48 kHz to 16 kHz", () => {
    const input = new Float32Array(4800);
    for (let i = 0; i < input.length; i += 1) input[i] = i;
    const out = downsampleTo16k(input, 48_000);
    expect(out.length).toBe(1600);
    expect(out[0]).toBe(0);
  });

  it("writes a valid PCM WAV header", () => {
    const samples = tone(1600, 0.2);
    const wav = encodeWavPcm16le(samples, LIVE_ASR_SAMPLE_RATE);
    const ascii = String.fromCharCode(...wav.subarray(0, 12));
    expect(ascii.startsWith("RIFF")).toBe(true);
    expect(ascii.endsWith("WAVE")).toBe(true);
    expect(wav.length).toBe(44 + samples.length * 2);
    const view = new DataView(wav.buffer, wav.byteOffset, wav.byteLength);
    expect(view.getUint16(22, true)).toBe(1);
    expect(view.getUint32(24, true)).toBe(LIVE_ASR_SAMPLE_RATE);
  });

  it("flushes after speech followed by silence", () => {
    const buf = new PcmUtteranceBuffer();
    const speechFrame = tone(800, 0.4);
    expect(frameRms(speechFrame)).toBeGreaterThan(SPEECH_RMS_THRESHOLD);
    let flushed = null;
    let t = 0;
    for (let i = 0; i < 40; i += 1) {
      t += (speechFrame.length / LIVE_ASR_SAMPLE_RATE) * 1000;
      flushed = buf.ingest(speechFrame, t) ?? flushed;
    }
    const quiet = silence(800);
    for (let i = 0; i < 20; i += 1) {
      t += (quiet.length / LIVE_ASR_SAMPLE_RATE) * 1000;
      const hit = buf.ingest(quiet, t);
      if (hit) flushed = hit;
    }
    expect(flushed).not.toBeNull();
    expect(flushed?.samples.length ?? 0).toBeGreaterThan(1000);
  });

  it("discards long silence without speech", () => {
    const buf = new PcmUtteranceBuffer();
    const quiet = silence(1000);
    let flushed = null;
    let t = 0;
    const frames = Math.ceil(MAX_UTTERANCE_SAMPLES / quiet.length) + 2;
    for (let i = 0; i < frames; i += 1) {
      t += 100;
      flushed = buf.ingest(quiet, t) ?? flushed;
    }
    expect(flushed).toBeNull();
  });
});
