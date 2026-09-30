import { useState } from "react";
import { StoreProvider, useStore } from "./store";
import Dashboard from "./components/Dashboard";
import Entry from "./components/Entry";
import Handover from "./components/Handover";
import Review from "./components/Review";
import Trends from "./components/Trends";
import Summary from "./components/Summary";
import { watchDayLabel, watchLabel } from "./domain";

const TABS = [
  { key: "dashboard", label: "看板", icon: "▦" },
  { key: "entry", label: "抄表录入", icon: "✎" },
  { key: "handover", label: "交班对账", icon: "✍" },
  { key: "review", label: "历史与复核", icon: "⚑" },
  { key: "trends", label: "趋势", icon: "∿" },
  { key: "summary", label: "摘要与设置", icon: "☰" },
];

function Shell() {
  const [tab, setTab] = useState("dashboard");
  const [bannerOpen, setBannerOpen] = useState(true);
  const { data, currentWatch, missingDensityCount, pendingReviewCount } = useStore();

  const voidedOpen = data.watches.filter((w) => w.confirmed && w.voided && !w.resigned);

  return (
    <main className="app">
      <header className="topbar">
        <div className="brand">
          <span className="brand-mark">油</span>
          <div>
            <h1>{data.settings.shipName} · 油料与值守对账台</h1>
            <small>液位 / 温度 / 密度按观测时刻存档 · 油耗取相邻两次实测差 · 数据仅存于本机浏览器</small>
          </div>
        </div>
        <div className="top-status">
          <span className="ts-item">
            当前 <b>{watchDayLabel(currentWatch)} {watchLabel(currentWatch)}</b>
          </span>
          {missingDensityCount > 0 && (
            <button className="ts-alert" onClick={() => setTab("review")}>
              待补录密度 ×{missingDensityCount}
            </button>
          )}
          {pendingReviewCount > 0 && (
            <button className="ts-alert ts-alert-purple" onClick={() => setTab("review")}>
              待轮机长复核 ×{pendingReviewCount}
            </button>
          )}
        </div>
      </header>

      <nav className="tabs no-print">
        {TABS.map((t) => (
          <button
            key={t.key}
            className={tab === t.key ? "tab tab-active" : "tab"}
            onClick={() => setTab(t.key)}
          >
            <span className="tab-icon">{t.icon}</span>
            {t.label}
            {t.key === "review" && (missingDensityCount + pendingReviewCount > 0) ? (
              <i className="tab-dot">{missingDensityCount + pendingReviewCount}</i>
            ) : null}
            {t.key === "handover" && voidedOpen.length > 0 ? <i className="tab-dot tab-dot-bad">{voidedOpen.length}</i> : null}
          </button>
        ))}
      </nav>

      {bannerOpen && missingDensityCount > 0 ? (
        <div className="migration-banner">
          <b>旧记录已迁移：</b>
          检测到 {missingDensityCount} 条历史读数缺实测密度，已迁入「待补录」队列——保留液位与温度但不计入存量折算与对账，数据保存在浏览器中。
          <button className="link-btn" onClick={() => setTab("review")}>
            前往补录 →
          </button>
          <button className="banner-close" onClick={() => setBannerOpen(false)} aria-label="关闭提示">
            ✕
          </button>
        </div>
      ) : null}

      {tab === "dashboard" && <Dashboard onNavigate={setTab} />}
      {tab === "entry" && <Entry />}
      {tab === "handover" && <Handover />}
      {tab === "review" && <Review />}
      {tab === "trends" && <Trends />}
      {tab === "summary" && <Summary />}

      <footer className="app-foot no-print">
        <span>规则：晚到补录只进历史，不回改已确认班次原始读数 · 同一观测时刻只留一条有效值（轮机长复核裁定）</span>
        <span>hxyfront-62001 · 本地存储 fuel-watch-reconcile-v1</span>
      </footer>
    </main>
  );
}

export default function App() {
  return (
    <StoreProvider>
      <Shell />
    </StoreProvider>
  );
}
