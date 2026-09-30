"use client";

import { Car, Plus, Trash2 } from "lucide-react";
import { useId, useMemo } from "react";
import type { MeetingVehicle } from "../lib/meeting-vehicles";
import { normalizeLicensePlate } from "../lib/meeting-vehicles";
import { buildUnitDirectory, resolveCanonicalUnit, searchUnitDirectory } from "../lib/unit-directory";
import { useAdminConfig } from "../lib/use-admin-config";

export function MeetingVehicleEditor({ value, onChange, disabled = false }: {
  value: MeetingVehicle[];
  onChange: (value: MeetingVehicle[]) => void;
  disabled?: boolean;
}) {
  const { config } = useAdminConfig();
  const listId = useId();
  const units = useMemo(() => buildUnitDirectory(config.rosterRules.aliases), [config.rosterRules.aliases]);
  function patch(index: number, field: keyof MeetingVehicle, text: string) {
    onChange(value.map((vehicle, position) => position === index ? { ...vehicle, [field]: text } : vehicle));
  }
  return (
    <div className="meeting-vehicle-editor">
      <div className="meeting-attendee-editor__toolbar">
        <div><strong>参会车辆（可选）</strong><span>按单位登记，不绑定人员；同一单位可以报多辆车，单位暂不明确也可先登记</span></div>
        <button type="button" disabled={disabled} onClick={() => onChange([...value, { unit: "", licensePlate: "", note: "" }])}>
          <Plus aria-hidden="true" />添加车辆
        </button>
      </div>
      {value.length ? (
        <div className="meeting-attendee-editor__table-wrap">
          <table className="meeting-vehicle-editor__table">
            <thead><tr><th>报送单位</th><th>车牌号 *</th><th>备注</th><th aria-label="操作" /></tr></thead>
            <tbody>{value.map((vehicle, index) => {
              const plate = normalizeLicensePlate(vehicle.licensePlate);
              const duplicate = plate && value.some((other, i) => i !== index && normalizeLicensePlate(other.licensePlate) === plate);
              return <tr key={index}>
                <td>
                  <input value={vehicle.unit} maxLength={200} disabled={disabled} list={`${listId}-${index}`} placeholder="输入单位或选择全称" aria-label={`第 ${index + 1} 辆车报送单位`}
                    onChange={(event) => patch(index, "unit", event.target.value)}
                    onBlur={() => { const match = resolveCanonicalUnit(vehicle.unit, units); if (match) patch(index, "unit", match.canonical); }} />
                  <datalist id={`${listId}-${index}`}>{searchUnitDirectory(vehicle.unit, units).map((unit) => <option key={unit.id} value={unit.canonical} />)}</datalist>
                </td>
                <td><input value={vehicle.licensePlate} maxLength={40} disabled={disabled} placeholder="例如：浙B12345" aria-label={`第 ${index + 1} 辆车车牌号`}
                  onChange={(event) => patch(index, "licensePlate", event.target.value)} />
                  {duplicate ? <small className="meeting-vehicle-editor__error">车牌重复，请核对</small> : null}
                </td>
                <td><input value={vehicle.note} maxLength={500} disabled={disabled} placeholder="例如：单位公务用车（可留空）" aria-label={`第 ${index + 1} 辆车备注`}
                  onChange={(event) => patch(index, "note", event.target.value)} /></td>
                <td><button className="meeting-attendee-editor__remove" type="button" disabled={disabled} aria-label={`删除第 ${index + 1} 辆车`}
                  onClick={() => onChange(value.filter((_, i) => i !== index))}><Trash2 aria-hidden="true" /></button></td>
              </tr>;
            })}</tbody>
          </table>
        </div>
      ) : <div className="meeting-vehicle-editor__empty"><Car aria-hidden="true" /><span>暂未登记车辆。无需人员名单，也可以独立登记车辆。</span></div>}
    </div>
  );
}
