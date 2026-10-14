"use client";

import { LockKeyhole, Maximize2, Minus, Plus } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { seatingFitScale, seatingLayout } from "../lib/seating-layout";
import type { SeatingPlan } from "../lib/seating";

export function SeatingCanvas({ plan, selectedId, swapSourceId, disabled, onSelect, onSwap }: {
  plan: SeatingPlan; selectedId: string; swapSourceId: string; disabled: boolean;
  onSelect: (id: string) => void; onSwap: (sourceId: string, targetId: string) => void;
}) {
  const viewport = useRef<HTMLDivElement>(null);
  const [size, setSize] = useState({ width: 800, height: 520 });
  const [zoom, setZoom] = useState<number | null>(null);
  const dragging = useRef("");
  const layout = seatingLayout(plan);
  const fit = seatingFitScale(size.width, size.height, layout);
  const scale = zoom ?? Math.max(.72, fit);
  const people = new Map(plan.participants.map((person) => [person.id, person]));
  const selectedPoint = layout.points.find((point) => point.id === selectedId);
  useEffect(() => {
    const element = viewport.current;
    if (!element) return;
    const observer = new ResizeObserver(([entry]) => setSize({ width: entry.contentRect.width, height: entry.contentRect.height }));
    observer.observe(element);
    return () => observer.disconnect();
  }, []);
  useEffect(() => {
    const element = viewport.current;
    if (!element?.clientWidth || !element.clientHeight) return;
    element.scrollTo({ left: Math.max(0, (selectedPoint?.x ?? layout.width / 2) * scale - element.clientWidth / 2 + 20), top: Math.max(0, (selectedPoint?.y ?? layout.height / 2) * scale - element.clientHeight / 2 + 20) });
  }, [selectedPoint?.x, selectedPoint?.y, layout.width, layout.height, scale]);
  return <div className="seat-canvas-shell">
    <div className="seat-canvas-tools"><span><i className="seat-dot host" />主方 <i className="seat-dot guest" />客方 <LockKeyhole size={13} />锁定</span><div>
      <button type="button" aria-label="缩小座次图" disabled={scale <= .12} onClick={() => setZoom(Math.max(.12, scale / 1.25))}><Minus size={15} /></button>
      <span>{Math.round(scale * 100)}%</span>
      <button type="button" aria-label="放大座次图" disabled={scale >= 2} onClick={() => setZoom(Math.min(2, scale * 1.25))}><Plus size={15} /></button>
      <button type="button" aria-label="座次图适应窗口" onClick={() => { setZoom(fit); viewport.current?.scrollTo(0, 0); }}><Maximize2 size={15} /></button>
    </div></div>
    <div className="seat-canvas-viewport" ref={viewport} aria-label="可交互座次图">
      <div className="seat-canvas-scaled" style={{ width: layout.width * scale, height: layout.height * scale }}>
        <div className="seat-canvas-scene" style={{ width: layout.width, height: layout.height, transform: `scale(${scale})` }}>
          {layout.screen ? <div className="seat-screen" style={{ left: layout.width / 2 }}>主席台背景 / 屏幕</div> : null}
          {layout.table ? <div className={`seat-furniture ${layout.table.round ? "round" : ""}`} style={{ left: layout.table.x, top: layout.table.y, width: layout.table.width, height: layout.table.height }}><span>{layout.table.round ? "圆桌" : "会谈桌"}</span><small>布局示意 · 非实测尺寸</small></div> : null}
          {layout.groups.map((group) => <span key={group.text} className="seat-group-label" style={{ left: group.x, top: group.y }}>{group.text}</span>)}
          {layout.points.map((point) => {
            const seat = plan.seats.find((entry) => entry.id === point.id)!;
            const person = people.get(seat.personId ?? "");
            const locked = plan.lockedSeatIds?.includes(seat.id);
            return <button type="button" key={seat.id} className={`seat-node ${seat.party} ${point.facing} ${seat.labels.length ? "key-seat" : ""} ${selectedId === seat.id ? "selected" : ""} ${swapSourceId === seat.id ? "swap-source" : ""}`}
              style={{ left: point.x, top: point.y }} disabled={disabled || !person} aria-pressed={selectedId === seat.id} aria-label={person ? `${seat.seatNumber}号 ${person.name} ${seat.group}${locked ? " 已锁定" : ""}` : "留空席"}
              title={person ? `${person.name} · ${person.unit || "单位未填"} · ${person.title || "职务未填"}${locked ? "（已锁定）" : "（点击查看，可拖动交换）"}` : "留空席"}
              draggable={!disabled && Boolean(person) && !locked}
              onClick={() => { if (swapSourceId && swapSourceId !== seat.id) onSwap(swapSourceId, seat.id); else onSelect(seat.id); }}
              onDragStart={(event) => { dragging.current = seat.id; event.dataTransfer.setData("text/plain", seat.id); event.dataTransfer.effectAllowed = "move"; }}
              onDragEnd={() => { dragging.current = ""; }}
              onDragOver={(event) => { if (dragging.current && person && !locked && !disabled) { event.preventDefault(); event.dataTransfer.dropEffect = "move"; } }}
              onDrop={(event) => { event.preventDefault(); const source = dragging.current; dragging.current = ""; if (source && !disabled) onSwap(source, seat.id); }}>
              <span className="seat-node-meta"><b>{seat.seatNumber || "空"}</b>{locked ? <LockKeyhole size={13} /> : null}</span>
              <strong>{person?.name ?? "留空席"}</strong><small>{seat.labels.join(" · ") || (seat.party === "host" ? "主方" : seat.party === "guest" ? "客方" : "")}</small>
              <span className="seat-facing" aria-hidden>{point.facing === "up" ? "↑" : point.facing === "down" ? "↓" : "向桌心"}</span>
            </button>;
          })}
          <div className={`seat-entrance ${plan.options.door}`} style={{ left: layout.width / 2 }}>入口 / 门</div>
          {layout.screen ? <span className="seat-audience" style={{ left: layout.width / 2 }}>面向会场 ↓</span> : null}
        </div>
      </div>
    </div>
    <p className="seat-canvas-hint">点击座位查看详情；选择“交换席位”后点击另一席，或直接拖动换座。箭头表示就座朝向。</p>
  </div>;
}
