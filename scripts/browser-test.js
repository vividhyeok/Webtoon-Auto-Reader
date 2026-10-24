"use strict";
const { spawn } = require("node:child_process"),
  fs = require("node:fs"),
  path = require("node:path"),
  os = require("node:os"),
  { pathToFileURL } = require("node:url");
const chrome =
  process.env.CHROME_PATH ||
  "C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe";
if (!fs.existsSync(chrome)) throw Error("Set CHROME_PATH to Chrome executable");
const profile = fs.mkdtempSync(path.join(os.tmpdir(), "reader-browser-"));
(async () => {
  const child = spawn(
    chrome,
    [
      "--headless",
      "--disable-gpu",
      "--no-first-run",
      "--no-default-browser-check",
      `--user-data-dir=${profile}`,
      "--allow-file-access-from-files",
      "--remote-debugging-port=0",
      "about:blank",
    ],
    { windowsHide: true, stdio: ["ignore", "ignore", "pipe"] },
  );
  let ws;
  const watchdog = setTimeout(() => child.kill(), 25000);
  try {
    const endpoint = await new Promise((resolve, reject) => {
      let buffer = "";
      child.stderr.on("data", (d) => {
        buffer += d;
        const match = buffer.match(/DevTools listening on (ws:\/\/[^\s]+)/);
        if (match) resolve(match[1]);
      });
      child.on("error", reject);
      child.on("exit", () => reject(Error("Chrome exited before connecting")));
    });
    ws = new WebSocket(endpoint);
    await new Promise((resolve, reject) => {
      ws.onopen = resolve;
      ws.onerror = reject;
    });
    let seq = 0;
    const pending = new Map();
    ws.onmessage = (e) => {
      const data = JSON.parse(e.data);
      if (data.id) {
        const callbacks = pending.get(data.id);
        pending.delete(data.id);
        if (data.error) callbacks.reject(Error(data.error.message));
        else callbacks.resolve(data.result);
      }
    };
    function send(method, params = {}, sessionId) {
      return new Promise((resolve, reject) => {
        const id = ++seq;
        pending.set(id, { resolve, reject });
        ws.send(JSON.stringify({ id, method, params, sessionId }));
      });
    }
    const { targetId } = await send("Target.createTarget", {
      url: "about:blank",
    });
    const { sessionId } = await send("Target.attachToTarget", {
      targetId,
      flatten: true,
    });
    await send("Page.enable", {}, sessionId);
    await send(
      "Page.navigate",
      { url: pathToFileURL(path.resolve("tests/fixtures/reader.html")).href },
      sessionId,
    );
    let result;
    for (let i = 0; i < 150; i++) {
      const r = await send(
        "Runtime.evaluate",
        {
          expression: 'document.getElementById("results")?.textContent',
          returnByValue: true,
        },
        sessionId,
      );
      result = r.result?.value;
      if (result && result !== "RUNNING") break;
      await new Promise((resolve) => setTimeout(resolve, 100));
    }
    if (!result?.startsWith("PASS:"))
      throw Error(result || "Browser fixture did not complete");
    console.log(result);
    await send("Browser.close");
  } finally {
    clearTimeout(watchdog);
    ws?.close();
    child.kill();
    await new Promise((resolve) => setTimeout(resolve, 300));
    try {
      fs.rmSync(profile, { recursive: true, force: true });
    } catch {}
  }
})().catch((e) => {
  console.error(e);
  process.exitCode = 1;
});
