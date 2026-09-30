import type { Reading, Shift, Tank } from "../types";
import { snapshot, uid } from "./fuel";

/** 舱容表：液位 cm -> 舱容 m³（线性插值） */
export const TANKS: Tank[] = [
  {
    id: "tank-1",
    name: "1号燃油舱",
    kind: "storage",
    capacity: 120,
    table: [
      { level: 0, volume: 0 },
      { level: 50, volume: 20 },
      { level: 100, volume: 45 },
      { level: 150, volume: 70 },
      { level: 200, volume: 95 },
      { level: 250, volume: 110 },
      { level: 300, volume: 120 },
    ],
  },
  {
    id: "tank-2",
    name: "2号燃油舱",
    kind: "storage",
    capacity: 90,
    table: [
      { level: 0, volume: 0 },
      { level: 50, volume: 16 },
      { level: 100, volume: 34 },
      { level: 150, volume: 54 },
      { level: 200, volume: 72 },
      { level: 250, volume: 90 },
    ],
  },
  {
    id: "tank-3",
    name: "沉淀柜",
    kind: "settling",
    capacity: 8,
    table: [
      { level: 0, volume: 0 },
      { level: 20, volume: 1.2 },
      { level: 40, volume: 2.8 },
      { level: 60, volume: 4.8 },
      { level: 80, volume: 6.8 },
      { level: 100, volume: 8 },
    ],
  },
  {
    id: "tank-4",
    name: "日用柜",
    kind: "daily",
    capacity: 3,
    table: [
      { level: 0, volume: 0 },
      { level: 20, volume: 0.6 },
      { level: 40, volume: 1.3 },
      { level: 60, volume: 2.1 },
      { level: 80, volume: 2.7 },
      { level: 100, volume: 3 },
    ],
  },
];

const SHIFT_DEFS = [
  { name: "00-04", start: 0, end: 4 },
  { name: "04-08", start: 4, end: 8 },
  { name: "08-12", start: 8, end: 12 },
  { name: "12-16", start: 12, end: 16 },
  { name: "16-20", start: 16, end: 20 },
  { name: "20-24", start: 20, end: 24 },
];

function dateAt(base: Date, hours: number, minutes = 0): Date {
  const d = new Date(base);
  d.setHours(hours, minutes, 0, 0);
  return d;
}

function iso(d: Date): string {
  return d.toISOString();
}

export function buildShifts(now: Date): Shift[] {
  const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  const yesterday = new Date(today);
  yesterday.setDate(yesterday.getDate() - 1);

  const shifts: Shift[] = [];
  for (const day of [yesterday, today]) {
    const dateStr = `${day.getFullYear()}-${String(day.getMonth() + 1).padStart(
      2,
      "0"
    )}-${String(day.getDate()).padStart(2, "0")}`;
    for (const def of SHIFT_DEFS) {
      shifts.push({
        id: `shift-${dateStr}-${def.name}`,
        date: dateStr,
        name: def.name,
        startAt: iso(dateAt(day, def.start)),
        endAt: iso(dateAt(day, def.end)),
        engineer: "",
        rpm: null,
        meterConsumption: null,
        allowableDiff: 0.5,
        signed: false,
        signedAt: null,
        signatureInvalid: false,
        snapshot: null,
      });
    }
  }
  return shifts;
}

