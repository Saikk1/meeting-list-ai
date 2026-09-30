import assert from "node:assert/strict";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { handleLocalContactsApi } from "../scripts/local-api.mjs";
import { createLocalConfigStore, createLocalContactStore } from "../scripts/local-store.mjs";

async function callApi(store, path, init = {}) {
  const response = await handleLocalContactsApi(
    new Request(`http://127.0.0.1:3000${path}`, {
      ...init,
      headers: {
        ...(init.body ? { "Content-Type": "application/json" } : {}),
        ...init.headers,
      },
    }),
    store,
  );
  assert.ok(response, `Expected contacts API to handle ${path}`);
  return response;
}

function body(value) {
  return JSON.stringify(value);
}

const unitRules = [{ enabled: true, canonical: "中国汽车技术研究中心有限公司", aliases: ["中汽研"], mode: "confirm" }];
const person = { name: "王镇宗", unit: "中汽研", department: "", title: "技术负责人" };

test("production contact store reads published unit aliases and follows later dictionary changes", async () => {
  const directory = await mkdtemp(join(tmpdir(), "meeting-contact-admin-rules-"));
  try {
    const config = JSON.parse(await readFile(new URL('../dist/default-admin-config.json', import.meta.url), 'utf8'));
    config.rosterRules.aliases = [{ ...unitRules[0], id: 'test-unit-alias', notes: '' }];
    const admin = createLocalConfigStore({ dataDirectory: directory });
    await admin.save({ expectedRevision: 0, summary: 'test', config });
    const store = createLocalContactStore({ dataDirectory: directory });
    assert.equal((await store.create(person)).unit, unitRules[0].canonical);
    config.rosterRules.aliases[0].aliases.push('中汽中心');
    await admin.save({ expectedRevision: 1, summary: 'test dictionary update', config });
    await store.upsertMeeting({ meeting: { id: 'meeting-test', title: '测试会议' }, contacts: [{ ...person, unit: '中汽中心' }] });
    assert.equal((await store.list()).total, 1);
    assert.equal((await store.list({ query: '中汽中心' })).total, 1);
  } finally { await rm(directory, { recursive: true, force: true }); }
});

test("create and update enforce canonical unit identity, while other units remain distinct", async () => {
  const directory = await mkdtemp(join(tmpdir(), "meeting-contact-canonical-"));
  try {
    const store = createLocalContactStore({ dataDirectory: directory, getUnitAliases: async () => unitRules });
    const first = await store.create(person);
    assert.equal(first.unit, unitRules[0].canonical);
    assert.equal((await callApi(store, "/api/contacts", { method: "POST", body: body({ contact: { ...person, unit: unitRules[0].canonical } }) })).status, 409);
    const other = await store.create({ ...person, unit: "另一家公司" });
    assert.equal((await callApi(store, `/api/contacts/${other.id}`, { method: "PUT", body: body({ contact: person }) })).status, 409);
    assert.equal((await store.list()).total, 2);
    assert.equal((await store.list({ query: "中汽" })).contacts[0].id, first.id);
  } finally { await rm(directory, { recursive: true, force: true }); }
});

test("legacy unit duplicates merge durably, preserve manual fields and unique meeting history", async () => {
  const directory = await mkdtemp(join(tmpdir(), "meeting-contact-merge-"));
  try {
    const legacy = createLocalContactStore({ dataDirectory: directory, getUnitAliases: async () => [] });
    const manual = await legacy.create(person);
    await legacy.upsertMeeting({ meeting: { id: "meeting-old", title: "旧会议", date: "2026-08-01" }, contacts: [person] });
    await legacy.upsertMeeting({ meeting: { id: "meeting-old", title: "旧会议", date: "2026-08-01" }, contacts: [{ ...person, unit: unitRules[0].canonical }] });
    await legacy.upsertMeeting({ meeting: { id: "meeting-new", title: "新会议", date: "2026-09-01" }, contacts: [{ ...person, unit: unitRules[0].canonical, department: "不能覆盖人工留空", title: "旧职务" }] });
    assert.equal((await legacy.list()).total, 2);
    const before = await readFile(legacy.mainPath, "utf8");
    const repaired = createLocalContactStore({ dataDirectory: directory, getUnitAliases: async () => unitRules });
    const snapshot = await repaired.list();
    assert.equal(snapshot.total, 1);
    const merged = snapshot.contacts[0];
    assert.equal(merged.id, manual.id);
    assert.equal(merged.unit, unitRules[0].canonical);
    assert.equal(merged.title, person.title);
    assert.equal(merged.department, "");
    assert.equal(merged.meetingCount, 2);
    assert.deepEqual(merged.meetingIds, ["meeting-old", "meeting-new"]);
    assert.equal(merged.lastMeetingTitle, "新会议");
    assert.equal(await readFile(repaired.backupPath, "utf8"), before);
    const persisted = await readFile(repaired.mainPath, "utf8");
    await repaired.list();
    assert.equal(await readFile(repaired.mainPath, "utf8"), persisted);
    const restarted = createLocalContactStore({ dataDirectory: directory, getUnitAliases: async () => unitRules });
    await restarted.upsertMeeting({ meeting: { id: "meeting-old", title: "旧会议", date: "2026-08-01" }, contacts: [person, { ...person, unit: unitRules[0].canonical }] });
    assert.equal((await restarted.list()).total, 1);
    assert.equal((await restarted.list()).contacts[0].meetingCount, 2);
    assert.equal((await restarted.list()).contacts[0].title, person.title);
    assert.equal((await restarted.list()).contacts[0].lastMeetingTitle, "新会议");
  } finally { await rm(directory, { recursive: true, force: true }); }
});

