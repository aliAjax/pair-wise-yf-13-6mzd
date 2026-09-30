import { useMemo, useState } from "react";
import {
  Watch,
  effectiveReconc,
  fmtDT,
  fmtNum,
  isWatchSigned,
  reconcileWatch,
  signedDiff,
  watchDayLabel,
  watchLabel,
} from "../domain";
import { useStore } from "../store";
import { Badge, Modal } from "./ui";

export default function Handover() {
  const { data, currentWatch, saveDraft, signWatch, resignWatch, voidSignedWatch } = useStore();
  const [officer, setOfficer] = useState("");
  const [signNote, setSignNote] = useState("");
  const [acknowledge, setAcknowledge] = useState(false);
  const [feedback, setFeedback] = useState<{ ok: boolean; text: string } | null>(null);
  const [voidTarget, setVoidTarget] = useState<Watch | null>(null);
  const [voidReason, setVoidReason] = useState("");
  const [resignTarget, setResignTarget] = useState<Watch | null>(null);

  const tol = data.settings.tolerance;
  const live = useMemo(
    () => reconcileWatch(currentWatch, data.tanks, data.readings, tol),
    [currentWatch, data.tanks, data.readings, tol],
  );

  const history = useMemo(
    () =>
      [...data.watches]
        .filter((w) => w.confirmed)
        .sort((a, b) => +new Date(b.start) - +new Date(a.start)),
    [data.watches],
  );

  const setReported = (tankId: string, raw: string) => {
    const v = raw === "" ? null : Number(raw);
    saveDraft({
      reportedConsumption: { ...currentWatch.reportedConsumption, [tankId]: v },
    });
  };

  const doSign = () => {
    const res = signWatch(officer.trim() || "值班轮机员", signNote.trim() || undefined, acknowledge);
    setFeedback(res.ok ? { ok: true, text: live.passed ? "班次已确认并签字，原始读数已封存。" : "已交班：对账超差，交接签字立即失效，等待轮机长复核。" } : { ok: false, text: res.error ?? "签字失败" });
    setAcknowledge(false);
  };

  const doResign = () => {
    if (!resignTarget) return;
    const res = resignWatch(resignTarget.id, "补录复核完成，差异消除，重新签字。");
    setFeedback(res.ok ? { ok: true, text: "轮机长已复核复签，班次恢复有效。" } : { ok: false, text: res.error ?? "复签失败" });
    setResignTarget(null);
  };

  return (
    <div className="tab-page">
      <section className="panel handover-current">
        <div className="heading">
          <div>
            <p>进行中班次 · 交班对账</p>
            <h2>
              {watchDayLabel(currentWatch)} {watchLabel(currentWatch)}（{fmtDT(currentWatch.start).slice(4)} –{" "}
              {fmtDT(currentWatch.end).slice(4)}）
            </h2>
          </div>
          <Badge tone="info">未确认</Badge>
        </div>

        <div className="handover-grid">
          <div>
            <div className="rpm-row">
              <label className="field">
                <span>接班主机转速 rpm</span>
                <input
                  type="number"
                  value={currentWatch.rpmStart ?? ""}
                  onChange={(e) => saveDraft({ rpmStart: e.target.value === "" ? null : Number(e.target.value) })}
                />
              </label>
              <label className="field">
                <span>交班主机转速 rpm</span>
                <input
                  type="number"
                  value={currentWatch.rpmEnd ?? ""}
                  onChange={(e) => saveDraft({ rpmEnd: e.target.value === "" ? null : Number(e.target.value) })}
                />
              </label>
            </div>

            <div className="reported-table">
              <table>
                <thead>
                  <tr>
                    <th>油舱</th>
                    <th>班前存量 t</th>
                    <th>当前存量 t</th>
                    <th>实测耗油 t</th>
                    <th>交班申报耗油 t</th>
                    <th>差异 t</th>
                  </tr>
                </thead>
                <tbody>
                  {live.lines.map((l) => {
                    const tank = data.tanks.find((t) => t.id === l.tankId)!;
                    return (
                      <tr key={l.tankId} className={!l.withinTolerance ? "row-bad" : ""}>
                        <td>
                          <span className="tank-dot" style={{ background: tank.color }} /> {tank.name}
                        </td>
                        <td>{fmtNum(l.startMass, 3)}</td>
                        <td>{fmtNum(l.endMass, 3)}</td>
                        <td>{fmtNum(l.measuredConsumption, 3)}</td>
                        <td>
                          <input
                            className={!l.withinTolerance ? "input-bad" : ""}
                            type="number"
                            step="0.01"
                            value={currentWatch.reportedConsumption[l.tankId] ?? ""}
                            onChange={(e) => setReported(l.tankId, e.target.value)}
                            placeholder="申报值"
                          />
                        </td>
                        <td className={!l.withinTolerance && l.difference != null ? "num-bad" : ""}>
                          {l.measuredConsumption == null ? <span className="muted">缺两次实测</span> : signedDiff(l.difference, 3)}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>

            <label className="field">
              <span>交接备注 / 异常说明</span>
              <input value={currentWatch.note} onChange={(e) => saveDraft({ note: e.target.value })} placeholder="异常巡检、流量计情况、补录说明等" />
            </label>
          </div>

          <aside className={`recon-card ${live.passed ? "" : "recon-card-bad"}`}>
            <h3>实时对账</h3>
            <dl>
              <div>
                <dt>实测总耗油</dt>
                <dd>{fmtNum(live.totalMeasured, 3)} t</dd>
              </div>
              <div>
                <dt>申报总耗油</dt>
                <dd>{fmtNum(live.totalReported, 3)} t</dd>
              </div>
              <div>
                <dt>总差异</dt>
                <dd className={live.totalExceeded ? "num-bad" : ""}>{signedDiff(live.totalDifference, 3)} t</dd>
              </div>
            </dl>
            <ul className="tol-list">
              <li className={live.tankExceeded ? "tol-bad" : "tol-ok"}>
                单舱差异 ≤ ±{fmtNum(tol.perTankT, 2)} t：{live.tankExceeded ? `超差（${live.flaggedTankIds.map((id) => data.tanks.find((t) => t.id === id)?.name).join("、")}）` : "通过"}
              </li>
              <li className={live.totalExceeded ? "tol-bad" : "tol-ok"}>
                本班总差异 ≤ ±{fmtNum(tol.totalT, 2)} t：{live.totalExceeded ? "超差" : "通过"}
              </li>
            </ul>

            <label className="field">
              <span>交班轮机员签字</span>
              <input value={officer} onChange={(e) => setOfficer(e.target.value)} placeholder="输入姓名即视为签字" />
            </label>
            <label className="field">
              <span>签字备注</span>
              <input value={signNote} onChange={(e) => setSignNote(e.target.value)} />
            </label>

            {!live.passed ? (
              <div className="void-warning">
                <label className="checkline">
                  <input type="checkbox" checked={acknowledge} onChange={(e) => setAcknowledge(e.target.checked)} />
                  <span>
                    我知道对账超差：一旦交班，<b>交接签字立即失效</b>，差异油舱进入轮机长复核，补录只进历史、不改原始读数。
                  </span>
                </label>
              </div>
            ) : null}

            <button className="primary sign-btn" disabled={!live.passed && !acknowledge} onClick={doSign}>
              {live.passed ? "确认交班并签字封存" : "强制交班（签字立即失效）"}
            </button>
            {feedback ? (
              <p className={feedback.ok ? "flash-ok" : "flash-err"}>{feedback.text}</p>
            ) : null}
            <p className="muted tiny">封存内容：班次边界各舱原始读数快照与本次对账结果，此后任何补录均不回改。</p>
          </aside>
        </div>
      </section>

      <section className="panel">
        <div className="heading">
          <div>
            <p>历史班次</p>
            <h2>交接签字状态</h2>
          </div>
        </div>
        <div className="watch-history">
          {history.map((w) => {
            const r = effectiveReconc(w);
            const signed = isWatchSigned(w);
            const voided = w.voided && !w.resigned;
            return (
              <article key={w.id} className={`wh-card ${voided ? "wh-card-bad" : signed ? "wh-card-ok" : ""}`}>
                <header>
                  <div>
                    <b>{watchDayLabel(w)} {watchLabel(w)}</b>
                    <span className="muted"> {fmtDT(w.start)} – {fmtDT(w.end)}</span>
                  </div>
                  {voided ? <Badge tone="bad">签字失效 · 待复核</Badge> : signed ? <Badge tone="ok">签字有效</Badge> : <Badge>已交班</Badge>}
                </header>
                <dl className="wh-dl">
                  <div><dt>转速</dt><dd>{w.rpmStart ?? "—"} → {w.rpmEnd ?? "—"} rpm</dd></div>
                  <div><dt>实测/申报</dt><dd>{fmtNum(r?.totalMeasured, 2)} / {fmtNum(r?.totalReported, 2)} t</dd></div>
                  <div><dt>总差异</dt><dd className={r && r.totalExceeded ? "num-bad" : ""}>{signedDiff(r?.totalDifference, 2)} t</dd></div>
                  <div><dt>交班人</dt><dd>{w.signed?.officer ?? "—"}</dd></div>
                </dl>
                {r && r.flaggedTankIds.length > 0 ? (
                  <p className="flag-line">
                    差异油舱：
                    {r.flaggedTankIds.map((id) => {
                      const t = data.tanks.find((x) => x.id === id);
                      return (
                        <Badge key={id} tone="bad">
                          {t?.name} {signedDiff(r.lines.find((l) => l.tankId === id)?.difference, 2)}t
                        </Badge>
                      );
                    })}
                  </p>
                ) : null}
                {voided ? (
                  <>
                    <p className="danger-note">{w.voided?.reason}</p>
                    <div className="wh-actions">
                      <button className="primary" onClick={() => setResignTarget(w)}>
                        轮机长复核后复签
                      </button>
                    </div>
                  </>
                ) : w.resigned ? (
                  <p className="flash-ok">已于 {fmtDT(w.resigned.signedAt)} 由 {w.resigned.officer} 复签（原失效记录保留审计）。</p>
                ) : (
                  <div className="wh-actions">
                    <button onClick={() => { setVoidTarget(w); setVoidReason(""); }}>
                      轮机长标记失效
                    </button>
                  </div>
                )}
              </article>
            );
          })}
        </div>
      </section>

      <Modal
        open={!!resignTarget}
        title="轮机长复核复签"
        onClose={() => setResignTarget(null)}
        footer={
          <>
            <button onClick={() => setResignTarget(null)}>取消</button>
            <button className="primary" onClick={doResign}>
              确认复签（以复核后的有效读数重新封存对账）
            </button>
          </>
        }
      >
        {resignTarget && (() => {
          const rr = reconcileWatch(resignTarget, data.tanks, data.readings, tol);
          return (
            <div>
              <p>
                将按<b>当前有效读数</b>重新计算 {watchDayLabel(resignTarget)} {watchLabel(resignTarget)} 的对账：
              </p>
              <p className={rr.passed ? "flash-ok" : "flash-err"}>
                总差异 {signedDiff(rr.totalDifference, 3)} t（允许 ±{fmtNum(tol.totalT, 2)} t）；
                {rr.passed ? "差异已消除，可以复签。" : "仍有差异油舱，暂不能复签。"}
              </p>
              <p className="muted tiny">原始封存快照保持不变，复签结果与原失效记录同时保留。</p>
            </div>
          );
        })()}
      </Modal>

      <Modal
        open={!!voidTarget}
        title="标记交接签字失效"
        onClose={() => setVoidTarget(null)}
        footer={
          <>
            <button onClick={() => setVoidTarget(null)}>取消</button>
            <button
              className="danger-btn"
              disabled={!voidReason.trim()}
              onClick={() => {
                if (voidTarget) voidSignedWatch(voidTarget.id, voidReason.trim());
                setVoidTarget(null);
                setFeedback({ ok: true, text: "签字已标记失效，等待复核。" });
              }}
            >
              确认失效
            </button>
          </>
        }
      >
        <label className="field">
          <span>失效原因（轮机长）</span>
          <input value={voidReason} onChange={(e) => setVoidReason(e.target.value)} placeholder="如：复查发现燃油日报与存量差超允许值" />
        </label>
      </Modal>
    </div>
  );
}
