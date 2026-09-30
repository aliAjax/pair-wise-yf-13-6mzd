import { useMemo, useRef, useState } from "react";
import {
  SnapshotReading,
  Tank,
  effectiveReconc,
  fmtDT,
  fmtNum,
  isWatchSigned,
  readingMass,
  signedDiff,
  watchDayLabel,
  watchLabel,
} from "../domain";
import { useStore } from "../store";
import { Badge } from "./ui";

const TANK_COLORS = ["#0f766e", "#2563eb", "#f97316", "#7c3aed", "#0891b2", "#be123c"];

function WatchSummaryCard({ watch, tanks }: { watch: import("../domain").Watch; tanks: Tank[] }) {
  const { data } = useStore();
  const r = effectiveReconc(watch);
  const signed = isWatchSigned(watch);
  const voided = !!watch.voided && !watch.resigned;

  const snapMass = (s: SnapshotReading): number | null => {
    const tank = tanks.find((t) => t.id === s.tankId);
    if (!tank) return null;
    return readingMass(s, tank, data.settings.tolerance.thermalPerDegree);
  };

  return (
    <article className={`sum-card ${voided ? "sum-card-bad" : signed ? "sum-card-ok" : ""}`}>
      <header className="no-print">
        <div>
          <h3>
            {watchDayLabel(watch)} {watchLabel(watch)}
          </h3>
          <span className="muted">
            {fmtDT(watch.start)} – {fmtDT(watch.end)}
          </span>
        </div>
        {voided ? (
          <Badge tone="bad">交接签字失效</Badge>
        ) : signed ? (
          <Badge tone="ok">签字有效{watch.resigned ? "（复签）" : ""}</Badge>
        ) : (
          <Badge>已交班未复签</Badge>
        )}
      </header>

      <table className="sum-table">
        <thead>
          <tr>
            <th>油舱</th>
            <th>班前 t</th>
            <th>班末 t</th>
            <th>实测耗油 t</th>
            <th>申报耗油 t</th>
            <th>差异 t</th>
            <th>判定</th>
          </tr>
        </thead>
        <tbody>
          {r?.lines.map((l) => {
            const tank = tanks.find((t) => t.id === l.tankId)!;
            return (
              <tr key={l.tankId} className={!l.withinTolerance ? "row-bad" : ""}>
                <td>
                  <span className="tank-dot" style={{ background: tank.color }} /> {tank.name}
                </td>
                <td>{fmtNum(l.startMass, 3)}</td>
                <td>{fmtNum(l.endMass, 3)}</td>
                <td>{fmtNum(l.measuredConsumption, 3)}</td>
                <td>{fmtNum(l.reportedConsumption, 3)}</td>
                <td className={!l.withinTolerance ? "num-bad" : ""}>{signedDiff(l.difference, 3)}</td>
                <td>
                  {l.difference == null ? (
                    <Badge>缺测</Badge>
                  ) : l.withinTolerance ? (
                    <Badge tone="ok">合格</Badge>
                  ) : (
                    <Badge tone="bad">差异油舱</Badge>
                  )}
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>

      <dl className="sum-totals">
        <div>
          <dt>主机转速</dt>
          <dd>
            {watch.rpmStart ?? "—"} → {watch.rpmEnd ?? "—"} rpm
          </dd>
        </div>
        <div>
          <dt>实测合计</dt>
          <dd>{fmtNum(r?.totalMeasured, 3)} t</dd>
        </div>
        <div>
          <dt>申报合计</dt>
          <dd>{fmtNum(r?.totalReported, 3)} t</dd>
        </div>
        <div>
          <dt>总差异 / 允许</dt>
          <dd className={r?.totalExceeded ? "num-bad" : ""}>
            {signedDiff(r?.totalDifference, 3)} / ±{fmtNum(data.settings.tolerance.totalT, 2)} t
          </dd>
        </div>
      </dl>

      <p className="sum-note">
        <b>交接备注：</b>
        {watch.note || "—"}
      </p>
      <div className="sum-sign">
        <span>交班签字：{watch.signed?.officer ?? "—"}（{watch.signed ? fmtDT(watch.signed.signedAt) : "—"}）</span>
        {watch.voided ? (
          <span className="num-bad">
            失效：{watch.voided.by} · {fmtDT(watch.voided.voidedAt)} — {watch.voided.reason}
          </span>
        ) : null}
        {watch.resigned ? (
          <span className="flash-ok">复签：{watch.resigned.officer} · {fmtDT(watch.resigned.signedAt)}</span>
        ) : null}
      </div>

      {watch.snapshot?.length ? (
        <details className="snapshot no-print">
          <summary>封存原始读数快照（{watch.snapshot.length} 条，补录不回改）</summary>
          <div className="snap-grid">
            {watch.snapshot.map((s) => {
              const tank = tanks.find((t) => t.id === s.tankId);
              return (
                <div key={s.id} className="snap-item">
                  <span className="tank-dot" style={{ background: tank?.color }} />
                  <span>
            {tank?.name} · {fmtDT(s.observedAt)} · {s.source}
          </span>
                  <span className="muted">
                    {" "}
                    {fmtNum(s.levelCm, 1)} cm / {fmtNum(s.temperatureC, 1)} ℃ / {fmtNum(s.density, 3)} /{" "}
                    {fmtNum(snapMass(s), 3)} t
                  </span>
                </div>
              );
            })}
          </div>
        </details>
      ) : null}
    </article>
  );
}

function SettingsPanel() {
  const { data, updateSettings, addTank, removeTank, resetDemo, clearAll, exportJson, importJson } = useStore();
  const [t, setT] = useState({ name: "", fuelType: "柴油 MGO" as Tank["fuelType"], capacityCm: "", kgPerCm: "", standardDensity: "" });
  const [msg, setMsg] = useState<string | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);

  const tol = data.settings.tolerance;

  return (
    <section className="panel">
      <div className="heading">
        <div>
          <p>参数与数据</p>
          <h2>对账设置</h2>
        </div>
      </div>

      <div className="settings-grid">
        <label className="field">
          <span>船名 / 机组</span>
          <input value={data.settings.shipName} onChange={(e) => updateSettings({ shipName: e.target.value })} />
        </label>
        <label className="field">
          <span>单舱允许差异（吨）</span>
          <input
            type="number"
            step="0.05"
            value={tol.perTankT}
            onChange={(e) => updateSettings({ tolerance: { ...tol, perTankT: Number(e.target.value) } })}
          />
        </label>
        <label className="field">
          <span>本班总差异允许值（吨）</span>
          <input
            type="number"
            step="0.1"
            value={tol.totalT}
            onChange={(e) => updateSettings({ tolerance: { ...tol, totalT: Number(e.target.value) } })}
          />
        </label>
        <label className="field">
          <span>温度体积修正系数（每 ℃，基准 15℃）</span>
          <input
            type="number"
            step="0.0001"
            value={tol.thermalPerDegree}
            onChange={(e) => updateSettings({ tolerance: { ...tol, thermalPerDegree: Number(e.target.value) } })}
          />
        </label>
      </div>

      <h3 className="sub-h">油舱舱容表</h3>
      <div className="tank-admin">
        {data.tanks.map((tank) => (
          <div key={tank.id} className="tank-admin-row">
            <span className="tank-dot" style={{ background: tank.color }} />
            <b>{tank.name}</b>
            <span className="muted">
              {tank.fuelType} · 量程 {tank.capacityCm} cm · {tank.kgPerCm} t/cm · 标准密度 {tank.standardDensity}
            </span>
            <button
              className="danger-btn ghost"
              onClick={() => {
                if (confirm(`删除 ${tank.name} 将同时移除其全部读数，确定？`)) removeTank(tank.id);
              }}
            >
              删除
            </button>
          </div>
        ))}
        <div className="tank-admin-add">
          <input placeholder="舱名，如：重油备用舱左" value={t.name} onChange={(e) => setT({ ...t, name: e.target.value })} />
          <select value={t.fuelType} onChange={(e) => setT({ ...t, fuelType: e.target.value as Tank["fuelType"] })}>
            <option>重油 HFO</option>
            <option>柴油 MGO</option>
            <option>滑油 LO</option>
          </select>
          <input placeholder="量程 cm" type="number" value={t.capacityCm} onChange={(e) => setT({ ...t, capacityCm: e.target.value })} />
          <input placeholder="t/cm" type="number" step="0.001" value={t.kgPerCm} onChange={(e) => setT({ ...t, kgPerCm: e.target.value })} />
          <input placeholder="标准密度" type="number" step="0.001" value={t.standardDensity} onChange={(e) => setT({ ...t, standardDensity: e.target.value })} />
          <button
            onClick={() => {
              const cap = Number(t.capacityCm);
              const k = Number(t.kgPerCm);
              const d = Number(t.standardDensity);
              if (!t.name || !cap || !k || !d) {
                setMsg("请填写完整油舱参数");
                return;
              }
              addTank({
                name: t.name,
                fuelType: t.fuelType,
                capacityCm: cap,
                kgPerCm: k,
                standardDensity: d,
                color: TANK_COLORS[data.tanks.length % TANK_COLORS.length],
              });
              setT({ name: "", fuelType: "柴油 MGO", capacityCm: "", kgPerCm: "", standardDensity: "" });
              setMsg("油舱已添加");
            }}
          >
            新增油舱
          </button>
        </div>
      </div>
      {msg ? <p className="flash-ok">{msg}</p> : null}

      <h3 className="sub-h">本地数据（浏览器 localStorage）</h3>
      <div className="data-actions">
        <button
          onClick={() => {
            const blob = new Blob([exportJson()], { type: "application/json" });
            const a = document.createElement("a");
            a.href = URL.createObjectURL(blob);
            a.download = `fuel-watch-${new Date().toISOString().slice(0, 10)}.json`;
            a.click();
            URL.revokeObjectURL(a.href);
          }}
        >
          导出全部数据 JSON
        </button>
        <button onClick={() => fileRef.current?.click()}>导入 JSON</button>
        <input
          ref={fileRef}
          type="file"
          accept="application/json"
          hidden
          onChange={(e) => {
            const f = e.target.files?.[0];
            if (!f) return;
            f.text().then((txt) => {
              const res = importJson(txt);
              setMsg(res.ok ? "导入成功" : `导入失败：${res.error}`);
            });
            e.target.value = "";
          }}
        />
        <button
          className="danger-btn ghost"
          onClick={() => {
            if (confirm("重置为内置演示数据？当前所有修改将被覆盖。")) {
              resetDemo();
              setMsg("已恢复演示数据");
            }
          }}
        >
          重置演示数据
        </button>
        <button
          className="danger-btn"
          onClick={() => {
            if (confirm("清空全部本地数据（油舱配置保留）？此操作不可恢复。")) {
              clearAll();
              setMsg("本地数据已清空");
            }
          }}
        >
          清空全部读数
        </button>
      </div>
    </section>
  );
}

export default function Summary() {
  const { data } = useStore();
  const watches = useMemo(
    () => [...data.watches].filter((w) => w.confirmed).sort((a, b) => +new Date(b.start) - +new Date(a.start)),
    [data.watches],
  );
  const flaggedCount = watches.filter((w) => effectiveReconc(w)?.flaggedTankIds.length).length;
  const voidedCount = watches.filter((w) => w.voided && !w.resigned).length;

  return (
    <div className="tab-page">
      <section className="panel sum-head">
        <div className="heading">
          <div>
            <p>交接班摘要 · {data.settings.shipName}</p>
            <h2>班次油料对账汇总</h2>
          </div>
          <div className="head-actions no-print">
            <Badge tone="bad">差异班次 {flaggedCount}</Badge>
            <Badge tone="bad">签字失效 {voidedCount}</Badge>
            <button className="primary" onClick={() => window.print()}>
              打印 / 存 PDF
            </button>
          </div>
        </div>
        <p className="muted">
          允许差异：单舱 ±{fmtNum(data.settings.tolerance.perTankT, 2)} t，本班总差异 ±
          {fmtNum(data.settings.tolerance.totalT, 2)} t；油耗一律取相邻两次实测折算存量之差。超差班次的差异油舱已逐行标出。
        </p>
      </section>

      {watches.map((w) => (
        <WatchSummaryCard key={w.id} watch={w} tanks={data.tanks} />
      ))}

      <SettingsPanel />
    </div>
  );
}
