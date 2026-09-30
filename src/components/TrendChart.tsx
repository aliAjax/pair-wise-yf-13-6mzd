import { useMemo, useState } from "react";
import type { Reading, Tank } from "../types";
import { stockOf } from "../lib/fuel";

interface Props {
  tanks: Tank[];
  readings: Reading[];
  highlightTankId?: string | null;
}

const COLORS = ["#0f766e", "#2563eb", "#f97316", "#7c3aed"];

export default function TrendChart({ tanks, readings, highlightTankId }: Props) {
  const [hidden, setHidden] = useState<Set<string>>(new Set());

  const data = useMemo(() => {
    const all = readings
      .map((r) => ({ r, t: new Date(r.observedAt).getTime() }))
      .sort((a, b) => a.t - b.t);
    const validAll = all.filter((x) => x.r.state === "valid");
    const masses = validAll
      .map((x) => {
        const tank = tanks.find((t) => t.id === x.r.tankId);
        return tank ? stockOf(tank, x.r)?.mass ?? null : null;
      })
      .filter((v): v is number => v != null);
    const tMin = all.length ? all[0].t : Date.now() - 86400000;
    const tMax = all.length ? all[all.length - 1].t : Date.now();
    const mMin = masses.length ? Math.min(...masses) : 0;
    const mMax = masses.length ? Math.max(...masses) : 100;
    return { all, tMin, tMax, mMin, mMax };
  }, [readings, tanks]);

  const W = 760;
  const H = 280;
  const padL = 46;
  const padR = 16;
  const padT = 16;
  const padB = 30;

  const xOf = (t: number) =>
    padL + ((t - data.tMin) / Math.max(data.tMax - data.tMin, 1)) * (W - padL - padR);
  const yOf = (m: number) =>
    padT + (1 - (m - data.mMin) / Math.max(data.mMax - data.mMin, 0.01)) * (H - padT - padB);

  const toggle = (id: string) => {
    setHidden((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  const timeTicks = useMemo(() => {
    const ticks: { t: number; label: string }[] = [];
    const span = Math.max(data.tMax - data.tMin, 1);
    const step = span <= 86400000 ? 4 * 3600000 : 6 * 3600000;
    const start = Math.ceil(data.tMin / step) * step;
    for (let t = start; t <= data.tMax; t += step) {
      const d = new Date(t);
      ticks.push({
        t,
        label: `${String(d.getMonth() + 1).padStart(2, "0")}-${String(
          d.getDate()
        ).padStart(2, "0")} ${String(d.getHours()).padStart(2, "0")}:00`,
      });
    }
    return ticks;
  }, [data]);

  return (
    <section className="panel">
      <div className="heading">
        <div>
          <p>存量趋势 · 补录点与待复核点单独标记</p>
          <h2>油舱存量趋势</h2>
        </div>
        <div className="legend">
          {tanks.map((t, i) => (
            <button
              key={t.id}
              className={`legend-item ${hidden.has(t.id) ? "off" : ""} ${
                highlightTankId === t.id ? "highlight" : ""
              }`}
              onClick={() => toggle(t.id)}
            >
              <span className="legend-swatch" style={{ background: COLORS[i % COLORS.length] }} />
              {t.name}
            </button>
          ))}
        </div>
      </div>
      <div className="chart-wrap">
        <svg viewBox={`0 0 ${W} ${H}`} className="chart">
          {[0, 0.25, 0.5, 0.75, 1].map((g) => {
            const y = padT + g * (H - padT - padB);
            const m = data.mMax - g * (data.mMax - data.mMin);
            return (
              <g key={g}>
                <line x1={padL} y1={y} x2={W - padR} y2={y} stroke="#e2e8f0" />
                <text x={padL - 6} y={y + 3} fontSize="10" fill="#94a3b8" textAnchor="end">
                  {m.toFixed(0)}t
                </text>
              </g>
            );
          })}
          {timeTicks.map((tk) => (
            <text key={tk.t} x={xOf(tk.t)} y={H - 8} fontSize="10" fill="#94a3b8" textAnchor="middle">
              {tk.label}
            </text>
          ))}

          {tanks.map((tank, i) => {
            if (hidden.has(tank.id)) return null;
            const color = COLORS[i % COLORS.length];
            const pts = data.all
              .filter((x) => x.r.tankId === tank.id && x.r.state === "valid")
              .map((x) => ({ x: xOf(x.t), y: yOf(stockOf(tank, x.r)!.mass), r: x.r }));
            const line = pts.map((p, j) => `${j === 0 ? "M" : "L"}${p.x},${p.y}`).join(" ");
            return (
              <g key={tank.id}>
                <path d={line} fill="none" stroke={color} strokeWidth="2" />
                {pts.map((p, j) => (
                  <circle key={j} cx={p.x} cy={p.y} r="3" fill={color} />
                ))}
              </g>
            );
          })}

          {/* 待补录 / 待复核 / 补录点标记 */}
          {data.all
            .filter(
              (x) =>
                x.r.state === "pending_density" ||
                x.r.state === "pending_review" ||
                (x.r.source === "backfill" && x.r.state === "valid")
            )
            .map((x) => {
              const tank = tanks.find((t) => t.id === x.r.tankId)!;
              const color = COLORS[tanks.indexOf(tank) % COLORS.length];
              const y =
                x.r.state === "pending_density"
                  ? yOf(data.mMin) - 6
                  : yOf(
                      stockOf(tank, { ...x.r, density: x.r.density ?? 0.9 })?.mass ??
                        (data.mMin + data.mMax) / 2
                    );
              return (
                <g key={x.r.id}>
                  {x.r.state === "pending_density" ? (
                    <text x={xOf(x.t)} y={y} fontSize="11" textAnchor="middle">
                  △
                    </text>
                  ) : x.r.state === "pending_review" ? (
                    <circle
                      cx={xOf(x.t)}
                      cy={y}
                      r="5"
                      fill="#fff"
                      stroke="#f97316"
                      strokeWidth="2"
                    />
                  ) : (
                    <rect
                      x={xOf(x.t) - 4}
                      y={y - 4}
                      width="8"
                      height="8"
                      fill="#7c3aed"
                    />
                  )}
                </g>
              );
            })}
        </svg>
        <div className="chart-legend">
          <span><i className="lg lg-line" />有效读数</span>
          <span><i className="lg lg-circle" />待复核（同时刻重复）</span>
          <span><i className="lg lg-diamond" />补录件（仅历史）</span>
          <span><i className="lg lg-tri" />缺密度待补录</span>
        </div>
      </div>
    </section>
  );
}
