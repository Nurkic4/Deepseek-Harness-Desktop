import { randomBytes, createHash } from "node:crypto";
import { existsSync } from "node:fs";
import { readFile } from "node:fs/promises";
import { isAbsolute, join } from "node:path";
import { stat } from "node:fs/promises";
import { withWindowsSystemPath } from "../../dsh-git-bash/lib/windows-env.js";

// DSH Desktop 配套终端（宿主侧）：
// 在 webServer 上提供终端路由，为「终端」标签页提供流式 shell：
//   GET /dsh-files/term/events?token=...&cwd=...   SSE（诊断/兼容用）
//   GET /dsh-files/term/ws?token=...&cwd=...       WebSocket 升级（正式通道——
//     浏览器对同一主机 HTTP/1.1 并发连接上限为 6，web UI 自身的长连接已占满，
//     终端若用 SSE 会被排队永远连不上；WebSocket 升级连接不占该池）
//   POST /dsh-files/term/input   {token, line}      兼容用（WS 内也可发命令）
//   POST /dsh-files/term/close   {token}            终止并清理 shell
//
// 设计要点：
//  - 每个 token 一个持久 shell：Windows 为 Git Bash，其他平台为 sh -i；
//    Windows 路径由桌面宿主通过 DSH_GIT_BASH_PATH 注入；
//  - 断开后 shell 保留 15 分钟（标签页切换/刷新不丢状态），重连时先回放
//    最近 512KB 输出（snapshot），再接续流式输出；
//  - 使用 DSH subprocess 服务分配 PTY；Windows 下由 node-pty 对接 ConPTY，
//    支持交互式 CLI、全屏程序、逐键输入和终端尺寸同步。

const TERM_EVENTS = "/dsh-files/term/events";
const TERM_WS = "/dsh-files/term/ws";
const TERM_INPUT = "/dsh-files/term/input";
const TERM_CLOSE = "/dsh-files/term/close";
const TERM_XTERM_JS = "/dsh-files/term/assets/xterm.js";
const TERM_FIT_JS = "/dsh-files/term/assets/addon-fit.js";
const TERM_XTERM_CSS = "/dsh-files/term/assets/xterm.css";

const WS_GUID = "258EAFA5-E914-47DA-95CA-C5AB0DC85B11";
const IDLE_KEEP_MS = 15 * 60 * 1000; // 断开后保留
const CLOSED_KEEP_MS = 60 * 1000;    // 退出后保留（吸收重连）
const MAX_BUFFER = 512 * 1024;       // snapshot 回放上限
const MAX_SHELLS = 32; // UI 每个会话最多 8 个；给多会话后台保留留出空间。
const HEARTBEAT_MS = 25 * 1000;

const shells = new Map(); // token -> record
let subprocessRuntime;

function isLoopback(req) {
  const ra = req.socket && req.socket.remoteAddress;
  return ra === "127.0.0.1" || ra === "::1" || ra === "::ffff:127.0.0.1";
}

function sendJson(res, status, body) {
  const data = Buffer.from(JSON.stringify(body), "utf8");
  res.writeHead(status, {
    "content-type": "application/json; charset=utf-8",
    "cache-control": "no-store",
    "content-length": String(data.length)
  });
  res.end(data);
}

function readBody(req, limit = 64 * 1024) {
  return new Promise((resolve, reject) => {
    let size = 0;
    const chunks = [];
    req.on("data", (c) => {
      size += c.length;
      if (size > limit) {
        reject(new Error("body too large"));
        req.destroy();
        return;
      }
      chunks.push(c);
    });
    req.on("end", () => resolve(Buffer.concat(chunks).toString("utf8")));
    req.on("error", reject);
  });
}

