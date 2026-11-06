import type {BodySelectionDriver} from "./selection-driver";

export interface NativeImeSignal { epoch: string; seq: number; state: "unknown" | "active" | "idle"; snapshot?: boolean; selection?: number; selectionSupported?: boolean; }

/** Transport-neutral connection to a scoped native observer. A disconnect/gap never means input ended. */
export class NativeImeConnection {
  private sequence: number | null = null;
  private timer: ReturnType<typeof setTimeout> | null = null;
  private closed = false;
  private selection: number | null = null;
  constructor(private driver: Pick<BodySelectionDriver, "signal">, private epoch: string, private error: (e: unknown) => void, private timeout = 2500, private selectionChanged?: () => void) {}

  receive(value: unknown): void {
    if (this.closed) return;
    const signal = value as Partial<NativeImeSignal> | null;
    if (!signal || signal.epoch !== this.epoch || !Number.isSafeInteger(signal.seq) || signal.seq! < 1
      || !["unknown", "active", "idle"].includes(signal.state ?? "")) { this.disconnect(); return; }
    if (this.sequence !== null && signal.seq! <= this.sequence) return; // Duplicate frames must not extend liveness.
    if ((this.sequence === null && signal.snapshot !== true) || (this.sequence !== null && signal.seq !== this.sequence + 1)) { this.disconnect(); return; }
    if(this.selectionChanged && (signal.selectionSupported!==true || !Number.isSafeInteger(signal.selection) || signal.selection!<0 || (this.selection!==null && signal.selection!<this.selection))){
      this.disconnect();this.error(new Error("네이티브 선택 이벤트를 신뢰할 수 없어 전환을 멈췄습니다"));return;
    }
    this.sequence = signal.seq!;
    if (this.timer) clearTimeout(this.timer);
    this.timer = setTimeout(() => { this.timer = null; this.send("unknown"); }, this.timeout);
    this.send(signal.state!);
    if(this.selectionChanged && signal.selection!==this.selection){
      this.selection=signal.selection!;
      try{this.selectionChanged();}catch(e){this.disconnect();this.error(e);}
    }
  }
  disconnect(): void {
    if (this.closed) return;
    this.closed = true;
    if (this.timer) clearTimeout(this.timer);
    this.timer = null;
    this.send("unknown");
  }
  private send(state: NativeImeSignal["state"]): void {
    void this.driver.signal(state).catch(e => { this.disconnect(); this.error(e); });
  }
}
