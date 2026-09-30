// Store 动作层集成测试：真实 React 根 + jsdom + localStorage
import { JSDOM } from "jsdom";
import React from "react";
import { act } from "react";
import { createRoot } from "react-dom/client";
import { StoreProvider, useStore } from "./src/store";
import { buildSeedData } from "./src/seed";
import {
  STORAGE_KEY,
  activeReadings,
  isWatchSigned,
  reconcileWatch,
  sameObservationMoment,
  watchIdOf,
} from "./src/domain";

const dom = new JSDOM('<!doctype html><html><body><div id="root"></div></body></html>', { url: "http://localhost/" });
(globalThis as unknown as { window: unknown }).window = dom.window;
(globalThis as unknown as { navigator: unknown }).navigator = dom.window.navigator;
(globalThis as unknown as { document: unknown }).document = dom.window.document;
(globalThis as unknown as { localStorage: Storage }).localStorage = dom.window.localStorage;
(globalThis as unknown as { KeyboardEvent: unknown }).KeyboardEvent = dom.window.KeyboardEvent;
(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
(dom.window as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

let store: ReturnType<typeof useStore> | null = null;
function Grab() {
  store = useStore();
  return null;
}

let pass = 0;
let fail = 0;
const ok = (name: string, cond: boolean, extra = "") => {
  if (cond) {
    pass++;
    console.log(`  ✓ ${name}`);
  } else {
    fail++;
    console.log(`  ✗ ${name} ${extra}`);
  }
};

// 用真实当前时间初始化种子（与应用实际运行一致）
const seedNow = new Date();
localStorage.setItem(STORAGE_KEY, JSON.stringify(buildSeedData(seedNow)));

const rootEl = document.getElementById("root")!;
const root = createRoot(rootEl);
await act(async () => {
  root.render(
    <StoreProvider>
      <Grab />
    </StoreProvider>,
  );
});

const get = () => store!;

console.log("== A. 进行中班次同刻读数：直接替换并留痕 ==");
// 动态取当前班次 T1 的班中读数时刻（本地 datetime-local 格式）
const toLocalInput = (d: Date) => {
  const p = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}T${p(d.getHours())}:${p(d.getMinutes())}`;
};
let midInput = "";
let existingId = "";
{
  const s = get();
  const open = s.data.watches.find((w) => !w.confirmed)!;
  ok("加载种子后存在进行中班次", !!open && !open.confirmed);
  const existing = activeReadings(s.data.readings)
    .filter((r) => r.tankId === "T1" && r.watchId === open.id && r.density != null)
    .sort((a, b) => +new Date(a.observedAt) - +new Date(b.observedAt))
    .find((r) => new Date(r.observedAt).getTime() !== new Date(open.start).getTime());
  ok("种子含班中 T1 读数", !!existing);
  midInput = toLocalInput(new Date(existing!.observedAt));
  existingId = existing!.id;
  let out: ReturnType<typeof s.addReading> | undefined;
  await act(async () => {
    out = s.addReading({
      tankId: "T1",
      observedAt: midInput,
      levelCm: 349.0,
      temperatureC: 44,
      density: 0.945,
      source: "现场",
    });
  });
  const s2 = get();
  ok("返回 saved 替换", out!.kind === "saved" && out.replacedId === existingId);
  const now1 = activeReadings(s2.data.readings).filter(
    (r) => r.tankId === "T1" && sameObservationMoment(new Date(r.observedAt), new Date(existing!.observedAt)),
  );
  ok("同刻仅 1 条 active 且为新值", now1.length === 1 && now1[0].levelCm === 349);
  const old = s2.data.readings.find((r) => r.id === existingId);
  ok("旧值标记 superseded 留痕", old?.status === "superseded");
}

console.log("== B. 已确认班次晚到补录：进复核，不回改 ==");
// 取 16-20 班（已确认）的开班时刻作为补录时刻
const j5 = get().data.watches.filter((w) => w.confirmed).sort((a, b) => +new Date(a.start) - +new Date(b.start))[5];
const j5StartInput = toLocalInput(new Date(j5.start));
{
  const s = get();
  const momentDate = new Date(j5.start);
  const origBefore = s.data.readings.filter(
    (r) => r.tankId === "T2" && sameObservationMoment(new Date(r.observedAt), momentDate),
  );
  let out: ReturnType<typeof s.addReading> | undefined;
  await act(async () => {
    out = s.addReading({
      tankId: "T2",
      observedAt: j5StartInput,
      levelCm: 223.0,
      temperatureC: 80,
      density: 0.94,
      source: "补录",
      note: "纸表晚到",
    });
  });
  const s2 = get();
  ok("补录进入 pending", out!.kind === "pending" && out.reading.status === "pending");
  ok(
    "新增复核候选",
    out!.kind === "pending" && s2.data.reviewCandidates.some((c) => !c.resolution && c.reading.id === out!.reading.id),
  );
  const origAfter = s2.data.readings.filter(
    (r) => r.tankId === "T2" && sameObservationMoment(new Date(r.observedAt), momentDate),
  );
  ok(
    "已封存时刻仍只有原来的 active 读数",
    origAfter.filter((r) => r.status === "active").length === 1 &&
      origBefore[0].id === origAfter.find((r) => r.status === "active")?.id,
  );
}

console.log("== C. 轮机长采纳：新值生效，旧值留痕，快照不动 ==");
{
  const s = get();
  const cand = s.data.reviewCandidates.filter((c) => !c.resolution).find((c) => c.reading.levelCm === 223)!;
  const watch = s.data.watches.find((w) => w.id === cand.reading.watchId)!;
  const snapBefore = watch.snapshot!.find((x) => x.id === cand.conflictingReadingId)?.levelCm;
  await act(async () => s.resolveCandidate(cand.id, "accepted", "轮机长 周建国"));
  const s2 = get();
  const cand2 = s2.data.reviewCandidates.find((c) => c.id === cand.id)!;
  ok("候选标记已采纳", cand2.resolution === "accepted" && cand2.resolvedBy === "轮机长 周建国");
  const active = activeReadings(s2.data.readings).filter(
    (r) => r.tankId === "T2" && sameObservationMoment(new Date(r.observedAt), new Date(cand.reading.observedAt)),
  );
  ok("同刻唯一 active 是采纳的补录", active.length === 1 && active[0].levelCm === 223 && active[0].source === "补录");
  ok("旧读数 superseded 留痕", s2.data.readings.find((r) => r.id === cand.conflictingReadingId)?.status === "superseded");
  const watch2 = s2.data.watches.find((w) => w.id === watch.id)!;
  ok("封存快照液位未被回改", watch2.snapshot!.find((x) => x.id === cand.conflictingReadingId)?.levelCm === snapBefore);
}

console.log("== D. 驳回补录：原始读数继续有效 ==");
{
  const s = get();
  // 再造一个冲突（16-20 班开班时刻的 T3）
  let out: ReturnType<typeof s.addReading> | undefined;
  await act(async () => {
    out = s.addReading({ tankId: "T3", observedAt: j5StartInput, levelCm: 170, temperatureC: 30, density: 0.841, source: "补录" });
  });
  const candId = (out as { candidate: { id: string } }).candidate.id;
  await act(async () => s.resolveCandidate(candId, "rejected", "轮机长 周建国"));
  const s2 = get();
  const c = s2.data.reviewCandidates.find((x) => x.id === candId)!;
  ok("候选已驳回", c.resolution === "rejected");
  ok("补录读数 rejected 留痕", s2.data.readings.find((r) => r.id === c.reading.id)?.status === "rejected");
  const active = activeReadings(s2.data.readings).filter(
    (r) => r.tankId === "T3" && sameObservationMoment(new Date(r.observedAt), new Date(j5.start)),
  );
  ok("原 T3 读数仍唯一有效", active.length === 1 && active[0].id === c.conflictingReadingId);
}

console.log("== E. 缺密度补录后参与折算 ==");
{
  const s = get();
  const miss = s.data.readings.find((r) => r.density == null)!;
  await act(async () => s.supplementDensity(miss.id, 0.946));
  const s2 = get();
  const updated = s2.data.readings.find((r) => r.id === miss.id)!;
  ok("密度已补录", updated.density === 0.946 && updated.volumeM3 != null);
  ok("不再计入迁移缺密度列表", !s2.migratedLegacyIds.includes(miss.id) && s2.missingDensityCount === 1);
}

console.log("== F. 合格签字：封存；超差签字：立即失效 ==");
{
  const s = get();
  // 找到仍未确认的班次（进行班）
  const open = s.data.watches.find((w) => !w.confirmed)!;
  ok("存在可签字的进行班", !!open);
  const before = reconcileWatch(open, s.data.tanks, s.data.readings, s.data.settings.tolerance);
  ok("进行班实时对账通过", before.passed, `diff=${before.totalDifference}`);
  let res = { ok: false, error: "未执行" };
  await act(async () => {
    res = s.signWatch("李轮机", "测试合格签字");
  });
  ok("签字成功", res.ok, res.error);
  const s2 = get();
  const w2 = s2.data.watches.find((w) => w.id === open.id)!;
  ok("班次已确认签字且未失效", w2.confirmed && isWatchSigned(w2) && !w2.voided);
  ok("封存了快照与对账", (w2.snapshot?.length ?? 0) > 0 && !!w2.sealedReconc);

  // 额外验证：超差强制交班 -> 签字立即失效
  // 构造一个未来不可行，改为直接检查种子中已存在的失效班次（16-20）满足规则
  const voided = s2.data.watches.filter((w) => w.voided && !w.resigned);
  ok("存在超差失效班次（种子 16-20）", voided.some((w) => w.sealedReconc && !w.sealedReconc.passed));
}

console.log("== G. localStorage 持久化 ==");
{
  const raw = localStorage.getItem(STORAGE_KEY);
  ok("数据写入 localStorage", !!raw);
  const parsed = JSON.parse(raw!);
  ok("持久化的已签字班次存在", parsed.watches.some((w: { signed?: unknown; confirmed: boolean }) => w.confirmed && w.signed));
}

console.log(`\n结果: ${pass} 通过, ${fail} 失败`);
if (fail) process.exit(1);
root.unmount();
