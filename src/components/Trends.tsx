import { useState } from "react";
import {
  Watch,
  activeReadings,
  effectiveReconc,
  fmtNum,
  latestInvalidWatch,
  reconcileWatch,
  signedDiff,
  watchDayLabel,
  watchLabel,
} from "../domain";
import { useStore, tankMassHistory } from "../store";
import { Badge, Legend, LineChart } from "./ui";

function BarChart({ watches }: { watches: Watch[] }) {
  const { data } = useStore();
  const tol = data.settings.tolerance;
  const blocks = [...watches]
    .filter((w) => w.confirmed)
    .sort((a, b) => +new Date(a.start) - +new Date(b.start));
  if (!blocks.length) return <p className="empty">暂无已确认班次。</p>;
  const perTank = data.tanks.map((tank) => {
    const values = blocks.map((w) => {
      // 已签字班次以封存对账为准；失效未复签也展示封存值（即触发失效的那次）
      const r = effectiveReconc(w);
      return r?.lines.find((l) => l.tankId === tank.id)?.measuredConsumption ?? 0;
    });
    return { tank, values };
  });
  const maxStack = Math.max(
    1e-9,
    ...perTank.map((p) => p.values.reduce((s, v) => s + (v ?? 0), 0)),
  );
  const chartH = 170;
  const barW = 46;
  const gap = 26;
  const width = blocks.length * (barW + gap) + gap;

  return (
    <div className="bar-scroll">
      <svg viewBox={`0 0 ${width} ${chartH + 56}`} className="bar-chart" role="img">
        {blocks.map((w, i) => {
          const x0 = gap + i * (barW + gap);
          let yCursor = chartH;
          const r = effectiveReconc(w);
          const failed = r && (r.tankExceeded || r.totalExceeded) && !w.resigned;
          return (
            <g key={w.id}>
              {perTank.map((p) => {
                const v = p.values[i] ?? 0;
                const h = (v / maxStack) * (chartH - 24);
                yCursor -= h;
                return (
                  <rect
                    key={p.tank.id}
                    x={x0}
                    y={yCursor}
                    width={barW}
                    height={h}
                    fill={p.tank.color}
                    opacity={failed ? 1 : 0.85}
                  />
                );
              })}
              <rect
                x={x0 - 3}
                y={0}
                width={barW + 6}
                height={chartH}
                fill="none"
                stroke={failed ? "#dc2626" : "transparent"}
                strokeDasharray="4 3"
                strokeWidth={1.5}
                rx={4}
              />
              <text x={x0 + barW / 2} y={chartH + 16} textAnchor="middle" className="axis">
                {watchLabel(w)}
              </text>
              <text x={x0 + barW / 2} y={chartH + 32} textAnchor="middle" className="axis">
                {watchDayLabel(w)}
              </text>
              <text x={x0 + barW / 2} y={chartH + 47} textAnchor="middle" className={failed ? "axis-bad" : "axis"}>
                {fmtNum(r?.totalMeasured, 2)}t
              </text>
            </g>
          );
        })}
      </svg>
    </div>
  );
}

export default function Trends() {
  const { data } = useStore();
  const [selected, setSelected] = useState<string>("ALL");

  const invalid = latestInvalidWatch(data.watches.filter((w) => w.voided && !w.resigned));
  const flagged = new Set(invalid?.sealedReconc?.flaggedTankIds ?? []);

  const massSeries = data.tanks
    .filter((t) => selected === "ALL" || t.id === selected)
    .map((tank) => ({
      key: tank.id,
      label: tank.name,
      color: tank.color,
      points: tankMassHistory(data, tank.id)
        .filter((p) => p.reading.status === "active" && p.mass != null)
        .map((p) => ({ t: p.t, v: p.mass })),
    }));

  // 最近一次失效班次的实时复算（用于展示补录复核后趋势变化）
  const liveInvalid = invalid
    ? reconcileWatch(invalid, data.tanks, data.readings, data.settings.tolerance)
    : null;

  return (
    <div className="tab-page">
      <section className="panel">
        <div className="heading">
          <div>
            <p>折算存量趋势（仅有效读数，缺密度旧记录排除）</p>
            <h2>各舱存量随观测时刻变化</h2>
          </div>
          <select value={selected} onChange={(e) => setSelected(e.target.value)}>
            <option value="ALL">全部油舱叠加</option>
            {data.tanks.map((t) => (
              <option key={t.id} value={t.id}>
                {t.name}
              </option>
            ))}
          </select>
        </div>
        {invalid ? (
          <div className="trend-alert">
            <Badge tone="bad">差异高亮</Badge>
            <span>
              最近签字失效班次（{watchDayLabel(invalid)} {watchLabel(invalid)}）的差异油舱：
              {[...flagged].map((id) => data.tanks.find((t) => t.id === id)?.name).join("、")}
              ；待复核补录采纳后趋势会以新值续接，旧点留痕不删除。
            </span>
          </div>
        ) : (
          <p className="muted tiny">当前没有对账超差班次，趋势线为正常状态。</p>
        )}
        <LineChart series={massSeries} yUnit="吨" markTanks={flagged.size ? flagged : undefined} />
        <Legend
          items={data.tanks.map((t) => ({ key: t.id, label: t.name, color: t.color }))}
          markTanks={flagged.size ? flagged : undefined}
        />
      </section>

      <section className="panel">
        <div className="heading">
          <div>
            <p>班次油耗 · 相邻两次实测差</p>
            <h2>每舱堆叠耗油（已确认班次）</h2>
          </div>
          {invalid ? <Badge tone="bad">红框为签字失效班次</Badge> : null}
        </div>
        <BarChart watches={data.watches} />
        <Legend items={data.tanks.map((t) => ({ key: t.id, label: t.name, color: t.color }))} />
        {invalid && liveInvalid ? (
          <div className="recheck-note">
            <b>失效班次当前实时复算：</b>
            {liveInvalid.lines.map((l) => {
              const tank = data.tanks.find((t) => t.id === l.tankId)!;
              return (
                <span key={l.tankId} className={!l.withinTolerance ? "num-bad" : "muted"}>
                  {tank.name} {signedDiff(l.difference, 3)} t
                  {"　"}
                </span>
              );
            })}
            <span className={liveInvalid.passed ? "flash-ok" : "flash-err"}>
              {liveInvalid.passed ? "　复核后差异已消除，可在交班页复签。" : "　差异仍超允许值。"}
            </span>
          </div>
        ) : null}
      </section>

      <section className="panel">
        <div className="heading">
          <div>
            <p>读数密度</p>
            <h2>各舱观测点数（含留痕）</h2>
          </div>
        </div>
        <div className="density-cards">
          {data.tanks.map((tank) => {
            const all = data.readings.filter((r) => r.tankId === tank.id);
            const act = activeReadings(all);
            const miss = all.filter((r) => r.density == null).length;
            return (
              <article key={tank.id} className="mini-card">
                <span className="tank-dot" style={{ background: tank.color }} />
                <b>{tank.name}</b>
                <small className="muted">
                  有效 {act.length} · 留痕 {all.length - act.length} · 缺密度 {miss}
                </small>
              </article>
            );
          })}
        </div>
      </section>
    </div>
  );
}
