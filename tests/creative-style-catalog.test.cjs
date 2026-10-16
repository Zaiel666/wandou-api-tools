const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const html = fs.readFileSync(path.join(__dirname, '..', 'app', 'ai-node-canvas.html'), 'utf8');
const start = html.indexOf('    const creativeStyles = [');
const end = html.indexOf('    const builtInKeywordPresets = [', start);
assert.ok(start >= 0 && end > start, 'creative styles catalog is present');
const styles = vm.runInNewContext(`${html.slice(start, end)}\ncreativeStyles`);

const screenshotStyles = [
  '航拍视角', '收藏版铁盒', '重返80年代', '夸张漫画', '素描',
  '贴纸', '慕尼黑啤酒节怀旧', '拍照亭', 'Y2K数码相机风', '动漫',
  '70年代风格人像', '印象派绘画', '置顶合集', '水下', '3D头像',
  '丙烯画', '羊毛毡微缩模型', '塔罗牌', '雕像', '黏土动画世界',
  '拼装模型套件', '16位街机风格', '手写批注风格', '美妆指南', '涂鸦',
  '你的摇头娃娃', '迷你分身', '剖面图', '增强照片', '远方情结',
  '夜拍闪光', '蓝图海报', '色彩分析', '漫画', '动漫漫画',
  '奇幻报纸', '胶片条', '超写实壁纸'
];
const canonical = (name) => String(name).replace(/[\s·]/g, '').toLocaleLowerCase();

test('all image ideas in the supplied screenshot are available without duplicate entries', () => {
  const names = new Set(styles.map((style) => canonical(style.name)));
  screenshotStyles.forEach((name) => assert.ok(names.has(canonical(name)), `${name} is missing`));
  assert.equal(styles.length, 16 + screenshotStyles.length);
  assert.equal(new Set(styles.map((style) => style.id)).size, styles.length);
  assert.equal(names.size, styles.length);
  styles.forEach((style) => {
    assert.ok(style.note && style.prompt && style.mark && style.a, `${style.name} needs complete metadata`);
  });
});

test('older saved skill IDs retain their preview while the 38 new cards use the supplied image', () => {
  assert.equal(styles.find((style) => style.id === 'poster').name, '海报');
  assert.equal(styles.find((style) => style.id === 'logo').name, 'Logo');
  assert.equal(styles.filter((style) => Number.isInteger(style.sprite)).length, 16);
  assert.equal(styles.filter((style) => Number.isInteger(style.referenceIndex)).length, 38);
  assert.equal(styles.find((style) => style.id === 'aerial-view').referenceIndex, 0);
  assert.equal(styles.find((style) => style.id === 'photoreal-wallpaper').referenceIndex, 37);
  assert.match(html, /const hasSprite = Number\.isInteger\(style\.sprite\)/);
  assert.match(html, /creative-style-preview\$\{hasReference \? " reference" : hasSprite \? "" : " custom"\}/);
  assert.match(html, /creative-styles-reference\.png/);
  assert.ok(fs.statSync(path.join(__dirname, '..', 'app', 'assets', 'creative-styles-reference.png')).size > 100_000);
  assert.match(html, /data-creative-style-search/);
});

test('selector renders every unique skill with a searchable, accessible option', () => {
  const left = html.indexOf('    function creativeStyleOptionsHtml(');
  const right = html.indexOf('    function generatorSkillOptionsHtml(', left);
  assert.ok(left > 0 && right > left);
  const context = { creativeStyles:styles, escapeHtml:value => String(value).replace(/[&<>"']/g, '') };
  vm.createContext(context);
  vm.runInContext(html.slice(left, right), context);
  const markup = context.creativeStyleOptionsHtml({ creativeStyle:'aerial-view' });
  assert.equal((markup.match(/data-creative-style=/g) || []).length, styles.length + 1);
  assert.match(markup, /data-creative-style="aerial-view"[^>]*data-creative-search="航拍视角/);
  assert.match(markup, /creative-style-preview reference/);
  assert.match(markup, /aria-label="航拍视角：俯视构图与空间尺度"/);
  assert.match(markup, /data-creative-style="poster"/);
  assert.match(html, /class="creative-style-grid" data-creative-style-grid><\/div>/);
  assert.match(html, /creativeGrid\.innerHTML = creativeStyleOptionsHtml\(node\)/);
});

test('the canvas wheel handler leaves the skill picker scrollable', () => {
  assert.match(html, /\[data-creative-style-popover\]"\)\?\.addEventListener\("wheel", \(event\) => event\.stopPropagation\(\), \{ passive:true \}\)/);
  assert.match(html, /canvasWrap\.addEventListener\("wheel", \(event\) => \{\s*if \(event\.target\.closest\("\[data-creative-style-popover\]"\)\) return;/);
  assert.match(html, /\.creative-style-popover \{[^}]*overflow-y:auto; overscroll-behavior:contain;/);
});
