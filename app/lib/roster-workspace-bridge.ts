export const MAX_ROSTER_WORKSPACE_SNAPSHOT_RECORDS = 200;

export type RosterWorkspaceFileValue = {
  name: string;
  size: number;
  lastModified: number;
  kind: "excel" | "word" | "text";
};

export type RosterWorkspaceRecordValue = {
  id: string;
  originalIndex: number;
  name: string;
  unit: string;
  department: string;
  title: string;
  source: string;
  confidence: number;
  issues: string[];
};

export type RosterWorkspaceAliasValue = {
  id: string;
  canonical: string;
  aliases: string[];
  reason: string;
  applied: boolean;
};

export type RosterWorkspaceSnapshot = {
  revision: number;
  pasteText: string;
  files: RosterWorkspaceFileValue[];
  step: 1 | 2 | 3 | 4;
  records: RosterWorkspaceRecordValue[];
  recordTotal: number;
  truncated: boolean;
  aliases: RosterWorkspaceAliasValue[];
  linkedMeeting: {
    id: string;
    title: string;
    updatedAt: string;
  } | null;
  busy: {
    processing: boolean;
    ranking: boolean;
    enrichingRecordId: string | null;
  };
};

export type RosterWorkspaceRecordInput = Pick<
  RosterWorkspaceRecordValue,
  "name" | "unit" | "department" | "title"
>;

export type RosterWorkspaceRecordPatch =
  Partial<RosterWorkspaceRecordInput>;

export type RosterWorkspaceCommand =
  | {
      type: "roster.workspace.set_text";
      expectedRevision: number;
      text: string;
    }
  | {
      type: "roster.workspace.process";
      expectedRevision: number;
    }
  | {
      type: "roster.workspace.record.update";
      expectedRevision: number;
      recordId: string;
      patch: RosterWorkspaceRecordPatch;
    }
  | {
      type: "roster.workspace.record.add";
      expectedRevision: number;
      record: RosterWorkspaceRecordInput;
    }
  | {
      type: "roster.workspace.record.remove";
      expectedRevision: number;
      recordId: string;
    }
  | {
      type: "roster.workspace.alias.apply";
      expectedRevision: number;
      aliasId: string;
    }
  | {
      type: "roster.workspace.confirm";
      expectedRevision: number;
    }
  | {
      type: "roster.workspace.analyze_ranking";
      expectedRevision: number;
    }
  | {
      type: "roster.workspace.enrich_person";
      expectedRevision: number;
      recordId: string;
    }
  | {
      type: "roster.workspace.save_to_meeting";
      expectedRevision: number;
    }
  | {
      type: "roster.workspace.export";
      expectedRevision: number;
    };

export type RosterWorkspaceExecutionResult = {
  revision: number;
  commandTypes: RosterWorkspaceCommand["type"][];
  affectedRecordIds: string[];
  message: string;
  exportedFileName: string | null;
};

export type RosterWorkspaceBridgeHandler = {
  getSnapshot: () =>
    | RosterWorkspaceSnapshot
    | Promise<RosterWorkspaceSnapshot>;
  execute: (
    commands: readonly RosterWorkspaceCommand[],
  ) =>
    | RosterWorkspaceExecutionResult
    | Promise<RosterWorkspaceExecutionResult>;
};

export type RosterWorkspaceBridgeErrorCode =
  | "UNAVAILABLE"
  | "TIMEOUT"
  | "STALE_REVISION"
  | "INVALID_COMMAND"
  | "INVALID_SNAPSHOT"
  | "INVALID_RESULT"
  | "EXECUTION_FAILED";

export class RosterWorkspaceBridgeError extends Error {
  constructor(
    readonly code: RosterWorkspaceBridgeErrorCode,
    message: string,
  ) {
    super(message);
    this.name = "RosterWorkspaceBridgeError";
  }
}

type PlainObject = Record<string, unknown>;

const SNAPSHOT_EVENT = "meeting-assistant:roster-workspace:snapshot";
const SNAPSHOT_REQUEST_EVENT =
  "meeting-assistant:roster-workspace:get-snapshot";
