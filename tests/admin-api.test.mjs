import assert from "node:assert/strict";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import { handleLocalAdminApi } from "../scripts/local-api.mjs";
import { createLocalConfigStore } from "../scripts/local-store.mjs";

function makeConfig(overrides = {}) {
  return {
    schemaVersion: 1,
    organization: {
      name: "测试单位",
      defaultOwner: "会务组",
      defaultStartTime: "14:00",
      defaultAttendeeEstimate: 20,
      defaultRoomSize: "small",
      defaultPresentationRequired: true,
    },
    meetingRules: {
      parkingVehicleLimit: 4,
      businessMealMin: 300,
      businessMealMax: 400,
      waterServiceIntervalMinutes: 30,
      reminders: {
        missingLocation: true,
        missingOwner: true,
        missingRoster: true,
        overdueTasks: true,
        blockedTasks: true,
      },
    },
    checklistTemplates: [
      {
        id: "meeting-confirm",
        title: "确认会议安排",
        description: "",
        phase: "before",
        group: "会前准备",
        condition: "always",
        dueOffsetDays: -1,
        enabled: true,
      },
    ],
    rosterRules: {
      sortDirection: "asc",
      withinUnitOrder: "source",
      outputFields: [
        { key: "sequence", label: "序号", width: 10, enabled: true },
        { key: "name", label: "姓名", width: 16, enabled: true },
        { key: "unit", label: "单位", width: 32, enabled: true },
        { key: "department", label: "部门", width: 24, enabled: false },
        { key: "title", label: "职务", width: 24, enabled: true },
        { key: "source", label: "来源", width: 24, enabled: false },
      ],
      exportFileNameTemplate: "{会议名称}_参会名单",
      worksheetName: "参会人员名单",
      autoFilter: true,
      freezeHeader: true,
      aliases: [],
      extractionPromptSuffix: "",
    },
    ...overrides,
  };
}

