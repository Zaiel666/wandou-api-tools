const nodeTest = require('node:test');
const test = (name, run) => nodeTest(name, {timeout: 3000}, run);
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const source = fs.readFileSync(path.join(__dirname, '../app/ai-node-canvas.html'), 'utf8');
function block(start, end) {
  const from = source.indexOf(start);
  const to = source.indexOf(end, from);
  assert.ok(from >= 0 && to > from, `Missing source block: ${start}`);
  return source.slice(from, to);
}
function deferred() {
  let resolve, reject;
  const promise = new Promise((yes, no) => { resolve = yes; reject = no; });
  return { promise, resolve, reject };
}
const tick = () => new Promise(resolve => setImmediate(resolve));

function fixture() {
  const requests = [], writes = new Map(), timers = new Map(), toasts = [];
  let timerId = 0;
  const c = {
    console, AbortController, DOMException, URL,
    setTimeout(fn) { timers.set(++timerId, fn); return timerId; },
    clearTimeout(id) { timers.delete(id); },
    localStorage: { getItem: key => writes.get(key) || null, setItem: (key, value) => writes.set(key, value) },
    assistantConversationSaveRevisions: new Map(), currentFolderId: 'folder',
    assistantInput: {value: '你好', focus() {}}, assistantAttachments: [], assistantSending: false,
    assistantTask: null, assistantMessages: [], assistantModelOptions: [],
    apiKeyInput: {value: 'FAKE_ONE', focus() { c.focusedKey = 1; }},
    apiKey2Input: {value: 'FAKE_TWO', focus() { c.focusedKey = 2; }},
    apiUrlInput: {value: 'https://one.invalid'}, apiUrl2Input: {value: 'https://two.invalid'},
    assistantModelSelect: {value: 'gpt-6-astra · 渠道 2'},
    activeProjectId: 'A', projects: [{id: 'A', name: 'A'}, {id: 'B', name: 'B'}], nodes: [],
    renderAssistantAttachments() {}, renderAssistantConversation() {}, resizeAssistantInput() {},
    syncAssistantPicker() {}, renderAssistantModelOptions() {},
    assistantMessageContent: item => item.text,
    selectedAssistantSkillRules: async () => '', selectedAssistantCreativeSkillRules: () => '',
    persistMediaValue: async url => url, getLocalMedia: async url => url, localMediaPrefix: 'indexed-media:',
    warnCanvasStorageSkipped(error) { throw error; },
    promptModelCandidates: () => ['gpt-6-astra', 'gpt-4o'],
    postChatCompletion: async (url, headers, body, signal) => {
      const response = deferred(); requests.push({url, headers, body, signal, response}); return response.promise;
    },
    postPromptModelWithFallback: async (url, headers, body, signal, candidates) => {
      const response = deferred(); requests.push({url, headers, body:{...body, model:candidates?.[0]}, signal, response, candidates, fallback: true}); return response.promise;
    },
    extractText: () => '', extractMediaUrls: () => [], isRenderableImageUrl: () => false,
    addAssistantMediaResults() { c.mediaWrites++; }, maybeCreateAssistantCanvasNode() { c.nodeWrites++; },
    mediaWrites: 0, nodeWrites: 0,
    showToast: text => toasts.push(text), setSettingsOpen() { c.settingsOpened = true; },
    defaultApiBaseUrl: () => 'https://default.invalid',
  };
  vm.createContext(c);
  vm.runInContext([
    block('    function isDrawingModelId(', '    function isGeminiTtsModel('),
    block('    const channelTwoModelSuffix =', '    function modelProviderIconHtml('),
    block('    function applySyncedAssistantModels(', '    async function fetchModelsForApiChannel('),
    block('    function modelToApiModel(', '    function imageGenerationApiModel('),
    block('    function assistantConversationStorageKey(', '    function renderAssistantAttachments('),
    block('    async function sendAssistantMessage(', '    function getCanvasSnapshot('),
  ].join('\n'), c);
  return {c, requests, writes, timers, toasts};
}

test('explicit channels use their own credentials and strip the display suffix; channel 2 works alone', async () => {
  for (const channel of [1, 2]) {
    const {c, requests, timers} = fixture();
    c.assistantModelSelect.value = channel === 2 ? 'gpt-6-astra · 渠道 2' : 'gpt-4o';
    if (channel === 2) c.apiKeyInput.value = '';
    const pending = c.sendAssistantMessage('hello'); await tick();
    assert.equal(requests.length, 1);
    assert.equal(requests[0].url, channel === 2 ? 'https://two.invalid' : 'https://one.invalid');
    assert.equal(requests[0].headers.Authorization, channel === 2 ? 'Bearer FAKE_TWO' : 'Bearer FAKE_ONE');
    assert.equal(requests[0].body.model, channel === 2 ? 'gpt-6-astra' : 'gpt-4o');
    if (channel === 2) assert.equal(requests[0].body.temperature, undefined);
    requests[0].response.resolve({text: 'ok'}); await pending;
    assert.equal(c.assistantMessages.at(-1).text, 'ok'); assert.equal(timers.size, 0);
  }
});

