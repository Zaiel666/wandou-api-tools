const fs = require("fs");
const path = require("path");
const { pathToFileURL } = require("url");
const { spawn } = require("child_process");

const root = path.resolve(__dirname, "..");
const browserPath = "C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe";
const userDataDir = path.join(root, "build-output", `canvas-smoke-${Date.now()}`);
const logFile = path.join(root, "build-output", "canvas-smoke-test.log");
const port = 9315 + Math.floor(Math.random() * 200);
const builtCanvas = path.join(root, "build-output", "win-unpacked", "resources", "app", "ai-node-canvas.html");
const canvasFile = fs.existsSync(builtCanvas) ? builtCanvas : path.join(root, "app", "ai-node-canvas.html");
const canvasUrl = `${pathToFileURL(canvasFile).href}?project=canvas-smoke`;
fs.mkdirSync(userDataDir, { recursive: true });
fs.writeFileSync(logFile, "phase: launch\n");
const log = (message) => fs.appendFileSync(logFile, `${message}\n`);

class CdpClient {
  constructor(url) {
    this.nextId = 1;
    this.pending = new Map();
    this.socket = new WebSocket(url);
    this.ready = new Promise((resolve, reject) => {
      this.socket.addEventListener("open", resolve, { once: true });
      this.socket.addEventListener("error", reject, { once: true });
    });
    this.socket.addEventListener("message", (event) => {
      const message = JSON.parse(event.data);
      if (!message.id || !this.pending.has(message.id)) return;
      const { resolve, reject } = this.pending.get(message.id);
      this.pending.delete(message.id);
      if (message.error) reject(new Error(message.error.message));
      else resolve(message.result);
    });
    this.socket.addEventListener("close", () => {
      for (const { reject } of this.pending.values()) reject(new Error("CDP connection closed"));
      this.pending.clear();
    });
  }

  async send(method, params = {}) {
    await this.ready;
    const id = this.nextId++;
    return new Promise((resolve, reject) => {
      this.pending.set(id, { resolve, reject });
      this.socket.send(JSON.stringify({ id, method, params }));
    });
  }

  close() {
    this.socket.close();
  }
}

async function targets() {
  return fetch(`http://127.0.0.1:${port}/json/list`, { signal: AbortSignal.timeout(800) }).then((response) => response.json());
}

async function waitForTarget(predicate, timeout = 15000) {
  const startedAt = Date.now();
  while (Date.now() - startedAt < timeout) {
    try {
      const target = (await targets()).find(predicate);
      if (target) return target;
    } catch (error) {}
    await new Promise((resolve) => setTimeout(resolve, 200));
  }
  throw new Error("Timed out waiting for Electron target");
}

async function evaluate(client, expression) {
  const result = await client.send("Runtime.evaluate", { expression, awaitPromise: true, returnByValue: true });
  if (result.exceptionDetails) {
    throw new Error(result.exceptionDetails.exception?.description || result.exceptionDetails.text || "Renderer evaluation failed");
  }
  return result.result.value;
}