async function withTemporaryStore(run) {
  const directory = await mkdtemp(join(tmpdir(), "meeting-admin-test-"));
  try {
    await run(directory);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
}

async function callApi(store, path, { method = "GET", body, origin } = {}) {
  const headers = {};
  if (body !== undefined) headers["content-type"] = "application/json";
  if (origin) headers.origin = origin;
  const response = await handleLocalAdminApi(
    new Request(`http://127.0.0.1:3000${path}`, {
      method,
      headers,
      body: body === undefined ? undefined : JSON.stringify(body),
    }),
    store,
  );
  return { response, json: await response.json() };
}

test("admin config persists after constructing a fresh store", async () => {
  await withTemporaryStore(async (directory) => {
    const firstStore = createLocalConfigStore({ dataDirectory: directory });
    const empty = await firstStore.getSnapshot();
    assert.equal(empty.revision, 0);
    assert.equal(empty.config, null);

    const saved = await firstStore.save({
      expectedRevision: 0,
      summary: "首次保存",
      config: makeConfig(),
    });
    assert.equal(saved.revision, 1);

    const restartedStore = createLocalConfigStore({ dataDirectory: directory });
    const restarted = await restartedStore.getSnapshot();
    assert.equal(restarted.revision, 1);
    assert.equal(restarted.config.organization.name, "测试单位");
  });
});

test("installer defaults seed six rooms once and preserve edits/deletions on restart", async () => {
  await withTemporaryStore(async (directory) => {
    const defaults = JSON.parse(await readFile(new URL("../dist/default-admin-config.json", import.meta.url), "utf8"));
    const store = createLocalConfigStore({ dataDirectory: directory });
    const initialized = await store.initializeDefaults(defaults);
    assert.equal(initialized.revision, 1);
    assert.equal(initialized.config.meetingRooms.length, 6);
    assert.deepEqual(initialized.config.meetingRooms.map((room) => room.areaSqm), [42.7, 106.2, 12, 17.8, 47.7, 35]);
    assert.deepEqual(initialized.config.meetingRooms.map((room) => room.tableDimensions), ["3.2m × 1.4m", "2m × 6.8m", "1.6m × 0.9m", "1.2m × 2.4m", "4.8m × 1.6m", "1.5m × 4m"]);
    const edited = structuredClone(initialized.config);
    edited.meetingRooms[0].name = "决策室（自定义名称）";
    edited.meetingRooms[0].areaSqm = 43;
    edited.meetingRooms[0].capacity = 12;
    edited.meetingRooms.pop();
    const saved = await store.save({ expectedRevision: 1, summary: "修改并删除内置房间", config: edited });
    const restarted = createLocalConfigStore({ dataDirectory: directory });
    const retained = await restarted.initializeDefaults(defaults);
    assert.equal(retained.revision, saved.revision);
    assert.deepEqual(retained.config, edited);
    assert.deepEqual((await restarted.getExport()).config, edited);
    // An older client omitting the internal marker must not re-enable bootstrap.
    const oldClientConfig = structuredClone(edited);
    delete oldClientConfig.meetingRoomPresetVersion;
    const olderSaved = await restarted.save({ expectedRevision: retained.revision, summary: "旧客户端保存", config: oldClientConfig });
    assert.equal(olderSaved.config.meetingRoomPresetVersion, 1);
    assert.equal((await restarted.initializeDefaults(defaults)).config.meetingRooms.length, 5);
  });
});

test("room table types persist through save and restart while old rooms remain valid", async () => {
  await withTemporaryStore(async (directory) => {
    const defaults = JSON.parse(await readFile(new URL("../dist/default-admin-config.json", import.meta.url), "utf8"));
    const store = createLocalConfigStore({ dataDirectory: directory });
    const initial = await store.initializeDefaults(defaults);
    const config = structuredClone(initial.config);
    config.meetingRooms[0].tableType = "round";
    config.meetingRooms[1].tableType = "rectangular";
    config.meetingRooms[2].tableType = "podium";
    delete config.meetingRooms[3].tableType;
    const saved = await store.save({ expectedRevision: initial.revision, summary: "配置会议桌型", config });
    const restarted = await createLocalConfigStore({ dataDirectory: directory }).initializeDefaults(defaults);
    assert.deepEqual(restarted.config, saved.config);
    assert.equal(restarted.config.meetingRooms[0].tableType, "round");
    const bad = structuredClone(config);
    bad.meetingRooms[0].tableType = "triangle";
    await assert.rejects(store.save({ expectedRevision: saved.revision, summary: "非法桌型", config: bad }), /tableType/);
    assert.equal((await store.getExport()).config.meetingRooms[0].tableType, "round");
  });
});

test("default-room upgrade appends missing rooms without changing existing settings and supports rollback", async () => {
  await withTemporaryStore(async (directory) => {
    const defaults = JSON.parse(await readFile(new URL("../dist/default-admin-config.json", import.meta.url), "utf8"));
    const room = { ...defaults.meetingRooms[0], name: "自定义决策室", capacity: 8, enabled: false };
    const sameNameDifferentId = { ...defaults.meetingRooms[1], id: "room-custom-command", capacity: 30 };
    const original = makeConfig({ meetingRooms: [room, sameNameDifferentId] });
    const store = createLocalConfigStore({ dataDirectory: directory });
    await store.save({ expectedRevision: 0, summary: "原有用户配置", config: original });
    const upgraded = await store.initializeDefaults(defaults);
    assert.equal(upgraded.config.organization.name, "测试单位");
    assert.equal(upgraded.config.meetingRooms.length, 6);
    assert.deepEqual(upgraded.config.meetingRooms[0], room);
    assert.deepEqual(upgraded.config.meetingRooms[1], sameNameDifferentId);
    assert.deepEqual(upgraded.config.rosterRules, original.rosterRules);
    assert.equal(upgraded.history[0].revision, 1);
    const rolledBack = await store.rollback({ expectedRevision: 2, targetRevision: 1 });
    assert.deepEqual(rolledBack.config.meetingRooms, original.meetingRooms);
    assert.equal(rolledBack.config.meetingRoomPresetVersion, 1);
    assert.equal((await store.initializeDefaults(defaults)).revision, rolledBack.revision);
    const bad = { ...rolledBack.config, meetingRooms: [{ ...room, areaSqm: -1 }] };
    await assert.rejects(() => store.save({ expectedRevision: rolledBack.revision, summary: "无效面积", config: bad }), /面积/);
    assert.equal((await store.getSnapshot()).revision, rolledBack.revision);
  });
});

test("meeting rooms publish and reload through the durable config store", async () => {
  await withTemporaryStore(async (directory) => {
    const store = createLocalConfigStore({ dataDirectory: directory });
    const config = makeConfig({
      organization: {
        ...makeConfig().organization,
        defaultMeetingRoomId: "room-main",
      },
      meetingRooms: [
        {
          id: "room-main",
          name: "三楼大会议室",
          location: "三楼东侧",
          capacity: 36,
          roomSize: "large",
          equipment: ["投影仪", "视频会议"],
          requirements: "会前打开中控",
          enabled: true,
        },
      ],
      checklistTemplates: [
        {
          id: "print-nameplates",
          title: "打印桌签",
          description: "",
          phase: "before",
          group: "会前准备",
          condition: "roster",
          dueOffsetDays: -1,
          enabled: true,
        },
      ],
    });

    const saved = await store.save({
      expectedRevision: 0,
      summary: "新增会议室",
      config,
    });
    assert.equal(saved.revision, 1);

    const restarted = await createLocalConfigStore({
      dataDirectory: directory,
    }).getSnapshot();
    assert.equal(restarted.config.meetingRooms[0].name, "三楼大会议室");
    assert.equal(
      restarted.config.organization.defaultMeetingRoomId,
      "room-main",
    );
    assert.equal(
      restarted.config.checklistTemplates[0].condition,
      "roster",
    );
  });
});

test("admin API rejects stale revisions with 409", async () => {
  await withTemporaryStore(async (directory) => {
    const store = createLocalConfigStore({ dataDirectory: directory });
    const first = await callApi(store, "/api/admin/config", {
      method: "PUT",
      origin: "http://127.0.0.1:3000",
      body: {
        expectedRevision: 0,
        summary: "版本一",
        config: makeConfig(),
      },
    });
    assert.equal(first.response.status, 200);

    const stale = await callApi(store, "/api/admin/config", {
      method: "PUT",
      origin: "http://127.0.0.1:3000",
      body: {
        expectedRevision: 0,
        summary: "过期保存",
        config: makeConfig(),
      },
    });
    assert.equal(stale.response.status, 409);
    assert.equal(stale.json.error.code, "REVISION_CONFLICT");
    assert.equal(stale.json.error.details.currentRevision, 1);
  });
});

test("export omits history and secret-shaped properties cannot be stored", async () => {
  await withTemporaryStore(async (directory) => {
    const store = createLocalConfigStore({ dataDirectory: directory });
    await store.save({
      expectedRevision: 0,
      summary: "可导出配置",
      config: makeConfig(),
    });
    await store.save({
      expectedRevision: 1,
      summary: "产生历史",
      config: makeConfig({
        organization: {
          ...makeConfig().organization,
          name: "第二版单位",
        },
      }),
    });

    const exported = await callApi(store, "/api/admin/config/export");
    assert.equal(exported.response.status, 200);
    assert.equal(exported.json.revision, 2);
    assert.equal(Object.hasOwn(exported.json, "history"), false);
    assert.doesNotMatch(JSON.stringify(exported.json), /api[-_]?key/i);

    const secretConfig = makeConfig();
    secretConfig.apiKey = "should-never-be-persisted";
    const rejected = await callApi(store, "/api/admin/config", {
      method: "PUT",
      origin: "http://127.0.0.1:3000",
      body: {
        expectedRevision: 2,
        summary: "不应保存",
        config: secretConfig,
      },
    });
    assert.equal(rejected.response.status, 400);
    const diskText = await readFile(store.mainPath, "utf8");
    assert.doesNotMatch(diskText, /should-never-be-persisted/);
  });
});

test("a corrupt main file falls back to the last atomic backup", async () => {
  await withTemporaryStore(async (directory) => {
    const store = createLocalConfigStore({ dataDirectory: directory });
    await store.save({
      expectedRevision: 0,
      summary: "安全版本",
      config: makeConfig(),
    });
    await store.save({
      expectedRevision: 1,
      summary: "最新版本",
      config: makeConfig({
        organization: {
          ...makeConfig().organization,
          name: "最新但损坏",
        },
      }),
    });
    await writeFile(store.mainPath, "{broken json", "utf8");

    const restartedStore = createLocalConfigStore({ dataDirectory: directory });
    const recovered = await restartedStore.getSnapshot();
    assert.equal(recovered.revision, 1);
    assert.equal(recovered.summary, "安全版本");
    assert.equal(recovered.config.organization.name, "测试单位");
  });
});

test("large valid configs keep saving by trimming old history to the byte limit", async () => {
  await withTemporaryStore(async (directory) => {
    const store = createLocalConfigStore({ dataDirectory: directory });
    const largeTemplates = Array.from({ length: 300 }, (_, index) => ({
      id: `large-task-${index}`,
      title: `大型配置事项 ${index}`,
      description: "会务执行说明".repeat(166).slice(0, 1000),
      phase: "before",
      group: "大型配置",
      condition: "always",
      dueOffsetDays: -1,
      enabled: true,
    }));

    for (let revision = 0; revision < 4; revision += 1) {
      const saved = await store.save({
        expectedRevision: revision,
        summary: `大型配置版本 ${revision + 1}`,
        config: makeConfig({
          checklistTemplates: largeTemplates.map((item) => ({
            ...item,
            title: `${item.title} r${revision + 1}`,
          })),
        }),
      });
      assert.equal(saved.revision, revision + 1);
    }

    const snapshot = await store.getSnapshot();
    assert.equal(snapshot.revision, 4);
    assert.ok(snapshot.history.length < 4);
    const diskBytes = Buffer.byteLength(
      await readFile(store.mainPath, "utf8"),
      "utf8",
    );
    assert.ok(diskBytes <= 2 * 1024 * 1024);
  });
});