const EXECUTE_REQUEST_EVENT = "meeting-assistant:roster-workspace:execute";
const EDIT_COMMAND_TYPES = new Set<RosterWorkspaceCommand["type"]>([
  "roster.workspace.record.add",
  "roster.workspace.record.update",
  "roster.workspace.record.remove",
]);
const COMMAND_TYPES = new Set<RosterWorkspaceCommand["type"]>([
  "roster.workspace.set_text",
  "roster.workspace.process",
  "roster.workspace.record.update",
  "roster.workspace.record.add",
  "roster.workspace.record.remove",
  "roster.workspace.alias.apply",
  "roster.workspace.confirm",
  "roster.workspace.analyze_ranking",
  "roster.workspace.enrich_person",
  "roster.workspace.save_to_meeting",
  "roster.workspace.export",
]);

function bridgeError(
  code: RosterWorkspaceBridgeErrorCode,
  message: string,
): never {
  throw new RosterWorkspaceBridgeError(code, message);
}

function plainObject(
  value: unknown,
  path: string,
  code: RosterWorkspaceBridgeErrorCode,
): PlainObject {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    bridgeError(code, `${path} 必须是对象`);
  }
  return value as PlainObject;
}

function exactKeys(
  value: PlainObject,
  keys: readonly string[],
  path: string,
  code: RosterWorkspaceBridgeErrorCode,
  optional: readonly string[] = [],
) {
  const allowed = new Set([...keys, ...optional]);
  for (const key of Object.keys(value)) {
    if (!allowed.has(key)) bridgeError(code, `${path}.${key} 是未知字段`);
  }
  for (const key of keys) {
    if (!Object.hasOwn(value, key)) {
      bridgeError(code, `${path}.${key} 是必填字段`);
    }
  }
}

function stringValue(
  value: unknown,
  path: string,
  code: RosterWorkspaceBridgeErrorCode,
  options: { minimum?: number; maximum: number },
) {
  if (typeof value !== "string" || value.includes("\u0000")) {
    bridgeError(code, `${path} 必须是有效字符串`);
  }
  const trimmed = value.trim();
  if (trimmed.length < (options.minimum ?? 0)) {
    bridgeError(code, `${path} 不能为空`);
  }
  if (value.length > options.maximum) {
    bridgeError(code, `${path} 超过 ${options.maximum} 字符上限`);
  }
  return value;
}

function integerValue(
  value: unknown,
  path: string,
  code: RosterWorkspaceBridgeErrorCode,
  maximum = 2_147_483_647,
) {
  if (
    typeof value !== "number" ||
    !Number.isInteger(value) ||
    value < 0 ||
    value > maximum
  ) {
    bridgeError(code, `${path} 必须是有效非负整数`);
  }
  return value;
}

function finiteNumber(
  value: unknown,
  path: string,
  code: RosterWorkspaceBridgeErrorCode,
) {
  if (typeof value !== "number" || !Number.isFinite(value)) {
    bridgeError(code, `${path} 必须是有限数字`);
  }
  return value;
}

function parseRecordInput(
  value: unknown,
  path: string,
  code: RosterWorkspaceBridgeErrorCode,
): RosterWorkspaceRecordInput {
  const object = plainObject(value, path, code);
  exactKeys(object, ["name", "unit", "department", "title"], path, code);
  return {
    name: stringValue(object.name, `${path}.name`, code, { maximum: 200 }),
    unit: stringValue(object.unit, `${path}.unit`, code, { maximum: 500 }),
    department: stringValue(object.department, `${path}.department`, code, {
      maximum: 500,
    }),
    title: stringValue(object.title, `${path}.title`, code, { maximum: 500 }),
  };
}

function parseRecordPatch(
  value: unknown,
  path: string,
  code: RosterWorkspaceBridgeErrorCode,
): RosterWorkspaceRecordPatch {
  const object = plainObject(value, path, code);
  const keys = ["name", "unit", "department", "title"] as const;
  if (!Object.keys(object).length) bridgeError(code, `${path} 不能为空`);
  for (const key of Object.keys(object)) {
    if (!keys.includes(key as (typeof keys)[number])) {
      bridgeError(code, `${path}.${key} 是未知字段`);
    }
  }
  const patch: RosterWorkspaceRecordPatch = {};
  for (const key of keys) {
    if (Object.hasOwn(object, key)) {
      patch[key] = stringValue(object[key], `${path}.${key}`, code, {
        maximum: key === "name" ? 200 : 500,
      });
    }
  }
  return patch;
}