(async () => {
  if (!fs.existsSync(browserPath)) throw new Error(`Chrome was not found: ${browserPath}`);
  const child = spawn(browserPath, [
    "--headless=new",
    "--no-sandbox",
    "--disable-gpu",
    "--no-first-run",
    "--disable-default-apps",
    "--disable-extensions",
    `--remote-debugging-port=${port}`,
    `--user-data-dir=${userDataDir}`,
    canvasUrl
  ], {
    stdio: "ignore"
  });
  child.on("exit", (code, signal) => log(`phase: browser exit code=${code} signal=${signal}`));
  child.on("error", (error) => log(`phase: browser error ${error.stack || error}`));
  let canvasClient;
  try {
    const canvasTarget = await waitForTarget((target) => target.url.includes("ai-node-canvas.html"));
    log("phase: canvas ready");
    canvasClient = new CdpClient(canvasTarget.webSocketDebuggerUrl);
    await new Promise((resolve) => setTimeout(resolve, 900));

    log("phase: create and persist");
    const persisted = await evaluate(canvasClient, `(async () => {
      const baseline = document.querySelectorAll('.node').length;
      const preview = 'data:image/svg+xml,' + encodeURIComponent('<svg xmlns="http://www.w3.org/2000/svg" width="360" height="480"><rect width="100%" height="100%" fill="#dff4e5"/><circle cx="180" cy="220" r="90" fill="#45c936"/></svg>');
      for (let index = 0; index < 60; index++) {
        createNode('result', 120 + (index % 10) * 330, 120 + Math.floor(index / 10) * 460, { mediaUrl: preview, previewUrl: preview, width: 360, height: 480, pending: false });
      }
      render();
      await Promise.race([
        window.wandouSaveBeforeClose(),
        new Promise((_, reject) => setTimeout(() => reject(new Error('save timeout')), 10000))
      ]);
      const saved = document.querySelectorAll('.node').length;
      const db = await openLocalMediaDb();
      const backupStore = db.objectStoreNames.contains(canvasStateStoreName);
      return { baseline, saved, backupStore };
    })()`);

    log(`phase: persisted ${JSON.stringify(persisted)}`);
    log("phase: right selection and zoom");
    const interaction = await evaluate(canvasClient, `(async () => {
      view.zoom = 0.63;
      view.x = 80;
      view.y = 20;
      applyCanvasTransform();
      await new Promise(requestAnimationFrame);
      const nodeRects = [...document.querySelectorAll('.node')].slice(0, 4).map((node) => node.getBoundingClientRect());
      const startX = Math.max(2, Math.min(...nodeRects.map((rect) => rect.left)) - 8);
      const startY = Math.max(70, Math.min(...nodeRects.map((rect) => rect.top)) - 8);
      const endX = Math.min(innerWidth - 4, Math.max(...nodeRects.map((rect) => rect.right)) + 8);
      const endY = Math.min(innerHeight - 4, Math.max(...nodeRects.map((rect) => rect.bottom)) + 8);
      const wrap = document.querySelector('.canvas-wrap');
      wrap.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true, cancelable: true, button: 2, buttons: 2, pointerId: 91, clientX: startX, clientY: startY }));
      window.dispatchEvent(new PointerEvent('pointermove', { bubbles: true, cancelable: true, button: 2, buttons: 2, pointerId: 91, clientX: endX, clientY: endY }));
      await new Promise(requestAnimationFrame);
      const selectionRect = document.querySelector('#selectionBox').getBoundingClientRect();
      const boxStartOffset = Math.hypot(selectionRect.left - startX, selectionRect.top - startY);
      window.dispatchEvent(new PointerEvent('pointerup', { bubbles: true, cancelable: true, button: 2, buttons: 0, pointerId: 91, clientX: endX, clientY: endY }));
      const selected = document.querySelectorAll('.node.box-selected').length;
      const menuRect = document.querySelector('#selectionMenu').getBoundingClientRect();
      const menuOffset = Math.hypot(menuRect.left - endX, menuRect.top - endY);
      document.querySelector('#projectHubButton').click();
      await new Promise(requestAnimationFrame);
      const newProjectRect = document.querySelector('#newProjectButton').getBoundingClientRect();
      const pinRect = document.querySelector('#pinProjectHubButton').getBoundingClientRect();
      const exportRect = document.querySelector('#exportProjectButton').getBoundingClientRect();
      const importRect = document.querySelector('#importProjectButton').getBoundingClientRect();
      const hubButtonRect = document.querySelector('#projectHubButton').getBoundingClientRect();
      const hubMenuRect = document.querySelector('#projectHubMenu').getBoundingClientRect();
      const projectLayout = {
        firstRowOffset: Math.abs((newProjectRect.top + newProjectRect.height / 2) - (pinRect.top + pinRect.height / 2)),
        secondRowOffset: Math.abs(exportRect.top - importRect.top),
        rowGap: exportRect.top - newProjectRect.bottom,
        pinIsRight: pinRect.left >= newProjectRect.right,
        menuWidthOffset: Math.abs(hubMenuRect.width - hubButtonRect.width),
        menuRightOverflow: Math.max(0, hubMenuRect.right - window.innerWidth)
      };
      const wheelStart = performance.now();
      const bounds = wrap.getBoundingClientRect();
      for (let index = 0; index < 40; index++) {
        wrap.dispatchEvent(new WheelEvent('wheel', { bubbles: true, cancelable: true, deltaY: index % 2 ? 60 : -60, clientX: bounds.left + bounds.width / 2, clientY: bounds.top + bounds.height / 2 }));
        await new Promise(requestAnimationFrame);
      }
      const wheelMs = Math.round(performance.now() - wheelStart);
      await Promise.race([
        window.wandouSaveBeforeClose(),
        new Promise((_, reject) => setTimeout(() => reject(new Error('save timeout')), 10000))
      ]);
      localStorage.removeItem(projectCanvasStorageKey());
      localStorage.removeItem(folderCanvasStorageKey());
      return { selected, boxStartOffset, menuOffset, wheelMs, projectLayout };
    })()`);

    log(`phase: interaction ${JSON.stringify(interaction)}`);
    log("phase: backup restore");
    await canvasClient.send("Page.reload", { ignoreCache: true });
    await new Promise((resolve) => setTimeout(resolve, 1400));
    canvasClient.close();
    const restoredTarget = await waitForTarget((target) => target.url.includes("ai-node-canvas.html"));
    canvasClient = new CdpClient(restoredTarget.webSocketDebuggerUrl);
    const restored = await evaluate(canvasClient, `({ nodes: document.querySelectorAll('.node').length, title: document.title })`);
    const passed = persisted.saved > persisted.baseline
      && interaction.selected >= 2
      && interaction.boxStartOffset <= 1.5
      && interaction.menuOffset <= 1.5
      && interaction.projectLayout.firstRowOffset <= 1.5
      && interaction.projectLayout.secondRowOffset <= 1.5
      && interaction.projectLayout.rowGap >= 0
      && interaction.projectLayout.rowGap <= 6
      && interaction.projectLayout.pinIsRight
      && interaction.projectLayout.menuWidthOffset <= 1.5
      && interaction.projectLayout.menuRightOverflow === 0
      && persisted.backupStore
      && restored.nodes === persisted.saved
      && interaction.wheelMs < 5000;
    console.log(JSON.stringify({ passed, persisted, interaction, restored, userDataDir }, null, 2));
    log(`result: ${JSON.stringify({ passed, persisted, interaction, restored, userDataDir })}`);
    if (!passed) process.exitCode = 1;
  } finally {
    canvasClient?.close();
    child.kill();
  }
  setTimeout(() => process.exit(process.exitCode || 0), 400);
})().catch((error) => {
  try { fs.appendFileSync(logFile, `error: ${error.stack || error}\n`); } catch (writeError) {}
  console.error(error);
  process.exit(1);
});
