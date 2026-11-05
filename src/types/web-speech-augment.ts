/** Web Speech API — TypeScript DOM 库不包含本接口时在此处补齐最小形状 */

export {};

declare global {
  interface WebSpeechRecoResultAlternative {
    readonly transcript?: string;
  }

  interface WebSpeechRecoResultLine {
    readonly 0?: WebSpeechRecoResultAlternative;
    readonly length?: number;
    readonly isFinal?: boolean;
  }

  interface WebSpeechRecoErrorEvent {
    readonly error?: string;
    readonly message?: string;
  }

  interface WebSpeechRecoResultsList {
    readonly length: number;
    [index: number]: WebSpeechRecoResultLine;
  }

  interface WebSpeechRecoEvent {
    readonly resultIndex: number;
    readonly results: WebSpeechRecoResultsList;
  }

  interface WebSpeechReco {
    lang: string;
    continuous: boolean;
    interimResults: boolean;
    onresult: ((ev: WebSpeechRecoEvent) => void) | null;
    onerror: ((ev: WebSpeechRecoErrorEvent) => void) | null;
    onend: (() => void) | null;
    start(): void;
    stop(): void;
  }

  interface Window {
    SpeechRecognition?: new () => WebSpeechReco;
    webkitSpeechRecognition?: new () => WebSpeechReco;
  }
}
