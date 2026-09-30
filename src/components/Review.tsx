import { useMemo, useState } from "react";
import {
  CHIEF_ENGINEER,
  Reading,
  ReviewCandidate,
  fmtDT,
  fmtNum,
  readingMass,
  round,
} from "../domain";
import { useStore } from "../store";
import { Badge, Modal } from "./ui";

function StatusBadge({ r }: { r: Reading }) {
  if (r.density == null) return <Badge tone="warn">缺密度·待补录</Badge>;
  switch (r.status) {
    case "active":
      return <Badge tone="ok">有效</Badge>;
    case "pending":
      return <Badge tone="warn">待复核</Badge>;
    case "superseded":
      return <Badge>已取代·留痕</Badge>;
    case "rejected":
      return <Badge>已驳回·留痕</Badge>;
  }
}

function CandidateCard({ c }: { c: ReviewCandidate }) {
  const { data, resolveCandidate } = useStore();
  const tank = data.tanks.find((t) => t.id === c.reading.tankId)!;
  const old = data.readings.find((r) => r.id === c.conflictingReadingId);
  const newMass = readingMass(c.reading, tank, data.settings.tolerance.thermalPerDegree);
  const oldMass = old ? readingMass(old, tank, data.settings.tolerance.thermalPerDegree) : null;
  const resolved = !!c.resolution;

  return (
    <article className={`cand-card ${resolved ? "cand-resolved" : ""}`}>
      <header>
        <div>
          <span className="tank-dot" style={{ background: tank.color }} />
          <b>{tank.name}</b>
          <span className="muted"> 同一观测时刻 {fmtDT(c.reading.observedAt)}</span>
        </div>
        {resolved ? (
          <Badge tone={c.resolution === "accepted" ? "ok" : "neutral"}>
            已{c.resolution === "accepted" ? "采纳" : "驳回"} · {c.resolvedBy}
          </Badge>
        ) : (
          <Badge tone="warn">等待轮机长复核</Badge>
        )}
      </header>
      <p className="muted">{c.reason}</p>
      <div className="cand-compare">
        <div className="cand-col cand-old">
          <small>已存在读数（{old?.source ?? "—"}）{old?.watchId ? "· 已确认班次封存" : ""}</small>
          <b>{fmtNum(old?.levelCm ?? null, 1)} cm</b>
          <span>
            {fmtNum(old?.temperatureC ?? null, 1)} ℃ · {fmtNum(old?.density ?? null, 3)} g/cm³
          </span>
          <span>折算 {fmtNum(oldMass, 3)} t</span>
          <Badge>{old ? (old.status === "superseded" ? "已被取代留痕" : "原始有效") : "—"}</Badge>
        </div>
        <div className="cand-arrow">→</div>
        <div className="cand-col cand-new">
          <small>晚到补录 · 提交于 {fmtDT(c.createdAt)}</small>
          <b>{fmtNum(c.reading.levelCm, 1)} cm</b>
          <span>
            {fmtNum(c.reading.temperatureC, 1)} ℃ · {fmtNum(c.reading.density, 3)} g/cm³
          </span>
          <span>折算 {fmtNum(newMass, 3)} t</span>
          {c.reading.note ? <span className="muted tiny">{c.reading.note}</span> : null}
        </div>
      </div>
      {resolved ? (
        <p className="tiny muted">
          裁定时间 {c.resolvedAt ? fmtDT(c.resolvedAt) : "—"}；
          {c.resolution === "accepted"
            ? "采纳后旧值标记 superseded 留痕，补录成为该观测时刻唯一有效值；已封存快照未改动。"
            : "补录已驳回留痕，原始读数继续有效。"}
        </p>
      ) : (
        <div className="cand-actions">
          <button className="primary" onClick={() => resolveCandidate(c.id, "accepted", CHIEF_ENGINEER)}>
            轮机长采纳补录（旧值留痕）
          </button>
          <button onClick={() => resolveCandidate(c.id, "rejected", CHIEF_ENGINEER)}>
            驳回，保留原始读数
          </button>
        </div>
      )}
    </article>
  );
}

