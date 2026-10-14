import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { mkdtemp, readFile, mkdir } from "node:fs/promises";
import { resolve, join } from "node:path";
import { createServer } from "node:net";

const executable = resolve(process.argv[2] || "release/desktop/win-unpacked/MeetingAssistant.exe");
await mkdir(resolve(".tmp"), { recursive: true });
const testRoot = await mkdtemp(resolve(".tmp/desktop-验证 "));
const probe = createServer();
await new Promise((ready) => probe.listen(0, "127.0.0.1", ready));
const port = probe.address().port;
await new Promise((closed) => probe.close(closed));
for (let pass = 1; pass <= 2; pass += 1) {
  const reportPath = join(testRoot, `report-${pass}.json`);
  const env = {
    ...process.env,
    MEETING_DESKTOP_SMOKE: "1",
    MEETING_DESKTOP_TEST_DATA: join(testRoot, "数据"),
    MEETING_DESKTOP_REPORT: reportPath,
    MEETING_DESKTOP_TEST_PORT: String(port),
  };
  // A development terminal must not accidentally turn the EXE into Node.
  delete env.ELECTRON_RUN_AS_NODE;
  const child = spawn(executable, [], { env, stdio: ["ignore", "pipe", "pipe"], windowsHide: true });
  let output = "";
  child.stdout.on("data", (chunk) => { output += chunk; });
  child.stderr.on("data", (chunk) => { output += chunk; });
  await new Promise((resolveExit, rejectExit) => {
    const timer = setTimeout(() => {
      child.kill();
      rejectExit(new Error("Desktop smoke test timed out"));
    }, 60000);
    child.once("error", (error) => { clearTimeout(timer); rejectExit(error); });
    child.once("exit", () => { clearTimeout(timer); resolveExit(); });
  });
  const report = JSON.parse(await readFile(reportPath, "utf8").catch((error) => {
    throw new Error(`Desktop did not produce a report: ${error.message}\n${output}`);
  }));
  assert.equal(report.ok, true, report.error);
  assert.equal(report.packaged, true);
  assert.equal(report.builtinRoomCount, 6, "Packaged defaults must contain six rooms");
  assert.deepEqual(report.inputRecovery, { cancel: 3, escape: true, confirm: true, textInput: true, textarea: true }, "Input must recover after confirmations in the EXE renderer");
  if (pass === 2) {
    assert.equal(report.restoredContact, true, "Contact was not restored after restart");
    assert.equal(report.restoredMeeting, true, "Meeting was not restored after restart");
    assert.equal(report.restoredProfile, true, "Browser settings were not restored after restart");
    assert.equal(report.restoredRoom, true, "Room edits must be preserved across restarts");
    assert.equal(report.restoredTableType, true, "Room table type must be preserved across restarts");
  }
  console.log(JSON.stringify({ executable, pass, ...report }));
}
