import { useCallback, useEffect, useMemo, useState } from "react";
import type { Reading, Shift, StoreState } from "./types";
import { buildSeed } from "./lib/seed";
import {
  reconcile,
  sameMinute,
  snapshot as buildSnapshot,
  uid,
} from "./lib/fuel";

const KEY = "fuel-duty-reconciliation-v1";

function loadState(): StoreState {
  try {
    const raw = localStorage.getItem(KEY);
    if (raw) {
      const parsed = JSON.parse(raw) as StoreState;
      if (parsed.tanks?.length && Array.isArray(parsed.readings)) {
        // 兼容：旧班次缺字段时补默认
        parsed.shifts = parsed.shifts.map((s) => ({
          rpm: null,
          meterConsumption: null,
          allowableDiff: 0.5,
          signed: false,
          signedAt: null,
          signatureInvalid: false,
          snapshot: null,
          engineer: "",
          ...s,
        }));
        return parsed;
      }
    }
  } catch (e) {
    console.warn("读取本地数据失败，重置为演示数据", e);
  }
  return buildSeed();
}

export interface AddReadingInput {
  tankId: string;
  observedAt: string; // ISO
  level: number | null;
  temp: number | null;
  density: number | null;
  note?: string;
}

export interface AddReadingResult {
  reading: Reading;
  source: Reading["source"];
  state: Reading["state"];
  shiftId: string | null;
  duplicateOf: string | null;
}

