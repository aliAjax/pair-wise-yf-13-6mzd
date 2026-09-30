import { useEffect, type ReactNode } from "react";
import { fmtNum } from "../domain";

export function Badge({
  tone = "neutral",
  children,
}: {
  tone?: "neutral" | "ok" | "warn" | "bad" | "info" | "purple";
  children: ReactNode;
}) {
  return <span className={`badge badge-${tone}`}>{children}</span>;
}

export function Stat({
  label,
  value,
  unit,
  tone,
  hint,
}: {
  label: string;
  value: ReactNode;
  unit?: string;
  tone?: "ok" | "warn" | "bad" | "neutral";
  hint?: string;
}) {
  return (
    <article className={`stat stat-${tone ?? "neutral"}`}>
      <small>{label}</small>
      <strong>
        {value}
        {unit ? <em>{unit}</em> : null}
      </strong>
      {hint ? <span className="stat-hint">{hint}</span> : null}
    </article>
  );
}

export function Modal({
  open,
  title,
  onClose,
  children,
  footer,
  wide,
}: {
  open: boolean;
  title: string;
  onClose: () => void;
  children: ReactNode;
  footer?: ReactNode;
  wide?: boolean;
}) {
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open, onClose]);

  if (!open) return null;
  return (
    <div className="modal-mask" onClick={onClose}>
      <div className={`modal ${wide ? "modal-wide" : ""}`} onClick={(e) => e.stopPropagation()}>
        <header>
          <h3>{title}</h3>
          <button className="icon-btn" onClick={onClose} aria-label="关闭">
            ✕
          </button>
        </header>
        <div className="modal-body">{children}</div>
        {footer ? <footer>{footer}</footer> : null}
      </div>
    </div>
  );
}

export interface ChartPoint {
  t: Date;
  v: number | null;
}

/** 纯 SVG 折线图（无第三方依赖） */
export function LineChart({
  series,
  height = 150,
  yUnit = "",
  markTanks,
}: {
  series: Array<{
    key: string;
    label: string;
    color: string;
    points: ChartPoint[];
  }>;
  height?: number;
  yUnit?: string;
  markTanks?: Set<string>;
}) {
  const width = 720;
  const padL = 46;
  const padR = 14;
  const padT = 12;
  const padB = 26;
  const allVals = series.flatMap((s) => s.points.map((p) => p.v).filter((v): v is number => v != null));
  if (!allVals.length) return <p className="empty">暂无可折算的数据点（缺密度的旧记录不计入）。</p>;
  const minV = Math.min(...allVals);
  const maxV = Math.max(...allVals);
  const span = maxV - minV || 1;
  const yMin = minV - span * 0.12;
  const yMax = maxV + span * 0.12;
  const allT = series[0]?.points.map((p) => p.t.getTime()) ?? [];
  const xMin = Math.min(...allT);
  const xMax = Math.max(...allT);
  const xSpan = xMax - xMin || 1;

  const x = (t: number) => padL + ((t - xMin) / xSpan) * (width - padL - padR);
  const y = (v: number) => padT + (1 - (v - yMin) / (yMax - yMin || 1)) * (height - padT - padB);

  const gridVals = [0, 0.25, 0.5, 0.75, 1].map((f) => yMin + f * (yMax - yMin));

  return (
    <svg className="line-chart" viewBox={`0 0 ${width} ${height}`} role="img">
      {gridVals.map((v, i) => (
        <g key={i}>
          <line x1={padL} x2={width - padR} y1={y(v)} y2={y(v)} className="grid" />
          <text x={padL - 6} y={y(v) + 3} className="axis" textAnchor="end">
            {fmtNum(v, v >= 10 ? 0 : 1)}
          </text>
        </g>
      ))}
      {series[0]?.points.map((p, i) =>
        i % 2 === 0 ? (
          <text key={i} x={x(p.t.getTime())} y={height - 8} className="axis" textAnchor="middle">
            {`${p.t.getMonth() + 1}/${p.t.getDate()} ${String(p.t.getHours()).padStart(2, "0")}:${String(p.t.getMinutes()).padStart(2, "0")}`}
          </text>
        ) : null,
      )}
      {series.map((s) => {
        const pts = s.points.filter((p) => p.v != null) as Array<{ t: Date; v: number }>;
        const path = pts
          .map((p, i) => `${i === 0 ? "M" : "L"}${x(p.t.getTime()).toFixed(1)},${y(p.v).toFixed(1)}`)
          .join(" ");
        const marked = markTanks?.has(s.key);
        return (
          <g key={s.key} className={marked ? "series-marked" : ""}>
            <path d={path} fill="none" stroke={s.color} strokeWidth={marked ? 3 : 1.8} />
            {pts.map((p, i) => (
              <circle key={i} cx={x(p.t.getTime())} cy={y(p.v)} r={marked ? 3.4 : 2.4} fill={s.color} />
            ))}
          </g>
        );
      })}
      {yUnit ? <text x={8} y={padT + 4} className="axis">{yUnit}</text> : null}
    </svg>
  );
}

export function Legend({
  items,
  markTanks,
}: {
  items: Array<{ key: string; label: string; color: string }>;
  markTanks?: Set<string>;
}) {
  return (
    <div className="legend">
      {items.map((it) => (
        <span key={it.key} className={markTanks?.has(it.key) ? "legend-marked" : ""}>
          <i style={{ background: it.color }} />
          {it.label}
          {markTanks?.has(it.key) ? <b className="legend-flag">差异</b> : null}
        </span>
      ))}
    </div>
  );
}
