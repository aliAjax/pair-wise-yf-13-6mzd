// 油料与值守对账台 —— 领域模型与纯计算

export type FuelType = "重油 HFO" | "柴油 MGO" | "滑油 LO";

export interface Tank {
  id: string;
  name: string;
  fuelType: FuelType;
  capacityCm: number; // 测深管最大液位 cm
  kgPerCm: number; // 该舱每厘米液柱对应的质量（吨），由舱容表给出
  standardDensity: number; // 标准密度 g/cm³（15℃）
  color: string;
}

export type ReadingStatus =
  | "active" // 当前有效值
  | "pending" // 晚到补录，同一观测时刻冲突，等待轮机长复核（暂不计入有效）
  | "superseded" // 被复核后采纳的新值取代，仍留在历史
  | "rejected"; // 复核驳回 / 因新值而失效

export interface Reading {
  id: string;
  tankId: string;
  /** 观测时刻（ISO 字符串，同一舱同一分钟视为同一观测时刻） */
  observedAt: string;
  levelCm: number | null; // 液位 cm
  temperatureC: number | null; // 温度 ℃
  density: number | null; // 实测密度 g/cm³；旧记录可为空 => 待补录
  volumeM3: number | null; // 由舱容表按液位查出的体积 m³
  source: "现场" | "补录";
  status: ReadingStatus;
  watchId: string | null;
  note?: string;
  createdAt: string;
}

export interface ReviewCandidate {
  id: string;
  reading: Reading; // 晚到补录的读数
  conflictingReadingId: string; // 已存在的有效读数（已确认班次，不可回改）
  reason: string;
  createdAt: string;
  resolvedAt?: string;
  resolution?: "accepted" | "rejected";
  resolvedBy?: string;
}

export interface ReconcLine {
  tankId: string;
  startMass: number | null;
  endMass: number | null;
  measuredConsumption: number | null; // 相邻两次实测折算存量之差（消耗为正）
  reportedConsumption: number | null; // 交班申报油耗
  difference: number | null; // 申报 - 实测
  withinTolerance: boolean;
  basis: string;
}

export interface ReconcResult {
  watchId: string;
  lines: ReconcLine[];
  totalMeasured: number | null;
  totalReported: number | null;
  totalDifference: number | null;
  tankExceeded: boolean;
  totalExceeded: boolean;
  passed: boolean;
  flaggedTankIds: string[];
}

export interface SnapshotReading {
  id: string;
  tankId: string;
  observedAt: string;
  levelCm: number | null;
  temperatureC: number | null;
  density: number | null;
  volumeM3: number | null;
  source: "现场" | "补录";
}

export interface SignatureRecord {
  signedAt: string;
  officer: string;
  note?: string;
}

export interface VoidRecord {
  voidedAt: string;
  by: string;
  reason: string;
}

export interface Watch {
  id: string; // W-YYYY-MM-DDThh
  start: string;
  end: string;
  rpmStart: number | null;
  rpmEnd: number | null;
  /** key: tankId => 申报耗油 吨 */
  reportedConsumption: Record<string, number | null>;
  note: string;
  confirmed: boolean;
  signed?: SignatureRecord;
  voided?: VoidRecord; // 对账超差 => 签字立即失效
  /** 确认时封存的原始读数快照（不可回改） */
  snapshot?: SnapshotReading[];
  sealedReconc?: ReconcResult; // 确认时封存的对账结果
  /** 轮机长复核差异消除后重新签字（保留原失效记录用于审计） */
  resigned?: SignatureRecord;
  resealedReconc?: ReconcResult;
}

export function isWatchSigned(w: Watch): boolean {
  if (!w.confirmed) return false;
  if (!w.voided) return !!w.signed;
  return !!w.resigned;
}

/** 看板/摘要使用的有效封存对账（重新签字后为复核结果） */
export function effectiveReconc(w: Watch): ReconcResult | undefined {
  return w.resealedReconc ?? w.sealedReconc;
}

export interface ToleranceSettings {
  perTankT: number; // 单舱允许差异 吨
  totalT: number; // 本班总差异允许值 吨
  thermalPerDegree: number; // 温度体积修正系数（每 ℃，相对 15℃）
}

export interface Settings {
  shipName: string;
  tolerance: ToleranceSettings;
}

export interface AppData {
  version: number;
  settings: Settings;
  tanks: Tank[];
  readings: Reading[];
  reviewCandidates: ReviewCandidate[];
  watches: Watch[];
  migratedLegacyIds: string[];
  seededAt: string;
}

export const STORAGE_KEY = "fuel-watch-reconcile-v1";
export const DATA_VERSION = 1;
export const WATCH_HOURS = 4;
export const REFERENCE_TEMP_C = 15;