test('missing selected channel key opens the matching input without consuming the draft', async () => {
  const {c, requests} = fixture(); c.apiKey2Input.value = '';
  await c.sendAssistantMessage('draft');
  assert.equal(c.focusedKey, 2); assert.equal(requests.length, 0);
  assert.equal(c.assistantMessages.length, 0); assert.equal(c.assistantInput.value, '你好');
});

test('auto selection without a model list supports channel 2 alone; no keys opens channel 1', async () => {
  const {c, requests} = fixture();
  c.assistantModelSelect.value = ''; c.apiKeyInput.value = ''; c.apiKey2Input.value = '';
  await c.sendAssistantMessage('no keys'); assert.equal(c.focusedKey, 1);
  c.apiKey2Input.value = 'FAKE_TWO';
  const pending = c.sendAssistantMessage('auto'); await tick();
  assert.equal(requests[0].fallback, true); assert.equal(requests[0].url, 'https://two.invalid');
  requests[0].response.resolve({text: 'ok'}); await pending;
});

test('non-chat selection does not consume text or attached images', async () => {
  const {c, requests} = fixture(); c.assistantModelSelect.value = 'gpt-image-2';
  c.assistantAttachments = [{url:'data:image/png;base64,fake'}];
  await c.sendAssistantMessage('draft');
  assert.equal(requests.length, 0); assert.equal(c.assistantAttachments.length, 1);
  assert.equal(c.assistantMessages.length, 0);
});

test('reference images retain numbered multimodal content and order after routing changes', async () => {
  const {c, requests} = fixture();
  vm.runInContext(block('    function assistantMessageContent(', '    async function selectedAssistantSkillRules('), c);
  c.isRenderableImageUrl = url => url.startsWith('data:image/');
  const images = ['data:image/png;base64,first', 'data:image/png;base64,second'];
  c.assistantAttachments = images.map(url => ({url}));
  const pending = c.sendAssistantMessage('compare'); await tick();
  const content = requests[0].body.messages.at(-1).content;
  assert.deepEqual(Array.from(content.filter(item => item.type === 'image_url'), item => item.image_url.url), images);
  assert.deepEqual(Array.from(content.filter(item => item.type === 'text'), item => item.text), ['compare', '参考图 1', '参考图 2']);
  requests[0].response.resolve({text:'ok'}); await pending;
});

test('real project switch cancels before canvas restoration, but a failed save keeps the original request', async () => {
  const {c, requests} = fixture(); const restore = deferred(); let saved = false;
  Object.assign(c, {
    saveCanvasState: async () => saved, clearPsdRuntimeState() {}, saveProjects() {},
    restoreOrSeedCanvas: () => restore.promise, renderProjects() {}, canvasRecoveryBlocked:false,
  });
  vm.runInContext(block('    async function switchProject(', '    async function deleteProject('), c);
  const pending = c.sendAssistantMessage('A'); await tick();
  await c.switchProject('B'); assert.equal(c.activeProjectId, 'A'); assert.equal(requests[0].signal.aborted, false);
  saved = true; const switching = c.switchProject('B'); await tick();
  assert.equal(c.activeProjectId, 'B'); assert.equal(requests[0].signal.aborted, true);
  requests[0].response.resolve({text:'late'}); await pending;
  restore.resolve(); await switching;
  assert.equal(c.assistantMessages.length, 0);
});

test('a slow image persistence from an old save cannot overwrite cleared conversation', async () => {
  const {c, writes} = fixture(); const media = deferred();
  c.persistMediaValue = () => media.promise;
  c.assistantMessages = [{role:'user', text:'old', images:['data:image/png;base64,fake']}];
  const oldSave = c.saveAssistantConversation();
  c.clearAssistantConversation(); await tick();
  media.resolve('indexed-media:saved'); await oldSave;
  assert.equal(writes.get('aiCanvasAssistantV1:folder:A'), '[]');
});

test('auto model selection uses a configured channel and excludes non-chat models', async () => {
  const {c, requests} = fixture();
  c.apiKeyInput.value = ''; c.assistantModelSelect.value = '';
  c.applySyncedAssistantModels(['gpt-image-2', 'text-embedding-3-large', 'gpt-4o-mini-tts'], ['sora-2', 'gpt-6-astra']);
  assert.deepEqual(Array.from(c.assistantModelOptions), ['gpt-6-astra · 渠道 2']);
  const pending = c.sendAssistantMessage('auto'); await tick();
  assert.equal(requests[0].url, 'https://two.invalid'); assert.equal(requests[0].body.model, 'gpt-6-astra');
  assert.equal(requests[0].fallback, true);
  requests[0].response.resolve({text: 'ok'}); await pending;
});

