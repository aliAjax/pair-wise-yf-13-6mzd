import type { Shift } from "../types";
import { fmtDT } from "../lib/fuel";
import { Badge } from "./bits";

interface Props {
  shifts: Shift[];
  selectedId: string;
  onSelect: (id: string) => void;
  onUpdate: (id: string, patch: Partial<Shift>) => void;
  onSign: (id: string) => void;
  onReview: (id: string) => void;
}

export default function ShiftBar({
  shifts,
  selectedId,
  onSelect,
  onUpdate,
  onSign,
  onReview,
}: Props) {
  const selected = shifts.find((s) => s.id === selectedId) ?? shifts[0];
  const dateGroups: { date: string; items: Shift[] }[] = [];
  for (const s of shifts) {
    let g = dateGroups.find((x) => x.date === s.date);
    if (!g) {
      g = { date: s.date, items: [] };
      dateGroups.push(g);
    }
    g.items.push(s);
  }

  return (
    <section className="panel shift-panel">
      <div className="heading">
        <div>
          <p>值班班次 · 交接班</p>
          <h2>班次切换与交接签字</h2>
        </div>
        <div className="shift-legend">
          <span className="dot dot-green" /> 已签字
          <span className="dot dot-red" /> 签字失效
          <span className="dot dot-gray" /> 未交班
        </div>
      </div>

      <div className="shift-tabs">
        {dateGroups.map((g) => (
          <div className="shift-group" key={g.date}>
            <span className="shift-date">{g.date.slice(5)}</span>
            {g.items.map((s) => {
              const cls = s.signatureInvalid
                ? "tab-red"
                : s.signed
                ? "tab-green"
                : "";
              return (
                <button
                  key={s.id}
                  className={`shift-tab ${cls} ${
                    s.id === selected.id ? "active" : ""
                  }`}
                  onClick={() => onSelect(s.id)}
                >
                  {s.name}
                </button>
              );
            })}
          </div>
        ))}
      </div>

      <div className="shift-detail">
        <div className="shift-status-row">
          <div>
            <strong>
              {selected.date} {selected.name}班
            </strong>
            <span className="shift-time">
              {fmtDT(selected.startAt)} – {fmtDT(selected.endAt)}
            </span>
          </div>
          <div>
            {selected.signatureInvalid ? (
              <Badge tone="red">签字失效 · 等待轮机长复核</Badge>
            ) : selected.signed ? (
              <Badge tone="green">交接已签字 · 原始读数冻结</Badge>
            ) : (
              <Badge tone="gray">未交班</Badge>
            )}
          </div>
        </div>

        <div className="shift-fields">
          <label>
            <span>当班轮机员</span>
            <input
              value={selected.engineer}
              placeholder="姓名"
              onChange={(e) =>
                onUpdate(selected.id, { engineer: e.target.value })
              }
            />
          </label>
          <label>
            <span>主机转速 rpm</span>
            <input
              type="number"
              value={selected.rpm ?? ""}
              placeholder="如 82"
              onChange={(e) =>
                onUpdate(selected.id, {
                  rpm: e.target.value === "" ? null : Number(e.target.value),
                })
              }
            />
          </label>
          <label>
            <span>油耗表本班消耗量 t</span>
            <input
              type="number"
              step="0.01"
              value={selected.meterConsumption ?? ""}
              placeholder="0.00"
              onChange={(e) =>
                onUpdate(selected.id, {
                  meterConsumption:
                    e.target.value === "" ? null : Number(e.target.value),
                })
              }
            />
          </label>
          <label>
            <span>对账允许差 t</span>
            <input
              type="number"
              step="0.05"
              value={selected.allowableDiff}
              onChange={(e) =>
                onUpdate(selected.id, { allowableDiff: Number(e.target.value) })
              }
            />
          </label>
        </div>

        <div className="shift-actions">
          {!selected.signatureInvalid ? (
            <button
              className="primary"
              onClick={() => onSign(selected.id)}
              disabled={selected.signed && !selected.signatureInvalid}
            >
              {selected.signed ? "已完成交接签字" : "交班签字（立即对账）"}
            </button>
          ) : (
            <>
              <button className="primary" onClick={() => onSign(selected.id)}>
                处理后重新签字
              </button>
              <button className="danger" onClick={() => onReview(selected.id)}>
                轮机长复核对账
              </button>
            </>
          )}
          <span className="shift-hint">
            对账差异超过允许值时签字立即失效；补录只进历史，不回改已确认班次原始读数。
          </span>
        </div>
      </div>
    </section>
  );
}
