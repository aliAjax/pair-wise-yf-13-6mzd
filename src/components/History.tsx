import { useMemo, useState } from "react";
import type { Reading, Tank } from "../types";
import { fmtDT, stockOf } from "../lib/fuel";
import { Badge, StateBadge } from "./bits";

interface Props {
  tanks: Tank[];
  readings: Reading[];
}

export default function History({ tanks, readings }: Props) {
  const [tankFilter, setTankFilter] = useState("all");
  const [stateFilter, setStateFilter] = useState("all");

  const tankName = (id: string) => tanks.find((t) => t.id === id)?.name ?? id;

  const rows = useMemo(() => {
    return readings
      .filter((r) => tankFilter === "all" || r.tankId === tankFilter)
      .filter((r) => stateFilter === "all" || r.state === stateFilter)
      .sort((a, b) => +new Date(b.observedAt) - +new Date(a.observedAt));
  }, [readings, tankFilter, stateFilter]);

  return (
    <section className="panel">
      <div className="heading">
        <div>
          <p>全部观测记录 · 补录只进历史</p>
          <h2>历史记录</h2>
        </div>
        <div className="history-filters">
          <select value={tankFilter} onChange={(e) => setTankFilter(e.target.value)}>
            <option value="all">全部油舱</option>
            {tanks.map((t) => (
              <option key={t.id} value={t.id}>
                {t.name}
              </option>
            ))}
          </select>
          <select value={stateFilter} onChange={(e) => setStateFilter(e.target.value)}>
            <option value="all">全部状态</option>
            <option value="valid">有效</option>
            <option value="pending_review">待复核</option>
            <option value="pending_density">待补录</option>
            <option value="void">作废</option>
          </select>
        </div>
      </div>

      <div className="history-table">
        <div className="history-row history-head">
          <span>观测时刻</span>
          <span>油舱</span>
          <span>液位</span>
          <span>温度</span>
          <span>密度</span>
          <span>折算存量</span>
          <span>来源</span>
          <span>状态</span>
          <span>备注</span>
        </div>
        {rows.map((r) => {
          const tank = tanks.find((t) => t.id === r.tankId);
          const stock = tank ? stockOf(tank, r) : null;
          return (
            <div className="history-row" key={r.id}>
              <span>{fmtDT(r.observedAt)}</span>
              <span>{tankName(r.tankId)}</span>
              <span>{r.level ?? "—"} cm</span>
              <span>{r.temp ?? "—"} ℃</span>
              <span>{r.density ?? "—"}</span>
              <span>{stock ? `${stock.mass} t` : "—"}</span>
              <span>
                {r.source === "backfill" ? (
                  <Badge tone="purple">补录</Badge>
                ) : (
                  <Badge tone="blue">实测</Badge>
                )}
              </span>
              <span>
                <StateBadge state={r.state} />
              </span>
              <span className="history-note">{r.note ?? r.reviewNote ?? "—"}</span>
            </div>
          );
        })}
        {rows.length === 0 && (
          <p className="history-empty">当前筛选条件下无记录。</p>
        )}
      </div>
    </section>
  );
}