function parseCommand(
  value: unknown,
  path: string,
): RosterWorkspaceCommand {
  const code = "INVALID_COMMAND" as const;
  const object = plainObject(value, path, code);
  const type = stringValue(object.type, `${path}.type`, code, {
    minimum: 1,
    maximum: 80,
  }) as RosterWorkspaceCommand["type"];
  if (!COMMAND_TYPES.has(type)) bridgeError(code, `${path}.type 不受支持`);
  const expectedRevision = integerValue(
    object.expectedRevision,
    `${path}.expectedRevision`,
    code,
  );

  switch (type) {
    case "roster.workspace.set_text":
      exactKeys(object, ["type", "expectedRevision", "text"], path, code);
      return {
        type,
        expectedRevision,
        text: stringValue(object.text, `${path}.text`, code, {
          maximum: 100_000,
        }),
      };
    case "roster.workspace.record.update":
      exactKeys(
        object,
        ["type", "expectedRevision", "recordId", "patch"],
        path,
        code,
      );
      return {
        type,
        expectedRevision,
        recordId: stringValue(object.recordId, `${path}.recordId`, code, {
          minimum: 1,
          maximum: 200,
        }).trim(),
        patch: parseRecordPatch(object.patch, `${path}.patch`, code),
      };
    case "roster.workspace.record.add":
      exactKeys(
        object,
        ["type", "expectedRevision", "record"],
        path,
        code,
      );
      return {
        type,
        expectedRevision,
        record: parseRecordInput(object.record, `${path}.record`, code),
      };
    case "roster.workspace.record.remove":
    case "roster.workspace.enrich_person":
      exactKeys(
        object,
        ["type", "expectedRevision", "recordId"],
        path,
        code,
      );
      return {
        type,
        expectedRevision,
        recordId: stringValue(object.recordId, `${path}.recordId`, code, {
          minimum: 1,
          maximum: 200,
        }).trim(),
      };
    case "roster.workspace.alias.apply":
      exactKeys(
        object,
        ["type", "expectedRevision", "aliasId"],
        path,
        code,
      );
      return {
        type,
        expectedRevision,
        aliasId: stringValue(object.aliasId, `${path}.aliasId`, code, {
          minimum: 1,
          maximum: 200,
        }).trim(),
      };
    case "roster.workspace.process":
    case "roster.workspace.confirm":
    case "roster.workspace.analyze_ranking":
    case "roster.workspace.save_to_meeting":
    case "roster.workspace.export":
      exactKeys(object, ["type", "expectedRevision"], path, code);
      return { type, expectedRevision };
  }
}

function parseCommands(
  value: unknown,
): RosterWorkspaceCommand[] {
  if (!Array.isArray(value) || !value.length || value.length > 100) {
    bridgeError(
      "INVALID_COMMAND",
      "名单工作区命令必须是包含 1 至 100 项的数组",
    );
  }
  const commands = value.map((command, index) =>
    parseCommand(command, `commands[${index}]`),
  );
  const revisions = new Set(
    commands.map((command) => command.expectedRevision),
  );
  if (revisions.size !== 1) {
    bridgeError("INVALID_COMMAND", "批量命令必须使用相同的工作区版本");
  }
  if (
    commands.length > 1 &&
    commands.some((command) => !EDIT_COMMAND_TYPES.has(command.type))
  ) {
    bridgeError(
      "INVALID_COMMAND",
      "仅名单记录新增、修改和删除可以批量执行",
    );
  }
  const recordIds = commands.flatMap((command) =>
    command.type === "roster.workspace.record.update" ||
    command.type === "roster.workspace.record.remove"
      ? [command.recordId]
      : [],
  );
  if (new Set(recordIds).size !== recordIds.length) {
    bridgeError("INVALID_COMMAND", "同一批命令不能重复修改或删除同一条记录");
  }
  return commands;
}

