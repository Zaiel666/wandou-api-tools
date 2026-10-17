const test = require('node:test');
const assert = require('node:assert/strict');
const {plan} = require('../app/batch-image-core.js');
const slot = (name,n) => ({name,images:Array.from({length:n},(_,i)=>({url:`${name}-${i}`}))});
test('six references and two products produce twelve distinct ordered pairs',()=>{
  const tasks=plan([slot('参考图',6),slot('产品图',2)],'替换 @参考图 中的产品为 @产品图');
  assert.equal(tasks.length,12);
  assert.deepEqual(tasks[0].references.map(r=>r.url),['参考图-0','产品图-0']);
  assert.deepEqual(tasks[11].references.map(r=>r.url),['参考图-5','产品图-1']);
  assert.equal(new Set(tasks.map(t=>t.references.map(r=>r.url).join('|'))).size,12);
  assert.match(tasks[0].prompt,/@产品图 对应第 2 张输入图片/);
});
test('empty, duplicate and oversized configurations fail before requests',()=>{
  for(const slots of [[],[slot('a',0)],[slot('a',1),slot('a',1)],[slot('a',12),slot('b',11)],Array.from({length:7},(_,i)=>slot(String(i),1))])assert.throws(()=>plan(slots,'test'));
  assert.throws(()=>plan([slot('a',1)],' '));
});
test('six-slot combinations copy references and preserve-content is optional',()=>{
  const slots=Array.from({length:6},(_,i)=>slot(String(i),2));
  const tasks=plan(slots,'edit',false);assert.equal(tasks.length,64);assert.equal(tasks[0].references.length,6);
  tasks[0].references[0].url='changed';assert.equal(slots[0].images[0].url,'0-0');assert.doesNotMatch(tasks[0].prompt,/其余构图/);
});

test('optional model reference is ignored when empty and included when uploaded',()=>{
  const source=[slot('参考图',2),slot('产品图',2),{...slot('模特参考图',0),optional:true}];
  const without=plan(source,'替换产品和模特');
  assert.equal(without.length,4);
  assert.equal(without[0].references.length,2);
  assert.doesNotMatch(without[0].prompt,/@模特参考图 对应/);
  source[2]= {...slot('模特参考图',2),optional:true};
  const withModel=plan(source,'替换产品和模特');
  assert.equal(withModel.length,8);
  assert.equal(withModel[0].references.length,3);
  assert.match(withModel[0].prompt,/@模特参考图 对应第 3 张输入图片/);
  assert.match(withModel[0].prompt,/将画面中的模特替换为 @模特参考图/);
  assert.throws(()=>plan([...source.slice(0,2),{...slot('模特参考图',0),optional:true}],'替换 @模特参考图'));
});
