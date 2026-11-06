/** Host-independent, experimental single-block source editing. No UI, Word globals or storage assumptions. */
export interface BodyBlock {
  key: string;
  mode: "rendered" | "source";
  text: string;
  html: string;
  style: string;
  revision: string;
}
export interface BodyJournal {
  version: 1;
  key: string;
  originalMarkdown: string;
  originalStyle: string;
  originalRevision: string;
  phase: "opening" | "editing" | "closing" | "closed";
  /** Native host reports the last durable step of an interrupted transition. */
  nativeStage?: "prepared" | "content" | "tagged";
}
export interface BodyCommit {
  mode: "source" | "rendered";
  markdown: string;
  html?: string;
  style: string;
  journal: BodyJournal;
}
export interface BodyPort {
  read(key: string): Promise<BodyBlock | null>;
  journals(): Promise<BodyJournal[]>;
  save(journal: BodyJournal): Promise<void>;
  source(expected: BodyBlock, markdown: string): Promise<void>;
  render(expected: BodyBlock, html: string, style: string): Promise<void>;
  /** A native host owns journaling, mutation, mode and selection inside one checked operation. */
  commit?(expected: BodyBlock, change: BodyCommit): Promise<void>;
}
export interface BodyCodec {
  markdown(html: string): string;
  html(markdown: string): string;
}
/** The cursor moved before a source transition committed. This is cancellation, not a document error. */
export class SelectionMoved extends Error {}

export class BodyEditSession {
  activeKey: string | null = null;
  pausedReason: string | null = null;
  composing = false;
  private desired: string | null = null;
  private generation = 0;
  private handled = 0;
  private running: Promise<void> | null = null;

  constructor(private port: BodyPort, private codec: BodyCodec) {}

  select(key: string | null): Promise<void> {
    this.desired = key;
    this.generation++;
    return this.drain();
  }

  /** A native shell must supply real composition notifications. Office.js does not supply them here. */
  composition(active: boolean): Promise<void> {
    this.composing = active;
    if (!active) this.generation++;
    return this.drain();
  }

  pause(reason: string): void { this.pausedReason = reason; }

  /** Observe undo/deletion without writing metadata and destroying Word's redo history. */
  async reconcile(): Promise<void> {
    if (this.running) await this.running;
    if (!this.activeKey) return;
    const block = await this.port.read(this.activeKey);
    if (!block || block.mode !== "source")
      this.pause("문단이 삭제되었거나 실행 취소로 상태가 바뀌었습니다. 자동 편집을 멈췄습니다");
  }

  async pendingRecovery(): Promise<string[]> {
    if (this.running) await this.running;
    const out: string[] = [];
    for (const journal of await this.port.journals()) {
      const block = await this.port.read(journal.key);
      if (block && (block.mode === "source" || (journal.phase !== "closed" && (!!journal.nativeStage || block.revision !== journal.originalRevision)))) out.push(journal.key);
    }
    return out;
  }

  /** Explicit recovery only. Never recreate a deleted block or infer ownership from matching text. */
  recover(key: string, choice: "current" | "original"): Promise<void> {
    if (this.running) return Promise.reject(new Error("진행 중인 편집이 끝난 뒤 복구하세요"));
    const work = this.recoverNow(key, choice);
    this.running = work.finally(() => { this.running = null; });
    return this.running;
  }

  private async recoverNow(key: string, choice: "current" | "original"): Promise<void> {
    if (this.composing) throw new Error("글자 조합 중에는 복구하지 않습니다");
    this.pause("복구 후 명시적으로 다시 시작해야 합니다");
    const journal = (await this.port.journals()).find(j => j.key === key);
    const block = await this.port.read(key);
    if (!journal || !block) throw new Error("복구할 소스 문단을 안전하게 찾을 수 없습니다");
    if (choice === "current" && (journal.nativeStage === "content" || journal.nativeStage === "prepared"))
      throw new Error("내용 교체 후 모드 기록 전에 중단됐습니다. 원본 복구 또는 수동 확인이 필요합니다");
    if (choice === "current" && block.mode === "rendered") {
      if (journal.phase !== "closing" && block.revision !== journal.originalRevision)
        throw new Error("중단된 전환의 현재 내용을 판단할 수 없습니다. 원본 복구 또는 수동 확인이 필요합니다");
      await this.port.save({...journal, phase: "closed"});
      this.activeKey = null;
      return;
    }
    const markdown = choice === "original" ? journal.originalMarkdown : block.text;
    const html = this.codec.html(markdown);
    if (this.port.commit) await this.port.commit(block, {mode: "rendered", markdown, html, style: journal.originalStyle, journal: {...journal, phase: "closing"}});
    else {
      await this.port.render(block, html, journal.originalStyle);
      await this.port.save({...journal, phase: "closed"});
    }
    this.activeKey = null;
  }