export function buildReadings(now: Date, shifts: Shift[]): Reading[] {
  const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  const yesterday = new Date(today);
  yesterday.setDate(yesterday.getDate() - 1);
  const shiftId = (day: Date, name: string) =>
    `shift-${day.getFullYear()}-${String(day.getMonth() + 1).padStart(
      2,
      "0"
    )}-${String(day.getDate()).padStart(2, "0")}-${name}`;

  const rid = () => uid();
  const readings: Reading[] = [];
  const push = (r: Omit<Reading, "id" | "createdAt">) =>
    readings.push({ ...r, id: rid(), createdAt: now.toISOString() });

  // ---- 昨天 16-20 班（已签字但失效：20:00 同时刻两条读数待轮机长复核） ----
  const y16 = shiftId(yesterday, "16-20");
  push({
    tankId: "tank-1",
    observedAt: iso(dateAt(yesterday, 16)),
    level: 236,
    temp: 46,
    density: 0.95,
    source: "live",
    state: "valid",
    shiftId: y16,
  });
  push({
    tankId: "tank-1",
    observedAt: iso(dateAt(yesterday, 20)),
    level: 215,
    temp: 45,
    density: 0.95,
    source: "live",
    state: "valid",
    shiftId: y16,
  });
  // 同时刻重复读数（纸表与手抄不一致），待复核
  push({
    tankId: "tank-1",
    observedAt: iso(dateAt(yesterday, 20)),
    level: 218,
    temp: 45,
    density: 0.95,
    source: "live",
    state: "pending_review",
    shiftId: y16,
    note: "纸表读数 218cm，与值班记录 215cm 不一致",
  });
  push({
    tankId: "tank-2",
    observedAt: iso(dateAt(yesterday, 16)),
    level: 195,
    temp: 45,
    density: 0.94,
    source: "live",
    state: "valid",
    shiftId: y16,
  });
  push({
    tankId: "tank-2",
    observedAt: iso(dateAt(yesterday, 20)),
    level: 188,
    temp: 44,
    density: 0.94,
    source: "live",
    state: "valid",
    shiftId: y16,
  });
  push({
    tankId: "tank-3",
    observedAt: iso(dateAt(yesterday, 16)),
    level: 82,
    temp: 51,
    density: 0.92,
    source: "live",
    state: "valid",
    shiftId: y16,
  });
  push({
    tankId: "tank-3",
    observedAt: iso(dateAt(yesterday, 20)),
    level: 80,
    temp: 50,
    density: 0.92,
    source: "live",
    state: "valid",
    shiftId: y16,
  });
  push({
    tankId: "tank-4",
    observedAt: iso(dateAt(yesterday, 16)),
    level: 76,
    temp: 51,
    density: 0.92,
    source: "live",
    state: "valid",
    shiftId: y16,
  });
  push({
    tankId: "tank-4",
    observedAt: iso(dateAt(yesterday, 20)),
    level: 75,
    temp: 50,
    density: 0.92,
    source: "live",
    state: "valid",
    shiftId: y16,
  });

  // ---- 今天 08:00 / 12:00 当班实测（08-12 班已确认签字） ----
  push({
    tankId: "tank-1",
    observedAt: iso(dateAt(today, 8)),
    level: 250,
    temp: 45,
    density: 0.95,
    source: "live",
    state: "valid",
    shiftId: shiftId(today, "08-12"),
  });
  push({
    tankId: "tank-1",
    observedAt: iso(dateAt(today, 12)),
    level: 240,
    temp: 46,
    density: 0.95,
    source: "live",
    state: "valid",
    shiftId: shiftId(today, "08-12"),
  });
  push({
    tankId: "tank-2",
    observedAt: iso(dateAt(today, 8)),
    level: 200,
    temp: 44,
    density: 0.94,
    source: "live",
    state: "valid",
    shiftId: shiftId(today, "08-12"),
  });
  push({
    tankId: "tank-2",
    observedAt: iso(dateAt(today, 12)),
    level: 190,
    temp: 45,
    density: 0.94,
    source: "live",
    state: "valid",
    shiftId: shiftId(today, "08-12"),
  });
  push({
    tankId: "tank-3",
    observedAt: iso(dateAt(today, 8)),
    level: 80,
    temp: 50,
    density: 0.92,
    source: "live",
    state: "valid",
    shiftId: shiftId(today, "08-12"),
  });
  push({
    tankId: "tank-3",
    observedAt: iso(dateAt(today, 12)),
    level: 78,
    temp: 51,
    density: 0.92,
    source: "live",
    state: "valid",
    shiftId: shiftId(today, "08-12"),
  });
  push({
    tankId: "tank-4",
    observedAt: iso(dateAt(today, 8)),
    level: 75,
    temp: 50,
    density: 0.92,
    source: "live",
    state: "valid",
    shiftId: shiftId(today, "08-12"),
  });
  push({
    tankId: "tank-4",
    observedAt: iso(dateAt(today, 12)),
    level: 74,
    temp: 50,
    density: 0.92,
    source: "live",
    state: "valid",
    shiftId: shiftId(today, "08-12"),
  });

  // ---- 今天 16:00（12-16 班，待交接） ----
  const s12 = shiftId(today, "12-16");
  push({
    tankId: "tank-1",
    observedAt: iso(dateAt(today, 16)),
    level: 232,
    temp: 47,
    density: 0.95,
    source: "live",
    state: "valid",
    shiftId: s12,
  });
  // 2号舱 16:00 缺密度 -> 待补录
  push({
    tankId: "tank-2",
    observedAt: iso(dateAt(today, 16)),
    level: 182,
    temp: 46,
    density: null,
    source: "live",
    state: "pending_density",
    shiftId: s12,
    note: "纸表只抄回液位温度，密度未填",
  });
  push({
    tankId: "tank-3",
    observedAt: iso(dateAt(today, 16)),
    level: 77,
    temp: 52,
    density: 0.92,
    source: "live",
    state: "valid",
    shiftId: s12,
  });
  push({
    tankId: "tank-4",
    observedAt: iso(dateAt(today, 16)),
    level: 73,
    temp: 51,
    density: 0.92,
    source: "live",
    state: "valid",
    shiftId: s12,
  });

  // ---- 晚到补录：已确认 08-12 班的纸表（只进历史，不回改原始读数） ----
  push({
    tankId: "tank-1",
    observedAt: iso(dateAt(today, 8, 5)),
    level: 248,
    temp: 45,
    density: 0.95,
    source: "backfill",
    state: "pending_review",
    shiftId: shiftId(today, "08-12"),
    note: "纸表补录（08:05），晚到，轮机长待复核",
  });
  // 同时刻重复：1号舱 16:00 纸表与手抄不一致，待复核（同一时刻只留一条有效值）
  push({
    tankId: "tank-1",
    observedAt: iso(dateAt(today, 16)),
    level: 235,
    temp: 47,
    density: 0.95,
    source: "live",
    state: "pending_review",
    shiftId: s12,
    note: "纸表 235cm 与手抄 232cm 不一致",
  });

  return readings;
}

