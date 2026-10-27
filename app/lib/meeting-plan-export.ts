import { strFromU8, strToU8, unzipSync, zipSync } from "fflate";
import { agendaText, planTime, type MeetingPlan } from "./meeting-plan";
import { validateMeetingPlan } from "../../scripts/meeting-plan-schema.mjs";

function xmlText(value: string) {
  return value.replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f]/g, "").replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
}
export function buildMeetingPlanDocx(plan: MeetingPlan, template: Uint8Array): Uint8Array {
  validateMeetingPlan(plan);
  const archive = unzipSync(template);
  if (!archive["word/document.xml"]) throw new Error("会议方案模板无效");
  const document = strFromU8(archive["word/document.xml"]);
  const paragraphs = [...document.matchAll(/<w:p(?:\s[^>]*)?>[\s\S]*?<\/w:p>/g)].map((m) => m[0]);
  function paragraph(kind: string, text: string) {
    const prototype = paragraphs.find((p) => p.includes(`{{${kind}}}`));
    if (!prototype) throw new Error(`模板缺少 ${kind} 样式`);
    return prototype.replace(`{{${kind}}}`, xmlText(text));
  }
  const parts = [paragraph("TITLE", plan.title || "会议方案（待确认）"), paragraph("BODY", ""), paragraph("HEADING", "一、会议背景")];
  for (const line of (plan.background || "会议背景待补充").split(/\r?\n/)) parts.push(paragraph("BODY", line));
  parts.push(paragraph("HEADING", "二、会议基本信息"), paragraph("SUBHEADING", "（一）时间"), paragraph("BODY", planTime(plan)), paragraph("SUBHEADING", "（二）地点"), paragraph("BODY", plan.location || "地点待确认"), paragraph("SUBHEADING", "（三）参会人员"));
  if (!plan.groups.length) parts.push(paragraph("BODY", "参会人员待确认"));
  plan.groups.forEach((g, i) => {
    parts.push(paragraph("BODY", `${i + 1}.${g.label || "分组待确认"}`));
    for (const person of g.people) parts.push(paragraph("BODY", `${person.name}  ${person.unit && person.unit !== g.label ? `${person.unit} ` : ""}${[person.department, person.title].filter(Boolean).join(" ")}`.trim()));
    for (const line of g.collective.split(/\r?\n/).filter(Boolean)) parts.push(paragraph("BODY", line));
  });
  parts.push(paragraph("HEADING", "三、会议议程"));
  if (!plan.agenda.length) parts.push(paragraph("BODY", "会议议程待补充"));
  plan.agenda.forEach((a, i) => parts.push(paragraph("BODY", `${i + 1}.${agendaText(a)}`)));
  const section = document.match(/<w:sectPr\b[\s\S]*?<\/w:sectPr>/)?.[0] ?? "";
  archive["word/document.xml"] = strToU8(document.replace(/<w:body>[\s\S]*?<\/w:body>/, `<w:body>${parts.join("")}${section}</w:body>`));
  return zipSync(archive, { level: 6 });
}
export async function downloadMeetingPlan(plan: MeetingPlan, meetingTitle: string) {
  const response = await fetch("/templates/meeting-plan.docx");
  if (!response.ok) throw new Error("会议方案模板读取失败，请重试");
  const bytes = buildMeetingPlanDocx(plan, new Uint8Array(await response.arrayBuffer()));
  const url = URL.createObjectURL(new Blob([new Uint8Array(bytes)], { type: "application/vnd.openxmlformats-officedocument.wordprocessingml.document" }));
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = `${meetingTitle.replace(/[\\/:*?"<>|\u0000-\u001f]/g, "_").slice(0, 120)}_会议方案_${plan.date || "日期待定"}.docx`;
  document.body.append(anchor); anchor.click(); anchor.remove();
  window.setTimeout(() => URL.revokeObjectURL(url), 30000);
  return anchor.download;
}
