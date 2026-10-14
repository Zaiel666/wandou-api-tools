const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const source = fs.readFileSync(path.join(__dirname, '../app/ai-node-canvas.html'), 'utf8');
function block(start,end){const a=source.indexOf(start),b=source.indexOf(end,a);assert.ok(a>=0&&b>a);return source.slice(a,b);}
function fixture(){
  const requests=[];
  const c={Blob,TextDecoder,Uint8Array,FormData,
    modelToApiModel:value=>String(value).replace(/ · 渠道 2$/,''),isGeminiTtsModel:model=>/gemini.*tts/i.test(model),
    apiProfileForModel:model=>({key:'FAKE',url:model.includes('渠道 2')?'https://two.invalid':'https://one.invalid'}),
    normalizeApiEndpoint:base=>`${base}/v1/audio/speech`,
    blobToDataUrl:async blob=>`data:${blob.type};base64,${Buffer.from(await blob.arrayBuffer()).toString('base64')}`,
    extractAudioResponse:async payload=>payload?.audio_url?{url:payload.audio_url,mimeType:'audio/mpeg'}:null,
    callGeminiTtsApi:async(node,signal,profile)=>({node,profile,url:'gemini'}),
    fetchMaybeProxied:async(url,options)=>{requests.push({url,...options});return c.response;},
    response:new Response('ID3fake',{headers:{'content-type':'audio/mpeg'}}),
  };
  vm.createContext(c);
  for(const name of ['geminiAudioVoiceOptions','openAiAudioVoiceOptions','audioFormatOptions'])
    vm.runInContext(source.match(new RegExp(`const ${name} = [^;]+;`))[0],c);
  vm.runInContext(block('    function audioVoiceOptionsForModel(', '    function audioModelPriority(')
    +block('    function audioModelSupportsReference(', '    function renderAudioBody(')
    +block('    async function callAudioApi(', '    async function callApi('),c);
  return {c,requests};
}
test('legacy TTS excludes unsupported voices and normalizes stale Gemini voice settings',async()=>{
  const {c,requests}=fixture();
  assert.ok(!c.audioVoiceOptionsForModel('tts-1-hd').includes('marin'));
  await c.callAudioApi({model:'tts-1-hd',prompt:'hello',audioVoice:'Kore',audioInstruction:'soft'});
  const body=JSON.parse(requests[0].body);assert.equal(body.voice,'alloy');assert.equal(body.instructions,undefined);
});
test('GPT speech keeps supported voice and instruction and sends JSON through selected channel',async()=>{
  const {c,requests}=fixture();
  await c.callAudioApi({model:'gpt-4o-mini-tts · 渠道 2',prompt:'hello',audioVoice:'cedar',audioInstruction:'soft',audioFormat:'flac',audioSpeed:1.25});
  const body=JSON.parse(requests[0].body);assert.equal(body.model,'gpt-4o-mini-tts');assert.equal(body.voice,'cedar');assert.equal(body.instructions,'soft');
  assert.equal(requests[0].url,'https://two.invalid/v1/audio/speech');assert.equal(body.speed,1.25);
});
test('invalid input fails before a paid request and does not truncate the original text',async()=>{
  const {c,requests}=fixture();
  for(const patch of [{prompt:'x'.repeat(4097)},{audioSpeed:Infinity},{audioSpeed:0},{audioFormat:'bad'}]){
    const node={model:'gpt-4o-mini-tts',prompt:'hello',...patch};const original=node.prompt;
    await assert.rejects(c.callAudioApi(node));assert.equal(node.prompt,original);
  }
  assert.equal(requests.length,0);
});
test('unknown model does not imply permission to send reference audio using guessed multipart fields',async()=>{
  const {c,requests}=fixture();
  await c.callAudioApi({model:'custom-tts',prompt:'hello',audioVoice:'custom-voice',references:[{url:'private recording'}]});
  const body=JSON.parse(requests[0].body);assert.equal(body.voice,'custom-voice');assert.equal(body.reference_audio,undefined);assert.equal(body.audio,undefined);
  assert.equal(c.audioModelSupportsReference('custom-tts'),false);
});
test('octet-stream receives usable MIME and real WAV signature takes precedence over requested format',async()=>{
  const {c}=fixture();
  c.response=new Response('fLaCbytes',{headers:{'content-type':'application/octet-stream'}});
  assert.equal((await c.callAudioApi({model:'tts-1',prompt:'hello',audioFormat:'flac'})).mimeType,'audio/flac');
  c.response=new Response('RIFFxxxxWAVEdata',{headers:{'content-type':'application/octet-stream'}});
  assert.equal((await c.callAudioApi({model:'tts-1',prompt:'hello'})).mimeType,'audio/wav');
});
test('empty, HTML and JSON errors mislabeled as audio never become playable success',async()=>{
  const {c}=fixture();
  for(const content of ['', '<html>gateway error</html>', '{"error":"quota"}']){
    c.response=new Response(content,{headers:{'content-type':'audio/mpeg'}});
    await assert.rejects(c.callAudioApi({model:'tts-1',prompt:'hello'}));
  }
});
test('JSON audio URL remains supported and Gemini keeps its separate adapter',async()=>{
  const {c,requests}=fixture();
  c.response=new Response('{"audio_url":"https://audio.invalid/out.mp3"}',{headers:{'content-type':'application/json'}});
  assert.equal((await c.callAudioApi({model:'tts-1',prompt:'hello'})).url,'https://audio.invalid/out.mp3');
  const gemini=await c.callAudioApi({model:'gemini-tts',prompt:'hello',audioFormat:'wav',audioVoice:'Kore'});
  assert.equal(gemini.url,'gemini');assert.equal(requests.length,1);
});
