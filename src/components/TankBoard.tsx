import { useMemo } from "react";
import type { Reading, Tank } from "../types";
import { KIND_LABEL, Badge } from "./bits";
import { calcStock, round2, vcf } from "../lib/fuel";

interface Props {
  tanks: Tank[];
  readings: Reading[];
  onSelectTank: (id: string) => void;
}

function Sparkline({ points }: { points: number[] }) {
  if (points.length < 2) return <div className="spark-empty">趋势不足</div>;
  const w = 220;
  const h = 56;
  const min = Math.min(...points);
  const max = Math.max(...points);
  const range = max - min || 1;
  const pad = 4;
  const xy = points.map((p, i) => [
    pad + (i * (w - pad * 2)) / (points.length - 1),
    pad + (1 - (p - min) / range) * (h - pad * 2),
  ]);
  const path = xy.map(([x, y], i) => `${i === 0 ? "M" : "L"}${x},${y}`).join(" ");
  return (
    <svg className="spark" viewBox={`0 0 ${w} ${h}`} preserveAspectRatio="none">
      <path d={path} fill="none" stroke="var(--primary)" strokeWidth="2" />
      {xy.map(([x, y], i) => (
        <circle key={i} cx={x} cy={y} r="2.4" fill="var(--primary)" />
      ))}
    </svg>
  );
}

export default function TankBoard({ tanks, readings, onSelectTank }: Props) {
  const cards = useMemo(() => {
    return tanks.map((tank) => {
      const valid = readings
        .filter((r) => r.tankId === tank.id && r.state === "valid")
        .sort((a, b) => +new Date(a.observedAt) - +new Date(b.observedAt));
      const latest = valid[valid.length - 1] ?? null;
      const stock =
        latest && latest.level != null && latest.temp != null && latest.density != null
          ? calcStock(tank, latest.level, latest.temp, latest.density)
          : null;
      const pendingDensity = readings.filter(
        (r) => r.tankId === tank.id && r.state === "pending_density"
      ).length;
      const pendingReview = readings.filter(
        (r) => r.tankId === tank.id && r.state === "pending_review"
      ).length;
      const backfillCount = readings.filter(
        (r) => r.tankId === tank.id && r.source === "backfill" && r.state === "valid"
      ).length;
      const series = valid
        .slice(-12)
        .map((r) =>
          r.level != null && r.temp != null && r.density != null
            ? calcStock(tank, r.level, r.temp, r.density).mass
            : null
        )
        .filter((v): v is number => v != null);
      return {
        tank,
        latest,
        stock,
        pendingDensity,
        pendingReview,
        backfillCount,
        series,
      };
    });
  }, [tanks, readings]);

  return (
    <section className="panel">
      <div className="heading">
        <div>
          <p>各舱按观测时刻读数 · 折算存量</p>
          <h2>油舱存量看板</h2>
        </div>
        <span className="board-hint">点击油舱可在趋势中高亮</span>
      </div>
      <div className="tank-grid">
        {cards.map(
          ({ tank, latest, stock, pendingDensity, pendingReview, backfillCount, series }) => (
            <article
              key={tank.id}
              className="tank-card"
              onClick={() => onSelectTank(tank.id)}
            >
              <header>
                <h3>{tank.name}</h3>
                <Badge tone="blue">{KIND_LABEL[tank.kind]}</Badge>
              </header>
              <div className="tank-mass">
                {stock ? (
                  <>
                    <strong>{stock.mass}</strong>
                    <span>t 折算存量</span>
                  </>
                ) : (
                  <strong className="mass-missing">待补录</strong>
                )}
              </div>
              <div className="tank-stats">
                <div>
                  <small>液位</small>
                  <b>{latest?.level ?? "—"} cm</b>
                </div>
                <div>
                  <small>温度</small>
                  <b>{latest?.temp ?? "—"} ℃</b>
                </div>
                <div>
                  <small>密度</small>
                  <b>{latest?.density ?? "—"}</b>
                </div>
                <div>
                  <small>15℃标准体积</small>
                  <b>{stock ? `${stock.v15} m³` : "—"}</b>
                </div>
              </div>
              {latest && (
                <p className="tank-formula">
                  观测体积 {stock?.vt ?? "—"} m³ × 密度 {latest.density ?? "—"} t/m³
                  {latest.temp != null && (
                    <>
                      {" "}
                      · VCF {round2(vcf(latest.temp))}（{latest.temp}℃→15℃）
                    </>
                  )}
                </p>
              )}
              <Sparkline points={series} />
              <footer className="tank-flags">
                {pendingDensity > 0 && <Badge tone="red">缺密度 {pendingDensity}</Badge>}
                {pendingReview > 0 && <Badge tone="amber">待复核 {pendingReview}</Badge>}
                {backfillCount > 0 && <Badge tone="purple">补录 {backfillCount}</Badge>}
                {!pendingDensity && !pendingReview && (
                  <Badge tone="green">读数完整</Badge>
                )}
              </footer>
            </article>
          )
        )}
      </div>
    </section>
  );
}