export const CREW = ["李轮机", "王大车", "赵三管", "陈四轨"];
export const CHIEF_ENGINEER = "轮机长 周建国";

// ---------- 班次（4 小时一班：00-04 04-08 08-12 12-16 16-20 20-24）----------

const DAY_MS = 86_400_000;

export function watchBlock(date: Date): { start: Date; end: Date; id: string } {
  const start = new Date(date);
  start.setHours(Math.floor(start.getHours() / WATCH_HOURS) * WATCH_HOURS, 0, 0, 0);
  const end = new Date(start.getTime() + WATCH_HOURS * 3600_000);
  return { start, end, id: watchIdOf(start) };
}

export function watchIdOf(d: Date): string {
  const p = (n: number) => String(n).padStart(2, "0");
  return `W-${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}T${p(d.getHours())}`;
}

export function parseWatchId(id: string): Date | null {
  const m = id.match(/^W-(\d{4})-(\d{2})-(\d{2})T(\d{2})$/);
  if (!m) return null;
  return new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3]), Number(m[4]));
}

export function watchLabel(w: Pick<Watch, "start" | "end"> | { start: Date; end: Date }): string {
  const s = typeof w.start === "string" ? new Date(w.start) : w.start;
  const e = typeof w.end === "string" ? new Date(w.end) : w.end;
  const p = (n: number) => String(n).padStart(2, "0");
  return `${p(s.getHours())}-${p(e.getHours())}班`;
}

export function watchDayLabel(w: Pick<Watch, "start">): string {
  const s = new Date(w.start);
  const p = (n: number) => String(n).padStart(2, "0");
  return `${s.getMonth() + 1}月${s.getDate()}日`;
}

export function shiftBlocksBetween(fromExclusive: Date, to: Date): Date[] {
  const out: Date[] = [];
  let cur = new Date(fromExclusive.getTime() + WATCH_HOURS * 3600_000);
  cur.setMinutes(0, 0, 0);
  while (cur.getTime() <= to.getTime()) {
    out.push(new Date(cur));
    cur = new Date(cur.getTime() + WATCH_HOURS * 3600_000);
  }
  return out;
}

/**
 * 两次观测是否同一观测时刻（按抄表精度：同一日 + 同一分钟）。
 * 使用 UTC 分量比较，兼容种子 UTC 整点存储与浏览器本地时区的整点偏移。
 */
export function sameObservationMoment(a: Date, b: Date): boolean {
  return (
    a.getUTCFullYear() === b.getUTCFullYear() &&
    a.getUTCMonth() === b.getUTCMonth() &&
    a.getUTCDate() === b.getUTCDate() &&
    a.getUTCHours() === b.getUTCHours() &&
    a.getUTCMinutes() === b.getUTCMinutes()
  );
}

// ---------- 存量折算：液位 -> 体积 -> 温度修正 -> 标准密度 -> 质量（吨）----------

export function readingMass(
  r: Pick<Reading, "levelCm" | "temperatureC" | "density" | "volumeM3">,
  tank: Tank,
  thermalPerDegree: number,
): number | null {
  if (r.levelCm == null || r.volumeM3 == null || r.density == null) return null;
  const temp = r.temperatureC ?? REFERENCE_TEMP_C;
  const correctedVolume = r.volumeM3 * (1 + (temp - REFERENCE_TEMP_C) * thermalPerDegree);
  return round(correctedVolume * r.density, 3);
}

/** 只看量尺按舱容系数估算的存量（待补录读数用，不计入对账，仅看板提示） */
export function levelOnlyMass(r: Pick<Reading, "levelCm">, tank: Tank): number | null {
  if (r.levelCm == null) return null;
  return round(r.levelCm * tank.kgPerCm, 3);
}

export function round(n: number, digits = 2): number {
  const f = 10 ** digits;
  return Math.round(n * f) / f;
}

// ---------- 取数：某班次边界 / 区间内各舱的有效实测 ----------

export interface EffectiveReading {
  reading: Reading;
  mass: number | null;
}

export function activeReadings(readings: Reading[]): Reading[] {
  return readings.filter((r) => r.status === "active");
}

/** 某时刻（整点边界）该舱的有效读数：必须正好落在该观测时刻；晚到补录采纳后同样适用 */
export function readingAtBoundary(
  readings: Reading[],
  tankId: string,
  boundary: Date,
  tanks: Tank[],
  thermal: number,
): EffectiveReading | null {
  const list = activeReadings(readings)
    .filter((r) => r.tankId === tankId)
    .sort((a, b) => +new Date(a.observedAt) - +new Date(b.observedAt));
  const exact = list.filter((r) => sameObservationMoment(new Date(r.observedAt), boundary));
  if (!exact.length) return null;
  const r = exact[exact.length - 1];
  const tank = tanks.find((t) => t.id === tankId);
  return { reading: r, mass: tank ? readingMass(r, tank, thermal) : null };
}

