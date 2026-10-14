import type { SeatingPlan } from "./seating";

export type SeatPoint = { id: string; x: number; y: number; facing: "up" | "down" | "center" };
export type SeatingLayout = { width: number; height: number; points: SeatPoint[]; table: { x: number; y: number; width: number; height: number; round: boolean } | null; groups: { text: string; x: number; y: number }[]; screen: boolean };

/** Presentation geometry only: never estimates physical room capacity or dimensions. */
export function seatingLayout(plan: SeatingPlan): SeatingLayout {
  if (plan.options.template === "round") {
    const size = Math.max(700, plan.participants.length * 48);
    const radius = size / 2 - 120;
    return { width: size, height: size, screen: false, groups: [], table: { x: size * .27, y: size * .27, width: size * .46, height: size * .46, round: true }, points: plan.seats.map((seat) => {
      const angle = seat.position / plan.participants.length * Math.PI * 2 + (plan.options.door === "bottom" ? -Math.PI / 2 : Math.PI / 2);
      return { id: seat.id, x: size / 2 + Math.cos(angle) * radius, y: size / 2 + Math.sin(angle) * radius, facing: "center" };
    }) };
  }
  const rows = [...new Set(plan.seats.map((seat) => seat.row))].sort((a, b) => a - b);
  const span = Math.max(...rows.map((row) => plan.seats.filter((seat) => seat.row === row).length));
  const width = Math.max(760, span * 126 + 140);
  const table = plan.options.template.startsWith("table");
  const height = table ? 650 : Math.max(520, rows.length * 172 + 190);
  const points = plan.seats.map((seat): SeatPoint => {
    const count = plan.seats.filter((item) => item.row === seat.row).length;
    return { id: seat.id, x: width / 2 + (seat.position - (count - 1) / 2) * 126,
      y: table ? seat.row === 1 ? 200 : 460 : height - 155 - (seat.row - 1) * 172,
      facing: table && seat.row === 2 ? "up" : "down" };
  });
  return { width, height, points, screen: !table, table: table ? { x: 70, y: 285, width: width - 140, height: 90, round: false } : null,
    groups: rows.map((row) => ({ text: plan.seats.find((seat) => seat.row === row)!.group, x: width / 2, y: (points.find((point) => plan.seats.find((seat) => seat.id === point.id)?.row === row)?.y ?? 0) - 76 })) };
}

export function seatingFitScale(width: number, height: number, layout: Pick<SeatingLayout, "width" | "height">) {
  return Math.max(.08, Math.min(1, Math.max(1, width - 40) / layout.width, Math.max(1, height - 40) / layout.height));
}
