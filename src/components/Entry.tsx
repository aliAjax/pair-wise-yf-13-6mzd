import { useMemo, useState } from "react";
import {
  Reading,
  fmtDT,
  fmtNum,
  readingMass,
  round,
  sameObservationMoment,
  watchBlock,
  watchLabel,
} from "../domain";
import { useStore } from "../store";
import { Badge, Modal } from "./ui";

function nowLocalInput(): string {
  const d = new Date();
  const p = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}T${p(d.getHours())}:00`;
}

interface RowDraft {
  tankId: string;
  level: string;
  temp: string;
  density: string;
}

export default function Entry() {
  const { data, addReading } = useStore();
  const [observedAt, setObservedAt] = useState(nowLocalInput());
  const [source, setSource] = useState<"现场" | "补录">("现场");
  const [rows, setRows] = useState<RowDraft[]>(
    data.tanks.map((t) => ({
      tankId: t.id,
      level: "",
      temp: "",
      density: String(t.standardDensity),
    })),
  );
  const [note, setNote] = useState("");
  const [pendingResult, setPendingResult] = useState<{
    tankName: string;
    candidateId?: string;
    message: string;
  } | null>(null);
  const [savedFlash, setSavedFlash] = useState<string | null>(null);

  const block = observedAt ? watchBlock(new Date(observedAt)) : null;
  const blockWatch = block ? data.watches.find((w) => w.id === block.id) : null;

  const clashMap = useMemo(() => {
    if (!observedAt) return new Map<string, Reading>();
    const t = new Date(observedAt);
    const m = new Map<string, Reading>();
    for (const r of data.readings) {
      if (
        (r.status === "active" || r.status === "pending") &&
        sameObservationMoment(new Date(r.observedAt), t)
      ) {
        m.set(r.tankId, r);
      }
    }
    return m;
  }, [data.readings, observedAt]);

  const update = (tankId: string, patch: Partial<RowDraft>) =>
    setRows((rs) => rs.map((r) => (r.tankId === tankId ? { ...r, ...patch } : r)));

  const previewMass = (row: RowDraft): number | null => {
    const tank = data.tanks.find((t) => t.id === row.tankId);
    const level = parseFloat(row.level);
    const density = parseFloat(row.density);
    const temp = parseFloat(row.temp);
    if (!tank || Number.isNaN(level) || Number.isNaN(density)) return null;
    const volume = (level * tank.kgPerCm) / density;
    const corrected = volume * (1 + ((Number.isNaN(temp) ? 15 : temp) - 15) * data.settings.tolerance.thermalPerDegree);
    return round(corrected * density, 3);
  };

  const filledRows = rows.filter((r) => r.level.trim() !== "");

  const submit = () => {
    if (!observedAt) return;
    let saved = 0;
    let pendingTank = "";
    for (const row of filledRows) {
      const level = parseFloat(row.level);
      const temp = parseFloat(row.temp);
      const density = parseFloat(row.density);
      if (Number.isNaN(level) || Number.isNaN(temp) || Number.isNaN(density)) continue;
      const out = addReading({
        tankId: row.tankId,
        observedAt,
        levelCm: level,
        temperatureC: temp,
        density,
        source,
        note: note.trim() || undefined,
      });
      if (out.kind === "saved") saved++;
      else pendingTank = data.tanks.find((t) => t.id === row.tankId)?.name ?? "";
    }
    if (saved) setSavedFlash(`已保存 ${saved} 个油舱的读数（观测时刻 ${fmtDT(new Date(observedAt))}）`);
    if (pendingTank)
      setPendingResult({
        tankName: pendingTank,
        message:
          source === "补录"
            ? "晚到补录与已确认班次的原始读数同一观测时刻：补录只进历史，不能回改原始读数；已转入「历史与复核」等待轮机长裁定保留哪一条。"
            : "同一观测时刻在已确认班次中已有读数，不能回改；新读数已转入待复核队列。",
      });
    setRows((rs) => rs.map((r) => ({ ...r, level: "", temp: "" })));
    setNote("");
    setTimeout(() => setSavedFlash(null), 4000);
  };

  const recent = useMemo(
    () =>
      [...data.readings]
        .filter((r) => r.status !== "rejected")
        .sort((a, b) => +new Date(b.createdAt) - +new Date(a.createdAt))
        .slice(0, 8),
    [data.readings],
  );

  return (
    <div className="tab-page entry-layout">
      <section className="panel">
        <div className="heading">
          <div>
            <p>每班抄表 · 按观测时刻保存</p>
            <h2>油舱液位 / 温度 / 密度录入</h2>
          </div>
        </div>

        <div className="entry-meta">
          <label className="field">
            <span>观测时刻（同一舱同一时刻只保留一条有效值）</span>
            <input type="datetime-local" value={observedAt} onChange={(e) => setObservedAt(e.target.value)} step={60} />
          </label>
          <div className="source-toggle" role="radiogroup" aria-label="数据来源">
            <button className={source === "现场" ? "toggle-on" : ""} onClick={() => setSource("现场")}>
              现场抄表
            </button>
            <button className={source === "补录" ? "toggle-on" : ""} onClick={() => setSource("补录")}>
              纸表补录（晚到）
            </button>
          </div>
          {block && blockWatch ? (
            <div className={`entry-watch ${blockWatch.confirmed ? "entry-watch-locked" : ""}`}>
              归属班次：<b>{watchLabel(block)}</b>
              {blockWatch.confirmed ? (
                <Badge tone="bad">该班已确认封存 · 补录不回改原始读数</Badge>
              ) : (
                <Badge tone="ok">进行中/未确认 · 同刻可直接更正</Badge>
              )}
            </div>
          ) : (
            <div className="entry-watch">
              归属班次：<b>{block ? watchLabel(block) : "—"}</b>
              <Badge>新班次将自动建立</Badge>
            </div>
          )}
        </div>

        <div className="entry-table">
          <table>
            <thead>
              <tr>
                <th>油舱</th>
                <th>液位 cm</th>
                <th>温度 ℃</th>
                <th>密度 g/cm³</th>
                <th>折算存量（吨）</th>
                <th>同刻已有值</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((row) => {
                const tank = data.tanks.find((t) => t.id === row.tankId)!;
                const clash = clashMap.get(row.tankId);
                const clashMass = clash
                  ? readingMass(clash, tank, data.settings.tolerance.thermalPerDegree)
                  : null;
                return (
                  <tr key={row.tankId} className={clash && blockWatch?.confirmed ? "row-clash" : ""}>
                    <td>
                      <span className="tank-dot" style={{ background: tank.color }} />
                      {tank.name}
                    </td>
                    <td>
                      <input
                        inputMode="decimal"
                        placeholder={`≤ ${tank.capacityCm}`}
                        value={row.level}
                        onChange={(e) => update(row.tankId, { level: e.target.value })}
                      />
                    </td>
                    <td>
                      <input
                        inputMode="decimal"
                        placeholder="如 42.0"
                        value={row.temp}
                        onChange={(e) => update(row.tankId, { temp: e.target.value })}
                      />
                    </td>
                    <td>
                      <input
                        inputMode="decimal"
                        value={row.density}
                        onChange={(e) => update(row.tankId, { density: e.target.value })}
                      />
                    </td>
                    <td className="mass-preview">{previewMass(row) != null ? fmtNum(previewMass(row), 3) : "—"}</td>
                    <td>
                      {clash ? (
                        <span className="clash-info">
                          <Badge tone={blockWatch?.confirmed ? "bad" : "warn"}>
                            {blockWatch?.confirmed ? "已封存" : clash.status === "pending" ? "待复核" : "可覆盖"}
                          </Badge>
                          <small>
                            {fmtNum(clash.levelCm, 1)} cm / {fmtNum(clashMass, 2)} t
                          </small>
                        </span>
                      ) : (
                        <span className="muted">无</span>
                      )}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>

        <label className="field note-field">
          <span>备注（可选）</span>
          <input value={note} onChange={(e) => setNote(e.target.value)} placeholder="如：测量时左倾 0.5°，纸表第 12 页" />
        </label>

        <div className="entry-actions">
          <button className="primary" disabled={!filledRows.length} onClick={submit}>
            {source === "补录" ? "提交补录（进入历史）" : `保存 ${filledRows.length || ""} 个舱的读数`}
          </button>
          {savedFlash ? <span className="flash-ok">{savedFlash}</span> : null}
          <span className="muted">
            折算规则：舱容(液位) × 温度修正 × 实测密度；油耗只认相邻两次实测折算存量之差。
          </span>
        </div>
      </section>

      <section className="panel">
        <div className="heading">
          <div>
            <p>最近保存</p>
            <h2>读数时间线</h2>
          </div>
        </div>
        <div className="timeline">
          {recent.map((r) => {
            const tank = data.tanks.find((t) => t.id === r.tankId);
            return (
              <div key={r.id} className={`tl-item tl-${r.status}`}>
                <span className="tank-dot" style={{ background: tank?.color }} />
                <div>
                  <b>{tank?.name}</b>
                  <span className="muted"> {fmtDT(r.observedAt)}</span>
                  <div className="tl-tags">
                    <Badge tone={r.source === "补录" ? "purple" : "neutral"}>{r.source}</Badge>
                    {r.status === "pending" && <Badge tone="warn">待复核</Badge>}
                    {r.status === "superseded" && <Badge>已被取代留痕</Badge>}
                    {r.density == null && <Badge tone="warn">缺密度·待补录</Badge>}
                  </div>
                  <small className="muted">
                    液位 {fmtNum(r.levelCm, 1)} cm · 温度 {fmtNum(r.temperatureC, 1)} ℃ · 密度{" "}
                    {fmtNum(r.density, 3)}
                    {r.note ? ` · ${r.note}` : ""}
                  </small>
                </div>
              </div>
            );
          })}
        </div>
      </section>

      <Modal
        open={!!pendingResult}
        title="补录已进入复核队列"
        onClose={() => setPendingResult(null)}
        footer={
          <button className="primary" onClick={() => setPendingResult(null)}>
            知道了
          </button>
        }
      >
        <p>
          <b>{pendingResult?.tankName}</b>：{pendingResult?.message}
        </p>
      </Modal>
    </div>
  );
}
