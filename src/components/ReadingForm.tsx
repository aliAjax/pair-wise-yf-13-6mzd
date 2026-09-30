import { useMemo, useState } from "react";
import type { Reading, Shift, Tank } from "../types";
import { calcStock, fmtDT, toLocalInput } from "../lib/fuel";

interface Props {
  tanks: Tank[];
  shifts: Shift[];
  readings: Reading[];
  defaultTankId?: string;
  onSubmit: (input: {
    tankId: string;
    observedAt: string;
    level: number | null;
    temp: number | null;
    density: number | null;
    note?: string;
  }) => { state: string; source: string; shiftId: string | null; duplicateOf: string | null };
}

export default function ReadingForm({ tanks, shifts, readings, defaultTankId, onSubmit }: Props) {
  const [tankId, setTankId] = useState(defaultTankId ?? tanks[0]?.id ?? "");
  const [time, setTime] = useState(toLocalInput(new Date()));
  const [level, setLevel] = useState("");
  const [temp, setTemp] = useState("");
  const [density, setDensity] = useState("");
  const [note, setNote] = useState("");
  const [msg, setMsg] = useState<{ tone: "green" | "amber" | "red"; text: string } | null>(null);

  const tank = tanks.find((t) => t.id === tankId) ?? tanks[0];
  const observedAt = useMemo(() => new Date(time).toISOString(), [time]);

  const shift = useMemo(
    () =>
      shifts.find((s) => {
        const t = new Date(observedAt).getTime();
        return t >= new Date(s.startAt).getTime() && t < new Date(s.endAt).getTime();
      }) ?? null,
    [shifts, observedAt]
  );

  const dup = useMemo(
    () =>
      readings.some(
        (r) =>
          r.tankId === tankId &&
          r.state === "valid" &&
          r.observedAt.slice(0, 16) === observedAt.slice(0, 16)
      ),
    [readings, tankId, observedAt]
  );

  const stock = useMemo(() => {
    if (!tank || level === "" || temp === "" || density === "") return null;
    const l = Number(level);
    const tp = Number(temp);
    const dn = Number(density);
    if (![l, tp, dn].every((n) => Number.isFinite(n))) return null;
    return calcStock(tank, l, tp, dn);
  }, [tank, level, temp, density]);

  const hints: { tone: "green" | "amber" | "red"; text: string }[] = [];
  if (shift?.signed)
    hints.push({
      tone: "amber",
      text: `该时刻位于已确认的 ${shift.date.slice(5)} ${shift.name}班（已签字）：本次按“补录”进入历史，不回改该班原始读数。`,
    });
  if (dup)
    hints.push({
      tone: "amber",
      text: "同一油舱该观测时刻已有有效值：新读数进入“待复核”，同一时刻只保留一条有效值，等待轮机长复核。",
    });
  if (density === "")
    hints.push({
      tone: "red",
      text: "未填密度：该记录将迁移为“待补录”，暂不参与存量折算与对账。",
    });

  const submit = () => {
    if (!tank) return;
    const res = onSubmit({
      tankId,
      observedAt,
      level: level === "" ? null : Number(level),
      temp: temp === "" ? null : Number(temp),
      density: density === "" ? null : Number(density),
      note: note || undefined,
    });
    setMsg(
      res.state === "valid"
        ? { tone: "green", text: `已保存为有效读数（${res.source === "backfill" ? "补录" : "当班实测"}）。` }
        : res.state === "pending_density"
        ? { tone: "red", text: "已保存：缺密度，状态为待补录。请到待办队列补录密度。" }
        : { tone: "amber", text: "已保存：状态为待复核，等待轮机长取唯一有效值。" }
    );
    setNote("");
  };

  return (
    <section className="panel form-panel">
      <div className="heading">
        <div>
          <p>各舱按观测时刻保存读数</p>
          <h2>读数录入</h2>
        </div>
      </div>
      <div className="field-grid">
        <label>
          <span>油舱</span>
          <select value={tankId} onChange={(e) => setTankId(e.target.value)}>
            {tanks.map((t) => (
              <option key={t.id} value={t.id}>
                {t.name}
              </option>
            ))}
          </select>
        </label>
        <label>
          <span>观测时刻</span>
          <input
            type="datetime-local"
            value={time}
            onChange={(e) => setTime(e.target.value)}
          />
        </label>
        <label>
          <span>液位 cm</span>
          <input
            type="number"
            value={level}
            placeholder="如 232"
            onChange={(e) => setLevel(e.target.value)}
          />
        </label>
        <label>
          <span>温度 ℃</span>
          <input
            type="number"
            value={temp}
            placeholder="如 47"
            onChange={(e) => setTemp(e.target.value)}
          />
        </label>
        <label>
          <span>密度 g/cm³</span>
          <input
            type="number"
            step="0.001"
            value={density}
            placeholder="如 0.95（缺填则待补录）"
            onChange={(e) => setDensity(e.target.value)}
          />
        </label>
        <label>
          <span>备注</span>
          <input
            value={note}
            placeholder="纸表/手抄、异常说明等"
            onChange={(e) => setNote(e.target.value)}
          />
        </label>
      </div>

      {hints.length > 0 && (
        <div className="hint-list">
          {hints.map((h, i) => (
            <p key={i} className={`hint hint-${h.tone}`}>
              {h.text}
            </p>
          ))}
        </div>
      )}

      <div className="stock-preview">
        {stock ? (
          <>
            折算存量：<b>{stock.mass} t</b>
            <span>
              （观测体积 {stock.vt} m³ × 密度 {density} t/m³；15℃标准体积{" "}
              {stock.v15} m³，标准密度 {stock.rho15} t/m³）
            </span>
          </>
        ) : (
          <span className="preview-empty">
            填写液位 / 温度 / 密度后自动折算存量；缺密度记录进入待补录。
          </span>
        )}
      </div>

      <div className="form-footer">
        <button className="primary" onClick={submit}>
          保存读数
        </button>
        {shift && (
          <span className="shift-tag">
            所属班次：{shift.date.slice(5)} {shift.name}班
            {shift.signed ? "（已确认，补录入历史）" : "（当班）"}
          </span>
        )}
      </div>
      {msg && <p className={`form-msg msg-${msg.tone}`}>{msg.text}</p>}
      <p className="now-hint">当前时刻 {fmtDT(new Date().toISOString())}</p>
    </section>
  );
}