export function validateRosterWorkspaceCommands(
  value: unknown,
): RosterWorkspaceCommand[] {
  return parseCommands(value);
}

function parseSnapshot(value: unknown): RosterWorkspaceSnapshot {
  const code = "INVALID_SNAPSHOT" as const;
  const object = plainObject(value, "snapshot", code);
  exactKeys(
    object,
    [
      "revision",
      "pasteText",
      "files",
      "step",
      "records",
      "recordTotal",
      "truncated",
      "aliases",
      "linkedMeeting",
      "busy",
    ],
    "snapshot",
    code,
  );
  const revision = integerValue(object.revision, "snapshot.revision", code);
  const pasteText = stringValue(object.pasteText, "snapshot.pasteText", code, {
    maximum: 100_000,
  });
  if (!Array.isArray(object.files) || object.files.length > 100) {
    bridgeError(code, "snapshot.files 必须是最多 100 项的数组");
  }
  const files = object.files.map((file, index) => {
    const path = `snapshot.files[${index}]`;
    const item = plainObject(file, path, code);
    exactKeys(item, ["name", "size", "lastModified", "kind"], path, code);
    const kind = stringValue(item.kind, `${path}.kind`, code, {
      minimum: 1,
      maximum: 20,
    });
    if (kind !== "excel" && kind !== "word" && kind !== "text") {
      bridgeError(code, `${path}.kind 不受支持`);
    }
    return {
      name: stringValue(item.name, `${path}.name`, code, {
        minimum: 1,
        maximum: 240,
      }),
      size: integerValue(item.size, `${path}.size`, code, Number.MAX_SAFE_INTEGER),
      lastModified: integerValue(
        item.lastModified,
        `${path}.lastModified`,
        code,
        Number.MAX_SAFE_INTEGER,
      ),
      kind,
    };
  });
  if (
    object.step !== 1 &&
    object.step !== 2 &&
    object.step !== 3 &&
    object.step !== 4
  ) {
    bridgeError(code, "snapshot.step 必须是 1、2、3 或 4");
  }
  if (
    !Array.isArray(object.records) ||
    object.records.length > MAX_ROSTER_WORKSPACE_SNAPSHOT_RECORDS
  ) {
    bridgeError(
      code,
      `snapshot.records 最多允许 ${MAX_ROSTER_WORKSPACE_SNAPSHOT_RECORDS} 项`,
    );
  }
  const records = object.records.map((record, index) => {
    const path = `snapshot.records[${index}]`;
    const item = plainObject(record, path, code);
    exactKeys(
      item,
      [
        "id",
        "originalIndex",
        "name",
        "unit",
        "department",
        "title",
        "source",
        "confidence",
        "issues",
      ],
      path,
      code,
    );
    if (!Array.isArray(item.issues) || item.issues.length > 100) {
      bridgeError(code, `${path}.issues 必须是最多 100 项的数组`);
    }
    return {
      id: stringValue(item.id, `${path}.id`, code, {
        minimum: 1,
        maximum: 200,
      }).trim(),
      originalIndex: integerValue(
        item.originalIndex,
        `${path}.originalIndex`,
        code,
      ),
      name: stringValue(item.name, `${path}.name`, code, { maximum: 200 }),
      unit: stringValue(item.unit, `${path}.unit`, code, { maximum: 500 }),
      department: stringValue(item.department, `${path}.department`, code, {
        maximum: 500,
      }),
      title: stringValue(item.title, `${path}.title`, code, { maximum: 500 }),
      source: stringValue(item.source, `${path}.source`, code, { maximum: 500 }),
      confidence: finiteNumber(item.confidence, `${path}.confidence`, code),
      issues: item.issues.map((issue, issueIndex) =>
        stringValue(issue, `${path}.issues[${issueIndex}]`, code, {
          minimum: 1,
          maximum: 500,
        }),
      ),
    };
  });
  const recordTotal = integerValue(
    object.recordTotal,
    "snapshot.recordTotal",
    code,
  );
  if (records.length !== Math.min(recordTotal, MAX_ROSTER_WORKSPACE_SNAPSHOT_RECORDS)) {
    bridgeError(code, "snapshot.records 数量与 recordTotal 不一致");
  }
  const expectedTruncated = recordTotal > records.length;
  if (object.truncated !== expectedTruncated) {
    bridgeError(code, "snapshot.truncated 与记录数量不一致");
  }
  if (!Array.isArray(object.aliases) || object.aliases.length > 2_000) {
    bridgeError(code, "snapshot.aliases 必须是最多 2000 项的数组");
  }
  const aliases = object.aliases.map((alias, index) => {
    const path = `snapshot.aliases[${index}]`;
    const item = plainObject(alias, path, code);
    exactKeys(
      item,
      ["id", "canonical", "aliases", "reason", "applied"],
      path,
      code,
    );
    if (!Array.isArray(item.aliases) || item.aliases.length > 100) {
      bridgeError(code, `${path}.aliases 必须是最多 100 项的数组`);
    }
    if (typeof item.applied !== "boolean") {
      bridgeError(code, `${path}.applied 必须是布尔值`);
    }
    return {
      id: stringValue(item.id, `${path}.id`, code, {
        minimum: 1,
        maximum: 200,
      }).trim(),
      canonical: stringValue(item.canonical, `${path}.canonical`, code, {
        maximum: 500,
      }),
      aliases: item.aliases.map((name, aliasIndex) =>
        stringValue(name, `${path}.aliases[${aliasIndex}]`, code, {
          maximum: 500,
        }),
      ),
      reason: stringValue(item.reason, `${path}.reason`, code, {
        maximum: 1_000,
      }),
      applied: item.applied,
    };
  });
  let linkedMeeting: RosterWorkspaceSnapshot["linkedMeeting"] = null;
  if (object.linkedMeeting !== null) {
    const linked = plainObject(object.linkedMeeting, "snapshot.linkedMeeting", code);
    exactKeys(linked, ["id", "title", "updatedAt"], "snapshot.linkedMeeting", code);
    linkedMeeting = {
      id: stringValue(linked.id, "snapshot.linkedMeeting.id", code, {
        minimum: 1,
        maximum: 200,
      }).trim(),
      title: stringValue(linked.title, "snapshot.linkedMeeting.title", code, {
        minimum: 1,
        maximum: 500,
      }),
      updatedAt: stringValue(
        linked.updatedAt,
        "snapshot.linkedMeeting.updatedAt",
        code,
        { minimum: 1, maximum: 100 },
      ),
    };
  }
  const busyValue = plainObject(object.busy, "snapshot.busy", code);
  exactKeys(
    busyValue,
    ["processing", "ranking", "enrichingRecordId"],
    "snapshot.busy",
    code,
  );
  if (typeof busyValue.processing !== "boolean" || typeof busyValue.ranking !== "boolean") {
    bridgeError(code, "snapshot.busy 状态无效");
  }
  const enrichingRecordId =
    busyValue.enrichingRecordId === null
      ? null
      : stringValue(
          busyValue.enrichingRecordId,
          "snapshot.busy.enrichingRecordId",
          code,
          { minimum: 1, maximum: 200 },
        ).trim();

  return {
    revision,
    pasteText,
    files,
    step: object.step,
    records,
    recordTotal,
    truncated: expectedTruncated,
    aliases,
    linkedMeeting,
    busy: {
      processing: busyValue.processing,
      ranking: busyValue.ranking,
      enrichingRecordId,
    },
  };
}