test("changed and disabled dictionaries are respected without guessing unit relationships", async () => {
  const directory = await mkdtemp(join(tmpdir(), "meeting-contact-dictionary-"));
  try {
    let rules = [{ ...unitRules[0], enabled: false }];
    const store = createLocalContactStore({ dataDirectory: directory, getUnitAliases: async () => rules });
    await store.create(person);
    await store.create({ ...person, unit: unitRules[0].canonical });
    await store.create({ ...person, unit: "中汽研另一家分公司" });
    assert.equal((await store.list()).total, 3);
    rules = unitRules;
    assert.equal((await store.list()).total, 2);
    assert.equal((await store.list({ query: "分公司" })).total, 1);
  } finally { await rm(directory, { recursive: true, force: true }); }
});

test("renamed historical identities also resolve unit aliases without recreating old contacts", async () => {
  const directory = await mkdtemp(join(tmpdir(), "meeting-contact-renamed-alias-"));
  try {
    const store = createLocalContactStore({ dataDirectory: directory, getUnitAliases: async () => unitRules });
    const original = await store.create(person);
    await store.update(original.id, { ...person, name: "人工修正姓名", unit: "新单位" });
    await store.upsertMeeting({ meeting: { id: "meeting-old", title: "历史会议" }, contacts: [person] });
    assert.equal((await store.list()).total, 1);
    assert.equal((await store.list()).contacts[0].name, "人工修正姓名");
  } finally { await rm(directory, { recursive: true, force: true }); }
});

test("restoring old snapshots cannot reintroduce unit duplicates", async () => {
  const directory = await mkdtemp(join(tmpdir(), "meeting-contact-restore-alias-"));
  try {
    const legacy = createLocalContactStore({ dataDirectory: directory, getUnitAliases: async () => [] });
    await legacy.create(person);
    await legacy.create({ ...person, unit: unitRules[0].canonical });
    const snapshot = await legacy.list();
    const store = createLocalContactStore({ dataDirectory: directory, getUnitAliases: async () => unitRules });
    await store.replaceAll({ contacts: snapshot.contacts });
    assert.equal((await store.list()).total, 1);
  } finally { await rm(directory, { recursive: true, force: true }); }
});

test("concurrent reads and historical sync serialize migration without losing new history", async () => {
  const directory = await mkdtemp(join(tmpdir(), "meeting-contact-migration-queue-"));
  try {
    const legacy = createLocalContactStore({ dataDirectory: directory, getUnitAliases: async () => [] });
    await legacy.create(person);
    await legacy.create({ ...person, unit: unitRules[0].canonical });
    const store = createLocalContactStore({ dataDirectory: directory, getUnitAliases: async () => unitRules });
    await Promise.all([store.list(), store.upsertMeeting({ meeting: { id: "meeting-queued", title: "新增会议" }, contacts: [person] }), store.list()]);
    assert.equal((await store.list()).total, 1);
    assert.deepEqual((await store.list()).contacts[0].meetingIds, ["meeting-queued"]);
  } finally { await rm(directory, { recursive: true, force: true }); }
});

