/** Meeting vehicles belong to a reporting unit, never to an attendee/contact. */
export type MeetingVehicle = {
  unit: string;
  licensePlate: string;
  note: string;
};

export function normalizeLicensePlate(value: string) {
  return value.normalize("NFKC").replace(/[\s·•]/g, "").toUpperCase();
}

export function normalizeMeetingVehicles(vehicles: readonly MeetingVehicle[]) {
  if (vehicles.length > 500) throw new Error("最多登记 500 辆参会车辆");
  const seen = new Set<string>();
  return vehicles.map((vehicle) => ({
    unit: vehicle.unit.trim(),
    licensePlate: normalizeLicensePlate(vehicle.licensePlate),
    note: vehicle.note.trim(),
  })).filter((vehicle) => vehicle.unit || vehicle.licensePlate || vehicle.note)
    .map((vehicle, index) => {
      if (!vehicle.licensePlate) throw new Error(`第 ${index + 1} 辆车缺少车牌号`);
      if (vehicle.unit.length > 200 || vehicle.licensePlate.length > 40 || vehicle.note.length > 500) {
        throw new Error(`第 ${index + 1} 辆车的信息过长`);
      }
      if (seen.has(vehicle.licensePlate)) throw new Error(`车牌号“${vehicle.licensePlate}”重复，请核对单位`);
      seen.add(vehicle.licensePlate);
      return vehicle;
    });
}

export async function buildMeetingVehiclesXlsx(vehicles: readonly MeetingVehicle[]) {
  const rows = normalizeMeetingVehicles(vehicles);
  const XLSX = await import("xlsx");
  const sheet = XLSX.utils.aoa_to_sheet([
    ["序号", "单位", "车牌号", "备注"],
    ...rows.map((vehicle, index) => [index + 1, vehicle.unit, vehicle.licensePlate, vehicle.note]),
  ]);
  sheet["!cols"] = [{ wch: 8 }, { wch: 40 }, { wch: 18 }, { wch: 40 }];
  const workbook = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(workbook, sheet, "参会车辆");
  return XLSX.write(workbook, { type: "array", bookType: "xlsx" }) as ArrayBuffer;
}
