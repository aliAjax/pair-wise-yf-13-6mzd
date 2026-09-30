import {
  ReconcLine,
  Tank,
  Watch,
  activeReadings,
  effectiveReconc,
  fmtDT,
  fmtHM,
  fmtNum,
  isWatchSigned,
  latestInvalidWatch,
  readingMass,
  reconcileWatch,
  round,
  signedDiff,
  watchDayLabel,
  watchLabel,
} from "../domain";
import { useStore } from "../store";
import { Badge, Stat } from "./ui";

function TankCard({ tank, latest, estimated }: { tank: Tank; latest: ReturnType<typeof activeReadings>[number] | undefined; estimated: number | null }) {
  const { data } = useStore();
  const mass = latest ? readingMass(latest, tank, data.settings.tolerance.thermalPerDegree) : null;
  const pct = latest?.levelCm != null ? Math.min(100, (latest.levelCm / tank.capacityCm) * 100) : 0;
  const missing = latest?.density == null;
  return (
    <article className={`tank-card ${missing ? "tank-card-warn" : ""}`}>
      <header>
        <span className="tank-dot" style={{ background: tank.color }} />
        <div>
          <h4>{tank.name}</h4>
          <small>{tank.fuelType}</small>
        </div>
        {latest ? (
          <Badge tone={latest.source === "补录" ? "purple" : "info"}>{latest.source}</Badge>
        ) : null}
      </header>
      <div className="level-bar">
        <i style={{ width: `${pct}%`, background: tank.color }} />
      </div>
      <dl className="tank-grid">
        <div>
          <dt>折算存量</dt>
          <dd>
            {missing ? (
              <Badge tone="warn">待补录密度</Badge>
            ) : (
              <>
                <b>{fmtNum(mass, 2)}</b> 吨
              </>
            )}
          </dd>
        </div>
        <div>
          <dt>液位</dt>
          <dd>
            {fmtNum(latest?.levelCm, 1)} <em>cm</em>
          </dd>
        </div>
        <div>
          <dt>温度</dt>
          <dd>
            {fmtNum(latest?.temperatureC, 1)} <em>℃</em>
          </dd>
        </div>
        <div>
          <dt>密度</dt>
          <dd>
            {fmtNum(latest?.density, 3)} <em>g/cm³</em>
          </dd>
        </div>
      </dl>
      <footer>
        <span>
          观测 {latest ? fmtDT(latest.observedAt) : "—"}
          {latest?.status === "pending" ? "（待复核）" : ""}
        </span>
        {missing && estimated != null ? <span className="muted">量尺估算约 {fmtNum(estimated, 2)} 吨，仅供参考</span> : null}
      </footer>
    </article>
  );
}