test("license plates persist, remain searchable and survive empty historical syncs", async () => {
  const directory = await mkdtemp(join(tmpdir(), "meeting-contact-plate-"));
  try {
    const store = createLocalContactStore({ dataDirectory: directory });
    const contact = { name: "测试人员", unit: "测试单位", department: "", title: "", licensePlate: " 浙b01234 " };
    const created = await callApi(store, "/api/contacts", { method: "POST", body: body({ contact }) });
    assert.equal(created.status, 201);
    const { contact: saved } = await created.json();
    assert.equal(saved.licensePlate, "浙B01234");
    const restored = createLocalContactStore({ dataDirectory: directory });
    const matches = await callApi(restored, "/api/contacts?q=01234");
    assert.equal((await matches.json()).contacts[0].id, saved.id);
    const sync = await callApi(restored, "/api/contacts/upsert", {
      method: "POST",
      body: body({ meeting: { id: "plate-meeting", title: "测试会议" }, contacts: [{ ...contact, licensePlate: "" }] }),
    });
    assert.equal(sync.status, 200);
    const retained = await callApi(restored, "/api/contacts?q=01234");
    assert.equal((await retained.json()).contacts[0].licensePlate, "浙B01234");
    const updated = await callApi(restored, `/api/contacts/${saved.id}`, {
      method: "PUT", body: body({ contact: { ...contact, licensePlate: "浙B54321" } }),
    });
    assert.equal((await updated.json()).contact.licensePlate, "浙B54321");
    const cleared = await callApi(restored, `/api/contacts/${saved.id}`, {
      method: "PUT", body: body({ contact: { ...contact, licensePlate: "" } }),
    });
    assert.equal((await cleared.json()).contact.licensePlate, "");
    const invalid = await callApi(restored, `/api/contacts/${saved.id}`, {
      method: "PUT", body: body({ contact: { ...contact, licensePlate: "A".repeat(41) } }),
    });
    assert.equal(invalid.status, 400);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

test("meeting attendees are durably upserted without double counting", async () => {
  const directory = await mkdtemp(join(tmpdir(), "meeting-contacts-"));
  try {
    const store = createLocalContactStore({ dataDirectory: directory });
    const first = await callApi(store, "/api/contacts/upsert", {
      method: "POST",
      body: body({
        meeting: {
          id: "meeting-1",
          title: "第一次会议",
          date: "2026-08-01",
        },
        contacts: [
          {
            name: "马 晓 勇",
            unit: "宁波轿辰",
            department: "经营管理部",
            title: "执行总裁",
          },
          {
            name: "黄乾炜",
            unit: "上海九誓",
            department: "",
            title: "",
          },
        ],
      }),
    });
    assert.equal(first.status, 200);
    assert.deepEqual(await first.json(), { upserted: 2, total: 2 });

    const repeated = await callApi(store, "/api/contacts/upsert", {
      method: "POST",
      body: body({
        meeting: { id: "meeting-1", title: "第一次会议" },
        contacts: [
          {
            name: "马晓勇",
            unit: "宁波轿辰",
            department: "",
            title: "",
          },
        ],
      }),
    });
    assert.equal(repeated.status, 200);

    const secondMeeting = await callApi(store, "/api/contacts/upsert", {
      method: "POST",
      body: body({
        meeting: {
          id: "meeting-2",
          title: "第二次会议",
          date: "2026-09-01",
        },
        contacts: [
          {
            name: "马晓勇",
            unit: "宁波轿辰",
            department: "",
            title: "董事长",
          },
        ],
      }),
    });
    assert.equal(secondMeeting.status, 200);

    const restartedStore = createLocalContactStore({
      dataDirectory: directory,
    });
    const search = await callApi(
      restartedStore,
      "/api/contacts?q=%E9%A9%AC%E5%AE%81%E6%B3%A2&limit=10",
    );
    assert.equal(search.status, 200);
    const payload = await search.json();
    assert.equal(payload.total, 1);
    assert.equal(payload.contacts[0].name, "马晓勇");
    assert.equal(payload.contacts[0].department, "经营管理部");
    assert.equal(payload.contacts[0].title, "董事长");
    assert.equal(payload.contacts[0].meetingCount, 2);
    assert.deepEqual(payload.contacts[0].meetingIds, [
      "meeting-1",
      "meeting-2",
    ]);
    assert.equal(payload.contacts[0].lastMeetingTitle, "第二次会议");
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

test("contacts API supports manual create, update, search and delete", async () => {
  const directory = await mkdtemp(join(tmpdir(), "meeting-contacts-crud-"));
  try {
    const store = createLocalContactStore({ dataDirectory: directory });
    const createdResponse = await callApi(store, "/api/contacts", {
      method: "POST",
      body: body({
        contact: {
          name: "贺世博",
          unit: "上海九誓科技有限公司",
          department: "市场部",
          title: "总经理",
        },
      }),
    });
    assert.equal(createdResponse.status, 201);
    const created = (await createdResponse.json()).contact;
    assert.equal(created.meetingCount, 0);

    const updatedResponse = await callApi(
      store,
      `/api/contacts/${created.id}`,
      {
        method: "PUT",
        body: body({
          contact: {
            name: "贺世博",
            unit: "上海九誓科技有限公司",
            department: "战略市场部",
            title: "执行总经理",
          },
        }),
      },
    );
    assert.equal(updatedResponse.status, 200);
    assert.equal(
      (await updatedResponse.json()).contact.department,
      "战略市场部",
    );

    const searchResponse = await callApi(
      store,
      "/api/contacts?q=%E6%88%98%E7%95%A5&limit=5",
    );
    assert.equal(searchResponse.status, 200);
    assert.equal((await searchResponse.json()).total, 1);

    const conflictResponse = await callApi(store, "/api/contacts", {
      method: "POST",
      body: body({
        contact: {
          name: "贺世博",
          unit: "上海九誓科技有限公司",
          department: "",
          title: "",
        },
      }),
    });
    assert.equal(conflictResponse.status, 409);

    const deletedResponse = await callApi(
      store,
      `/api/contacts/${created.id}`,
      { method: "DELETE" },
    );
    assert.equal(deletedResponse.status, 200);
    assert.deepEqual(await deletedResponse.json(), {
      deleted: true,
      total: 0,
    });
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

test("renaming a meeting contact updates the same record during later historical syncs", async () => {
  const directory = await mkdtemp(join(tmpdir(), "meeting-contacts-rename-"));
  try {
    const store = createLocalContactStore({ dataDirectory: directory });
    const originalMeeting = {
      meeting: { id: "meeting-rename", title: "历史会议", date: "2026-08-01" },
      contacts: [
        {
          name: "原姓名",
          unit: "原单位",
          department: "市场部",
          title: "经理",
        },
      ],
    };
    await callApi(store, "/api/contacts/upsert", {
      method: "POST",
      body: body(originalMeeting),
    });
    const originalList = await callApi(store, "/api/contacts?limit=10");
    const original = (await originalList.json()).contacts[0];

    const updatedResponse = await callApi(
      store,
      `/api/contacts/${original.id}`,
      {
        method: "PUT",
        body: body({
          contact: {
            name: "新姓名",
            unit: "新单位",
            department: "市场经营部",
            title: "负责人",
          },
        }),
      },
    );
    assert.equal(updatedResponse.status, 200);

    const repeatedBackfill = await callApi(store, "/api/contacts/upsert", {
      method: "POST",
      body: body(originalMeeting),
    });
    assert.equal(repeatedBackfill.status, 200);

    const finalList = await callApi(store, "/api/contacts?limit=10");
    const finalPayload = await finalList.json();
    assert.equal(finalPayload.total, 1);
    assert.equal(finalPayload.contacts[0].id, original.id);
    assert.equal(finalPayload.contacts[0].name, "新姓名");
    assert.equal(finalPayload.contacts[0].unit, "新单位");
    assert.equal(finalPayload.contacts[0].department, "市场经营部");
    assert.equal(finalPayload.contacts[0].title, "负责人");
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

test("contacts API can replace an exact snapshot for safe undo", async () => {
  const directory = await mkdtemp(join(tmpdir(), "meeting-contacts-restore-"));
  try {
    const store = createLocalContactStore({ dataDirectory: directory });
    const createdResponse = await callApi(store, "/api/contacts", {
      method: "POST",
      body: body({ contact: { name: "张三", unit: "宁波经发", department: "市场部", title: "经理" } }),
    });
    const original = (await createdResponse.json()).contact;
    const replacement = { ...original, department: "市场经营部" };
    const replaceResponse = await callApi(store, "/api/contacts", {
      method: "PUT",
      body: body({ contacts: [replacement] }),
    });
    assert.equal(replaceResponse.status, 200);
    assert.deepEqual(await replaceResponse.json(), { replaced: true, total: 1 });
    const listResponse = await callApi(store, "/api/contacts?limit=10");
    const payload = await listResponse.json();
    assert.equal(payload.contacts[0].id, original.id);
    assert.equal(payload.contacts[0].department, "市场经营部");
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});