export function buildSeed(now = new Date()): {
  tanks: Tank[];
  readings: Reading[];
  shifts: Shift[];
} {
  const tanks = TANKS;
  const shifts = buildShifts(now);
  const readings = buildReadings(now, shifts);

  // 昨天 16-20：已签字但失效（待复核读数未处理）
  const y = new Date(now.getFullYear(), now.getMonth(), now.getDate() - 1);
  const yShift = shifts.find(
    (s) =>
      s.date ===
        `${y.getFullYear()}-${String(y.getMonth() + 1).padStart(2, "0")}-${String(
          y.getDate()
        ).padStart(2, "0")}` && s.name === "16-20"
  )!;
  yShift.engineer = "张轮机";
  yShift.rpm = 78;
  yShift.meterConsumption = 8.8;
  yShift.allowableDiff = 0.5;
  yShift.signed = true;
  yShift.signedAt = new Date(
    y.getFullYear(),
    y.getMonth(),
    y.getDate(),
    20,
    5
  ).toISOString();
  yShift.signatureInvalid = true;
  yShift.snapshot = snapshot(yShift, tanks, readings);

  // 今天 08-12：已确认签字（对账通过，原始读数冻结）
  const t = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  const mShift = shifts.find(
    (s) =>
      s.date ===
        `${t.getFullYear()}-${String(t.getMonth() + 1).padStart(2, "0")}-${String(
          t.getDate()
        ).padStart(2, "0")}` && s.name === "08-12"
  )!;
  mShift.engineer = "张轮机";
  mShift.rpm = 80;
  mShift.meterConsumption = 6.4;
  mShift.allowableDiff = 0.5;
  mShift.signed = true;
  mShift.signedAt = new Date(
    t.getFullYear(),
    t.getMonth(),
    t.getDate(),
    12,
    5
  ).toISOString();
  mShift.signatureInvalid = false;
  mShift.snapshot = snapshot(mShift, tanks, readings);

  // 今天 12-16：待交接
  const sShift = shifts.find(
    (s) =>
      s.date ===
        `${t.getFullYear()}-${String(t.getMonth() + 1).padStart(2, "0")}-${String(
          t.getDate()
        ).padStart(2, "0")}` && s.name === "12-16"
  )!;
  sShift.engineer = "李轮机";
  sShift.rpm = 82;
  sShift.meterConsumption = 5.1;
  sShift.allowableDiff = 0.5;

  return { tanks, readings, shifts };
}
