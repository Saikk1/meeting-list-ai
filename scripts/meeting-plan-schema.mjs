// Shared browser / local-store validation. Templates contain no meeting data.
const fields = ["title", "background", "date", "startTime", "endTime", "location", "groups", "agenda", "source"];
function object(value, keys, path) {
  if (!value || typeof value !== "object" || Array.isArray(value) || Object.getPrototypeOf(value) !== Object.prototype) throw new Error(`${path} 必须是普通对象`);
  if (Object.keys(value).some((key) => !keys.includes(key))) throw new Error(`${path} 包含不支持的字段`);
}
function text(value, max, path) {
  if (typeof value !== "string" || value.length > max || value.includes("\0")) throw new Error(`${path} 必须是最多 ${max} 字的文本`);
}
function rows(value, max, path, check) {
  if (!Array.isArray(value) || value.length > max) throw new Error(`${path} 条目过多或格式无效`);
  const ids = new Set();
  value.forEach((item) => {
    check(item);
    text(item.id, 200, path);
    if (!item.id || ids.has(item.id)) throw new Error(`${path} 标识为空或重复`);
    ids.add(item.id);
  });
}
export function validateMeetingPlanPatch(value) {
  object(value, fields.filter((key) => key !== "source"), "会议方案修改");
  if (!Object.keys(value).length) throw new Error("会议方案修改不能为空");
  validateFields(value);
  return value;
}
function validateFields(value) {
  for (const key of ["title", "background", "date", "startTime", "endTime", "location"]) {
    if (Object.hasOwn(value, key)) text(value[key], key === "background" ? 20000 : key === "location" ? 500 : key === "title" ? 300 : 40, key);
  }
  if (value.date && !/^\d{4}-\d{2}-\d{2}$/.test(value.date)) throw new Error("方案日期格式无效");
  if (value.date && (Number.isNaN(Date.parse(`${value.date}T00:00:00Z`)) || new Date(`${value.date}T00:00:00Z`).toISOString().slice(0, 10) !== value.date)) throw new Error("方案日期不是有效日历日期");
  for (const key of ["startTime", "endTime"]) if (value[key] && !/^([01]\d|2[0-3]):[0-5]\d$/.test(value[key])) throw new Error("方案时间格式无效");
  if (value.startTime && value.endTime && value.endTime <= value.startTime) throw new Error("方案结束时间须晚于开始时间");
  if (Object.hasOwn(value, "groups")) {
    const personIds = new Set();
    rows(value.groups, 250, "参会分组", (g) => {
      object(g, ["id", "label", "people", "collective"], "参会分组");
      text(g.label, 300, "组名"); text(g.collective, 4000, "集体描述");
      rows(g.people, 1000, "组内人员", (p) => {
        object(p, ["id", "name", "unit", "department", "title"], "方案人员");
        for (const k of ["name", "unit", "department", "title"]) text(p[k], k === "unit" ? 200 : 120, k);
        if (personIds.has(p.id)) throw new Error("方案人员不能重复出现在不同分组");
        personIds.add(p.id);
      });
    });
    if (personIds.size > 1000) throw new Error("方案最多包含1000名人员");
  }
  if (Object.hasOwn(value, "agenda")) rows(value.agenda, 100, "议程", (a) => {
    object(a, ["id", "content", "speaker", "duration"], "议程");
    text(a.content, 4000, "议程内容"); text(a.speaker, 200, "发言人"); text(a.duration, 100, "时长");
  });
}
export function validateMeetingPlan(value) {
  object(value, fields, "会议方案");
  if (fields.some((key) => !Object.hasOwn(value, key))) throw new Error("会议方案字段不完整");
  validateFields(value);
  object(value.source, ["title", "time", "location", "people"], "来源快照");
  for (const k of ["title", "time", "location", "people"]) text(value.source[k], k === "people" ? 1000000 : 1000, "来源快照");
  if (JSON.stringify(value).length > 1000000) throw new Error("会议方案超过容量限制");
  return value;
}
