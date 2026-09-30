// 首次进入时生成演示数据：油舱、连续班次读数、已确认班次封存、
// 一次对账超差导致签字失效、两条缺密度旧记录迁移、一条待复核补录

import {
  AppData,
  CREW,
  DATA_VERSION,
  DAY_MS,
  Reading,
  ReadingStatus,
  ReconcResult,
  ReviewCandidate,
  Settings,
  SnapshotReading,
  Tank,
  Watch,
  WATCH_HOURS,
  watchBlock,
  watchIdOf,
  reconcileWatch,
  readingMass,
  round,
  uid,
} from "./domain";

export const DEFAULT_SETTINGS: Settings = {
  shipName: "远洋 18 号",
  tolerance: {
    perTankT: 0.3,
    totalT: 0.5,
    thermalPerDegree: 0.0007,
  },
};

export const DEFAULT_TANKS: Tank[] = [
  {
    id: "T1",
    name: "重油沉淀舱",
    fuelType: "重油 HFO",
    capacityCm: 420,
    kgPerCm: 0.092,
    standardDensity: 0.945,
    color: "#0f766e",
  },
  {
    id: "T2",
    name: "重油日用舱",
    fuelType: "重油 HFO",
    capacityCm: 360,
    kgPerCm: 0.055,
    standardDensity: 0.94,
    color: "#2563eb",
  },
  {
    id: "T3",
    name: "柴油日用舱",
    fuelType: "柴油 MGO",
    capacityCm: 300,
    kgPerCm: 0.04,
    standardDensity: 0.84,
    color: "#f97316",
  },
  {
    id: "T4",
    name: "滑油循环舱",
    fuelType: "滑油 LO",
    capacityCm: 260,
    kgPerCm: 0.035,
    standardDensity: 0.9,
    color: "#7c3aed",
  },
];

// 各舱每个 4 小时边界的液位（cm）序列：b0 = 前天20:00 … b8 = 当前班次开始
const LEVEL_SERIES: Record<string, number[]> = {
  T1: [382, 378.5, 375, 371.2, 367.6, 364, 360.2, 356.5, 352.8],
  T2: [268, 259.4, 251, 242.3, 233.9, 225.2, 216.8, 208.1, 202.6],
  T3: [176, 173.9, 176, 174, 172, 173.5, 171.4, 169.6, 170.8],
  T4: [142, 140.8, 139.5, 138.4, 137.2, 136.1, 135.0, 133.8, 132.6],
};

const TEMP_RANGE: Record<string, [number, number]> = {
  T1: [42, 46],
  T2: [78, 84],
  T3: [28, 32],
  T4: [45, 48],
};

// 各交班班次的申报油耗（吨），索引 0..6 对应 b0->b1 … b6->b7
const REPORTED: Record<string, (number | null)[]> = {
  T1: [0.32, 0.32, 0.35, 0.33, 0.33, 0.35, 0.34],
  // j5（16-20 班）申报 1.10，实测约 0.48，差异 +0.62 => 单舱与总量同时超差
  T2: [0.47, 0.46, 0.48, 0.46, 0.48, 1.1, 0.48],
  T3: [0.09, 0.08, 0.08, 0.08, 0.08, 0.09, 0.07],
  T4: [0.04, 0.05, 0.04, 0.04, 0.04, 0.04, 0.04],
};

const RPM_START = [82, 83, 82, 84, 83, 81, 84];
const RPM_END = [83, 82, 84, 83, 81, 84, 82];

