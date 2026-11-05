import { ensureVoiceInputReady } from "../chat/voice-input";
import { pushMeetingAudioChunk, transcribeMeetingLiveChunk } from "./meeting-bridge";
import {
  downsampleTo16k,
  encodeWavPcm16le,
  LIVE_ASR_SAMPLE_RATE,
  mixToMono,
  PcmUtteranceBuffer,
  wavBytesToBase64,
  type FlushedUtterance,
} from "./pcm-wav";

export type MeetingCaptureCallbacks = {
  onSegment: (seg: { text: string; startMs: number; endMs: number; rms: number }) => void;
  onError: (message: string, hint?: string) => void;
};

export type MeetingCaptureSession = {
  stop: () => Promise<void>;
  pause: () => void;
  resume: () => void;
  isPaused: () => boolean;
};

function readAnalyserRms(analyser: AnalyserNode): number {
  const data = new Uint8Array(analyser.fftSize);
  analyser.getByteTimeDomainData(data);
  let sum = 0;
  for (let i = 0; i < data.length; i += 1) {
    const sample = data[i] ?? 128;
    const v = (sample - 128) / 128;
    sum += v * v;
  }
  return Math.sqrt(sum / data.length);
}

async function blobToBase64(blob: Blob): Promise<string> {
  const buffer = await blob.arrayBuffer();
  let binary = "";
  const bytes = new Uint8Array(buffer);
  const chunk = 0x8000;
  for (let i = 0; i < bytes.length; i += chunk) {
    binary += String.fromCharCode(...bytes.subarray(i, i + chunk));
  }
  return btoa(binary);
}

function captureElapsedMs(startAt: number, totalPausedMs: number): number {
  return Math.max(0, Date.now() - startAt - totalPausedMs);
}

/**
 * 会中采集：MediaRecorder 落盘 + Windows 本机分片 ASR（System.Speech）。
 * 不使用 Web Speech API：WebView2 没有 Chrome 的在线识别密钥，会误报 network。
 */