export default function Review() {
  const { data, supplementDensity } = useStore();
  const [tankFilter, setTankFilter] = useState("ALL");
  const [statusFilter, setStatusFilter] = useState("ALL");
  const [sourceFilter, setSourceFilter] = useState("ALL");
  const [densityTarget, setDensityTarget] = useState<Reading | null>(null);
  const [densityValue, setDensityValue] = useState("");

  const pending = data.reviewCandidates.filter((c) => !c.resolution);
  const resolved = data.reviewCandidates.filter((c) => c.resolution);
  const missingDensity = data.readings.filter((r) => r.density == null);

  const filtered = useMemo(() => {
    return [...data.readings]
      .filter((r) => (tankFilter === "ALL" ? true : r.tankId === tankFilter))
      .filter((r) => (statusFilter === "ALL" ? true : r.status === statusFilter))
      .filter((r) => (sourceFilter === "ALL" ? true : r.source === sourceFilter))
      .sort((a, b) => +new Date(b.observedAt) - +new Date(a.observedAt));
  }, [data.readings, tankFilter, statusFilter, sourceFilter]);

  // 同一观测时刻出现多条（含留痕）的舱，用于展示去重规则
  const dupMoments = useMemo(() => {
    const groups = new Map<string, Reading[]>();
    for (const r of data.readings) {
      const key = `${r.tankId}|${r.observedAt.slice(0, 16)}`;
      groups.set(key, [...(groups.get(key) ?? []), r]);
    }
    return [...groups.values()].filter((g) => g.length > 1);
  }, [data.readings]);

  return (
    <div className="tab-page">
      {missingDensity.length > 0 ? (
        <section className="panel panel-warn">
          <div className="heading">
            <div>
              <p>旧记录迁移 · 数据留在浏览器</p>
              <h2>{missingDensity.length} 条历史读数缺实测密度，已迁移为待补录</h2>
            </div>
            <Badge tone="warn">不计入对账</Badge>
          </div>
          <div className="density-list">
            {missingDensity.map((r) => {
              const tank = data.tanks.find((t) => t.id === r.tankId);
              return (
                <div key={r.id} className="density-item">
                  <span className="tank-dot" style={{ background: tank?.color }} />
                  <b>{tank?.name}</b>
                  <span className="muted">
                    {fmtDT(r.observedAt)} · 液位 {fmtNum(r.levelCm, 1)} cm · 温度 {fmtNum(r.temperatureC, 1)} ℃
                  </span>
                  <button
                    onClick={() => {
                      setDensityTarget(r);
                      setDensityValue(String(tank?.standardDensity ?? ""));
                    }}
                  >
                    补录密度
                  </button>
                </div>
              );
            })}
          </div>
        </section>
      ) : null}

      <section className="panel">
        <div className="heading">
          <div>
            <p>同一观测时刻 · 只留一条有效值</p>
            <h2>晚到补录复核队列（{pending.length}）</h2>
          </div>
        </div>
        {pending.length === 0 && resolved.length === 0 ? (
          <p className="empty">暂无冲突补录。</p>
        ) : (
          <div className="cand-list">
            {pending.map((c) => (
              <CandidateCard key={c.id} c={c} />
            ))}
            {resolved.map((c) => (
              <CandidateCard key={c.id} c={c} />
            ))}
          </div>
        )}
      </section>

      <section className="panel">
        <div className="heading">
          <div>
            <p>全量历史 · 留痕不可删改</p>
            <h2>读数检索（{filtered.length}）</h2>
          </div>
        </div>
        <div className="filters">
          <select value={tankFilter} onChange={(e) => setTankFilter(e.target.value)}>
            <option value="ALL">全部油舱</option>
            {data.tanks.map((t) => (
              <option key={t.id} value={t.id}>
                {t.name}
              </option>
            ))}
          </select>
          <select value={sourceFilter} onChange={(e) => setSourceFilter(e.target.value)}>
            <option value="ALL">全部来源</option>
            <option value="现场">现场</option>
            <option value="补录">补录</option>
          </select>
          <select value={statusFilter} onChange={(e) => setStatusFilter(e.target.value)}>
            <option value="ALL">全部状态</option>
            <option value="active">有效</option>
            <option value="pending">待复核</option>
            <option value="superseded">已取代留痕</option>
            <option value="rejected">已驳回留痕</option>
          </select>
        </div>

        {dupMoments.length > 0 ? (
          <p className="muted tiny dup-note">
            有 {dupMoments.length} 个「舱 × 观测时刻」存在多条记录：其中仅一条 active 参与对账与趋势，其余留痕；待裁定项不生效。
          </p>
        ) : null}

        <div className="history-table">
          <table>
            <thead>
              <tr>
                <th>观测时刻</th>
                <th>油舱</th>
                <th>液位</th>
                <th>温度</th>
                <th>密度</th>
                <th>折算存量</th>
                <th>来源</th>
                <th>状态</th>
                <th>备注</th>
              </tr>
            </thead>
            <tbody>
              {filtered.slice(0, 200).map((r) => {
                const tank = data.tanks.find((t) => t.id === r.tankId);
                const mass = tank ? readingMass(r, tank, data.settings.tolerance.thermalPerDegree) : null;
                return (
                  <tr key={r.id} className={`st-${r.status} ${r.density == null ? "row-clash" : ""}`}>
                    <td>{fmtDT(r.observedAt)}</td>
                    <td>
                      <span className="tank-dot" style={{ background: tank?.color }} /> {tank?.name ?? r.tankId}
                    </td>
                    <td>{fmtNum(r.levelCm, 1)} cm</td>
                    <td>{fmtNum(r.temperatureC, 1)} ℃</td>
                    <td>{r.density == null ? <Badge tone="warn">缺</Badge> : fmtNum(r.density, 3)}</td>
                    <td>{mass == null ? "—" : `${fmtNum(mass, 3)} t`}</td>
                    <td>
                      <Badge tone={r.source === "补录" ? "purple" : "neutral"}>{r.source}</Badge>
                    </td>
                    <td>
                      <StatusBadge r={r} />
                    </td>
                    <td className="muted tiny">{r.note ?? ""}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
          {filtered.length > 200 ? <p className="muted tiny">仅显示前 200 条，可按油舱筛选。</p> : null}
        </div>
      </section>

      <Modal
        open={!!densityTarget}
        title="补录历史读数的实测密度"
        onClose={() => setDensityTarget(null)}
        footer={
          <>
            <button onClick={() => setDensityTarget(null)}>取消</button>
            <button
              className="primary"
              onClick={() => {
                if (densityTarget && densityValue) {
                  supplementDensity(densityTarget.id, round(parseFloat(densityValue), 3));
                  setDensityTarget(null);
                }
              }}
            >
              保存补录
            </button>
          </>
        }
      >
        {densityTarget ? (
          <div>
            <p className="muted">
              液位 {fmtNum(densityTarget.levelCm, 1)} cm · 温度 {fmtNum(densityTarget.temperatureC, 1)} ℃ · 观测于{" "}
              {fmtDT(densityTarget.observedAt)}
            </p>
            <label className="field">
              <span>实测密度 g/cm³（默认取该舱标准密度）</span>
              <input type="number" step="0.001" value={densityValue} onChange={(e) => setDensityValue(e.target.value)} />
            </label>
            <p className="muted tiny">补录后按舱容与温度修正重新折算存量，读数仍保留在原观测时刻。</p>
          </div>
        ) : null}
      </Modal>
    </div>
  );
}