function sse(res, event, data) {
  try {
    res.write(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`);
  } catch {}
}

function firstExisting(paths) {
  return paths.filter(Boolean).find((candidate) => isAbsolute(candidate) && existsSync(candidate));
}

function resolveGitBash() {
  return firstExisting([
    process.env.DSH_GIT_BASH_PATH,
    process.env.ProgramFiles && join(process.env.ProgramFiles, "Git", "bin", "bash.exe"),
    process.env["ProgramFiles(x86)"] && join(process.env["ProgramFiles(x86)"], "Git", "bin", "bash.exe"),
    process.env.LOCALAPPDATA && join(process.env.LOCALAPPDATA, "Programs", "Git", "bin", "bash.exe"),
  ]);
}

function resolvePowerShell() {
  return firstExisting([
    process.env.DSH_PWSH_PATH,
    process.env.ProgramFiles && join(process.env.ProgramFiles, "PowerShell", "7", "pwsh.exe"),
    process.env.LOCALAPPDATA && join(process.env.LOCALAPPDATA, "Microsoft", "WindowsApps", "pwsh.exe"),
  ]);
}

function shellKind(value) {
  return value === "powershell" ? "powershell" : "git-bash";
}

async function spawnShell(cwd, shell, cols, rows) {
  if (!subprocessRuntime) throw new Error("subprocess terminal service is unavailable");
  let argv;
  if (process.platform === "win32") {
    if (shell === "powershell") {
      const pwsh = resolvePowerShell();
      if (!pwsh) throw new Error("PowerShell 7 (pwsh.exe) is unavailable");
      argv = [pwsh, "-NoLogo", "-NoProfile"];
    } else {
      const gitBash = resolveGitBash();
      if (!gitBash) throw new Error("Git Bash (bash.exe) is unavailable");
      argv = [gitBash, "--noprofile", "--norc", "-i"];
    }
  } else {
    argv = ["sh", "-i"];
  }
  const env = withWindowsSystemPath(
    Object.fromEntries(Object.entries(process.env).filter(([, value]) => value !== undefined)),
  );
  return subprocessRuntime.spawnTerminal({
    argv,
    cwd,
    cols,
    rows,
    graceMs: 2000,
    env: {
      ...env,
      CHERE_INVOKING: "1",
      MSYS2_ARG_CONV_EXCL: "*",
      TERM: "xterm-256color",
    },
  });
}

function removeRecord(token, grace = 0) {
  const rec = shells.get(token);
  if (!rec) return;
  if (grace > 0 && !rec._removing) {
    rec._removing = true;
    // A2：延迟删除前校验记录身份，防止旧定时器误删新记录。
    const timer = setTimeout(() => {
      if (shells.get(token) === rec) shells.delete(token);
    }, grace);
    timer.unref();
    return;
  }
  shells.delete(token);
}

function tokenTag(token) {
  const value = String(token || "");
  return value.length > 8 ? "..." + value.slice(-8) : value;
}

function destroyRecord(rec) {
  clearTimeout(rec.killTimer);
  rec.closed = true;
  console.log("[dsh-terminal] closing", tokenTag(rec.token), rec.shell, "pid=" + rec.proc.pid);
  void rec.proc.terminate().catch((error) => {
    console.error(
      "[dsh-terminal] cleanup failed",
      tokenTag(rec.token),
      "pid=" + rec.proc.pid,
      String((error && error.message) || error)
    );
  });
  detachRecord(rec);
}

function pushOutput(rec, text) {
  if (!text) return;
  rec.buffer = (rec.buffer + text).slice(-MAX_BUFFER);
  if (rec.send) rec.send({ event: "data", data: { text } });
}

/** 每个 record 一个活动传输（SSE 或 WS）；attach 前先断开旧传输。 */
function detachRecord(rec) {
  if (rec.detach) { try { rec.detach(); } catch {} }
  rec.send = null;
  rec.detach = null;
}

function scheduleIdleKill(rec) {
  if (rec.closed) return;
  clearTimeout(rec.killTimer);
  rec.killTimer = setTimeout(() => { destroyRecord(rec); removeRecord(rec.token); }, IDLE_KEEP_MS);
  rec.killTimer.unref?.();
}

function attachSse(rec, res) {
  detachRecord(rec);
  rec.send = (msg) => sse(res, msg.event, msg.data);
  const beat = setInterval(() => { try { res.write(": ping\n\n"); } catch {} }, HEARTBEAT_MS);
  const detach = () => { clearInterval(beat); };
  rec.detach = detach;
  res.on("close", () => {
    if (rec.detach !== detach) return;
    try { detach(); } catch {}
    rec.send = null;
    rec.detach = null;
    scheduleIdleKill(rec);
  });
  rec.send({ event: "snapshot", data: { text: rec.buffer } });
  rec.send({ event: "ready", data: { token: rec.token, cwd: rec.cwd, shell: rec.shell, resumed: true, exited: !!rec.closed } });
  if (rec.closed) rec.send({ event: "exit", data: { code: rec.exitCode } });
}

// --- WebSocket 最小实现（RFC 6455：握手 + 文本帧收发 + ping/close） ----------

function wsSendRaw(socket, buffer) {
  try { socket.write(buffer); } catch {}
}

function wsSendText(socket, text) {
  const payload = Buffer.from(text, "utf8");
  const len = payload.length;
  let header;
  if (len < 126) {
    header = Buffer.alloc(2);
    header[0] = 0x81; // FIN + text
    header[1] = len;
  } else if (len < 65536) {
    header = Buffer.alloc(4);
    header[0] = 0x81;
    header[1] = 126;
    header.writeUInt16BE(len, 2);
  } else {
    header = Buffer.alloc(10);
    header[0] = 0x81;
    header[1] = 127;
    header.writeBigUInt64BE(BigInt(len), 2);
  }
  wsSendRaw(socket, Buffer.concat([header, payload]));
}

function wsSendPing(socket) {
  wsSendRaw(socket, Buffer.from([0x89, 0]));
}

/** 客户端→服务端帧解析（客户端帧必须带 mask）。返回 null 表示连接已关闭。 */
function wsConsume(socket, chunk, onMessage) {
  let buf = socket.__wsbuf ? Buffer.concat([socket.__wsbuf, chunk]) : chunk;
  while (buf.length >= 2) {
    const b0 = buf[0], b1 = buf[1];
    const opcode = b0 & 0x0f;
    const masked = (b1 & 0x80) !== 0;
    let offset = 2;
    let len = b1 & 0x7f;
    if (len === 126) {
      if (buf.length < 4) break;
      len = buf.readUInt16BE(2);
      offset = 4;
    } else if (len === 127) {
      if (buf.length < 10) break;
      len = Number(buf.readBigUInt64BE(2));
      offset = 10;
    }
    const maskLen = masked ? 4 : 0;
    if (buf.length < offset + maskLen + len) break;
    const mask = masked ? buf.subarray(offset, offset + 4) : null;
    offset += maskLen;
    let payload = buf.subarray(offset, offset + len);
    if (mask) {
      const un = Buffer.alloc(len);
      for (let i = 0; i < len; i++) un[i] = payload[i] ^ mask[i & 3];
      payload = un;
    }
    buf = buf.subarray(offset + len);
    socket.__wsbuf = buf.length ? buf : Buffer.alloc(0);
    if (opcode === 8) { // close
      try { socket.end(); } catch {}
      return null;
    }
    if (opcode === 9) continue; // ping：忽略（浏览器一般不 ping 服务器）
    if (opcode === 1 || opcode === 2) {
      try { onMessage(payload.toString("utf8")); } catch {}
    }
    if ((b0 & 0x80) === 0) continue; // 分片后续帧忽略内容
  }
  socket.__wsbuf = buf;
  return socket;
}

function attachWs(rec, socket) {
  detachRecord(rec);
  rec.send = (msg) => wsSendText(socket, JSON.stringify(msg));
  const beat = setInterval(() => wsSendPing(socket), HEARTBEAT_MS);
  const onData = (c) => {
    const alive = wsConsume(socket, c, (text) => handleClientMessage(rec, text));
    if (alive === null && rec.detach === detach) { try { detach(); } catch {} }
  };
  socket.on("data", onData);
  const detach = () => {
    clearInterval(beat);
    socket.removeListener("data", onData);
    try { socket.destroy(); } catch {}
  };
  rec.detach = detach;
  socket.on("close", () => {
    if (rec.detach !== detach) return;
    try { detach(); } catch {}
    rec.send = null;
    rec.detach = null;
    scheduleIdleKill(rec);
  });
  socket.on("error", () => { try { socket.destroy(); } catch {} });
  rec.send({ event: "snapshot", data: { text: rec.buffer } });
  rec.send({ event: "ready", data: { token: rec.token, cwd: rec.cwd, shell: rec.shell, resumed: true, exited: !!rec.closed } });
  if (rec.closed) rec.send({ event: "exit", data: { code: rec.exitCode } });
}

function handleClientMessage(rec, text) {
  let msg;
  try { msg = JSON.parse(text); } catch { return; }
  if (!msg || typeof msg !== "object") return;
  if (msg.type === "input" && typeof msg.data === "string" && msg.data && !rec.closed) {
    rec.lastActive = Date.now();
    void rec.proc.write(msg.data).catch(() => {});
  } else if (msg.type === "resize" && Number.isInteger(msg.cols) && Number.isInteger(msg.rows)) {
    const cols = Math.max(2, Math.min(500, msg.cols));
    const rows = Math.max(1, Math.min(200, msg.rows));
    try { rec.proc.resize?.(cols, rows); } catch {}
  }
}

// --- 会话查找/创建（SSE 与 WS 共用） ------------------------------------------

async function ensureRecord(token, cwd, requestedShell, requestedCols = 120, requestedRows = 30) {
  const shell = shellKind(requestedShell);
  const cols = Math.max(2, Math.min(500, Number(requestedCols) || 120));
  const rows = Math.max(1, Math.min(200, Number(requestedRows) || 30));
  let rec = token ? shells.get(token) : undefined;
  if (rec) {
    // A2：同一 token 被另一会话（不同 cwd）复用：回收旧 shell，按新 cwd 重建。
    if (rec.cwd === cwd && rec.shell === shell) {
      try { rec.proc.resize?.(cols, rows); } catch {}
      console.log("[dsh-terminal] reused", tokenTag(token), shell, "pid=" + rec.proc.pid);
      return rec;
    }
    destroyRecord(rec);
    shells.delete(token);
  }
  const tok = token || randomBytes(9).toString("hex");
  if (!cwd || !isAbsolute(cwd)) return { __error: "cwd must be an absolute path" };
  try {
    const st = await stat(cwd);
    if (!st.isDirectory()) throw new Error("not a directory");
  } catch {
    return { __error: "cwd is not a directory: " + cwd };
  }
  if (shells.size >= MAX_SHELLS) return { __error: "too many terminal sessions" };
  let proc;
  try {
    proc = await spawnShell(cwd, shell, cols, rows);
  } catch (err) {
    return { __error: String((err && err.message) || err) };
  }
  rec = {
    token: tok,
    cwd,
    shell,
    proc,
    buffer: "",
    send: null,
    detach: null,
    closed: false,
    exitCode: null,
    killTimer: null,
    lastActive: Date.now()
  };
  shells.set(tok, rec);
  console.log("[dsh-terminal] spawned", tokenTag(tok), shell, "pid=" + proc.pid);
  proc.output.on("data", (chunk) => pushOutput(rec, chunk.toString("utf8")));
  proc.done.then(({ exitCode }) => {
    rec.closed = true;
    rec.exitCode = exitCode;
    if (rec.send) rec.send({ event: "exit", data: { code: exitCode } });
    detachRecord(rec);
    removeRecord(tok, CLOSED_KEEP_MS);
  }).catch((err) => {
    if (!rec.closed) pushOutput(rec, "\r\n[终端错误] " + String((err && err.message) || err) + "\r\n");
  });
  return rec;
}

// --- 路由 --------------------------------------------------------------------

async function handleEventsRoute(req, res) {
  console.log("[dsh-terminal] events request", req.method, "remote=" + (req.socket && req.socket.remoteAddress));
  if (req.method !== "GET") {
    res.writeHead(405, { allow: "GET" });
    res.end();
    return;
  }
  if (!isLoopback(req)) {
    res.writeHead(403);
    res.end("forbidden");
    return;
  }
  let url;
  try {
    url = new URL(req.url, "http://127.0.0.1");
  } catch {
    res.writeHead(400);
    res.end();
    return;
  }
  const token = (url.searchParams.get("token") || "").trim();
  const cwd = (url.searchParams.get("cwd") || "").trim();
  const shell = (url.searchParams.get("shell") || "").trim();
  const rec = await ensureRecord(token, cwd, shell, url.searchParams.get("cols"), url.searchParams.get("rows"));
  if (rec.__error) {
    sendJson(res, 400, { error: rec.__error });
    return;
  }
  attachSse(rec, res);
}

async function handleWsUpgrade(req, socket, head) {
  console.log("[dsh-terminal] ws request", "remote=" + (req.socket && req.socket.remoteAddress));
  if (!isLoopback(req)) { socket.destroy(); return; }
  const key = req.headers["sec-websocket-key"];
  if (!key) {
    socket.write("HTTP/1.1 400 Bad Request\r\n\r\n");
    socket.destroy();
    return;
  }
  let url;
  try {
    url = new URL(req.url, "http://127.0.0.1");
  } catch {
    socket.write("HTTP/1.1 400 Bad Request\r\n\r\n");
    socket.destroy();
    return;
  }
  const token = (url.searchParams.get("token") || "").trim();
  const cwd = (url.searchParams.get("cwd") || "").trim();
  const shell = (url.searchParams.get("shell") || "").trim();
  const rec = await ensureRecord(token, cwd, shell, url.searchParams.get("cols"), url.searchParams.get("rows"));
  if (rec.__error) {
    console.error("[dsh-terminal] terminal creation failed:", rec.__error);
    socket.write("HTTP/1.1 400 Bad Request\r\n\r\n");
    socket.destroy();
    return;
  }
  const accept = createHash("sha1").update(key + WS_GUID).digest("base64");
  socket.write(
    "HTTP/1.1 101 Switching Protocols\r\n" +
    "Upgrade: websocket\r\n" +
    "Connection: Upgrade\r\n" +
    "Sec-WebSocket-Accept: " + accept + "\r\n\r\n"
  );
  attachWs(rec, socket);
}

async function handleInputRoute(req, res) {
  if (req.method !== "POST") {
    res.writeHead(405, { allow: "POST" });
    res.end();
    return;
  }
  if (!isLoopback(req)) {
    res.writeHead(403);
    res.end("forbidden");
    return;
  }
  let body;
  try {
    body = JSON.parse((await readBody(req)).replace(/^\uFEFF/, ""));
  } catch {
    sendJson(res, 400, { error: "invalid JSON body" });
    return;
  }
  const token = String((body && body.token) || "");
  const line = String((body && body.line) || "");
  if (!token || !line) {
    sendJson(res, 400, { error: "token and line are required" });
    return;
  }
  const rec = shells.get(token);
  if (!rec) {
    sendJson(res, 404, { error: "terminal session not found" });
    return;
  }
  if (rec.closed) {
    sendJson(res, 409, { error: "shell exited" });
    return;
  }
  rec.lastActive = Date.now();
  try {
    await rec.proc.write(line + "\r");
    sendJson(res, 200, { ok: true });
  } catch (err) {
    sendJson(res, 500, { error: String((err && err.message) || err) });
  }
}

async function handleCloseRoute(req, res) {
  if (req.method !== "POST") {
    res.writeHead(405, { allow: "POST" });
    res.end();
    return;
  }
  if (!isLoopback(req)) {
    res.writeHead(403);
    res.end("forbidden");
    return;
  }
  let body;
  try {
    body = JSON.parse((await readBody(req)).replace(/^\uFEFF/, ""));
  } catch {
    sendJson(res, 400, { error: "invalid JSON body" });
    return;
  }
  const token = String((body && body.token) || "");
  const rec = token ? shells.get(token) : undefined;
  if (rec) {
    destroyRecord(rec);
    removeRecord(rec.token);
  }
  sendJson(res, 200, { ok: true });
}

function assetHandler(file, contentType) {
  return async (_req, res) => {
    try {
      const data = await readFile(new URL(file, import.meta.url));
      res.writeHead(200, {
        "content-type": contentType,
        "cache-control": "public, max-age=31536000, immutable",
        "content-length": String(data.length),
      });
      res.end(data);
    } catch {
      res.writeHead(404);
      res.end();
    }
  };
}

const name = "dsh-terminal";
const inject = ["webServer", "subprocess"];

function apply(ctx) {
  subprocessRuntime = ctx.subprocess;
  const disposers = [
    ctx.webServer.register({ kind: "exact", path: TERM_EVENTS, handler: handleEventsRoute }),
    ctx.webServer.registerUpgrade({ path: TERM_WS, handler: handleWsUpgrade }),
    ctx.webServer.register({ kind: "exact", path: TERM_INPUT, handler: handleInputRoute }),
    ctx.webServer.register({ kind: "exact", path: TERM_CLOSE, handler: handleCloseRoute }),
    ctx.webServer.register({ kind: "exact", path: TERM_XTERM_JS, handler: assetHandler("./xterm.js", "text/javascript; charset=utf-8") }),
    ctx.webServer.register({ kind: "exact", path: TERM_FIT_JS, handler: assetHandler("./addon-fit.js", "text/javascript; charset=utf-8") }),
    ctx.webServer.register({ kind: "exact", path: TERM_XTERM_CSS, handler: assetHandler("./xterm.css", "text/css; charset=utf-8") })
  ];
  return () => {
    for (const d of disposers) d();
    for (const rec of shells.values()) destroyRecord(rec);
    shells.clear();
    subprocessRuntime = undefined;
  };
}

export { apply, inject, name };