export async function startMeetingCapture(
  sessionId: string,
  callbacks: MeetingCaptureCallbacks,
): Promise<MeetingCaptureSession> {
  const ready = await ensureVoiceInputReady({ skipCache: true, requireSpeechApi: false });
  if (!ready.ok) {
    throw new Error(ready.hint ? `${ready.message}\n${ready.hint}` : ready.message);
  }

  const stream = await navigator.mediaDevices.getUserMedia({
    audio: {
      channelCount: 1,
      echoCancellation: true,
      noiseSuppression: true,
      autoGainControl: true,
    },
  });
  const audioCtx = new AudioContext();
  if (audioCtx.state === "suspended") {
    await audioCtx.resume();
  }
  const source = audioCtx.createMediaStreamSource(stream);
  const analyser = audioCtx.createAnalyser();
  analyser.fftSize = 2048;
  source.connect(analyser);

  if (typeof audioCtx.createScriptProcessor !== "function") {
    stream.getTracks().forEach((t) => t.stop());
    await audioCtx.close();
    throw new Error("当前环境无法采集音频波形，无法启动实时转写");
  }
  const processor = audioCtx.createScriptProcessor(4096, 1, 1);
  const mute = audioCtx.createGain();
  mute.gain.value = 0;
  source.connect(processor);
  processor.connect(mute);
  mute.connect(audioCtx.destination);

  const mimeType = MediaRecorder.isTypeSupported("audio/webm;codecs=opus")
    ? "audio/webm;codecs=opus"
    : MediaRecorder.isTypeSupported("audio/webm")
      ? "audio/webm"
      : "";
  const recorder = mimeType ? new MediaRecorder(stream, { mimeType }) : new MediaRecorder(stream);
  const audioChunks: Blob[] = [];
  const startAt = Date.now();
  let stopped = false;
  let paused = false;
  let pauseStartedAt = 0;
  let totalPausedMs = 0;
  const utterance = new PcmUtteranceBuffer();
  let lastErrorAt = 0;
  let lastErrorKey = "";
  let transcribeChain = Promise.resolve();

  const reportError = (message: string, hint?: string) => {
    const key = `${message}\n${hint ?? ""}`;
    const now = Date.now();
    if (key === lastErrorKey && now - lastErrorAt < 45_000) return;
    lastErrorKey = key;
    lastErrorAt = now;
    callbacks.onError(message, hint);
  };

  const enqueueUtterance = (flushed: FlushedUtterance) => {
    const wav = encodeWavPcm16le(flushed.samples, LIVE_ASR_SAMPLE_RATE);
    const wavBase64 = wavBytesToBase64(wav);
    const startMs = flushed.startMs;
    const endMs = flushed.endMs;
    const rms = flushed.rms;
    transcribeChain = transcribeChain.then(async () => {
      try {
        const text = (await transcribeMeetingLiveChunk(sessionId, wavBase64)).trim();
        if (!text) return;
        callbacks.onSegment({
          text,
          startMs,
          endMs,
          rms: rms > 0 ? rms : readAnalyserRms(analyser),
        });
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        reportError(
          "实时转写失败",
          msg || "请安装 Windows 中文语音包：设置 → 时间和语言 → 语音 → 中文（简体）→ 语音识别。",
        );
      }
    });
  };

  recorder.ondataavailable = (ev) => {
    if (ev.data && ev.data.size > 0) {
      audioChunks.push(ev.data);
    }
  };

  recorder.start(5000);

  processor.onaudioprocess = (ev) => {
    if (stopped || paused) return;
    const input = ev.inputBuffer;
    const channels: Float32Array[] = [];
    for (let c = 0; c < input.numberOfChannels; c += 1) {
      channels.push(input.getChannelData(c));
    }
    const mono = mixToMono(channels);
    const pcm16k = downsampleTo16k(mono, audioCtx.sampleRate || LIVE_ASR_SAMPLE_RATE);
    const flushed = utterance.ingest(pcm16k, captureElapsedMs(startAt, totalPausedMs));
    if (flushed) enqueueUtterance(flushed);
  };

  return {
    stop: async () => {
      stopped = true;
      const leftover = utterance.flush(captureElapsedMs(startAt, totalPausedMs));
      if (leftover) enqueueUtterance(leftover);
      processor.onaudioprocess = null;
      try {
        processor.disconnect();
        mute.disconnect();
      } catch {
        /* ignore */
      }
      if (recorder.state !== "inactive") {
        await new Promise<void>((resolve) => {
          recorder.onstop = () => resolve();
          recorder.stop();
        });
      }
      stream.getTracks().forEach((t) => t.stop());
      await audioCtx.close();

      try {
        await Promise.race([
          transcribeChain,
          new Promise<void>((resolve) => {
            window.setTimeout(resolve, 50_000);
          }),
        ]);
      } catch {
        /* 已在 enqueue 内提示 */
      }

      if (audioChunks.length > 0) {
        try {
          const blob = new Blob(audioChunks, { type: recorder.mimeType || "audio/webm" });
          const base64 = await blobToBase64(blob);
          await pushMeetingAudioChunk(sessionId, base64);
        } catch (err) {
          const msg = err instanceof Error ? err.message : String(err);
          callbacks.onError("录音保存失败", msg);
        }
      }
    },
    pause: () => {
      if (stopped || paused) return;
      paused = true;
      pauseStartedAt = Date.now();
      const leftover = utterance.flush(captureElapsedMs(startAt, totalPausedMs));
      if (leftover) enqueueUtterance(leftover);
      if (recorder.state === "recording") {
        recorder.pause();
      }
    },
    resume: () => {
      if (stopped || !paused) return;
      totalPausedMs += Date.now() - pauseStartedAt;
      paused = false;
      utterance.reset();
      if (recorder.state === "paused") {
        recorder.resume();
      }
    },
    isPaused: () => paused,
  };
}
