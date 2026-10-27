import { EventEmitter } from "node:events";
import { createHash, randomUUID } from "node:crypto";
import { createReadStream } from "node:fs";
import { mkdir, open, readdir, rename, rm, stat } from "node:fs/promises";
import { join } from "node:path";
import { spawn } from "node:child_process";

export const RELEASES_URL = "https://github.com/Saikk1/meeting-list-ai/releases";
export const UPDATE_API = "https://api.github.com/repos/Saikk1/meeting-list-ai/releases/latest";
const MAX_INSTALLER_SIZE = 512 * 1024 * 1024;

function versionParts(value) {
  if (typeof value !== "string" || !/^\d{1,6}\.\d{1,6}\.\d{1,6}$/.test(value)) throw new Error("版本号格式无效。");
  return value.split(".").map(Number);
}

export function isNewerVersion(candidate, current) {
  const next = versionParts(candidate), previous = versionParts(current);
  for (let i = 0; i < 3; i++) {
    if (next[i] !== previous[i]) return next[i] > previous[i];
  }
  return false;
}

export function parseUpdateRelease(release, currentVersion) {
  if (!release || release.draft !== false || release.prerelease !== false) throw new Error("发布信息无效，请到发布页查看。");
  const version = typeof release.tag_name === "string" ? release.tag_name.replace(/^v/, "") : "";
  if (!isNewerVersion(version, currentVersion)) return null;
  const name = `MeetingAssistant-${version}-Setup.exe`;
  const assets = Array.isArray(release.assets) ? release.assets.filter((asset) => asset.name === name) : [];
  const asset = assets[0];
  const url = `${RELEASES_URL}/download/v${version}/${name}`;
  if (assets.length !== 1 || asset.state !== "uploaded" || asset.browser_download_url !== url
    || !Number.isSafeInteger(asset.size) || asset.size <= 0 || asset.size > MAX_INSTALLER_SIZE
    || !/^sha256:[a-f0-9]{64}$/.test(asset.digest)) {
    throw new Error("新版安装包尚未完整发布或缺少校验信息，请稍后重试。");
  }
  return { version, url, name, size: asset.size, sha256: asset.digest.slice(7),
    notes: typeof release.body === "string" ? release.body.slice(0, 12000) : "本次发布未提供更新说明。" };
}

async function verifyFile(file, expected) {
  const info = await stat(file);
  if (!info.isFile() || info.size !== expected.size) throw new Error("安装包大小校验失败，请重新下载。");
  const hash = createHash("sha256");
  for await (const chunk of createReadStream(file)) hash.update(chunk);
  if (hash.digest("hex") !== expected.sha256) throw new Error("安装包 SHA-256 校验失败，请重新下载。");
}

async function readLimitedText(response, limit = 1024 * 1024) {
  let length = 0;
  const chunks = [];
  for await (const chunk of response.body) {
    length += chunk.length;
    if (length > limit) throw new Error("发布信息超出限制。");
    chunks.push(Buffer.from(chunk));
  }
  return Buffer.concat(chunks).toString("utf8");
}

async function readPublicRelease(fetchImpl, currentVersion) {
  const options = { credentials: "omit", cache: "no-store", signal: AbortSignal.timeout(15000) };
  const page = await fetchImpl(`${RELEASES_URL}/latest`, options);
  const prefix = `${RELEASES_URL}/tag/v`;
  if (!page.ok || !page.url?.startsWith(prefix)) throw new Error("GitHub 暂时限制检查频率，发布页也不可用，请稍后重试。");
  const version = page.url.slice(prefix.length);
  await page.body?.cancel();
  if (!isNewerVersion(version, currentVersion)) return null;
  const name = `MeetingAssistant-${version}-Setup.exe`;
  const url = `${RELEASES_URL}/download/v${version}/${name}`;
  const sums = await fetchImpl(`${RELEASES_URL}/download/v${version}/SHA256SUMS-${version}.txt`, options);
  if (!sums.ok) throw new Error("新版校验文件暂不可用，请稍后重试。");
  const matches = (await readLimitedText(sums, 16384)).split(/\r?\n/).map((line) => line.match(/^([a-f0-9]{64}) [ *](\S+)$/i))
    .filter((match) => match && match[2] === name);
  if (matches.length !== 1) throw new Error("新版校验文件无效，请到发布页查看。");
  const head = await fetchImpl(url, { ...options, method: "HEAD" });
  const size = Number(head.headers.get("content-length"));
  if (!head.ok) throw new Error("新版安装包暂不可用，请稍后重试。");
  // Use the same strict asset validator for both GitHub metadata paths.
  return parseUpdateRelease({ tag_name: `v${version}`, draft: false, prerelease: false,
    body: "发现新的正式版本。请点击“打开发布页”查看完整更新说明。", assets: [{ name, state: "uploaded", size,
      digest: `sha256:${matches[0][1].toLowerCase()}`, browser_download_url: url }] }, currentVersion);
}

// No credentials, user records or renderer-provided URLs enter update requests.
export class DesktopUpdates extends EventEmitter {
  constructor({ currentVersion, cacheDirectory, fetchImpl = globalThis.fetch }) {
    super();
    versionParts(currentVersion);
    this.currentVersion = currentVersion;
    this.cacheDirectory = cacheDirectory;
    this.fetchImpl = fetchImpl;
    this.state = { status: "idle", currentVersion, version: "", notes: "", progress: 0, error: "" };
  }

