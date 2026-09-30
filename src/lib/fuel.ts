import type {
  Reading,
  ReconcileSnapshot,
  Tank,
  TankMovement,
  Shift,
} from "../types";

/** 燃油体积温度系数（残渣燃料油近似） */
export const ALPHA = 0.00075;
/** 标准参考温度 ℃ */
export const REF_TEMP = 15;

export const round2 = (n: number) => Math.round(n * 100) / 100;
export const round3 = (n: number) => Math.round(n * 1000) / 1000;

/** 体积修正系数 VCF：观测温度体积 -> 15℃ 标准体积（石油表近似公式） */
export function vcf(temp: number): number {
  const dt = temp - REF_TEMP;
  return Math.exp(-ALPHA * dt * (1 + 0.8 * ALPHA * dt));
}

/** 舱容表插值：液位 cm -> 观测体积 m³ */
export function volumeAt(tank: Tank, level: number): number {
  const table = tank.table;
  if (level <= table[0].level) return table[0].volume;
  for (let i = 0; i < table.length - 1; i++) {
    const a = table[i];
    const b = table[i + 1];
    if (level <= b.level) {
      const r = (level - a.level) / (b.level - a.level);
      return a.volume + r * (b.volume - a.volume);
    }
  }
  return table[table.length - 1].volume;
}

export interface StockCalc {
  vt: number; // 观测体积 m³
  v15: number; // 标准体积 m³
  rho15: number; // 标准密度 t/m³（15℃）
  mass: number; // 折算存量 t（空气中重量）
}

/** 由液位 / 温度 / 密度折算存量 */
export function calcStock(
  tank: Tank,
  level: number,
  temp: number,
  density: number
): StockCalc {
  const vt = volumeAt(tank, level);
  const f = vcf(temp);
  return {
    vt: round3(vt),
    v15: round3(vt * f),
    rho15: round3(density / f),
    mass: round3(vt * density),
  };
}

export function stockOf(tank: Tank, r: Reading): StockCalc | null {
  if (r.level == null || r.temp == null || r.density == null) return null;
  return calcStock(tank, r.level, r.temp, r.density);
}

export function massOf(tank: Tank, r: Reading): number | null {
  return stockOf(tank, r)?.mass ?? null;
}

export function sameMinute(a: string, b: string): boolean {
  const da = new Date(a);
  const db = new Date(b);
  return (
    da.getFullYear() === db.getFullYear() &&
    da.getMonth() === db.getMonth() &&
    da.getDate() === db.getDate() &&
    da.getHours() === db.getHours() &&
    da.getMinutes() === db.getMinutes()
  );
}

export function within(iso: string, startIso: string, endIso: string): boolean {
  const t = new Date(iso).getTime();
  return t >= new Date(startIso).getTime() && t <= new Date(endIso).getTime();
}

/** 某油舱在某时刻及之前的最近一条有效读数 */
export function latestValidAtOrBefore(
  readings: Reading[],
  tankId: string,
  atIso: string
): Reading | null {
  const limit = new Date(atIso).getTime();
  let best: Reading | null = null;
  for (const r of readings) {
    if (r.tankId !== tankId || r.state !== "valid") continue;
    const t = new Date(r.observedAt).getTime();
    if (t > limit) continue;
    if (!best || t > new Date(best.observedAt).getTime()) best = r;
  }
  return best;
}

/** 某油舱在某时刻及之后的最早一条有效读数 */
export function earliestValidAtOrAfter(
  readings: Reading[],
  tankId: string,
  atIso: string
): Reading | null {
  const limit = new Date(atIso).getTime();
  let best: Reading | null = null;
  for (const r of readings) {
    if (r.tankId !== tankId || r.state !== "valid") continue;
    const t = new Date(r.observedAt).getTime();
    if (t < limit) continue;
    if (!best || t < new Date(best.observedAt).getTime()) best = r;
  }
  return best;
}

export interface ReconcileResult {
  movements: TankMovement[];
  tankDiff: number;
  meter: number;
  diff: number;
  diffRate: number;
  passed: boolean;
  blocked: boolean;
  differential: ReconcileSnapshot["differential"];
}

/**
 * 班次对账：油耗取相邻两次实测差（期初存量 - 期末存量），
 * 与油耗表本班消耗量比较；缺密度 / 待复核未处理则阻塞对账。
 */
