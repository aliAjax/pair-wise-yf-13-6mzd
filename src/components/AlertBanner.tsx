import type { Reading, Shift, Tank } from "../types";

interface Props {
  shifts: Shift[];
  readings: Reading[];
  tanks: Tank[];
  onJumpShift: (id: string) => void;
  onJumpQueue: () => void;
}

export default function AlertBanner({
  shifts,
  readings,
  tanks,
  onJumpShift,
  onJumpQueue,
}: Props) {
  const invalidShifts = shifts.filter((s) => s.signatureInvalid);
  const pendingDensity = readings.filter((r) => r.state === "pending_density");
  const pendingReview = readings.filter((r) => r.state === "pending_review");

  if (!invalidShifts.length && !pendingDensity.length && !pendingReview.length)
    return null;

  const tankName = (id: string) => tanks.find((t) => t.id === id)?.name ?? id;

  return (
    <section className="panel alert-panel">
      <div className="alert-list">
        {invalidShifts.map((s) => {
          const diffTanks =
            s.snapshot?.differential.filter((d) => d.level === "error") ?? [];
          return (
            <div className="alert alert-red" key={s.id}>
              <strong>
                {s.date.slice(5)} {s.name}班 交接签字已失效
              </strong>
              <span>
                差异油舱：
                {diffTanks.length
                  ? diffTanks.map((d) => tankName(d.tankId)).join("、")
                  : "—"}
                ；差异 {s.snapshot?.diff ?? "?"}t（允许 {s.allowableDiff}t）
              </span>
              <button onClick={() => onJumpShift(s.id)}>前往处理</button>
            </div>
          );
        })}
        {pendingDensity.length > 0 && (
          <div className="alert alert-amber">
            <strong>{pendingDensity.length} 条旧记录缺密度，待补录</strong>
            <span>补录仅进入历史，不回改已确认班次原始读数</span>
            <button onClick={onJumpQueue}>去补录</button>
          </div>
        )}
        {pendingReview.length > 0 && (
          <div className="alert alert-amber">
            <strong>{pendingReview.length} 条读数待轮机长复核</strong>
            <span>同一观测时刻只保留一条有效值</span>
            <button onClick={onJumpQueue}>去复核</button>
          </div>
        )}
      </div>
    </section>
  );
}
