import { buildSeedData } from "./src/seed";
import {
  activeReadings,
  effectiveReconc,
  fmtDT,
  isWatchSigned,
  latestInvalidWatch,
  readingMass,
  reconcileWatch,
  sameObservationMoment,
  watchLabel,
} from "./src/domain";

const d = buildSeedData(new Date("2026-09-30T05:40:00"));
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

console.log("== 1. 种子班次与读数 ==");
const confirmed = d.watches.filter((w) => w.confirmed);
ok("已确认班次 7 个 + 进行中 1 个", confirmed.length === 7 && d.watches.length === 8, `got ${confirmed.length}/${d.watches.length}`);

console.log("\n== 2. 存量折算 ==");
const t1 = d.tanks[0];
const r1 = activeReadings(d.readings).filter((r) => r.tankId === "T1" && r.density != null).sort((a, b) => +new Date(a.observedAt) - +new Date(b.observedAt))[0];
const m1 = readingMass(r1, t1, d.settings.tolerance.thermalPerDegree)!;
console.log(`  T1 b0: level=${r1.levelCm} temp=${r1.temperatureC} density=${r1.density} => ${m1.toFixed(3)} t`);
ok("折算存量为正且与量尺系数同量级", m1 > 30 && m1 < 40);

console.log("\n== 3. 16-20 班对账超差 ==");
const j5 = confirmed.find((w) => watchLabel(w) === "16-20班")!;
const sr = j5.sealedReconc!;
const t2line = sr.lines.find((l) => l.tankId === "T2")!;
console.log(`  T2 实测=${t2line.measuredConsumption} 申报=${t2line.reportedConsumption} 差异=${t2line.difference}`);
ok("T2 单舱差异超过 0.3t", Math.abs(t2line.difference!) > 0.3);
ok("封存对账判定不通过", !sr.passed);
ok("总差异超过 0.5t", sr.totalExceeded);
ok("差异油舱仅含 T2", sr.flaggedTankIds.join() === "T2", sr.flaggedTankIds.join());
ok("该班签字立即失效(voided)", !!j5.voided);
ok("isWatchSigned 对失效班为 false", !isWatchSigned(j5));
ok("原始快照已封存且未被补录改动", (j5.snapshot ?? []).length === 8, `snap=${j5.snapshot?.length}`);
const snapT2End = j5.snapshot!.find((s) => s.tankId === "T2" && new Date(s.observedAt).getTime() === new Date(j5.end).getTime())!;
ok("快照中 T2 班末液位仍为原始 216.8", snapT2End.levelCm === 216.8, `${snapT2End.levelCm}`);

console.log("\n== 4. 其他班次均合格 ==");
for (const w of confirmed) {
  if (w === j5) continue;
  ok(`${watchLabel(w)} 封存对账通过`, !!w.sealedReconc?.passed, `diff=${w.sealedReconc?.totalDifference}`);
  ok(`${watchLabel(w)} 签字有效`, isWatchSigned(w));
}

console.log("\n== 5. 缺密度旧记录迁移 ==");
const legacy = d.readings.filter((r) => r.density == null);
ok("2 条缺密度记录", legacy.length === 2, `n=${legacy.length}`);
ok("迁移 ID 记录一致", legacy.every((r) => d.migratedLegacyIds.includes(r.id)));
ok("缺密度记录折算为 null（不计入对账）", legacy.every((r) => readingMass(r, d.tanks.find((t) => t.id === r.tankId)!, 0.0007) == null));

console.log("\n== 6. 待复核补录（同一观测时刻冲突）==");
const pending = d.reviewCandidates.filter((c) => !c.resolution);
ok("1 条待裁定候选", pending.length === 1);
const cand = pending[0];
ok("候选读数 status=pending 不生效", cand.reading.status === "pending");
const activeAtMoment = activeReadings(d.readings).filter(
  (r) => r.tankId === "T2" && sameObservationMoment(new Date(r.observedAt), new Date(cand.reading.observedAt)),
);
ok("冲突时刻仍只有 1 条 active（原始读数）", activeAtMoment.length === 1 && activeAtMoment[0].id === cand.conflictingReadingId);
ok("pending 读数不进入有效对账", sr.lines.find((l) => l.tankId === "T2")!.endMass === readingMass(activeAtMoment[0], d.tanks[1], 0.0007));

console.log("\n== 7. 复核闭环：采纳补录后失效班可复签 ==");
// 模拟采纳
let readings = d.readings.map((r) => {
  if (r.id === cand.conflictingReadingId) return { ...r, status: "superseded" as const };
  if (r.id === cand.reading.id) return { ...r, status: "active" as const };
  return r;
});
const live = reconcileWatch(j5, d.tanks, readings, d.settings.tolerance);
const t2live = live.lines.find((l) => l.tankId === "T2")!;
console.log(`  采纳后 T2 实测=${t2live.measuredConsumption} 差异=${t2live.difference} 总差异=${live.totalDifference}`);
ok("采纳后 T2 差异回落到允许值内", Math.abs(t2live.difference!) <= 0.3);
ok("采纳后全班对账通过，可复签", live.passed);
const snapStillIntact = j5.snapshot!.find((s) => s.id === cand.conflictingReadingId);
ok("已封存快照保持原始值不回改", !!snapStillIntact && snapStillIntact.levelCm === 216.8);
const oldNow = readings.find((r) => r.id === cand.conflictingReadingId)!;
ok("旧读数留痕为 superseded 但不删除", oldNow.status === "superseded");

console.log("\n== 8. 驳回补录 ==");
const rejected = d.readings.map((r) => (r.id === cand.reading.id ? { ...r, status: "rejected" as const } : r));
const live2 = reconcileWatch(j5, d.tanks, rejected, d.settings.tolerance);
ok("驳回后仍超差（维持签字失效）", !live2.passed);

console.log(`\n结果: ${pass} 通过, ${fail} 失败`);
if (fail) process.exit(1);