export function reconcile(
  shift: Shift,
  tanks: Tank[],
  readings: Reading[]
): ReconcileResult {
  const movements: TankMovement[] = [];
  const differential: ReconcileSnapshot["differential"] = [];

  for (const tank of tanks) {
    const opening = latestValidAtOrBefore(readings, tank.id, shift.startAt);
    const closing = latestValidAtOrBefore(readings, tank.id, shift.endAt);

    const blockers: string[] = [];
    let anomaly: string | null = null;

    if (!opening) blockers.push("期初无有效读数");
    if (!closing) blockers.push("期末无有效读数（缺密度或待复核）");

    // 期初 / 期末边界存在同时刻待复核读数 -> 未取唯一有效值
    const openingTime = opening?.observedAt ?? shift.startAt;
    const closingTime = closing?.observedAt ?? shift.endAt;
    const boundaryDup =
      readings.some(
        (r) =>
          r.tankId === tank.id &&
          r.state === "pending_review" &&
          sameMinute(r.observedAt, closingTime)
      ) ||
      readings.some(
        (r) =>
          r.tankId === tank.id &&
          r.state === "pending_review" &&
          sameMinute(r.observedAt, openingTime)
      );
    if (boundaryDup)
      blockers.push(
        `交接班边界存在待复核读数，未取唯一有效值`
      );

    // 班内存在缺密度待补录记录
    const pendingDensity = readings.filter(
      (r) =>
        r.tankId === tank.id &&
        r.state === "pending_density" &&
        within(r.observedAt, shift.startAt, shift.endAt)
    );
    if (pendingDensity.length)
      blockers.push(`${pendingDensity.length} 条记录缺密度待补录`);

    const openingMass = opening ? massOf(tank, opening) : null;
    const closingMass = closing ? massOf(tank, closing) : null;
    const diff =
      openingMass != null && closingMass != null
        ? round2(openingMass - closingMass)
        : null;

    if (diff != null && diff < -0.05)
      anomaly = `本班存量增加 ${round2(-diff)}t，无接收记录`;
    else if (diff != null && diff > tank.capacity)
      anomaly = `实测消耗 ${diff}t 超过舱容，读数异常`;

    movements.push({
      tankId: tank.id,
      opening,
      closing,
      openingMass,
      closingMass,
      diff,
      blockers,
      anomaly,
    });

    if (blockers.length)
      differential.push({ tankId: tank.id, reason: blockers[0], level: "error" });
    else if (anomaly)
      differential.push({ tankId: tank.id, reason: anomaly, level: "error" });
  }

  const tankDiff = round2(
    movements.reduce((s, m) => s + (m.diff ?? 0), 0)
  );
  const meter = shift.meterConsumption ?? 0;
  const diff = round2(tankDiff - meter);
  const diffRate = meter > 0 ? round3(diff / meter) : 0;
  const blocked = differential.some((d) => d.level === "error");
  const passed = !blocked && Math.abs(diff) <= shift.allowableDiff;

  // 总差异超允许值：列出各差异油舱（实测差涉及舱室）
  if (!passed && !blocked) {
    for (const m of movements) {
      if (m.diff != null)
        differential.push({
          tankId: m.tankId,
          reason: `实测差 ${m.diff}t，合计与油耗表差异 ${diff}t（允许 ${shift.allowableDiff}t）`,
          level: "warn",
        });
    }
  }

  return { movements, tankDiff, meter, diff, diffRate, passed, blocked, differential };
}

/** 由对账结果生成冻结快照（已确认班次原始读数不再随补录改变） */
export function snapshot(
  shift: Shift,
  tanks: Tank[],
  readings: Reading[]
): ReconcileSnapshot {
  const r = reconcile(shift, tanks, readings);
  return {
    at: new Date().toISOString(),
    meterConsumption: r.meter,
    allowableDiff: shift.allowableDiff,
    tankDiff: r.tankDiff,
    diff: r.diff,
    diffRate: r.diffRate,
    passed: r.passed,
    blocked: r.blocked,
    movements: r.movements,
    differential: r.differential,
  };
}

export function fmtDT(iso: string): string {
  const d = new Date(iso);
  const p = (n: number) => String(n).padStart(2, "0");
  return `${p(d.getMonth() + 1)}-${p(d.getDate())} ${p(d.getHours())}:${p(
    d.getMinutes()
  )}`;
}

export function fmtFull(iso: string): string {
  const d = new Date(iso);
  const p = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())} ${p(
    d.getHours()
  )}:${p(d.getMinutes())}`;
}

export function toLocalInput(iso: string | Date): string {
  const d = new Date(iso);
  const p = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}T${p(
    d.getHours()
  )}:${p(d.getMinutes())}`;
}

export function uid(): string {
  if (typeof crypto !== "undefined" && "randomUUID" in crypto)
    return crypto.randomUUID();
  return `id-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
}
