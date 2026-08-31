const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");

const app = path.join(__dirname, "..", "app");
const projectHub = fs.readFileSync(path.join(app, "project-hub.html"), "utf8");
const assets = fs.readFileSync(path.join(app, "asset-library.css"), "utf8");
const home = fs.readFileSync(path.join(app, "index.html"), "utf8");
const styles = fs.readFileSync(path.join(app, "styles.css"), "utf8");
const canvas = fs.readFileSync(path.join(app, "ai-node-canvas.html"), "utf8");
const main = fs.readFileSync(path.join(__dirname, "..", "desktop-client", "main.js"), "utf8");

test("project and asset pages use the full desktop viewport", () => {
  assert.match(projectHub, /\.shell\s*\{[\s\S]*?width:\s*100%;[\s\S]*?max-width:\s*none;/);
  assert.match(assets, /\.asset-shell\s*\{[^}]*width:\s*100%;[^}]*max-width:\s*none;/);
});

test("home header no longer exposes the cache-clear action", () => {
  assert.doesNotMatch(home, /data-cache-clear/);
});

test("contact card keeps only centered WeChat and QR content", () => {
  assert.match(home, /微信：peafour1111/);
  assert.match(home, /assets\/wechat-qr\.png/);
  assert.doesNotMatch(home, /zl779584477@outlook\.com/);
  assert.doesNotMatch(home, /充值请联系我/);
  assert.match(styles, /\.contact-card\s*\{[\s\S]*?justify-items:\s*center;[\s\S]*?text-align:\s*center;/);
});

test("common dialogs and announcement cards use neutral opaque surfaces", () => {
  assert.match(styles, /--neutral-surface:\s*#ffffff/);
  assert.match(styles, /\.api-dialog,[\s\S]*?background:\s*var\(--neutral-surface\)/);
  assert.match(styles, /\.announcement-intro-card[\s\S]*?background:\s*var\(--neutral-surface\)/);
  assert.match(styles, /\.service-dialog-card,[\s\S]*?background:\s*var\(--neutral-surface\)/);
});

test("offscreen result media is decoded only near the viewport", () => {
  assert.match(canvas, /new IntersectionObserver/);
  assert.match(canvas, /root:\s*canvasWrap,\s*rootMargin:\s*"360px"/);
  assert.match(canvas, /data-canvas-media=/);
  assert.match(canvas, /preload="none"/);
  assert.match(canvas, /media\.removeAttribute\("src"\)/);
});

test("legacy oversized backup snapshots are not parsed on normal startup", () => {
  assert.match(main, /stats\.size > 12 \* 1024 \* 1024/);
  assert.match(main, /if \(states\.length >= 3\) break/);
});
