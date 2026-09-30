export type TankKind = "storage" | "settling" | "daily";

/** 舱容表读数点：液位 cm -> 舱容 m³ */
export interface SoundingPoint {
  level: number;
  volume: number;
}

export interface Tank {
  id: string;
  name: string;
  kind: TankKind;
  capacity: number; // m³
  table: SoundingPoint[];
}

/** 读数来源：当班实测 / 晚到补录 */
export type ReadingSource = "live" | "backfill";
/** 读数状态：有效 / 待复核（同时刻重复） / 待补录（缺密度） / 作废 */
export type ReadingState = "valid" | "pending_review" | "pending_density" | "void";

export interface Reading {
  id: string;
  tankId: string;
  observedAt: string; // ISO
  level: number | null; // 液位 cm
  temp: number | null; // 温度 ℃
  density: number | null; // 密度 g/cm³（观测温度下）
  source: ReadingSource;
  state: ReadingState;
  shiftId: string | null;
  createdAt: string;
  note?: string;
  reviewNote?: string;
}

export interface Shift {
  id: string;
  date: string; // YYYY-MM-DD
  name: string; // 08-12
  startAt: string;
  endAt: string;
  engineer: string; // 当班轮机员
  rpm: number | null; // 主机转速 rpm
  meterConsumption: number | null; // 油耗表本班消耗量 t
  allowableDiff: number; // 允许差 t
  signed: boolean;
  signedAt: string | null;
  signatureInvalid: boolean;
  snapshot: ReconcileSnapshot | null;
}

export interface TankMovement {
  tankId: string;
  opening: Reading | null;
  closing: Reading | null;
  openingMass: number | null;
  closingMass: number | null;
  /** 本班实测消耗 = 期初存量 - 期末存量（相邻两次实测差）t */
  diff: number | null;
  /** 无法取数的阻塞原因（待补录 / 待复核） */
  blockers: string[];
  /** 存量异常波动（无接收增加 / 超舱容） */
  anomaly: string | null;
}

export interface DifferentialItem {
  tankId: string;
  reason: string;
  level: "error" | "warn";
}

export interface ReconcileSnapshot {
  at: string;
  meterConsumption: number;
  allowableDiff: number;
  tankDiff: number;
  diff: number;
  diffRate: number;
  passed: boolean;
  blocked: boolean;
  movements: TankMovement[];
  differential: DifferentialItem[];
}

export interface StoreState {
  tanks: Tank[];
  readings: Reading[];
  shifts: Shift[];
}