export function validateRosterWorkspaceSnapshot(
  value: unknown,
): RosterWorkspaceSnapshot {
  return parseSnapshot(value);
}

function parseExecutionResult(
  value: unknown,
  commands: readonly RosterWorkspaceCommand[],
): RosterWorkspaceExecutionResult {
  const code = "INVALID_RESULT" as const;
  const object = plainObject(value, "result", code);
  exactKeys(
    object,
    [
      "revision",
      "commandTypes",
      "affectedRecordIds",
      "message",
      "exportedFileName",
    ],
    "result",
    code,
  );
  const revision = integerValue(object.revision, "result.revision", code);
  const expectedRevision = commands[0].expectedRevision;
  if (revision < expectedRevision) {
    bridgeError(code, "result.revision 不能早于命令版本");
  }
  if (!Array.isArray(object.commandTypes)) {
    bridgeError(code, "result.commandTypes 必须是数组");
  }
  const commandTypes = object.commandTypes.map((type, index) => {
    const parsed = stringValue(type, `result.commandTypes[${index}]`, code, {
      minimum: 1,
      maximum: 80,
    }) as RosterWorkspaceCommand["type"];
    if (!COMMAND_TYPES.has(parsed)) {
      bridgeError(code, `result.commandTypes[${index}] 不受支持`);
    }
    return parsed;
  });
  const expectedTypes = commands.map((command) => command.type);
  if (JSON.stringify(commandTypes) !== JSON.stringify(expectedTypes)) {
    bridgeError(code, "result.commandTypes 与执行命令不一致");
  }
  if (!Array.isArray(object.affectedRecordIds) || object.affectedRecordIds.length > 100) {
    bridgeError(code, "result.affectedRecordIds 必须是最多 100 项的数组");
  }
  const affectedRecordIds = object.affectedRecordIds.map((id, index) =>
    stringValue(id, `result.affectedRecordIds[${index}]`, code, {
      minimum: 1,
      maximum: 200,
    }).trim(),
  );
  const message = stringValue(object.message, "result.message", code, {
    minimum: 1,
    maximum: 1_000,
  });
  const includesExport = commandTypes.includes("roster.workspace.export");
  const exportedFileName =
    object.exportedFileName === null
      ? null
      : stringValue(
          object.exportedFileName,
          "result.exportedFileName",
          code,
          { minimum: 1, maximum: 240 },
        );
  if (includesExport !== Boolean(exportedFileName)) {
    bridgeError(code, "仅导出命令可以返回 exportedFileName");
  }
  return {
    revision,
    commandTypes,
    affectedRecordIds,
    message,
    exportedFileName,
  };
}

