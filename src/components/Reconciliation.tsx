import { useMemo } from "react";
import type { Reading, Shift, Tank } from "../types";
import { reconcile, fmtDT } from "../lib/fuel";
import { KIND_LABEL, Badge } from "./bits";

interface Props {
  shift: Shift;
  tanks: Tank[];
  readings: Reading[];
}

export default function Reconciliation({ shift, tanks, readings }: Props) {
  const live = useMemo(
    () => reconcile(shift, tanks, readings),
    [shift, tanks, readings]
  );

  // 已签字班次使用冻结快照；未交班使用实时对账
  const snap = shift.signed && shift.snapshot ? shift.snapshot : null;
  const view = snap
    ? {
        movements: snap.movements,
        tankDiff: snap.tankDiff,
        meter: snap.meterConsumption,
        diff: snap.diff,
        diffRate: snap.diffRate,
        passed: snap.passed,
        blocked: snap.blocked,
        differential: snap.differential,
      }
    : live;

  const tankName = (id: string) => tanks.find((t) => t.id === id)?.name ?? id;

  return (
    <section className="panel">
      <div className="heading">
        <div>
          <p>油耗取相邻两次实测差 · 与油耗表对账</p>
          <h2>
            {shift.date.slice(5)} {shift.name}班 油料对账
          </h2>
        </div>
        {snap ? (
          <Badge tone={view.passed ? "green" : "red"}>
            {view.passed ? "对账通过（快照冻结）" : "对账失败 · 签字失效"}
          </Badge>
        ) : (
          <Badge tone={view.blocked ? "red" : view.diff !== 0 ? "amber" : "gray"}>
            {view.blocked
              ? "对账阻塞：有待补录 / 待复核"
              : Math.abs(view.diff) <= shift.allowableDiff
              ? "试算通过（未签字）"
              : "试算差异超允许值"}
          </Badge>
        )}
      </div>

      <div className="recon-table">
        <div className="recon-row recon-head">
          <span>油舱</span>
          <span>期初存量</span>
          <span>期末存量</span>
          <span>实测消耗</span>
          <span>状态 / 差异原因</span>
        </div>
        {view.movements.map((m) => {
          const tank = tanks.find((t) => t.id === m.tankId)!;
          const diffItem = view.differential.find((d) => d.tankId === m.tankId);
          return (
            <div className="recon-row" key={m.tankId}>
              <span className="recon-tank">
                {tank.name}
                <small>{KIND_LABEL[tank.kind]}</small>
              </span>
              <span>
                {m.openingMass != null ? `${m.openingMass} t` : "—"}
                {m.opening && (
                  <small className="recon-time">{fmtDT(m.opening.observedAt)}</small>
                )}
              </span>
              <span>
                {m.closingMass != null ? `${m.closingMass} t` : "—"}
                {m.closing && (
                  <small className="recon-time">{fmtDT(m.closing.observedAt)}</small>
                )}
              </span>
              <span className="recon-diff">
                {m.diff != null ? `${m.diff} t` : "—"}
              </span>
              <span>
                {m.blockers.length > 0 ? (
                  <Badge tone="red">{m.blockers[0]}</Badge>
                ) : m.anomaly ? (
                  <Badge tone="red">{m.anomaly}</Badge>
                ) : diffItem?.level === "warn" ? (
                  <Badge tone="amber">{diffItem.reason}</Badge>
                ) : (
                  <Badge tone="green">正常</Badge>
                )}
              </span>
            </div>
          );
        })}
      </div>

      <div className="recon-summary">
        <div>
          <small>实测消耗合计</small>
          <b>{view.tankDiff} t</b>
        </div>
        <div>
          <small>油耗表消耗量</small>
          <b>{view.meter} t</b>
        </div>
        <div>
          <small>对账差异</small>
          <b className={Math.abs(view.diff) > shift.allowableDiff ? "num-bad" : "num-ok"}>
            {view.diff} t
          </b>
        </div>
        <div>
          <small>差异率</small>
          <b>{(view.diffRate * 100).toFixed(1)}%</b>
        </div>
        <div>
          <small>允许差</small>
          <b>±{shift.allowableDiff} t</b>
        </div>
      </div>

      {view.differential.length > 0 && (
        <div className="diff-tanks">
          <h3>差异油舱（{view.differential.length}）</h3>
          <ul>
            {view.differential.map((d, i) => (
              <li key={i} className={d.level === "error" ? "diff-error" : "diff-warn"}>
                <Badge tone={d.level === "error" ? "red" : "amber"}>
                  {d.level === "error" ? "异常" : "差异"}
                </Badge>
                <strong>{tankName(d.tankId)}</strong>
                <span>{d.reason}</span>
              </li>
            ))}
          </ul>
        </div>
      )}

      {snap && (
        <p className="snapshot-note">
          已确认班次原始读数已冻结（对账快照于 {fmtDT(snap.at)} 生成）；晚到补录只进历史，不回改本班原始读数。
        </p>
      )}
    </section>
  );
}