function FlaggedPanel({ invalid, lines }: { invalid: Watch; lines: ReconcLine[] }) {
  const { data } = useStore();
  const flagged = lines.filter((l) => !l.withinTolerance);
  return (
    <section className="panel panel-danger">
      <div className="heading">
        <div>
          <p>签字失效 · 待轮机长复核</p>
          <h2>
            差异油舱：{watchDayLabel(invalid)} {watchLabel(invalid)}
          </h2>
        </div>
        <Badge tone="bad">交接签字已失效</Badge>
      </div>
      <p className="danger-note">{invalid.voided?.reason}</p>
      <div className="flag-table">
        <table>
          <thead>
            <tr>
              <th>油舱</th>
              <th>实测耗油（相邻两次实测差）</th>
              <th>交班申报</th>
              <th>差异</th>
              <th>允许值</th>
              <th>判定</th>
            </tr>
          </thead>
          <tbody>
            {lines.map((l) => {
              const tank = data.tanks.find((t) => t.id === l.tankId)!;
              return (
                <tr key={l.tankId} className={!l.withinTolerance ? "row-bad" : ""}>
                  <td>
                    <span className="tank-dot" style={{ background: tank.color }} /> {tank.name}
                  </td>
                  <td>{fmtNum(l.measuredConsumption, 3)} t</td>
                  <td>{fmtNum(l.reportedConsumption, 3)} t</td>
                  <td className={l.difference != null && Math.abs(l.difference) > data.settings.tolerance.perTankT ? "num-bad" : ""}>
                    {signedDiff(l.difference, 3)} t
                  </td>
                  <td>±{fmtNum(data.settings.tolerance.perTankT, 2)} t</td>
                  <td>
                    {l.difference == null ? (
                      <Badge>缺测</Badge>
                    ) : l.withinTolerance ? (
                      <Badge tone="ok">合格</Badge>
                    ) : (
                      <Badge tone="bad">超差</Badge>
                    )}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
      <p className="muted">
        本班总差异 <b className={invalid.sealedReconc?.totalExceeded ? "num-bad" : ""}>{signedDiff(invalid.sealedReconc?.totalDifference, 3)} t</b>
        ，允许 ±{fmtNum(data.settings.tolerance.totalT, 2)} t；晚到补录只进历史，已封存原始读数不回改。
      </p>
    </section>
  );
}

export default function Dashboard({ onNavigate }: { onNavigate: (tab: string) => void }) {
  const { data, currentWatch, missingDensityCount, pendingReviewCount } = useStore();

  const live = reconcileWatch(currentWatch, data.tanks, data.readings, data.settings.tolerance);
  const invalid = latestInvalidWatch(data.watches.filter((w) => w.confirmed && w.voided && !w.resigned));
  const invalidLines = invalid ? effectiveReconc(invalid)?.lines ?? [] : [];

  const latestByTank = data.tanks.map((tank) => {
    const list = data.readings
      .filter((r) => r.tankId === tank.id && r.status === "active")
      .sort((a, b) => +new Date(b.observedAt) - +new Date(a.observedAt));
    const latest = list[0];
    const estimated = latest?.levelCm != null ? round(latest.levelCm * tank.kgPerCm, 2) : null;
    return { tank, latest, estimated };
  });

  const totalStock = latestByTank.reduce(
    (s, x) => s + (x.latest ? readingMass(x.latest, x.tank, data.settings.tolerance.thermalPerDegree) ?? 0 : 0),
    0,
  );
  const validSigned = data.watches.filter((w) => w.confirmed && isWatchSigned(w)).length;
  const voidedCount = data.watches.filter((w) => w.voided && !w.resigned).length;

  const recent = [...data.watches]
    .filter((w) => w.confirmed)
    .sort((a, b) => +new Date(b.start) - +new Date(a.start))
    .slice(0, 5);

  return (
    <div className="tab-page">
      {invalid ? <FlaggedPanel invalid={invalid} lines={invalidLines} /> : null}

      <section className="kpis">
        <Stat label="各舱当前折算存量合计" value={fmtNum(totalStock, 1)} unit="吨" tone="neutral" hint="液位×舱容×温度修正×实测密度" />
        <Stat
          label={`本班（${watchLabel(currentWatch)}）实测耗油`}
          value={fmtNum(live.totalMeasured, 2)}
          unit="吨"
          tone={live.totalMeasured == null ? "warn" : "neutral"}
          hint="各舱相邻两次实测存量差之和"
        />
        <Stat label="有效签字班次" value={validSigned} unit="个" tone="ok" hint={`共 ${data.watches.filter((w) => w.confirmed).length} 个已确认`} />
        <Stat
          label="待处理告警"
          value={voidedCount + pendingReviewCount + missingDensityCount}
          unit="项"
          tone={voidedCount + pendingReviewCount + missingDensityCount > 0 ? "bad" : "ok"}
          hint={`签字失效 ${voidedCount} · 待复核 ${pendingReviewCount} · 缺密度 ${missingDensityCount}`}
        />
      </section>

      <section className="panel">
        <div className="heading">
          <div>
            <p>机舱油料看板</p>
            <h2>各舱最新读数与折算存量</h2>
          </div>
          <button className="primary" onClick={() => onNavigate("entry")}>
            抄表录入
          </button>
        </div>
        <div className="tank-grid-cards">
          {latestByTank.map((x) => (
            <TankCard key={x.tank.id} tank={x.tank} latest={x.latest} estimated={x.estimated} />
          ))}
        </div>
      </section>

      <section className="panel">
        <div className="heading">
          <div>
            <p>值守状态带</p>
            <h2>近期班次交接</h2>
          </div>
          <button onClick={() => onNavigate("handover")}>去交班对账</button>
        </div>
        <div className="watch-strip">
          {recent.map((w) => {
            const r = effectiveReconc(w);
            const signed = isWatchSigned(w);
            const active = w.id === currentWatch.id;
            return (
              <div
                key={w.id}
                className={`watch-chip ${active ? "watch-chip-active" : ""} ${w.voided && !w.resigned ? "watch-chip-bad" : signed ? "watch-chip-ok" : ""}`}
              >
                <div className="watch-chip-day">{watchDayLabel(w)}</div>
                <div className="watch-chip-label">{watchLabel(w)}</div>
                <div className="watch-chip-status">
                  {w.voided && !w.resigned ? (
                    <Badge tone="bad">签字失效</Badge>
                  ) : signed ? (
                    <Badge tone="ok">已签字</Badge>
                  ) : (
                    <Badge>已交班</Badge>
                  )}
                </div>
                <small>
                  {w.resigned ? "轮机长复核复签" : w.signed?.officer ?? ""}
                </small>
                <small className={r && (r.tankExceeded || r.totalExceeded) ? "num-bad" : "muted"}>
                  总差异 {signedDiff(r?.totalDifference, 2)} t
                </small>
                <small className="muted">
                  {fmtHM(w.start)}–{fmtHM(w.end)}
                </small>
              </div>
            );
          })}
        </div>
      </section>
    </div>
  );
}