test('auto retry uses synced candidates from one channel and stops on authorization errors', async () => {
  for (const firstError of ['HTTP 404 model not found', 'HTTP 403']) {
    const {c, timers} = fixture(); const attempts = [];
    c.assistantModelSelect.value = '';
    c.applySyncedAssistantModels(['other-chat'], ['gpt-6-astra', 'gpt-4o']);
    c.promptModelAttemptTimeoutMs = 10000;
    c.modelToPromptModel = c.modelToApiModel;
    vm.runInContext(block('    function shouldStopPromptModelFallback(', '    function drawingSkillOptions('), c);
    c.postChatCompletion = async (url, headers, body) => {
      attempts.push({url, headers, body});
      if (attempts.length === 1) throw new Error(firstError);
      return {text: 'retried'};
    };
    await c.sendAssistantMessage('auto');
    assert.equal(attempts.length, firstError.includes('403') ? 1 : 2);
    assert.ok(attempts.every(item => item.url === 'https://two.invalid' && item.headers.Authorization === 'Bearer FAKE_TWO'));
    assert.equal(attempts[0].body.model, 'gpt-6-astra');
    if (attempts.length === 2) assert.equal(attempts[1].body.model, 'gpt-4o');
    assert.equal(timers.size, 0);
  }
});

test('switching conversation aborts A; its late response cannot change B or release B sending state', async () => {
  const {c, requests, writes, timers} = fixture();
  const old = c.sendAssistantMessage('A question'); await tick();
  c.activeProjectId = 'B'; c.loadAssistantConversation();
  assert.equal(requests[0].signal.aborted, true);
  const next = c.sendAssistantMessage('B question'); await tick();
  requests[0].response.resolve({text: 'A answer'}); await old;
  assert.equal(c.assistantSending, true);
  assert.deepEqual(Array.from(c.assistantMessages, m => m.text), ['B question']);
  assert.equal(c.mediaWrites, 0); assert.equal(c.nodeWrites, 0);
  requests[1].response.resolve({text: 'B answer'}); await next; await tick();
  assert.equal(JSON.parse(writes.get('aiCanvasAssistantV1:folder:B')).at(-1).text, 'B answer');
  assert.ok(!writes.get('aiCanvasAssistantV1:folder:B').includes('A answer'));
  assert.equal(timers.size, 0);
});

test('project identity guard rejects response even before the destination conversation has loaded', async () => {
  const {c, requests} = fixture(); const pending = c.sendAssistantMessage('A'); await tick();
  c.activeProjectId = 'B'; requests[0].response.resolve({text: 'late'}); await pending;
  assert.ok(!c.assistantMessages.some(m => m.text === 'late')); assert.equal(c.nodeWrites, 0);
});

test('clear aborts the request; delayed response cannot resurrect cleared history', async () => {
  const {c, requests, writes} = fixture(); const pending = c.sendAssistantMessage('old'); await tick();
  c.clearAssistantConversation(); requests[0].response.resolve({text: 'late'}); await pending; await tick();
  assert.equal(requests[0].signal.aborted, true); assert.equal(c.assistantMessages.length, 0);
  assert.equal(writes.get('aiCanvasAssistantV1:folder:A'), '[]');
});

test('cancellation while skill loads does not send a request; double-send cannot create a second task', async () => {
  const {c, requests, timers} = fixture(); const skill = deferred();
  c.selectedAssistantSkillRules = () => skill.promise;
  const first = c.sendAssistantMessage('one'); await c.sendAssistantMessage('two');
  c.clearAssistantConversation(); await first;
  skill.resolve('rules'); await tick();
  assert.equal(requests.length, 0); assert.equal(timers.size, 0);
});

test('timeout settles even when transport ignores abort; error is stored but never sent as model context', async () => {
  const {c, requests, timers, writes} = fixture();
  const first = c.sendAssistantMessage('one'); await tick();
  for (const timeout of [...timers.values()]) timeout();
  await first; await tick();
  assert.equal(c.assistantSending, false); assert.equal(requests[0].signal.aborted, true);
  assert.equal(c.assistantMessages.at(-1).status, 'error');
  c.loadAssistantConversation();
  assert.equal(c.assistantMessages.at(-1).status, 'error');
  const second = c.sendAssistantMessage('retry'); await tick();
  assert.ok(!requests[1].body.messages.some(m => /超时|发送失败/.test(m.content)));
  requests[1].response.resolve({text: 'done'}); await second;
  requests[0].response.resolve({text: 'too late'}); await tick();
  assert.ok(!writes.get('aiCanvasAssistantV1:folder:A').includes('too late'));
});

test('API failure can retry and freezes model/project settings before asynchronous skill loading', async () => {
  const {c, requests} = fixture(); const skill = deferred();
  c.selectedAssistantSkillRules = () => skill.promise;
  const first = c.sendAssistantMessage('one');
  c.assistantModelSelect.value = 'gpt-4o'; c.apiKey2Input.value = 'CHANGED';
  skill.resolve('rules'); await tick();
  assert.equal(requests[0].body.model, 'gpt-6-astra');
  assert.equal(requests[0].headers.Authorization, 'Bearer FAKE_TWO');
  requests[0].response.reject(new Error('HTTP 403')); await first;
  assert.equal(c.assistantSending, false); assert.equal(c.assistantMessages.at(-1).status, 'error');
  const retry = c.sendAssistantMessage('retry'); await tick();
  requests[1].response.resolve({text: 'done'}); await retry;
  assert.equal(c.assistantMessages.at(-1).text, 'done');
});