export function buildSeedData(now: Date = new Date()): AppData {
  const settings = DEFAULT_SETTINGS;
  const tanks = DEFAULT_TANKS.map((t) => ({ ...t }));
  const readings: Reading[] = [];
  const watches: Watch[] = [];

  const cur = watchBlock(now);
  // b8 = 当前班次开始；b0 = 往前 8 个边界（前天 20:00 起）
  const boundaries: Date[] = [];
  for (let i = 8; i >= 0; i--) {
    boundaries.push(new Date(cur.start.getTime() - i * WATCH_HOURS * 3600_000));
  }
  // 已确认的交班班次：b0->b1 … b6->b7（7 个）
  const signedStarts = boundaries.slice(0, 7);

  tanks.forEach((tank) => {
    boundaries.forEach((b, i) => {
      const level = LEVEL_SERIES[tank.id][i];
      const [tLo, tHi] = TEMP_RANGE[tank.id];
      const temperature = round(tLo + ((i * 7) % 10) / 10 * (tHi - tLo) + (i % 3) * 0.3, 1);
      const density = round(tank.standardDensity + ((i % 4) - 1.5) * 0.001, 3);
      const volumeM3 = round((level * tank.kgPerCm) / density, 2);
      const watchStart = signedStarts.find(
        (s) => s.getTime() === b.getTime() && i < 7,
      );
      readings.push({
        id: uid("r"),
        tankId: tank.id,
        observedAt: b.toISOString(),
        levelCm: level,
        temperatureC: temperature,
        density,
        volumeM3,
        source: "现场",
        status: "active",
        watchId: watchStart ? watchIdOf(watchStart) : watchIdOf(cur.start),
        createdAt: new Date(b.getTime() + 5 * 60_000).toISOString(),
        note: undefined,
      });
    });
  });

  // —— 旧记录缺密度迁移：两条更早的历史读数，液位在、密度空 ——
  const legacySpecs: Array<{ tankId: string; offset: number; level: number; temp: number }> = [
    { tankId: "T1", offset: 12, level: 418.5, temp: 41 },
    { tankId: "T2", offset: 12, level: 305.2, temp: 76 },
  ];
  const migratedLegacyIds: string[] = [];
  for (const spec of legacySpecs) {
    const tank = tanks.find((t) => t.id === spec.tankId)!;
    const observed = new Date(cur.start.getTime() - spec.offset * WATCH_HOURS * 3600_000);
    const r: Reading = {
      id: uid("r"),
      tankId: spec.tankId,
      observedAt: observed.toISOString(),
      levelCm: spec.level,
      temperatureC: spec.temp,
      density: null,
      volumeM3: round((spec.level * tank.kgPerCm) / tank.standardDensity, 2),
      source: "现场",
      status: "active",
      watchId: null,
      createdAt: new Date(observed.getTime() + 8 * 60_000).toISOString(),
      note: "纸表归档迁移：缺实测密度，待补录",
    };
    readings.push(r);
    migratedLegacyIds.push(r.id);
  }

  // —— 组装已确认班次（封存原始读数与对账结果）——
  signedStarts.forEach((s, j) => {
    const end = new Date(s.getTime() + WATCH_HOURS * 3600_000);
    const id = watchIdOf(s);
    const reportedConsumption: Record<string, number | null> = {};
    for (const t of tanks) reportedConsumption[t.id] = REPORTED[t.id][j];

    const watch: Watch = {
      id,
      start: s.toISOString(),
      end: end.toISOString(),
      rpmStart: RPM_START[j],
      rpmEnd: RPM_END[j],
      reportedConsumption,
      note:
        j === 5
          ? "重油日用舱流量计与实测存量对不上，已电话报告轮机长，纸表晚班补交。"
          : "巡检正常，油舱液位、温度按时抄录。",
      confirmed: true,
      signed: {
        signedAt: new Date(end.getTime() + 9 * 60_000).toISOString(),
        officer: CREW[j % CREW.length],
        note: j === 5 ? "交班时纸表数据，未与实测存量复核" : undefined,
      },
    };

    // 用当前读数先算一次对账，落盘封存
    const sealed = reconcileWatch(watch, tanks, readings, settings.tolerance);
    watch.sealedReconc = sealed;
    watch.snapshot = readings
      .filter(
        (r) =>
          r.density != null &&
          [s.getTime(), end.getTime()].includes(new Date(r.observedAt).getTime()),
      )
      .map<SnapshotReading>((r) => ({
        id: r.id,
        tankId: r.tankId,
        observedAt: r.observedAt,
        levelCm: r.levelCm,
        temperatureC: r.temperatureC,
        density: r.density,
        volumeM3: r.volumeM3,
        source: r.source,
      }));

    // j5：差异超允许值 => 交接签字立即失效
    if (j === 5) {
      watch.voided = {
        voidedAt: new Date(end.getTime() + 35 * 60_000).toISOString(),
        by: "轮机长 周建国",
        reason: "重油日用舱单舱差异与本班总差异均超过允许值，交接签字失效，待复核。",
      };
    }
    watches.push(watch);
  });

  // 当前进行中的班次：加一条班中实测（取当前时刻前 20 分钟，保证已发生且在本班内），
  // 使实时对账在班末边界读数尚缺时，也能取到相邻两次实测差
  const elapsed = now.getTime() - cur.start.getTime();
  const midMs = Math.max(
    cur.start.getTime() + 20 * 60_000,
    Math.min(now.getTime() - 20 * 60_000, cur.start.getTime() + elapsed * 0.6),
  );
  const mid = new Date(midMs);
  const openReported: Record<string, number | null> = {};
  tanks.forEach((tank, ti) => {
    const startLevel = LEVEL_SERIES[tank.id][8];
    const prevLevel = LEVEL_SERIES[tank.id][7];
    const midLevel = round(startLevel - (startLevel - prevLevel) * 0.55, 1);
    const [tLo] = TEMP_RANGE[tank.id];
    const midTemp = round(tLo + 1.6 + (ti % 2) * 0.4, 1);
    const midDensity = round(tank.standardDensity + 0.001, 3);
    const midVolume = round((midLevel * tank.kgPerCm) / midDensity, 2);
    const midReading: Reading = {
      id: uid("r"),
      tankId: tank.id,
      observedAt: mid.toISOString(),
      levelCm: midLevel,
      temperatureC: midTemp,
      density: midDensity,
      volumeM3: midVolume,
      source: "现场",
      status: "active",
      watchId: watchIdOf(cur.start),
      createdAt: new Date(mid.getTime() + 5 * 60_000).toISOString(),
    };
    readings.push(midReading);

    // 预填与实测一致的申报值，方便直接体验合格签字（用户可改动触发超差）
    const startReading = readings.find(
      (r) =>
        r.tankId === tank.id &&
        new Date(r.observedAt).getTime() === cur.start.getTime() &&
        r.status === "active",
    )!;
    const m0 = readingMass(startReading, tank, settings.tolerance.thermalPerDegree);
    const m1 = readingMass(midReading, tank, settings.tolerance.thermalPerDegree);
    openReported[tank.id] = m0 != null && m1 != null ? round(m0 - m1, 2) : null;
  });

  const open: Watch = {
    id: watchIdOf(cur.start),
    start: cur.start.toISOString(),
    end: cur.end.toISOString(),
    rpmStart: 84,
    rpmEnd: 83,
    reportedConsumption: openReported,
    note: "主机运行平稳，各舱温度正常，准备交班。",
    confirmed: false,
  };
  watches.push(open);

  // —— 一条晚到补录：j5 结束时刻 T2 纸表读数与已封存的电子读数同一观测时刻 ——
  const j5Start = signedStarts[5];
  const j5End = new Date(j5Start.getTime() + WATCH_HOURS * 3600_000);
  const t2 = tanks[1];
  const conflicting = readings.find(
    (r) =>
      r.tankId === "T2" &&
      new Date(r.observedAt).getTime() === j5End.getTime() &&
      r.status === "active",
  )!;
  // 纸表液位 206.3（电子 216.8）：采纳后相邻实测差约 1.1 t，与交班申报 1.10 t 吻合，差异消除
  const paperLevel = 206.3;
  const lateReading: Reading = {
    id: uid("r"),
    tankId: "T2",
    observedAt: j5End.toISOString(),
    levelCm: paperLevel,
    temperatureC: 82.4,
    density: 0.939,
    volumeM3: round((paperLevel * t2.kgPerCm) / 0.939, 2),
    source: "补录",
    status: "pending",
    watchId: watchIdOf(j5Start),
    createdAt: new Date(j5End.getTime() + 5 * 3600_000).toISOString(),
    note: "纸表补录，晚到 5 小时；与同一观测时刻电子读数不一致",
  };
  readings.push(lateReading);

  const candidate: ReviewCandidate = {
    id: uid("c"),
    reading: lateReading,
    conflictingReadingId: conflicting.id,
    reason:
      "补录读数与已确认班次（16-20班）封存的原始读数落在同一观测时刻。按规定只保留一条有效值，且已确认班次原始读数不可回改，提交轮机长复核。",
    createdAt: lateReading.createdAt,
  };

  return {
    version: DATA_VERSION,
    settings,
    tanks,
    readings,
    reviewCandidates: [candidate],
    watches,
    migratedLegacyIds,
    seededAt: now.toISOString(),
  };
}

// 供其他模块复用：某读数按当前参数折算（避免循环依赖直接转发）
export function massOf(r: Reading, tank: Tank, thermal: number): number | null {
  return readingMass(r, tank, thermal);
}

export type { ReconcResult };

// 避免 DAY_MS 未使用告警（种子文件保留时间常量引用）
void DAY_MS;
