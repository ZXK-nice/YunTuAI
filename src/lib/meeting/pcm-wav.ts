/** 会议实时转写：16 kHz 单声道 PCM → WAV，以及按能量切句。 */

export const LIVE_ASR_SAMPLE_RATE = 16_000;
export const MIN_UTTERANCE_SAMPLES = Math.round(LIVE_ASR_SAMPLE_RATE * 1.6);
export const MAX_UTTERANCE_SAMPLES = LIVE_ASR_SAMPLE_RATE * 6;
export const SILENCE_FLUSH_SAMPLES = Math.round(LIVE_ASR_SAMPLE_RATE * 0.55);
export const SPEECH_RMS_THRESHOLD = 0.018;

export function mixToMono(channels: Float32Array[]): Float32Array {
  const first = channels[0];
  if (!first) return new Float32Array(0);
  if (channels.length === 1) return first.slice();
  const len = first.length;
  const out = new Float32Array(len);
  const n = channels.length;
  for (let i = 0; i < len; i += 1) {
    let sum = 0;
    for (const ch of channels) {
      sum += ch[i] ?? 0;
    }
    out[i] = sum / n;
  }
  return out;
}

export function downsampleTo16k(input: Float32Array, inputRate: number): Float32Array {
  if (input.length === 0) return input;
  if (inputRate === LIVE_ASR_SAMPLE_RATE) return input;
  if (inputRate <= 0) return new Float32Array(0);
  const ratio = inputRate / LIVE_ASR_SAMPLE_RATE;
  const outLen = Math.max(1, Math.floor(input.length / ratio));
  const out = new Float32Array(outLen);
  for (let i = 0; i < outLen; i += 1) {
    const src = i * ratio;
    const i0 = Math.floor(src);
    const i1 = Math.min(i0 + 1, input.length - 1);
    const a = input[i0] ?? 0;
    const b = input[i1] ?? a;
    const frac = src - i0;
    out[i] = a * (1 - frac) + b * frac;
  }
  return out;
}

export function frameRms(frame: Float32Array): number {
  if (frame.length === 0) return 0;
  let sum = 0;
  for (let i = 0; i < frame.length; i += 1) {
    const v = frame[i] ?? 0;
    sum += v * v;
  }
  return Math.sqrt(sum / frame.length);
}

export function encodeWavPcm16le(samples: Float32Array, sampleRate: number): Uint8Array {
  const dataBytes = samples.length * 2;
  const buffer = new ArrayBuffer(44 + dataBytes);
  const view = new DataView(buffer);
  const writeStr = (off: number, s: string) => {
    for (let i = 0; i < s.length; i += 1) {
      view.setUint8(off + i, s.charCodeAt(i) ?? 0);
    }
  };
  writeStr(0, "RIFF");
  view.setUint32(4, 36 + dataBytes, true);
  writeStr(8, "WAVE");
  writeStr(12, "fmt ");
  view.setUint32(16, 16, true);
  view.setUint16(20, 1, true);
  view.setUint16(22, 1, true);
  view.setUint32(24, sampleRate, true);
  view.setUint32(28, sampleRate * 2, true);
  view.setUint16(32, 2, true);
  view.setUint16(34, 16, true);
  writeStr(36, "data");
  view.setUint32(40, dataBytes, true);
  let offset = 44;
  for (let i = 0; i < samples.length; i += 1) {
    const s = Math.max(-1, Math.min(1, samples[i] ?? 0));
    view.setInt16(offset, s < 0 ? s * 0x8000 : s * 0x7fff, true);
    offset += 2;
  }
  return new Uint8Array(buffer);
}

export function wavBytesToBase64(bytes: Uint8Array): string {
  let binary = "";
  const chunk = 0x8000;
  for (let i = 0; i < bytes.length; i += chunk) {
    binary += String.fromCharCode(...bytes.subarray(i, i + chunk));
  }
  return btoa(binary);
}

export type FlushedUtterance = {
  samples: Float32Array;
  startMs: number;
  endMs: number;
  rms: number;
};

/** 按能量切出发言片段，供实时 ASR。 */
export class PcmUtteranceBuffer {
  private buf = new Float32Array(MAX_UTTERANCE_SAMPLES + LIVE_ASR_SAMPLE_RATE);
  private len = 0;
  private trailingSilence = 0;
  private speechSeen = false;
  private startMs: number | null = null;

  reset(): void {
    this.len = 0;
    this.trailingSilence = 0;
    this.speechSeen = false;
    this.startMs = null;
  }

  ingest(frame: Float32Array, nowMs: number): FlushedUtterance | null {
    if (frame.length === 0) return null;
    const rms = frameRms(frame);
    const isSpeech = rms >= SPEECH_RMS_THRESHOLD;
    const frameMs = (frame.length / LIVE_ASR_SAMPLE_RATE) * 1000;

    if (this.len + frame.length > this.buf.length) {
      const flushed = this.speechSeen ? this.flush(nowMs) : null;
      if (!this.speechSeen) this.reset();
      this.append(frame);
      if (isSpeech) {
        this.speechSeen = true;
        this.trailingSilence = 0;
        this.startMs = nowMs - frameMs;
      }
      return flushed;
    }

    this.append(frame);
    if (isSpeech) {
      this.speechSeen = true;
      this.trailingSilence = 0;
      if (this.startMs === null) this.startMs = Math.max(0, nowMs - frameMs);
    } else {
      this.trailingSilence += frame.length;
    }

    if (
      this.speechSeen &&
      this.len >= MIN_UTTERANCE_SAMPLES &&
      this.trailingSilence >= SILENCE_FLUSH_SAMPLES
    ) {
      return this.flush(nowMs);
    }
    if (this.speechSeen && this.len >= MAX_UTTERANCE_SAMPLES) {
      return this.flush(nowMs);
    }
    if (!this.speechSeen && this.len >= MAX_UTTERANCE_SAMPLES) {
      this.reset();
    }
    return null;
  }

  flush(nowMs: number): FlushedUtterance | null {
    if (!this.speechSeen || this.len < MIN_UTTERANCE_SAMPLES / 2) {
      this.reset();
      return null;
    }
    const samples = this.buf.slice(0, this.len);
    const startMs = this.startMs ?? Math.max(0, nowMs - (this.len / LIVE_ASR_SAMPLE_RATE) * 1000);
    const rms = frameRms(samples);
    this.reset();
    return { samples, startMs, endMs: nowMs, rms };
  }

  private append(frame: Float32Array): void {
    this.buf.set(frame, this.len);
    this.len += frame.length;
  }
}