export function validateRosterWorkspaceExecutionResult(
  value: unknown,
  commands: readonly RosterWorkspaceCommand[],
): RosterWorkspaceExecutionResult {
  return parseExecutionResult(value, parseCommands(commands));
}

type SnapshotRequestDetail = {
  handled: boolean;
  resolve: (value: RosterWorkspaceSnapshot) => void;
  reject: (error: unknown) => void;
};

type ExecuteRequestDetail = {
  handled: boolean;
  commands: RosterWorkspaceCommand[];
  resolve: (value: RosterWorkspaceExecutionResult) => void;
  reject: (error: unknown) => void;
};

function requireBrowserWindow() {
  if (typeof window === "undefined") {
    bridgeError("UNAVAILABLE", "名单治理工作区仅能在浏览器中使用");
  }
  return window;
}

export function publishRosterWorkspaceSnapshot(
  snapshot: RosterWorkspaceSnapshot,
) {
  const target = requireBrowserWindow();
  target.dispatchEvent(
    new CustomEvent(SNAPSHOT_EVENT, { detail: parseSnapshot(snapshot) }),
  );
}

export function subscribeRosterWorkspaceSnapshot(
  listener: (snapshot: RosterWorkspaceSnapshot) => void,
) {
  const target = requireBrowserWindow();
  const handle = (event: Event) => {
    try {
      listener(parseSnapshot((event as CustomEvent<unknown>).detail));
    } catch {
      // Ignore malformed events dispatched by unrelated page scripts.
    }
  };
  target.addEventListener(SNAPSHOT_EVENT, handle);
  return () => target.removeEventListener(SNAPSHOT_EVENT, handle);
}

