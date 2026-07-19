const fs = require("fs");
const path = require("path");
const { pathToFileURL } = require("url");
const { spawn } = require("child_process");

const root = path.resolve(__dirname, "..");
const executablePath = path.join(root, "build-output", "win-unpacked", "豌豆AI工具.exe");
const userDataDir = path.join(root, "build-output", `canvas-smoke-${Date.now()}`);
const logFile = path.join(root, "build-output", "canvas-smoke-test.log");
const port = 9315 + Math.floor(Math.random() * 200);
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
  const child = spawn(executablePath, [`--remote-debugging-port=${port}`], {
    env: { ...process.env, WANDOU_TEST_USER_DATA_DIR: userDataDir },
    stdio: "ignore"
  });
  let shellClient;
  let canvasClient;
  try {
    const shellTarget = await waitForTarget((target) => target.url.includes("shell.html"));
    log("phase: shell ready");
    shellClient = new CdpClient(shellTarget.webSocketDebuggerUrl);
    const canvasUrl = `${pathToFileURL(path.join(root, "build-output", "win-unpacked", "resources", "app", "ai-node-canvas.html")).href}?project=canvas-smoke`;
    for (let attempt = 0; attempt < 40; attempt++) {
      if (await evaluate(shellClient, `Boolean(document.querySelector('webview'))`)) break;
      await new Promise((resolve) => setTimeout(resolve, 150));
    }
    await evaluate(shellClient, `document.querySelector('webview').loadURL(${JSON.stringify(canvasUrl)}); true`);
    const canvasTarget = await waitForTarget((target) => target.url.includes("ai-node-canvas.html"));
    log("phase: canvas ready");
    canvasClient = new CdpClient(canvasTarget.webSocketDebuggerUrl);
    await new Promise((resolve) => setTimeout(resolve, 900));

    log("phase: create and persist");
    const persisted = await evaluate(canvasClient, `(async () => {
      const baseline = document.querySelectorAll('.node').length;
      for (let index = 0; index < 12; index++) {
        createNode(index % 3 === 0 ? 'image' : 'result', 120 + (index % 6) * 330, 120 + Math.floor(index / 6) * 420);
      }
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
      const nodeRects = [...document.querySelectorAll('.node')].slice(0, 4).map((node) => node.getBoundingClientRect());
      const startX = Math.max(2, Math.min(...nodeRects.map((rect) => rect.left)) - 8);
      const startY = Math.max(70, Math.min(...nodeRects.map((rect) => rect.top)) - 8);
      const endX = Math.min(innerWidth - 4, Math.max(...nodeRects.map((rect) => rect.right)) + 8);
      const endY = Math.min(innerHeight - 4, Math.max(...nodeRects.map((rect) => rect.bottom)) + 8);
      const wrap = document.querySelector('.canvas-wrap');
      wrap.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true, cancelable: true, button: 2, buttons: 2, pointerId: 91, clientX: startX, clientY: startY }));
      window.dispatchEvent(new PointerEvent('pointermove', { bubbles: true, cancelable: true, button: 2, buttons: 2, pointerId: 91, clientX: endX, clientY: endY }));
      await new Promise(requestAnimationFrame);
      window.dispatchEvent(new PointerEvent('pointerup', { bubbles: true, cancelable: true, button: 2, buttons: 0, pointerId: 91, clientX: endX, clientY: endY }));
      const selected = document.querySelectorAll('.node.box-selected').length;
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
      return { selected, wheelMs };
    })()`);

    log(`phase: interaction ${JSON.stringify(interaction)}`);
    log("phase: backup restore");
    await evaluate(shellClient, `document.querySelector('webview').loadURL(${JSON.stringify(canvasUrl)}); true`);
    await new Promise((resolve) => setTimeout(resolve, 1400));
    canvasClient.close();
    const restoredTarget = await waitForTarget((target) => target.url.includes("ai-node-canvas.html"));
    canvasClient = new CdpClient(restoredTarget.webSocketDebuggerUrl);
    const restored = await evaluate(canvasClient, `({ nodes: document.querySelectorAll('.node').length, title: document.title })`);
    const passed = persisted.saved > persisted.baseline
      && interaction.selected >= 2
      && persisted.backupStore
      && restored.nodes === persisted.saved
      && interaction.wheelMs < 5000;
    console.log(JSON.stringify({ passed, persisted, interaction, restored, userDataDir }, null, 2));
    log(`result: ${JSON.stringify({ passed, persisted, interaction, restored, userDataDir })}`);
    if (!passed) process.exitCode = 1;
  } finally {
    canvasClient?.close();
    shellClient?.close();
    child.kill();
  }
  setTimeout(() => process.exit(process.exitCode || 0), 400);
})().catch((error) => {
  try { fs.appendFileSync(logFile, `error: ${error.stack || error}\n`); } catch (writeError) {}
  console.error(error);
  process.exit(1);
});
