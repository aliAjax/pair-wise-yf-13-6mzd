import { useState } from "react";
import type { Reading, Shift, Tank } from "../types";
import { fmtDT } from "../lib/fuel";
import { Badge, StateBadge } from "./bits";

interface Props {
  tanks: Tank[];
  readings: Reading[];
  shifts: Shift[];
  onSupplement: (id: string, density: number) => void;
  onResolve: (pendingId: string, keepId: string) => void;
  onApprove: (id: string) => void;
  onSign: (id: string) => void;
  onReview: (id: string) => void;
}

function DensityForm({ onSubmit }: { onSubmit: (d: number) => void }) {
  const [val, setVal] = useState("");
  return (
    <div className="inline-form">
      <input
        type="number"
        step="0.001"
        placeholder="补录密度 g/cm³"
        value={val}
        onChange={(e) => setVal(e.target.value)}
      />
      <button
        className="primary"
        onClick={() => val && onSubmit(Number(val))}
        disabled={!val}
      >
        提交补录
      </button>
    </div>
  );
}

export default function ReviewQueue({
  tanks,
  readings,
  shifts,
  onSupplement,
  onResolve,
  onApprove,
  onSign,
  onReview,
}: Props) {
  const tankName = (id: string) => tanks.find((t) => t.id === id)?.name ?? id;

  const pendingDensity = readings.filter((r) => r.state === "pending_density");
  const pendingReview = readings.filter((r) => r.state === "pending_review");
  const invalidShifts = shifts.filter((s) => s.signatureInvalid);

  // 按同时刻分组待复核件
  const reviewGroups: { key: string; items: Reading[]; valid: Reading | null }[] = [];
  for (const r of pendingReview) {
    const key = `${r.tankId}|${r.observedAt.slice(0, 16)}`;
    let g = reviewGroups.find((x) => x.key === key);
    if (!g) {
      g = { key, items: [], valid: null };
      reviewGroups.push(g);
    }
    g.items.push(r);
  }
  for (const g of reviewGroups) {
    const [tankId, minute] = g.key.split("|");
    g.valid =
      readings.find(
        (r) =>
          r.tankId === tankId &&
          r.state === "valid" &&
          r.observedAt.slice(0, 16) === minute
      ) ?? null;
  }

  const total = pendingDensity.length + pendingReview.length + invalidShifts.length;

  return (
    <section className="panel" id="review-queue">
      <div className="heading">
        <div>
          <p>待补录 · 待轮机长复核 · 签字失效</p>
          <h2>复核队列{total ? `（${total}）` : ""}</h2>
        </div>
      </div>

      {total === 0 && <p className="queue-empty">无待办事项，记录完整、班次签字有效。</p>}

      {invalidShifts.map((s) => (
        <div className="queue-card queue-red" key={s.id}>
          <div className="queue-head">
            <Badge tone="red">签字失效</Badge>
            <strong>
              {s.date.slice(5)} {s.name}班
            </strong>
            <span className="queue-meta">
              差异 {s.snapshot?.diff ?? "?"}t（允许 {s.allowableDiff}t）
            </span>
          </div>
          <ul className="queue-reasons">
            {s.snapshot?.differential.map((d, i) => (
              <li key={i}>
                <Badge tone="red">{d.level === "error" ? "异常" : "差异"}</Badge>
                {tankName(d.tankId)} — {d.reason}
              </li>
            ))}
          </ul>
          <div className="queue-actions">
            <button className="primary" onClick={() => onSign(s.id)}>
              补录 / 复核后重新签字
            </button>
            <button className="danger" onClick={() => onReview(s.id)}>
              轮机长复核通过
            </button>
          </div>
        </div>
      ))}

      {pendingDensity.map((r) => (
        <div className="queue-card queue-amber" key={r.id}>
          <div className="queue-head">
            <Badge tone="red">待补录密度</Badge>
            <strong>{tankName(r.tankId)}</strong>
            <span className="queue-meta">{fmtDT(r.observedAt)}</span>
          </div>
          <p className="queue-desc">
            液位 {r.level ?? "—"}cm · 温度 {r.temp ?? "—"}℃ · 密度缺失
            {r.note ? `（${r.note}）` : ""}
          </p>
          <DensityForm onSubmit={(d) => onSupplement(r.id, d)} />
          <p className="queue-note">补录件进入待复核，不回改已确认班次原始读数。</p>
        </div>
      ))}

      {reviewGroups.map((g) => (
        <div className="queue-card queue-amber" key={g.key}>
          <div className="queue-head">
            <Badge tone="amber">待复核</Badge>
            <strong>{tankName(g.items[0].tankId)}</strong>
            <span className="queue-meta">{fmtDT(g.items[0].observedAt)}</span>
          </div>
          {g.valid ? (
            <>
              <p className="queue-desc">同一观测时刻存在两条读数，需取唯一有效值：</p>
              <div className="dup-grid">
                <div className="dup-col">
                  <h4>当前有效值</h4>
                  <ReadingRow r={g.valid} />
                </div>
                {g.items.map((r) => (
                  <div className="dup-col" key={r.id}>
                    <h4>
                      {r.source === "backfill" ? "纸表补录件" : "手抄件"}
                    </h4>
                    <ReadingRow r={r} />
                    <button
                      className="primary"
                      onClick={() => onResolve(r.id, g.valid!.id)}
                    >
                      保留当前值，作废此件
                    </button>
                  </div>
                ))}
              </div>
            </>
          ) : (
            <>
              <p className="queue-desc">
                晚到补录件（{g.items[0].source === "backfill" ? "纸表补录" : "当班"}
                ），等待轮机长复核后入历史：
              </p>
              <div className="dup-grid">
                {g.items.map((r) => (
                  <div className="dup-col" key={r.id}>
                    <h4>补录件</h4>
                    <ReadingRow r={r} />
                    <button className="primary" onClick={() => onApprove(r.id)}>
                      轮机长复核通过
                    </button>
                  </div>
                ))}
              </div>
            </>
          )}
        </div>
      ))}
    </section>
  );
}

function ReadingRow({ r }: { r: Reading }) {
  return (
    <div className="reading-row">
      <span>{fmtDT(r.observedAt)}</span>
      <span>液位 {r.level ?? "—"}cm</span>
      <span>温度 {r.temp ?? "—"}℃</span>
      <span>密度 {r.density ?? "—"}</span>
      <StateBadge state={r.state} />
      {r.note && <small className="reading-note">{r.note}</small>}
    </div>
  );
}