export function registerRosterWorkspaceBridge(
  handler: RosterWorkspaceBridgeHandler,
) {
  const target = requireBrowserWindow();
  const handleSnapshotRequest = (event: Event) => {
    const detail = (event as CustomEvent<SnapshotRequestDetail>).detail;
    if (!detail || detail.handled) return;
    detail.handled = true;
    Promise.resolve()
      .then(() => handler.getSnapshot())
      .then(parseSnapshot)
      .then(detail.resolve)
      .catch(detail.reject);
  };
  const handleExecuteRequest = (event: Event) => {
    const detail = (event as CustomEvent<ExecuteRequestDetail>).detail;
    if (!detail || detail.handled) return;
    detail.handled = true;
    Promise.resolve()
      .then(() => parseCommands(detail.commands))
      .then(async (commands) => {
        const snapshot = parseSnapshot(await handler.getSnapshot());
        const expectedRevision = commands[0].expectedRevision;
        if (snapshot.revision !== expectedRevision) {
          bridgeError(
            "STALE_REVISION",
            "名单治理工作区已发生变化，请重新预览后再执行",
          );
        }
        const result = await handler.execute(commands);
        return parseExecutionResult(result, commands);
      })
      .then(detail.resolve)
      .catch((error) => {
        detail.reject(
          error instanceof RosterWorkspaceBridgeError
            ? error
            : new RosterWorkspaceBridgeError(
                "EXECUTION_FAILED",
                error instanceof Error ? error.message : "名单工作区执行失败",
              ),
        );
      });
  };
  target.addEventListener(SNAPSHOT_REQUEST_EVENT, handleSnapshotRequest);
  target.addEventListener(EXECUTE_REQUEST_EVENT, handleExecuteRequest);
  return () => {
    target.removeEventListener(SNAPSHOT_REQUEST_EVENT, handleSnapshotRequest);
    target.removeEventListener(EXECUTE_REQUEST_EVENT, handleExecuteRequest);
  };
}

export function getRosterWorkspaceSnapshot(
  options: { timeoutMs?: number } = {},
): Promise<RosterWorkspaceSnapshot> {
  const target = requireBrowserWindow();
  const timeoutMs = options.timeoutMs ?? 2_000;
  return new Promise((resolve, reject) => {
    let settled = false;
    const finish = (
      callback: (value: never) => void,
      value: unknown,
    ) => {
      if (settled) return;
      settled = true;
      window.clearTimeout(timeoutId);
      callback(value as never);
    };
    const timeoutId = window.setTimeout(
      () =>
        finish(
          reject,
          new RosterWorkspaceBridgeError(
            "TIMEOUT",
            "读取名单治理工作区超时",
          ),
        ),
      timeoutMs,
    );
    const detail: SnapshotRequestDetail = {
      handled: false,
      resolve: (snapshot) => {
        try {
          finish(resolve, parseSnapshot(snapshot));
        } catch (error) {
          finish(reject, error);
        }
      },
      reject: (error) => finish(reject, error),
    };
    target.dispatchEvent(new CustomEvent(SNAPSHOT_REQUEST_EVENT, { detail }));
    if (!detail.handled) {
      finish(
        reject,
        new RosterWorkspaceBridgeError(
          "UNAVAILABLE",
          "名单治理页面尚未打开或工作区桥未就绪",
        ),
      );
    }
  });
}

export function executeRosterWorkspaceCommands(
  commands: readonly RosterWorkspaceCommand[],
  options: { timeoutMs?: number } = {},
): Promise<RosterWorkspaceExecutionResult> {
  const target = requireBrowserWindow();
  const parsedCommands = parseCommands(commands);
  const timeoutMs = options.timeoutMs ?? 120_000;
  return new Promise((resolve, reject) => {
    let settled = false;
    const finish = (
      callback: (value: never) => void,
      value: unknown,
    ) => {
      if (settled) return;
      settled = true;
      window.clearTimeout(timeoutId);
      callback(value as never);
    };
    const timeoutId = window.setTimeout(
      () =>
        finish(
          reject,
          new RosterWorkspaceBridgeError(
            "TIMEOUT",
            "名单治理工作区执行超时，状态可能仍在处理中",
          ),
        ),
      timeoutMs,
    );
    const detail: ExecuteRequestDetail = {
      handled: false,
      commands: parsedCommands,
      resolve: (result) => {
        try {
          finish(resolve, parseExecutionResult(result, parsedCommands));
        } catch (error) {
          finish(reject, error);
        }
      },
      reject: (error) => finish(reject, error),
    };
    target.dispatchEvent(new CustomEvent(EXECUTE_REQUEST_EVENT, { detail }));
    if (!detail.handled) {
      finish(
        reject,
        new RosterWorkspaceBridgeError(
          "UNAVAILABLE",
          "名单治理页面尚未打开或工作区桥未就绪",
        ),
      );
    }
  });
}
