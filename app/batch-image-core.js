/* Shared batch planning, with no network or canvas side effects. */
(function (root) {
  const MAX_TASKS = 120;
  function plan(slots, prompt, preserve = true) {
    if (!slots.length || slots.length > 6) throw new Error('请添加 1–6 个图片槽位。');
    const names = slots.map(s => String(s.name || '').trim());
    if (names.some(n => !n || /[@\n\r]/.test(n)) || new Set(names).size !== names.length) throw new Error('槽位名称不能为空、重复或包含 @。');
    if (slots.some(s => !s.optional && !s.images.length)) throw new Error('必填槽位需要图片；不用的槽位请删除。');
    if (!prompt.trim()) throw new Error('请填写改图要求。');
    const activeSlots = slots.filter(s => s.images.length);
    if (!activeSlots.length) throw new Error('请至少上传一张图片。');
    const missingReference = slots.find(s => s.optional && !s.images.length && prompt.includes(`@${s.name.trim()}`));
    if (missingReference) throw new Error(`请先上传 ${missingReference.name}，或从改图要求中移除对应引用。`);
    const count = activeSlots.reduce((n, s) => n * s.images.length, 1);
    if (count > MAX_TASKS) throw new Error(`共 ${count} 个任务，单批最多 ${MAX_TASKS} 个，请减少图片。`);
    let combinations = [[]];
    activeSlots.forEach(s => { combinations = combinations.flatMap(row => s.images.map(image => [...row, {...image}])); });
    return combinations.map((references, index) => ({
      title: `批量改图 ${index + 1}/${count}`,
      references,
      prompt: `${activeSlots.map((slot, i) => `@${slot.name.trim()} 对应第 ${i + 1} 张输入图片（图${i + 1}）。`).join('\n')}\n${prompt.trim()}${activeSlots.some(slot => slot.optional && slot.name.trim() === '模特参考图') ? '\n将画面中的模特替换为 @模特参考图 中的人物，保持产品信息准确。' : ''}${preserve ? '\n仅修改要求中指定的内容，其余构图、文字、背景和细节保持不变。' : ''}`
    }));
  }
  const api = {plan, MAX_TASKS};
  if (typeof module === 'object' && module.exports) module.exports = api;
  else root.WandouBatchCore = api;
})(typeof window === 'object' ? window : globalThis);
