import type { ReadingState, TankKind } from "../types";

export const KIND_LABEL: Record<TankKind, string> = {
  storage: "燃油舱",
  settling: "沉淀柜",
  daily: "日用柜",
};

export const STATE_LABEL: Record<ReadingState, string> = {
  valid: "有效",
  pending_review: "待复核",
  pending_density: "待补录",
  void: "作废",
};

export function Badge({
  tone,
  children,
}: {
  tone: "green" | "red" | "amber" | "blue" | "gray" | "purple";
  children: React.ReactNode;
}) {
  return <span className={`badge badge-${tone}`}>{children}</span>;
}

export function StateBadge({ state }: { state: ReadingState }) {
  const tone =
    state === "valid"
      ? "green"
      : state === "pending_review"
      ? "amber"
      : state === "pending_density"
      ? "red"
      : "gray";
  return <Badge tone={tone}>{STATE_LABEL[state]}</Badge>;
}