  snapshot() { return { ...this.state }; }
  setState(patch) {
    this.state = { ...this.state, ...patch };
    this.emit("state", this.snapshot());
  }

  check() {
    if (this.task) return this.task;
    if (["downloaded", "installing"].includes(this.state.status)) return Promise.resolve(this.snapshot());
    this.release = null;
    this.setState({ status: "checking", version: "", notes: "", progress: 0, error: "" });
    this.task = (async () => {
      try {
        const response = await this.fetchImpl(UPDATE_API, {
          headers: { Accept: "application/vnd.github+json", "X-GitHub-Api-Version": "2022-11-28" },
          credentials: "omit", cache: "no-store", signal: AbortSignal.timeout(15000),
        });
        if (response.status === 403 || response.status === 429) {
          // Public release pages/checksums remain accessible when a shared IP exhausts API quota.
          await response.body?.cancel();
          this.release = await readPublicRelease(this.fetchImpl, this.currentVersion);
        } else {
          if (!response.ok) throw new Error("无法读取 GitHub 发布信息，请检查网络或到发布页下载。");
          this.release = parseUpdateRelease(JSON.parse(await readLimitedText(response)), this.currentVersion);
        }
        this.setState({ status: this.release ? "available" : "upToDate", version: this.release?.version || "",
          notes: this.release?.notes || "", progress: 0 });
      } catch (error) {
        this.setState({ status: "error", error: error.message.includes("。") ? error.message : "检查更新失败，请检查网络后重试。" });
      }
      return this.snapshot();
    })().finally(() => { this.task = null; });
    return this.task;
  }

  download() {
    if (this.task) return this.task;
    if (!this.release || ["downloaded", "installing"].includes(this.state.status)) return Promise.resolve(this.snapshot());
    const release = this.release;
    this.controller = new AbortController();
    this.setState({ status: "downloading", progress: 0, error: "" });
    this.task = (async () => {
      let temporary, handle;
      try {
        await mkdir(this.cacheDirectory, { recursive: true });
        const file = join(this.cacheDirectory, `${release.version}-${release.sha256}.exe`);
        let cached = false;
        try { await verifyFile(file, release); cached = true; } catch { /* Retry corrupt/incomplete cache. */ }
        if (!cached) {
          const response = await this.fetchImpl(release.url, { credentials: "omit",
            signal: AbortSignal.any([this.controller.signal, AbortSignal.timeout(10 * 60 * 1000)]) });
          if (!response.ok || !response.body) throw new Error("下载失败，请检查网络后重试。");
          temporary = join(this.cacheDirectory, `${randomUUID()}.partial`);
          handle = await open(temporary, "wx", 0o600);
          let received = 0;
          const hash = createHash("sha256");
          for await (const chunk of response.body) {
            this.controller.signal.throwIfAborted();
            received += chunk.length;
            if (received > release.size) throw new Error("安装包大小校验失败，请重新下载。");
            hash.update(chunk);
            await handle.writeFile(chunk);
            const progress = Math.floor(received / release.size * 100);
            if (progress !== this.state.progress) this.setState({ progress });
          }
          if (received !== release.size || hash.digest("hex") !== release.sha256) throw new Error("安装包校验失败，请重新下载。");
          await handle.sync();
          await handle.close(); handle = null;
          this.controller.signal.throwIfAborted();
          // Only replace this exact version/hash cache file, never application or business files.
          await rm(file, { force: true });
          await rename(temporary, file); temporary = null;
        }
        this.controller.signal.throwIfAborted();
        this.installer = { file, size: release.size, sha256: release.sha256 };
        // Bound cache growth; touch only our exact installer cache names in this directory.
        for (const name of await readdir(this.cacheDirectory)) {
          if (/^\d+\.\d+\.\d+-[a-f0-9]{64}\.exe$/.test(name) && join(this.cacheDirectory, name) !== file) {
            await rm(join(this.cacheDirectory, name), { force: true }).catch(() => {});
          }
        }
        this.setState({ status: "downloaded", progress: 100 });
      } catch (error) {
        this.installer = null;
        this.setState({ status: this.controller.signal.aborted ? "available" : "error", progress: 0,
          error: this.controller.signal.aborted ? "已取消下载，可随时重试。" : error.message.includes("。") ? error.message : "下载失败，请检查网络和磁盘空间后重试。" });
      } finally {
        await handle?.close().catch(() => {});
        if (temporary) await rm(temporary, { force: true }).catch(() => {});
      }
      return this.snapshot();
    })().finally(() => { this.task = null; this.controller = null; });
    return this.task;
  }

  cancelDownload() { this.controller?.abort(); }
  async prepareInstall() {
    if (this.state.status !== "downloaded" || !this.installer) return null;
    this.setState({ status: "installing", error: "" });
    try {
      await verifyFile(this.installer.file, this.installer);
      return { ...this.installer };
    } catch {
      this.installer = null;
      this.setState({ status: "error", error: "安装包已变更，请重新下载后安装。" });
      return null;
    }
  }
  cancelInstall() {
    if (this.state.status === "installing") this.setState({ status: "downloaded" });
  }
}

export async function launchUpdateInstaller(installer, installDirectory, spawnImpl = spawn) {
  await verifyFile(installer.file, installer);
  await new Promise((resolve, reject) => {
    const child = spawnImpl(installer.file, ["/S", "--updated", "--force-run", `/D=${installDirectory}`],
      { detached: true, stdio: "ignore", windowsHide: true, shell: false });
    child.once("error", reject);
    child.once("spawn", () => { child.unref(); resolve(); });
  });
}
