(function (root) {
  'use strict';
  const GATEWAY = 'https://www.zayapi.top';
  const OFFICIAL = 'https://api.openai.com/v1';
  const ids = ['channel1', 'channel2'];
  const gatewayHosts = new Set(['zayapi.top', 'www.zayapi.top', 'zexitongxue.com', 'www.zexitongxue.com']);
  function gatewayUrl(value) {
    try {
      const url = new URL(value || GATEWAY);
      if (url.protocol !== 'https:' || url.username || url.password || url.port || !gatewayHosts.has(url.hostname.toLowerCase())) return GATEWAY;
      return url.origin + (/^\/v1\/?$/.test(url.pathname) ? '/v1' : '');
    } catch (_) { return GATEWAY; }
  }
  function normalize(value = {}) {
    if (!value || typeof value !== 'object') value = {};
    const channels = {};
    for (const [index, id] of ids.entries()) {
      const saved = value.channels?.[id];
      const legacyKey = index ? value.key2 : value.key;
      channels[id] = {
        provider: saved?.provider === 'openai' ? 'openai' : 'gateway',
        gateway: { key: String(saved?.gateway?.key ?? (saved ? '' : legacyKey || '')).trim(), url: gatewayUrl(saved?.gateway?.url || value.url) },
        openai: { key: String(saved?.openai?.key || '').trim() }
      };
    }
    // Legacy readers always see gateway credentials, never the selected official key.
    return { url: channels.channel1.gateway.url, key: channels.channel1.gateway.key, key2: channels.channel2.gateway.key, channels, savedAt: String(value.savedAt || '') };
  }
  function profile(value, id = 'channel1') {
    const config = normalize(value), channelId = ids.includes(id) ? id : 'channel1';
    const channel = config.channels[channelId], official = channel.provider === 'openai';
    return { id: channelId, label: channelId === 'channel2' ? '渠道 2' : '渠道 1', provider: channel.provider,
      url: official ? OFFICIAL : channel.gateway.url, key: official ? channel.openai.key : channel.gateway.key };
  }
  function update(value, id, patch = {}) {
    const config = normalize(value), channel = config.channels[id];
    if (!channel) throw new Error('未知 API 渠道');
    if (Object.hasOwn(patch, 'key')) channel[channel.provider].key = String(patch.key || '').trim();
    if (Object.hasOwn(patch, 'provider')) {
      if (patch.provider !== 'gateway' && patch.provider !== 'openai') throw new Error('不支持此 API 服务');
      channel.provider = patch.provider;
    }
    return normalize(config);
  }
  function mount({ config = {}, keyInputs = [], urlInputs = [], isBusy = () => false, onChange = () => {}, onBlocked = () => {} } = {}) {
    let state = normalize(config);
    const selects = [], notes = [];
    function remember() {
      ids.forEach((id, index) => { if (keyInputs[index]) state = update(state, id, { key: keyInputs[index].value }); });
    }
    function paint(index) {
      const id = ids[index], current = profile(state, id), input = keyInputs[index];
      if (input) {
        input.value = current.key;
        input.type = 'password';
        input.classList.remove('api-key-revealed');
        input.style.webkitTextSecurity = '';
        input.placeholder = current.provider === 'openai' ? '粘贴 OpenAI 官方 API Key' : `粘贴${current.label} API Key`;
        const visibility = input.parentElement?.querySelector('[data-api-key-visibility]');
        if (visibility) { visibility.setAttribute('aria-pressed', 'false'); visibility.setAttribute('aria-label', `显示${current.label}密钥`); visibility.title = '显示密钥'; }
      }
      if (urlInputs[index]) urlInputs[index].value = current.url;
      if (selects[index]) selects[index].value = current.provider;
      if (notes[index]) notes[index].textContent = current.provider === 'openai'
        ? '直连 api.openai.com，仅用于绘图。请填写官方密钥；与第三方密钥分别保留。'
        : '使用现有第三方渠道。新模型及 SVG 输出是否可用，取决于该渠道支持情况。';
    }
    ids.forEach((id, index) => {
      const card = keyInputs[index]?.closest('.api-channel-card');
      if (!card) return;
      card.querySelector('[data-image-provider-row]')?.remove();
      const row = document.createElement('div'); row.className = 'image-provider-row'; row.dataset.imageProviderRow = id;
      const label = document.createElement('label'); label.htmlFor = `imageProvider-${id}`; label.textContent = '服务来源';
      const select = document.createElement('select'); select.id = label.htmlFor; select.dataset.imageProvider = id;
      for (const [value, text] of [['gateway', '现有第三方渠道'], ['openai', 'OpenAI 官方（绘图）']]) {
        const option = document.createElement('option'); option.value = value; option.textContent = text; select.appendChild(option);
      }
      row.append(label, select);
      const note = document.createElement('p'); note.className = 'image-provider-note'; note.id = `imageProviderNote-${id}`;
      select.setAttribute('aria-describedby', note.id);
      card.querySelector('.api-channel-help')?.setAttribute('hidden', '');
      card.insertBefore(row, card.querySelector('.api-key-row'));
      card.insertBefore(note, card.querySelector('.api-key-row'));
      selects[index] = select; notes[index] = note;
      select.addEventListener('change', () => {
        const next = select.value;
        if (isBusy()) { select.value = state.channels[id].provider; onBlocked('请等待当前任务结束，再切换 API 服务'); return; }
        remember(); state = update(state, id, { provider: next }); paint(index);
        onChange({ id, provider: next, config: normalize(state) });
      });
      paint(index);
    });
    return {
      snapshot() { remember(); return normalize(state); },
      profile(id) { remember(); return profile(state, id); },
      load(next) { state = normalize(next); ids.forEach((_, index) => paint(index)); },
      dispose() { ids.forEach((_, index) => { selects[index]?.closest('[data-image-provider-row]')?.remove(); notes[index]?.remove(); }); }
    };
  }
  const api = Object.freeze({ normalize, profile, update, mount, gatewayUrl, GATEWAY, OFFICIAL });
  root.WandouImageChannels = api;
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
})(globalThis);