// ---------- 对账 ----------

export function reconcileWatch(
  watch: Watch,
  tanks: Tank[],
  readings: Reading[],
  tol: ToleranceSettings,
): ReconcResult {
  const start = new Date(watch.start);
  const end = new Date(watch.end);
  const lines: ReconcLine[] = tanks.map((tank) => {
    const before = readingAtBoundary(readings, tank.id, start, tanks, tol.thermalPerDegree);
    const atEnd = readingAtBoundary(readings, tank.id, end, tanks, tol.thermalPerDegree);
    const startMass = before?.mass ?? null;
    const endMass = atEnd?.mass ?? null;
    let measured: number | null = null;
    let basis = "边界实测折算";
    if (startMass != null && endMass != null) {
      measured = round(startMass - endMass, 3);
    } else {
      // 边界缺测时，用班次区间内最后两条有效读数兜底
      const inWatch = activeReadings(readings)
        .filter(
          (r) =>
            r.tankId === tank.id &&
            +new Date(r.observedAt) >= start.getTime() &&
            +new Date(r.observedAt) <= end.getTime(),
        )
        .sort((a, b) => +new Date(a.observedAt) - +new Date(b.observedAt));
      if (inWatch.length >= 2) {
        const a = readingMass(inWatch[0], tank, tol.thermalPerDegree);
        const b = readingMass(inWatch[inWatch.length - 1], tank, tol.thermalPerDegree);
        if (a != null && b != null) {
          measured = round(a - b, 3);
          basis = "班内相邻两次实测差";
        }
      } else {
        basis = "缺少两次可折算实测";
      }
    }
    const reported = watch.reportedConsumption[tank.id] ?? null;
    const diff = measured != null && reported != null ? round(reported - measured, 3) : null;
    return {
      tankId: tank.id,
      startMass,
      endMass,
      measuredConsumption: measured,
      reportedConsumption: reported,
      difference: diff,
      withinTolerance: diff == null ? true : Math.abs(diff) <= tol.perTankT + 1e-9,
      basis,
    };
  });

  const usable = lines.filter((l) => l.difference != null);
  const totalMeasured = usable.length
    ? round(usable.reduce((s, l) => s + (l.measuredConsumption ?? 0), 0), 3)
    : null;
  const totalReported = usable.length
    ? round(usable.reduce((s, l) => s + (l.reportedConsumption ?? 0), 0), 3)
    : null;
  const totalDifference =
    totalMeasured != null && totalReported != null
      ? round(totalReported - totalMeasured, 3)
      : null;
  const tankExceeded = lines.some((l) => !l.withinTolerance);
  const totalExceeded = totalDifference != null && Math.abs(totalDifference) > tol.totalT + 1e-9;
  const flaggedTankIds = lines.filter((l) => !l.withinTolerance).map((l) => l.tankId);
  return {
    watchId: watch.id,
    lines,
    totalMeasured,
    totalReported,
    totalDifference,
    tankExceeded,
    totalExceeded,
    passed: !tankExceeded && !totalExceeded,
    flaggedTankIds,
  };
}

/** 最近一次对账失效（签字失效）的班次 */
export function latestInvalidWatch(watches: Watch[]): Watch | null {
  return (
    watches
      .filter((w) => w.voided)
      .sort((a, b) => +new Date(b.start) - +new Date(a.start))[0] ?? null
  );
}

// ---------- 格式化 ----------

export function fmtDT(iso: string | Date): string {
  const d = typeof iso === "string" ? new Date(iso) : iso;
  const p = (n: number) => String(n).padStart(2, "0");
  return `${d.getMonth() + 1}/${d.getDate()} ${p(d.getHours())}:${p(d.getMinutes())}`;
}

export function fmtHM(iso: string | Date): string {
  const d = typeof iso === "string" ? new Date(iso) : iso;
  const p = (n: number) => String(n).padStart(2, "0");
  return `${p(d.getHours())}:${p(d.getMinutes())}`;
}

export function fmtNum(n: number | null | undefined, digits = 2): string {
  return n == null || Number.isNaN(n) ? "—" : n.toFixed(digits);
}

export function signedDiff(n: number | null | undefined, digits = 2): string {
  if (n == null || Number.isNaN(n)) return "—";
  return `${n > 0 ? "+" : ""}${n.toFixed(digits)}`;
}

export function nowIso(): string {
  return new Date().toISOString();
}

export function uid(prefix = "id"): string {
  const rand =
    typeof crypto !== "undefined" && "randomUUID" in crypto
      ? crypto.randomUUID().slice(0, 8)
      : Math.random().toString(36).slice(2, 10);
  return `${prefix}-${Date.now().toString(36)}-${rand}`;
}

export { DAY_MS };
