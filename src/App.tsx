import { useMemo, useState } from "react";
import "./styles.css";
import { useCurrentShiftId, useStore } from "./store";
import { reconcile } from "./lib/fuel";
import ShiftBar from "./components/ShiftBar";
import AlertBanner from "./components/AlertBanner";
import TankBoard from "./components/TankBoard";
import ReadingForm from "./components/ReadingForm";
import Reconciliation from "./components/Reconciliation";
import TrendChart from "./components/TrendChart";
import ReviewQueue from "./components/ReviewQueue";
import History from "./components/History";

export default function App() {
  const store = useStore();
  const { tanks, readings, shifts } = store;
  const currentId = useCurrentShiftId(shifts);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [highlightTank, setHighlightTank] = useState<string | null>(null);

  const selectedIdResolved = selectedId ?? currentId;
  const selected =
    shifts.find((s) => s.id === selectedIdResolved) ?? shifts[0];

  const live = useMemo(
    () => (selected ? reconcile(selected, tanks, readings) : null),
    [selected, tanks, readings]
  );

  const pendingDensity = readings.filter((r) => r.state === "pending_density").length;
  const pendingReview = readings.filter((r) => r.state === "pending_review").length;
  const invalidCount = shifts.filter((s) => s.signatureInvalid).length;
  const validCount = readings.filter((r) => r.state === "valid").length;

  const jumpQueue = () => {
    document.getElementById("review-queue")?.scrollIntoView({ behavior: "smooth", block: "start" });
  };

  return (
    <main className="app">
      <section className="hero">
        <div className="hero-top">
          <div>
            <p>船舶轮机 · 油料与值守对账台</p>
            <h1>油料与值守对账台</h1>
            <span>
              各舱按观测时刻保存液位、温度、密度并折算存量；油耗取相邻两次实测差，
              与主机油耗表交接班对账。晚到补录只进历史，不回改已确认班次原始读数；
              同一观测时刻只留一条有效值，等待轮机长复核；旧记录缺密度自动迁移为待补录。
            </span>
          </div>
          <div className="hero-actions">
            <span className="local-badge">数据仅保存在本浏览器（localStorage）</span>
            <button onClick={store.exportData}>导出数据</button>
            <button
              onClick={() => {
                if (confirm("将清空当前数据并重置为演示数据，确定？")) store.resetData();
              }}
            >
              重置演示
            </button>
          </div>
        </div>
      </section>

      <section className="metrics">
        <article>
          <small>油舱</small>
          <strong>{tanks.length} 座</strong>
        </article>
        <article>
          <small>有效读数</small>
          <strong>{validCount} 条</strong>
        </article>
        <article>
          <small>待补录 / 待复核</small>
          <strong className={pendingDensity + pendingReview ? "num-bad" : ""}>
            {pendingDensity + pendingReview} 条
          </strong>
        </article>
        <article>
          <small>{selected.date.slice(5)} {selected.name}班 试算差异</small>
          <strong className={live && Math.abs(live.diff) > selected.allowableDiff ? "num-bad" : "num-ok"}>
            {live ? `${live.diff > 0 ? "+" : ""}${live.diff} t` : "—"}
          </strong>
        </article>
      </section>

      <AlertBanner
        shifts={shifts}
        readings={readings}
        tanks={tanks}
        onJumpShift={setSelectedId}
        onJumpQueue={jumpQueue}
      />

      <ShiftBar
        shifts={shifts}
        selectedId={selected.id}
        onSelect={setSelectedId}
        onUpdate={store.updateShift}
        onSign={store.signShift}
        onReview={store.reviewShift}
      />

      <section className="workspace">
        <div className="col-main">
          <TankBoard
            tanks={tanks}
            readings={readings}
            onSelectTank={(id) =>
              setHighlightTank((cur) => (cur === id ? null : id))
            }
          />
          <Reconciliation shift={selected} tanks={tanks} readings={readings} />
          <TrendChart tanks={tanks} readings={readings} highlightTankId={highlightTank} />
          <History tanks={tanks} readings={readings} />
        </div>
        <div className="col-side">
          <ReadingForm
            tanks={tanks}
            shifts={shifts}
            readings={readings}
            onSubmit={store.addReading}
          />
          <ReviewQueue
            tanks={tanks}
            readings={readings}
            shifts={shifts}
            onSupplement={store.supplementDensity}
            onResolve={store.resolveDuplicate}
            onApprove={store.approveBackfill}
            onSign={store.signShift}
            onReview={store.reviewShift}
          />
        </div>
      </section>

      <footer className="footnote">
        对账规则：实测消耗 = 相邻两次实测存量差（期初 − 期末）；差异 = 实测消耗合计 −
        油耗表消耗量；差异超过允许值或存在待补录 / 待复核读数时，班次交接签字立即失效，
        差异油舱在看板、趋势与摘要中列出，经轮机长复核后重新签字。
      </footer>
    </main>
  );
}