export function useStore() {
  const [state, setState] = useState<StoreState>(loadState);

  useEffect(() => {
    try {
      localStorage.setItem(KEY, JSON.stringify(state));
    } catch (e) {
      console.warn("写入本地失败", e);
    }
  }, [state]);

  const findShiftFor = useCallback(
    (shifts: Shift[], iso: string): Shift | null => {
      const t = new Date(iso).getTime();
      return (
        shifts.find((s) => {
          const a = new Date(s.startAt).getTime();
          const b = new Date(s.endAt).getTime();
          return t >= a && t < b;
        }) ?? null
      );
    },
    []
  );

  /** 新增读数：自动判定 实测/补录、有效/待复核/待补录 */
  const addReading = useCallback(
    (input: AddReadingInput): AddReadingResult => {
      let result!: AddReadingResult;
      setState((prev) => {
        const shift = findShiftFor(prev.shifts, input.observedAt);
        const inConfirmedShift = !!shift?.signed;
        const source: Reading["source"] = inConfirmedShift
          ? "backfill"
          : "live";

        // 同一油舱同一观测时刻已有有效值 -> 只留一条有效值，新值待复核
        const dup = prev.readings.find(
          (r) =>
            r.tankId === input.tankId &&
            r.state === "valid" &&
            sameMinute(r.observedAt, input.observedAt)
        );

        let state: Reading["state"] = "valid";
        if (input.density == null) state = "pending_density";
        else if (dup) state = "pending_review";
        // 已确认班次时段内的补录（无重复时刻）也进入待复核，不回改原始读数
        if (inConfirmedShift && state === "valid") state = "pending_review";

        const reading: Reading = {
          id: uid(),
          tankId: input.tankId,
          observedAt: input.observedAt,
          level: input.level,
          temp: input.temp,
          density: input.density,
          source,
          state,
          shiftId: shift?.id ?? null,
          createdAt: new Date().toISOString(),
          note: input.note,
        };

        result = {
          reading,
          source,
          state,
          shiftId: shift?.id ?? null,
          duplicateOf: dup?.id ?? null,
        };
        return { ...prev, readings: [...prev.readings, reading] };
      });
      return result;
    },
    [findShiftFor]
  );

  /** 轮机长复核同时刻重复读数：保留一条为有效，其余作废 */
  const resolveDuplicate = useCallback(
    (pendingId: string, keepId: string) => {
      setState((prev) => ({
        ...prev,
        readings: prev.readings.map((r) => {
          if (r.id === keepId) return { ...r, state: "valid" as const };
          if (r.id === pendingId)
            return {
              ...r,
              state: "void" as const,
              reviewNote: "轮机长复核：同时刻重复，已作废",
            };
          // 同一油舱同一时刻的其他待复核件一并作废
          const keep = prev.readings.find((x) => x.id === keepId);
          if (
            keep &&
            r.id !== keepId &&
            r.tankId === keep.tankId &&
            sameMinute(r.observedAt, keep.observedAt) &&
            r.state === "pending_review"
          )
            return { ...r, state: "void" as const };
          return r;
        }),
      }));
    },
    []
  );

  /** 缺密度记录提交补录（密度补齐）：生成补录件进入待复核，原待补录件作废 */
  const supplementDensity = useCallback(
    (pendingId: string, density: number, temp?: number) => {
      setState((prev) => {
        const old = prev.readings.find((r) => r.id === pendingId);
        if (!old || old.density != null) return prev;
        const shift = findShiftFor(prev.shifts, old.observedAt);
        const reading: Reading = {
          id: uid(),
          tankId: old.tankId,
          observedAt: old.observedAt,
          level: old.level,
          temp: temp ?? old.temp,
          density,
          source: shift?.signed ? "backfill" : "backfill",
          state: "pending_review",
          shiftId: shift?.id ?? old.shiftId,
          createdAt: new Date().toISOString(),
          note: `缺密度补录（原记录 ${old.id.slice(0, 8)}…）`,
        };
        return {
          ...prev,
          readings: [
            ...prev.readings.map((r) =>
              r.id === pendingId
                ? {
                    ...r,
                    state: "void" as const,
                    reviewNote: "密度已补录，原件作废",
                  }
                : r
            ),
            reading,
          ],
        };
      });
    },
    [findShiftFor]
  );

  /** 轮机长复核通过补录件：补录只进历史，不回改已确认班次原始读数 */
  const approveBackfill = useCallback((id: string) => {
    setState((prev) => ({
      ...prev,
      readings: prev.readings.map((r) =>
        r.id === id
          ? {
              ...r,
              state: "valid" as const,
              reviewNote: "轮机长复核通过（补录件仅入历史）",
            }
          : r
      ),
    }));
  }, []);

  /** 修改班次交接参数 */
  const updateShift = useCallback(
    (shiftId: string, patch: Partial<Shift>) => {
      setState((prev) => ({
        ...prev,
        shifts: prev.shifts.map((s) =>
          s.id === shiftId ? { ...s, ...patch } : s
        ),
      }));
    },
    []
  );

  /** 交班签字：立即对账；差异超允许值则签字立即失效 */
  const signShift = useCallback((shiftId: string) => {
    setState((prev) => {
      const shift = prev.shifts.find((s) => s.id === shiftId);
      if (!shift) return prev;
      const snap = buildSnapshot(shift, prev.tanks, prev.readings);
      return {
        ...prev,
        shifts: prev.shifts.map((s) =>
          s.id === shiftId
            ? {
                ...s,
                signed: true,
                signedAt: new Date().toISOString(),
                signatureInvalid: !snap.passed,
                snapshot: snap,
              }
            : s
        ),
      };
    });
  }, []);

  /** 轮机长复核班次：重新对账，通过则恢复签字 */
  const reviewShift = useCallback((shiftId: string) => {
    setState((prev) => {
      const shift = prev.shifts.find((s) => s.id === shiftId);
      if (!shift) return prev;
      const snap = buildSnapshot(shift, prev.tanks, prev.readings);
      return {
        ...prev,
        shifts: prev.shifts.map((s) =>
          s.id === shiftId
            ? {
                ...s,
                signatureInvalid: !snap.passed,
                signed: snap.passed ? true : s.signed,
                signedAt: snap.passed ? new Date().toISOString() : s.signedAt,
                snapshot: snap.passed ? snap : s.snapshot,
              }
            : s
        ),
      };
    });
  }, []);

  /** 导出 / 重置 */
  const exportData = useCallback(() => {
    const blob = new Blob([JSON.stringify(state, null, 2)], {
      type: "application/json",
    });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `油料与值守对账-${new Date().toISOString().slice(0, 10)}.json`;
    a.click();
    URL.revokeObjectURL(url);
  }, [state]);

  const resetData = useCallback(() => {
    const seed = buildSeed();
    setState(seed);
  }, []);

  const value = useMemo(
    () => ({
      ...state,
      addReading,
      resolveDuplicate,
      supplementDensity,
      approveBackfill,
      updateShift,
      signShift,
      reviewShift,
      exportData,
      resetData,
    }),
    [
      state,
      addReading,
      resolveDuplicate,
      supplementDensity,
      approveBackfill,
      updateShift,
      signShift,
      reviewShift,
      exportData,
      resetData,
    ]
  );

  return value;
}

export type Store = ReturnType<typeof useStore>;

/** 当前班次（含此刻） */
export function useCurrentShiftId(shifts: Shift[]): string {
  return useMemo(() => {
    const now = Date.now();
    const cur = shifts.find((s) => {
      const a = new Date(s.startAt).getTime();
      const b = new Date(s.endAt).getTime();
      return now >= a && now < b;
    });
    if (cur) return cur.id;
    // 否则取今天 12-16（演示班）
    const t = new Date();
    const dateStr = `${t.getFullYear()}-${String(t.getMonth() + 1).padStart(
      2,
      "0"
    )}-${String(t.getDate()).padStart(2, "0")}`;
    return (
      shifts.find((s) => s.date === dateStr && s.name === "12-16")?.id ??
      shifts[shifts.length - 1]?.id ??
      ""
    );
  }, [shifts]);
}

export { reconcile };
