const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const source = fs.readFileSync(path.join(__dirname, '..', 'app', 'ai-node-canvas.html'), 'utf8');
function loadFunction(start, end, name) {
  const left = source.indexOf(start);
  const right = source.indexOf(end, left);
  assert.ok(left > 0 && right > left, `source for ${name} must exist`);
  return vm.runInNewContext(`${source.slice(left, right)}\n${name}`);
}
const plan = loadFunction('function psdLayerPlan(raw)', 'function psdVisionModelCandidates()', 'psdLayerPlan');
const rectangles = loadFunction('function vectorRectanglesFromRuns(runs)', 'function vectorPixelRuns(sourceCanvas)', 'vectorRectanglesFromRuns');
const retainsPixels = loadFunction('function psdLayerRetainsEnoughPixels(before, after, category)', 'function psdMakeObjectLayersDisjoint(layerCanvases, layers)', 'psdLayerRetainsEnoughPixels');
const reviewSource = source.slice(source.indexOf('function psdReviewSourceKey('), source.indexOf('function renderPsdBody('));

test('PSD review excludes rejected objects and blocks invalid positions', () => {
  const node = {id:7};
  const review = {node, projectId:'p', folderId:'f', sourceKey:'image', layers:[
    {name:'标题', category:'text', bounds:[10,20,300,50], selected:true},
    {name:'误识别', category:'element', bounds:[400,20,100,100], selected:false}
  ]};
  const context = {psdReviewPlans:new Map([[7,review]]), activeProjectId:'p', currentFolderId:'f'};
  vm.createContext(context);
  vm.runInContext(`${reviewSource}\nthis.getReview=psdReviewForNode;this.selected=psdReviewedLayers;`, context);
  assert.equal(context.selected(context.getReview(node,{url:'image'})).length,1);
  assert.equal(context.selected(review)[0].name,'标题');
  review.layers[0].bounds=[900,20,300,50];
  assert.throws(() => context.selected(review), /位置无效/);
  review.layers[0].selected=false;
  assert.throws(() => context.selected(review), /至少勾选一个/);
  assert.equal(context.getReview(node,{url:'another'}),null);
  assert.equal(context.psdReviewPlans.size,0);
  const other = {id:9, psdReview:{sourceKey:'outdated', layers:[]}};
  assert.equal(context.getReview(other,{url:'new-image'}),null);
  assert.equal(other.psdReview,undefined);
});

test('PSD review is restored for the same image and invalidated for a replacement image', () => {
  const node = {id:8, psdReview:{sourceKey:'original', width:100, height:100,
    layers:[{name:'主体', category:'subject', bounds:[10,10,200,200], selected:true}]}};
  const context = {psdReviewPlans:new Map(), activeProjectId:'p', currentFolderId:'f'};
  vm.createContext(context);
  vm.runInContext(`${reviewSource}\nthis.getReview=psdReviewForNode;`, context);
  assert.equal(context.getReview(node,{url:'original'}).layers[0].name,'主体');
  assert.equal(context.psdReviewPlans.size,1);
  assert.equal(context.getReview(node,{url:'replacement'}),null);
  assert.equal(node.psdReview,undefined);
  assert.equal(context.psdReviewPlans.size,0);
});

test('PSD rejects overflow instead of inventing locationless combined layers', () => {
  const layers = Array.from({length:17}, (_, index) => ({name:`对象 ${index + 1}`, category:'element', bounds:[index * 30, 10, 20, 20]}));
  assert.throws(() => plan(JSON.stringify({layers})), /17 个独立对象.*16 层上限/);
});

test('PSD text requires valid bounds before paid mask generation', () => {
  assert.throws(() => plan(JSON.stringify({layers:[{name:'主标题', category:'text'}]})), /缺少有效位置范围/);
  const valid = plan(JSON.stringify({layers:[{name:'主标题', category:'text', bounds:[100, 200, 300, 100]}]}));
  assert.equal(valid.length, 1);
  assert.equal(valid[0].name, '主标题');
});

test('PSD refuses a nearly erased object while allowing intentional lighting overlap', () => {
  assert.equal(retainsPixels(.05, .001, 'subject'), false);
  assert.equal(retainsPixels(.05, .015, 'text'), true);
  assert.equal(retainsPixels(.05, .001, 'lighting'), true);
});

test('vector vertical coalescing preserves each source pixel and separates gaps', () => {
  const runs = [[1,0,3],[1,1,3],[6,1,2],[1,2,3],[6,2,2],[1,4,3]];
  const result = rectangles(runs);
  assert.equal(result.length, 3);
  const raster = items => {
    const pixels = new Set();
    for (const item of items) {
      const [x,y,width,height] = Array.isArray(item) ? [...item,1] : [item.x,item.y,item.width,item.height];
      for (let row=y; row<y+height; row++) for (let column=x; column<x+width; column++) pixels.add(`${column}:${row}`);
    }
    return [...pixels].sort();
  };
  assert.deepEqual(raster(result), raster(runs));
  assert.equal(rectangles(Array.from({length:200}, (_, y) => [0,y,30])).length, 1);
});
