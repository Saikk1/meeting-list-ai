import {
  strFromU8,
  strToU8,
  unzipSync,
  zipSync,
} from "fflate";

function pad(value: number) {
  return String(value).padStart(2, "0");
}

export function formatRosterExportFileName(
  template: string,
  meetingTitle = "",
  now = new Date(),
) {
  const date = `${now.getFullYear()}${pad(now.getMonth() + 1)}${pad(
    now.getDate(),
  )}`;
  const time = `${pad(now.getHours())}${pad(now.getMinutes())}${pad(
    now.getSeconds(),
  )}`;
  const configuredName = template
    .replaceAll("{会议名称}", meetingTitle.trim())
    .replaceAll("{日期}", date)
    .replaceAll("{时间}", time)
    .replaceAll("{yyyyMMdd}", date)
    .replaceAll("{date}", date)
    .replaceAll("{time}", time)
    .replace(/[<>:"/\\|?*\u0000-\u001f]/g, "_")
    .replace(/_{2,}/g, "_")
    .replace(/^[\s_.-]+|[\s_.-]+$/g, "")
    .slice(0, 180);
  const baseName = configuredName || `参会人员名单_${date}`;
  return baseName.toLowerCase().endsWith(".xlsx")
    ? baseName
    : `${baseName}.xlsx`;
}

const FROZEN_PANE =
  '<pane ySplit="1" topLeftCell="A2" activePane="bottomLeft" state="frozen"/><selection pane="bottomLeft" activeCell="A2" sqref="A2"/>';

export function freezeFirstRowInXlsx(
  input: ArrayBuffer | Uint8Array,
): Uint8Array {
  const original =
    input instanceof Uint8Array ? input : new Uint8Array(input);
  const archive = unzipSync(original);
  const sheetPath = "xl/worksheets/sheet1.xml";
  const sheet = archive[sheetPath];
  if (!sheet) return original;

  let xml = strFromU8(sheet);
  if (/<pane\b/i.test(xml)) return original;

  if (/<sheetView\b[^>]*\/>/i.test(xml)) {
    xml = xml.replace(
      /<sheetView\b([^>]*)\/>/i,
      `<sheetView$1>${FROZEN_PANE}</sheetView>`,
    );
  } else if (/<sheetView\b[^>]*>/i.test(xml)) {
    xml = xml.replace(
      /(<sheetView\b[^>]*>)/i,
      `$1${FROZEN_PANE}`,
    );
  } else if (/<sheetViews\b[^>]*\/>/i.test(xml)) {
    xml = xml.replace(
      /<sheetViews\b[^>]*\/>/i,
      `<sheetViews><sheetView workbookViewId="0">${FROZEN_PANE}</sheetView></sheetViews>`,
    );
  } else if (/<worksheet\b[^>]*>/i.test(xml)) {
    xml = xml.replace(
      /(<worksheet\b[^>]*>)/i,
      `$1<sheetViews><sheetView workbookViewId="0">${FROZEN_PANE}</sheetView></sheetViews>`,
    );
  } else {
    return original;
  }

  archive[sheetPath] = strToU8(xml);
  return zipSync(archive, { level: 6 });
}