  async resume(): Promise<void> {
    if (this.running) throw new Error("진행 중인 편집이 끝난 뒤 다시 시작하세요");
    if (this.activeKey && (await this.port.read(this.activeKey))?.mode === "source")
      throw new Error("현재 소스 문단을 먼저 복구하세요");
    this.activeKey = null;
    this.pausedReason = null;
    this.generation++;
    return this.drain();
  }

  private drain(): Promise<void> {
    if (this.running) return this.running;
    if (this.pausedReason || this.composing) return Promise.resolve();
    this.running = (async () => {
      while (this.handled < this.generation && !this.pausedReason && !this.composing) {
        const generation = this.generation;
        const target = this.desired;
        let observed: BodyBlock | null = null;
        if (this.activeKey) {
          observed = await this.port.read(this.activeKey);
          if (!observed || observed.mode !== "source") {
            this.pause("문단 삭제 또는 실행 취소로 상태가 바뀌었습니다. 자동 편집을 멈췄습니다");
            break;
          }
        }
        if (this.composing || this.pausedReason) break;
        if (generation !== this.generation) continue;
        // Reuse the verified source snapshot; the port checks its revision immediately before mutation.
        if (observed && this.activeKey !== target) await this.leave(observed);
        if (!this.pausedReason && !this.composing && generation === this.generation && target && target !== this.activeKey) {
          try { await this.enter(target, generation); }
          catch (e) { if (!(e instanceof SelectionMoved)) throw e; }
        }
        this.handled = generation;
      }
    })().catch(e => {
      this.pause((e as Error)?.message ?? String(e));
      throw e;
    }).finally(() => { this.running = null; });
    return this.running;
  }

  private async enter(key: string, generation: number): Promise<void> {
    const block = await this.port.read(key);
    if (!block) throw new Error("선택한 문단을 찾을 수 없습니다");
    if (block.mode !== "rendered") throw new Error("이전에 중단된 소스 문단입니다. 먼저 복구하세요");
    const previous = (await this.port.journals()).find(j => j.key === key);
    if (previous && previous.phase !== "closed" && !(previous.phase === "opening" && block.revision === previous.originalRevision))
      throw new Error("중단된 전환 기록이 있습니다. 먼저 복구하세요");
    const markdown = this.codec.markdown(block.html);
    this.codec.html(markdown); // Validate before journaling or touching the block.
    if (generation !== this.generation || this.composing || this.pausedReason) return;
    const journal: BodyJournal = {version: 1, key, originalMarkdown: markdown, originalStyle: block.style, originalRevision: block.revision, phase: "opening"};
    if (this.port.commit) {
      await this.port.commit(block, {mode: "source", markdown, style: block.style, journal});
      this.activeKey = key;
      return;
    }
    await this.port.save(journal);
    if (generation !== this.generation || this.composing || this.pausedReason) return;
    await this.port.source(block, markdown);
    this.activeKey = key;
    await this.port.save({...journal, phase: "editing"});
  }

  private async leave(block: BodyBlock): Promise<void> {
    const key = block.key;
    const journal = (await this.port.journals()).find(j => j.key === key);
    if (!journal) throw new Error("복구 기록이 없어 자동 변환을 중단했습니다");
    const html = this.codec.html(block.text);
    if (this.composing || this.pausedReason) return;
    if (this.port.commit) {
      await this.port.commit(block, {mode: "rendered", markdown: block.text, html, style: journal.originalStyle, journal: {...journal, phase: "closing"}});
      this.activeKey = null;
      return;
    }
    await this.port.save({...journal, phase: "closing"});
    if (this.composing || this.pausedReason) return;
    await this.port.render(block, html, journal.originalStyle);
    this.activeKey = null;
    await this.port.save({...journal, phase: "closed"});
  }
}
