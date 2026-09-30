import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from "react";
import {
  AppData,
  CHIEF_ENGINEER,
  Reading,
  ReviewCandidate,
  Settings,
  STORAGE_KEY,
  Tank,
  Watch,
  activeReadings,
  nowIso,
  readingMass,
  reconcileWatch,
  round,
  sameObservationMoment,
  uid,
  watchBlock,
} from "./domain";
import { DEFAULT_SETTINGS, DEFAULT_TANKS, buildSeedData } from "./seed";

interface AddReadingInput {
  tankId: string;
  observedAt: string; // datetime-local 格式 yyyy-MM-ddTHH:mm
  levelCm: number;
  temperatureC: number;
  density: number;
  volumeM3?: number | null;
  source: "现场" | "补录";
  note?: string;
}

export type AddOutcome =
  | { kind: "saved"; reading: Reading; replacedId?: string }
  | { kind: "pending"; reading: Reading; candidate: ReviewCandidate };

interface StoreValue {
  data: AppData;
  currentWatch: Watch;
  addReading: (input: AddReadingInput) => AddOutcome;
  resolveCandidate: (
    candidateId: string,
    decision: "accepted" | "rejected",
    by: string,
  ) => void;
  supplementDensity: (readingId: string, density: number) => void;
  saveDraft: (patch: Partial<Pick<Watch, "rpmStart" | "rpmEnd" | "note">> & {
    reportedConsumption?: Record<string, number | null>;
  }) => void;
  signWatch: (officer: string, note?: string, force?: boolean) => { ok: boolean; error?: string };
  resignWatch: (watchId: string, note?: string) => { ok: boolean; error?: string };
  voidSignedWatch: (watchId: string, reason: string) => void;
  updateSettings: (patch: Partial<Settings>) => void;
  addTank: (tank: Omit<Tank, "id">) => void;
  removeTank: (tankId: string) => void;
  resetDemo: () => void;
  clearAll: () => void;
  exportJson: () => string;
  importJson: (json: string) => { ok: boolean; error?: string };
  // 选择器
  missingDensityCount: number;
  migratedLegacyIds: string[];
  pendingReviewCount: number;
  ensureWatchFor: (iso: string) => Watch;
}

const StoreContext = createContext<StoreValue | null>(null);

function loadData(): AppData {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (raw) {
      const parsed = JSON.parse(raw) as Partial<AppData>;
      if (parsed && parsed.version === 1 && Array.isArray(parsed.readings) && Array.isArray(parsed.tanks)) {
        const normalized: AppData = {
          version: 1,
          settings: parsed.settings ?? DEFAULT_SETTINGS,
          tanks: parsed.tanks,
          readings: parsed.readings,
          reviewCandidates: Array.isArray(parsed.reviewCandidates) ? parsed.reviewCandidates : [],
          watches: Array.isArray(parsed.watches) ? parsed.watches : [],
          migratedLegacyIds: Array.isArray(parsed.migratedLegacyIds) ? parsed.migratedLegacyIds : [],
          seededAt: parsed.seededAt ?? new Date().toISOString(),
        };
        return ensureCurrentWatch(normalized);
      }
    }
  } catch {
    // 损坏数据回落到演示数据
  }
  return buildSeedData();
}

function ensureCurrentWatch(d: AppData): AppData {
  const block = watchBlock(new Date());
  const exists = d.watches.some((w) => w.id === block.id);
  if (exists) return d;
  const open: Watch = {
    id: block.id,
    start: block.start.toISOString(),
    end: block.end.toISOString(),
    rpmStart: null,
    rpmEnd: null,
    reportedConsumption: Object.fromEntries(d.tanks.map((t) => [t.id, null])),
    note: "",
    confirmed: false,
  };
  return { ...d, watches: [...d.watches, open] };
}

