/** Experimental event adapter. Unknown IME state is a closed gate, not an assumption that composition is idle. */
export interface InputSession {
  select(key: string | null): Promise<void>;
  composition(active: boolean): Promise<void>;
  pause(reason: string): void;
}
export class BodySelectionDriver {
  state: "unknown" | "active" | "idle" = "unknown";
  private generation = 0;
  private timer: ReturnType<typeof setTimeout> | null = null;
  private disposed = false;
  private releasing: Promise<void> | null = null;
  private sampling: Promise<void> | null = null;
  constructor(private session: InputSession, private target: () => Promise<string | null>, private error: (e: unknown) => void, private delay = 120) {
    void session.composition(true).catch(error);
  }
  notify(): void {
    this.generation++;
    if (this.timer) clearTimeout(this.timer);
    if (this.disposed || this.state !== "idle" || this.releasing) return;
    const generation = this.generation;
    this.timer = setTimeout(() => {
      this.timer = null;
      void this.sample(generation).catch(e => {
        this.state = "unknown";
        void this.session.composition(true).catch(this.error);
        this.session.pause("선택 위치를 확인할 수 없어 자동 전환을 멈췄습니다");
        this.error(e);
      });
    }, this.delay);
  }
  async signal(state: "unknown" | "active" | "idle"): Promise<void> {
    if (this.disposed) return;
    // Native health snapshots are not selection changes. Do not re-read Word on repeated idle frames.
    if (state === this.state) return this.releasing ?? undefined;
    this.state = state;
    ++this.generation;
    if (this.timer) { clearTimeout(this.timer); this.timer = null; }
    // Close before reading the latest selection, so releasing composition cannot drain a stale queued target.
    const closed = this.session.composition(true);
    if (state !== "idle") return closed;
    if (this.releasing) { await closed; return this.releasing ?? undefined; }
    this.releasing = this.release(closed).finally(() => { this.releasing = null; });
    return this.releasing;
  }
  private async release(closed: Promise<void>): Promise<void> {
    try {
      await closed;
      while (!this.disposed && this.state === "idle") {
        const generation = this.generation;
        const target = await this.target();
        if (this.disposed || this.state !== "idle") return;
        if (generation !== this.generation) continue;
        await this.session.select(target);
        if (generation !== this.generation) continue;
        if (this.timer) { clearTimeout(this.timer); this.timer = null; }
        await this.session.composition(false);
        return;
      }
    } catch (e) {
      this.state = "unknown";
      this.session.pause("입력 상태를 확인할 수 없어 자동 전환을 멈췄습니다");
      throw e;
    }
  }
  dispose(): void {
    this.disposed = true; this.generation++;
    if (this.timer) clearTimeout(this.timer);
    this.session.pause("본문 이벤트 연결이 종료되었습니다");
  }
  private async sample(generation: number): Promise<void> {
    if (this.sampling) return this.sampling;
    this.sampling = (async () => {
      while (!this.disposed && this.state === "idle" && !this.releasing) {
        const target = await this.target();
        if (this.disposed || this.state !== "idle" || this.releasing) return;
        if (generation !== this.generation) { generation = this.generation; continue; }
        await this.session.select(target); return;
      }
    })().finally(() => { this.sampling = null; });
    return this.sampling;
  }
}