export function StoreProvider({ children }: { children: ReactNode }) {
  const [data, setData] = useState<AppData>(loadData);
  const dataRef = useRef(data);
  dataRef.current = data;

  useEffect(() => {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(data));
  }, [data]);

  const currentWatch = useMemo(() => {
    const blockId = watchBlock(new Date()).id;
    const found = data.watches.find((w) => w.id === blockId);
    if (found) return found;
    // 理论上 loadData/ensureCurrentWatch 已补建；兜底构造
    const b = watchBlock(new Date());
    return {
      id: b.id,
      start: b.start.toISOString(),
      end: b.end.toISOString(),
      rpmStart: null,
      rpmEnd: null,
      reportedConsumption: Object.fromEntries(data.tanks.map((t) => [t.id, null])),
      note: "",
      confirmed: false,
    } as Watch;
  }, [data.watches, data.tanks]);

  const ensureWatchFor = useCallback((iso: string): Watch => {
    const block = watchBlock(new Date(iso));
    const d = dataRef.current;
    const found = d.watches.find((w) => w.id === block.id);
    if (found) return found;
    const w: Watch = {
      id: block.id,
      start: block.start.toISOString(),
      end: block.end.toISOString(),
      rpmStart: null,
      rpmEnd: null,
      reportedConsumption: Object.fromEntries(d.tanks.map((t) => [t.id, null])),
      note: "",
      confirmed: false,
    };
    setData((prev) => ({ ...prev, watches: [...prev.watches, w] }));
    return w;
  }, []);

  const addReading = useCallback((input: AddReadingInput): AddOutcome => {
    const d = dataRef.current;
    const tank = d.tanks.find((t) => t.id === input.tankId);
    if (!tank) throw new Error("油舱不存在");
    const block = watchBlock(new Date(input.observedAt));
    const watch = d.watches.find((w) => w.id === block.id);
    const volumeM3 =
      input.volumeM3 ?? round((input.levelCm * tank.kgPerCm) / input.density, 2);

    const makeReading = (status: Reading["status"]): Reading => ({
      id: uid("r"),
      tankId: input.tankId,
      observedAt: new Date(input.observedAt).toISOString(),
      levelCm: input.levelCm,
      temperatureC: input.temperatureC,
      density: input.density,
      volumeM3,
      source: input.source,
      status,
      watchId: block.id,
      note: input.note,
      createdAt: nowIso(),
    });

    const observedDate = new Date(input.observedAt);
    const clash = d.readings.find(
      (r) =>
        r.tankId === input.tankId &&
        sameObservationMoment(new Date(r.observedAt), observedDate) &&
        (r.status === "active" || r.status === "pending"),
    );

    // 已确认班次的同一观测时刻：不能回改原始读数，补录进复核队列
    if (clash && clash.status === "active" && watch?.confirmed) {
      const nr = makeReading("pending");
      const candidate: ReviewCandidate = {
        id: uid("c"),
        reading: nr,
        conflictingReadingId: clash.id,
        reason:
          input.source === "补录"
            ? "晚到补录与已确认班次封存的原始读数同一观测时刻，按规定只保留一条有效值，待轮机长复核。"
            : "同一观测时刻已有确认读数，新读数待轮机长复核；已确认班次原始读数不可回改。",
        createdAt: nowIso(),
      };
      setData((prev) => ({
        ...prev,
        readings: [...prev.readings, nr],
        reviewCandidates: [...prev.reviewCandidates, candidate],
      }));
      return { kind: "pending", reading: nr, candidate };
    }

    // 未确认班次 / 进行中：同一时刻直接以新值替换，旧值留痕为 superseded/rejected
    let replacedId: string | undefined;
    const nr = makeReading("active");
    setData((prev) => ({
      ...prev,
      readings: [
        ...prev.readings.map((r) => {
          if (
            r.tankId === input.tankId &&
            sameObservationMoment(new Date(r.observedAt), observedDate) &&
            (r.status === "active" || r.status === "pending")
          ) {
            replacedId = r.id;
            return { ...r, status: r.status === "pending" ? "rejected" : "superseded" } as Reading;
          }
          return r;
        }),
        nr,
      ],
      reviewCandidates:
        clash?.status === "pending"
          ? prev.reviewCandidates.map((c) =>
              c.reading.id === clash.id && !c.resolution
                ? {
                    ...c,
                    resolution: "rejected",
                    resolvedAt: nowIso(),
                    resolvedBy: "值班轮机员",
                    reason: c.reason + "（已被同一观测时刻的新现场读数取代）",
                  }
                : c,
            )
          : prev.reviewCandidates,
    }));

    // 若该班次此前不存在，补建一个进行中班次
    if (!watch) ensureWatchFor(input.observedAt);

    return { kind: "saved", reading: nr, replacedId };
  }, [ensureWatchFor]);

  const resolveCandidate = useCallback(
    (candidateId: string, decision: "accepted" | "rejected", by: string) => {
      setData((prev) => {
        const cand = prev.reviewCandidates.find((c) => c.id === candidateId);
        if (!cand || cand.resolution) return prev;
        let readings = prev.readings;
        if (decision === "accepted") {
          // 只保留一条有效值：旧值 superseded 留痕；新值 active。已封存快照不动
          readings = readings.map((r) =>
            r.id === cand.conflictingReadingId
              ? ({ ...r, status: "superseded" } as Reading)
              : r.id === cand.reading.id
                ? ({ ...r, status: "active" } as Reading)
                : r,
          );
        } else {
          readings = readings.map((r) =>
            r.id === cand.reading.id ? ({ ...r, status: "rejected" } as Reading) : r,
          );
        }
        return {
          ...prev,
          readings,
          reviewCandidates: prev.reviewCandidates.map((c) =>
            c.id === candidateId
              ? { ...c, resolution: decision, resolvedAt: nowIso(), resolvedBy: by }
              : c,
          ),
        };
      });
    },
    [],
  );

  const supplementDensity = useCallback((readingId: string, density: number) => {
    setData((prev) => {
      const r = prev.readings.find((x) => x.id === readingId);
      const tank = prev.tanks.find((t) => t.id === r?.tankId);
      if (!r || !tank) return prev;
      return {
        ...prev,
        readings: prev.readings.map((x) =>
          x.id === readingId
            ? ({
                ...x,
                density: round(density, 3),
                volumeM3: round(((x.levelCm ?? 0) * tank.kgPerCm) / density, 2),
                note: x.note?.includes("待补录")
                  ? x.note.replace("待补录", "密度已补录")
                  : x.note,
              } as Reading)
            : x,
        ),
        migratedLegacyIds: prev.migratedLegacyIds.filter((id) => id !== readingId),
      };
    });
  }, []);

  const saveDraft = useCallback<StoreValue["saveDraft"]>(
    (patch) => {
      setData((prev) => {
        const blockId = watchBlock(new Date()).id;
        return {
          ...prev,
          watches: prev.watches.map((w) =>
            w.id === blockId && !w.confirmed ? ({ ...w, ...patch } as Watch) : w,
          ),
        };
      });
    },
    [],
  );

  const signWatch = useCallback<StoreValue["signWatch"]>(
    (officer, note, force = false) => {
      const d = dataRef.current;
      const blockId = watchBlock(new Date()).id;
      const w = d.watches.find((x) => x.id === blockId);
      if (!w) return { ok: false, error: "当前班次不存在" };
      if (w.confirmed) return { ok: false, error: "本班次已确认" };
      const missing = d.tanks.filter((t) => w.reportedConsumption[t.id] == null);
      if (missing.length) return { ok: false, error: `请先填写${missing.map((t) => t.name).join("、")}的申报耗油` };

      const result = reconcileWatch(w, d.tanks, d.readings, d.settings.tolerance);
      if (!result.passed && !force) {
        return {
          ok: false,
          error: `对账未通过：${result.flaggedTankIds
            .map((id) => d.tanks.find((t) => t.id === id)?.name)
            .filter(Boolean)
            .join("、")}差异超允许值${result.totalExceeded ? "，本班总差异也超差" : ""}。交接签字将立即失效，请先复核。`,
        };
      }
      const start = new Date(w.start);
      const end = new Date(w.end);
      const snapshot = activeReadings(d.readings)
        .filter(
          (r) =>
            [start.getTime(), end.getTime()].includes(new Date(r.observedAt).getTime()) &&
            r.density != null,
        )
        .map((r) => ({
          id: r.id,
          tankId: r.tankId,
          observedAt: r.observedAt,
          levelCm: r.levelCm,
          temperatureC: r.temperatureC,
          density: r.density,
          volumeM3: r.volumeM3,
          source: r.source,
        }));
      setData((prev) => ({
        ...prev,
        watches: prev.watches.map((x) =>
          x.id === blockId
            ? ({
                ...x,
                confirmed: true,
                note: note ?? x.note,
                signed: { signedAt: nowIso(), officer, note },
                sealedReconc: result,
                snapshot,
                // 超差仍强制交班：签字立即失效，等待复核
                voided: !result.passed
                  ? {
                      voidedAt: nowIso(),
                      by: CHIEF_ENGINEER,
                      reason: "对账差异超过允许值，交接签字立即失效，差异油舱待轮机长复核。",
                    }
                  : undefined,
              } as Watch)
            : x,
        ),
      }));
      return { ok: true };
    },
    [],
  );

  const resignWatch = useCallback<StoreValue["resignWatch"]>(
    (watchId, note) => {
      const d = dataRef.current;
      const w = d.watches.find((x) => x.id === watchId);
      if (!w?.voided || w.resigned) return { ok: false, error: "该班次无需重新签字" };
      const result = reconcileWatch(w, d.tanks, d.readings, d.settings.tolerance);
      if (!result.passed)
        return { ok: false, error: "差异仍超过允许值，请先完成补录复核后再重新签字。" };
      setData((prev) => ({
        ...prev,
        watches: prev.watches.map((x) =>
          x.id === watchId
            ? ({
                ...x,
                resigned: { signedAt: nowIso(), officer: CHIEF_ENGINEER, note },
                resealedReconc: result,
              } as Watch)
            : x,
        ),
      }));
      return { ok: true };
    },
    [],
  );

  const voidSignedWatch = useCallback((watchId: string, reason: string) => {
    setData((prev) => ({
      ...prev,
      watches: prev.watches.map((w) =>
        w.id === watchId && w.confirmed && !w.voided
          ? ({
              ...w,
              voided: { voidedAt: nowIso(), by: CHIEF_ENGINEER, reason },
              resigned: undefined,
              resealedReconc: undefined,
            } as Watch)
          : w,
      ),
    }));
  }, []);

  const updateSettings = useCallback((patch: Partial<Settings>) => {
    setData((prev) => ({
      ...prev,
      settings: {
        ...prev.settings,
        ...patch,
        tolerance: { ...prev.settings.tolerance, ...(patch.tolerance ?? {}) },
      },
    }));
  }, []);

  const addTank = useCallback<StoreValue["addTank"]>((tank) => {
    setData((prev) => ({
      ...prev,
      tanks: [...prev.tanks, { ...tank, id: uid("T") }],
    }));
  }, []);

  const removeTank = useCallback((tankId: string) => {
    setData((prev) => ({
      ...prev,
      tanks: prev.tanks.filter((t) => t.id !== tankId),
      readings: prev.readings.filter((r) => r.tankId !== tankId),
    }));
  }, []);

  const resetDemo = useCallback(() => setData(buildSeedData()), []);
  const clearAll = useCallback(
    () =>
      setData({
        version: 1,
        settings: DEFAULT_SETTINGS,
        tanks: DEFAULT_TANKS.map((t) => ({ ...t })),
        readings: [],
        reviewCandidates: [],
        watches: [
          {
            ...(() => {
              const b = watchBlock(new Date());
              return {
                id: b.id,
                start: b.start.toISOString(),
                end: b.end.toISOString(),
              };
            })(),
            rpmStart: null,
            rpmEnd: null,
            reportedConsumption: Object.fromEntries(DEFAULT_TANKS.map((t) => [t.id, null])),
            note: "",
            confirmed: false,
          },
        ],
        migratedLegacyIds: [],
        seededAt: nowIso(),
      }),
    [],
  );

  const exportJson = useCallback(() => JSON.stringify(dataRef.current, null, 2), []);
  const importJson = useCallback((json: string) => {
    try {
      const parsed = JSON.parse(json) as AppData;
      if (parsed.version !== 1 || !Array.isArray(parsed.readings) || !Array.isArray(parsed.tanks))
        return { ok: false, error: "文件格式不正确" };
      setData(ensureCurrentWatch(parsed));
      return { ok: true };
    } catch {
      return { ok: false, error: "JSON 解析失败" };
    }
  }, []);

  const missingDensityCount = useMemo(
    () => data.readings.filter((r) => r.density == null).length,
    [data.readings],
  );
  const migratedLegacyIds = useMemo(() => data.migratedLegacyIds ?? [], [data.migratedLegacyIds]);
  const pendingReviewCount = useMemo(
    () => data.reviewCandidates.filter((c) => !c.resolution).length,
    [data.reviewCandidates],
  );

  const value: StoreValue = {
    data,
    currentWatch,
    addReading,
    resolveCandidate,
    supplementDensity,
    saveDraft,
    signWatch,
    resignWatch,
    voidSignedWatch,
    updateSettings,
    addTank,
    removeTank,
    resetDemo,
    clearAll,
    exportJson,
    importJson,
    missingDensityCount,
    migratedLegacyIds,
    pendingReviewCount,
    ensureWatchFor,
  };

  return <StoreContext.Provider value={value}>{children}</StoreContext.Provider>;
}

export function useStore(): StoreValue {
  const ctx = useContext(StoreContext);
  if (!ctx) throw new Error("useStore must be used within StoreProvider");
  return ctx;
}

// ---------- 复用的选择器 ----------

export function tankMassHistory(
  data: AppData,
  tankId: string,
): Array<{ t: Date; mass: number | null; reading: Reading; status: Reading["status"] }> {
  const tank = data.tanks.find((t) => t.id === tankId);
  if (!tank) return [];
  return data.readings
    .filter((r) => r.tankId === tankId)
    .sort((a, b) => +new Date(a.observedAt) - +new Date(b.observedAt))
    .map((r) => ({
      t: new Date(r.observedAt),
      mass: readingMass(r, tank, data.settings.tolerance.thermalPerDegree),
      reading: r,
      status: r.status,
    }));
}

export { readingMass };
