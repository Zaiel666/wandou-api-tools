/* Reuse production handlers; this layer only rearranges their existing elements. */
(() => {
  const originalRenderNode = renderNode;
  // Remember UI state only, so re-renders do not replay success/selection effects.
  // No listeners dispatch actions: the original controls remain authoritative.
  const motionState = new Map();
  const refinePulse = new Map();
  const decorateMotion = (element, node) => {
    element.querySelectorAll('.node-menu button,.prompt-corner-tools button,.node-select-trigger,[data-generate],.test-stepper button').forEach(button => button.classList.add('test-motion-button'));
    const key = node.id || element.dataset.id;
    const previous = key ? motionState.get(key) : null;
    const favorite = element.querySelector('.node-menu [data-favorite]');
    if (favorite) {
      favorite.setAttribute('aria-pressed', String(!!node.favorite));
      if (previous && previous.favorite !== !!node.favorite) favorite.classList.add('test-motion-toggled');
    }
    const count = Number(node.count || 1);
    const output = element.querySelector('.test-stepper output');
    if (output && previous && previous.count !== count) {
      output.classList.add(count > previous.count ? 'test-count-up' : 'test-count-down');
    }
    if (key) {
      for (const [selector, property] of [['[data-auto-split-toggle]', 'autoSplit'], ['[data-transparent-background-toggle]', 'transparentBackground']]) {
        if (previous && previous[property] !== !!node[property]) element.querySelector(selector)?.classList.add('test-switch-changed');
      }
      motionState.set(key, {favorite:!!node.favorite, count, autoSplit:!!node.autoSplit, transparentBackground:!!node.transparentBackground});
      // Bound memory even after many deleted nodes or project switches.
      if (motionState.size > 2000) motionState.delete(motionState.keys().next().value);
    }
    return element;
  };
  const icon = (name, color = '') => {
    const image = document.createElement('img');
    image.className = 'ui-icon' + (color ? ' ' + color : '');
    image.src = './assets/canvas-ui-icons/' + name + '.svg';
    image.alt = '';
    image.setAttribute('aria-hidden', 'true');
    image.draggable = false;
    return image;
  };
  const labelButton = (button, text, name, iconOnly = false) => {
    if (!button) return;
    button.replaceChildren(icon(name));
    const label = document.createElement('span');
    label.textContent = text;
    if (!iconOnly) button.append(label);
    button.title = text;
    button.setAttribute('aria-label', text);
  };
  // Adapted visual details from Lucian #002/#013; see third-party notice.
  // Keep the real button and its existing action handler, never a demo timer.
  const decorateGenerate = button => {
    if (!button || button.classList.contains('test-generate')) return;
    const label = document.createElement('span');
    label.className = 'test-generate-label';
    label.textContent = button.textContent.trim();
    const fill = document.createElement('span');
    fill.className = 'test-generate-fill';
    fill.setAttribute('aria-hidden', 'true');
    const orb = document.createElement('span');
    orb.className = 'test-generate-orb';
    orb.setAttribute('aria-hidden', 'true');
    orb.innerHTML = '<svg viewBox="0 0 24 24"><path d="M5 12h13M13 6l6 6-6 6"/></svg><svg viewBox="0 0 24 24"><path d="M5 12h13M13 6l6 6-6 6"/></svg>';
    button.replaceChildren(fill, label, orb);
    button.classList.add('test-generate');
    const reset = () => { label.style.translate = orb.style.translate = '0px 0px'; };
    button.addEventListener('pointermove', event => {
      if (button.disabled || button.classList.contains('generating') || event.pointerType !== 'mouse' || !window.matchMedia?.('(hover:hover) and (pointer:fine)').matches || window.matchMedia?.('(prefers-reduced-motion:reduce)').matches) { reset(); return; }
      const rect = button.getBoundingClientRect();
      const scale = rect.width / button.offsetWidth || 1;
      const dx = (event.clientX - rect.left - rect.width / 2) / scale;
      const dy = (event.clientY - rect.top - rect.height / 2) / scale;
      // Interior parallax only: the canvas button's hit target must stay still.
      label.style.translate = `${Math.max(-4, Math.min(4, dx * .05))}px ${Math.max(-2, Math.min(2, dy * .08))}px`;
      orb.style.translate = `${Math.max(-3, Math.min(3, dx * .1))}px ${Math.max(-2, Math.min(2, dy * .14))}px`;
    });
    button.addEventListener('pointerleave', reset);
    button.addEventListener('pointercancel', reset);
    const press = event => {
      if (button.disabled || button.classList.contains('generating') || (event.type === 'pointerdown' && event.button !== 0) || (event.type === 'keydown' && !['Enter', ' '].includes(event.key))) return;
      button.classList.add('test-generate-fired');
    };
    button.addEventListener('pointerdown', press);
    button.addEventListener('keydown', press);
    orb.addEventListener('animationend', () => button.classList.remove('test-generate-fired'));
  };
  const decorateSwitches = (element, node) => {
    for (const [selector, property, name] of [['[data-auto-split-toggle]', 'autoSplit', '自动拆分'], ['[data-transparent-background-toggle]', 'transparentBackground', '透明背景']]) {
      const button = element.querySelector(selector);
      if (!button) continue;
      button.classList.add('test-switch');
      button.setAttribute('role', 'switch');
      button.setAttribute('aria-checked', String(!!node[property]));
      button.setAttribute('aria-label', name);
      button.title = button.disabled ? '当前模型不支持透明背景' : `${name}：${node[property] ? '已开启' : '已关闭'}`;
      button.innerHTML = '<span class="test-switch-knob" aria-hidden="true"><svg viewBox="0 0 24 24"><path class="test-switch-off" d="M7.5 7.5l9 9M16.5 7.5l-9 9"/><path class="test-switch-on" d="M5.5 12.5l4.5 4.5 8.5-9"/></svg></span>';
      if(node.type === 'generator') {
        button.classList.add('test-pill-toggle');
        button.innerHTML='<svg class="test-pill-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" aria-hidden="true">'+(property==='transparentBackground'?'<path d="m4 15 9-10 7 7-7 8H9zM8 11l7 7M13 20h8"/>':'<rect x="3" y="3" width="7" height="7" rx="2"/><rect x="14" y="3" width="7" height="7" rx="2"/><rect x="3" y="14" width="7" height="7" rx="2"/><rect x="14" y="14" width="7" height="7" rx="2"/>')+'</svg><span>'+(node[property]?'已开启':'开启')+'</span>';
      }
    }
    const hint = element.querySelector('.auto-split-hint');
    if (hint) { hint.title = hint.textContent; hint.textContent = '拆分 1–99 张 · 独立提示词'; }
    const transparentLabel = element.querySelector('.transparent-background-row > label');
    if (transparentLabel) transparentLabel.textContent = '透明背景';
    if (node.type === 'generator') {
      const left = element.querySelector('.transparent-background-row');
      const right = element.querySelector('.auto-split-row');
      if (left && right && !element.querySelector('.test-generator-options')) {
        const group = document.createElement('div');
        group.className = 'test-generator-options';
        left.before(group);
        group.append(left, right);
      }
    }
  };
  const decorateMediaFrame = (element, node) => {
    const pendingMedia = node.type === 'result' && !!node.pending && !['audio','text'].includes(node.mediaType);
    element.classList.toggle('test-pending-media', pendingMedia);
    if (pendingMedia) {
      const loading = element.querySelector('.loading-state');
      if (loading) {
        loading.setAttribute('role','status');loading.setAttribute('aria-live','polite');
        loading.innerHTML='<span class="test-ghost-loader" aria-hidden="true"><span class="test-ghost-eyes"><i></i><i></i></span></span><strong>正在生成中</strong>';
      }
    }
    if (node.type === 'result' && !['video','audio','text'].includes(node.mediaType)) {
      element.classList.add('test-image-result');
    }
    if (node.type === 'image') {
      element.querySelectorAll('[data-remove-ref]').forEach(button => {
        button.title = '移除此参考图（保留节点）';
        button.setAttribute('aria-label', button.title);
      });
      element.querySelectorAll('[data-reference-upload-trigger]').forEach(button => {
        button.title = '添加参考图片';
        button.setAttribute('aria-label', button.title);
      });
    }
    const reference = node.type === 'image' && element.querySelector('.single-reference .thumb > img');
    const result = node.type === 'result' && element.querySelector('.preview > img');
    const image = reference || result;
    if (!image) return;
    element.classList.add('test-fitted-media');
    element.style.minHeight = '0px';
    // Remove the reference renderer's inline 100% height. Intrinsic image height
    // fits even very tall/wide files and previously saved square node frames.
    image.style.height = 'auto';
    image.style.borderRadius = '0';
    const sync = () => {
      if (reference && typeof positionReferenceCommentMarkers === 'function') positionReferenceCommentMarkers(reference.parentElement);
      if (typeof scheduleDrawLinks === 'function') scheduleDrawLinks();
    };
    image.addEventListener('load', sync);
    if (image.complete) sync();
  };
  const fitImageResize = (startWidth, startHeight, dx, dy, corner, ratio) => {
    const horizontal = corner.includes('w') ? -dx : dx;
    const vertical = (corner.includes('n') ? -dy : dy) * ratio;
    const change = Math.abs(horizontal) >= Math.abs(vertical) ? horizontal : vertical;
    const width = Math.max(160, Math.round(startWidth + change));
    return {width, height:(width - 2) / ratio + 2};
  };
  // Keep the original controls and listeners as the single source of truth.
  let activeResolutionPicker = null;
  let resolutionPickerId = 0;
  const closeResolutionPicker = () => {
    if (!activeResolutionPicker) return;
    activeResolutionPicker.classList.remove('open');
    activeResolutionPicker.querySelector('.node-select-trigger').setAttribute('aria-expanded', 'false');
    activeResolutionPicker = null;
  };
  document.addEventListener('pointerdown', event => {
    if (activeResolutionPicker && !activeResolutionPicker.contains(event.target)) closeResolutionPicker();
  }, true);
  const compactResolution = (row, selector, label) => {
    if (!row) return;
    const options = [...row.querySelectorAll(selector)];
    const select = document.createElement('select');
    select.setAttribute('aria-label', label);
    options.forEach(button => {
      const option = document.createElement('option');
      option.textContent = button.textContent;
      option.value = button.getAttribute(selector.slice(1, -1));
      option.selected = button.classList.contains('active');
      option.disabled = button.disabled;
      select.append(option);
    });
    select.disabled = options.length === 0 || options.every(button => button.disabled);
    // Retain the value adapter for original handlers, but never show an OS popup.
    select.hidden = true;
    select.tabIndex = -1;
    select.addEventListener('change', () => {
      const target = options.find(button => button.getAttribute(selector.slice(1, -1)) === select.value);
      if (target && !target.disabled) target.click();
    });
    const choices = row.querySelector('.choice-options');
    if (choices) (choices.parentElement === row ? choices : choices.parentElement).hidden = true;
    row.append(select);
    const picker = document.createElement('div');
    picker.className = 'node-select test-resolution-picker';
    const trigger = document.createElement('button');
    trigger.type = 'button';
    trigger.className = 'node-select-trigger';
    trigger.setAttribute('aria-label', label);
    trigger.setAttribute('aria-haspopup', 'listbox');
    trigger.setAttribute('aria-expanded', 'false');
    trigger.disabled = select.disabled;
    const selected = options.find(option => option.classList.contains('active')) || options[0];
    const caption = document.createElement('span');
    caption.textContent = selected?.textContent || '无可用精度';
    trigger.append(caption, icon('chevron-down'));
    const menu = document.createElement('div');
    menu.className = 'node-select-menu test-resolution-menu';
    menu.id = 'test-resolution-' + (row.closest('.node')?.dataset.id || ++resolutionPickerId) + '-' + selector.replace(/[^a-z-]/g, '');
    menu.setAttribute('role', 'listbox');
    menu.setAttribute('aria-label', label);
    trigger.setAttribute('aria-controls', menu.id);
    options.forEach(original => {
      const choice = document.createElement('button');
      choice.type = 'button';
      choice.className = 'node-select-option';
      choice.setAttribute('role', 'option');
      choice.setAttribute('aria-selected', String(original === selected));
      choice.classList.toggle('active', original === selected);
      choice.disabled = original.disabled;
      choice.tabIndex = -1;
      choice.dataset.resolutionValue = original.getAttribute(selector.slice(1, -1));
      choice.textContent = original.textContent;
      choice.addEventListener('click', event => {
        event.stopPropagation();
        if (choice.disabled) return;
        closeResolutionPicker();
        caption.textContent = original.textContent;
        [...menu.children].forEach(item => {
          item.classList.toggle('active', item === choice);
          item.setAttribute('aria-selected', String(item === choice));
        });
        const selectedOption = [...select.options].find(option => option.value === choice.dataset.resolutionValue);
        if (selectedOption) selectedOption.selected = true;
        select.dispatchEvent(new window.Event('change'));
        // Real handlers may replace the node: focus its new trigger if so.
        (document.getElementById(menu.id)?.previousElementSibling || (picker.isConnected ? trigger : null))?.focus();
      });
      menu.append(choice);
    });
    const open = () => {
      closeResolutionPicker();
      if (typeof closeNodeSelects === 'function') closeNodeSelects();
      activeResolutionPicker = picker;
      picker.classList.add('open');
      trigger.setAttribute('aria-expanded', 'true');
      const rect = trigger.getBoundingClientRect?.();
      picker.classList.toggle('open-up', !!rect && window.innerHeight - rect.bottom < 150 && rect.top > window.innerHeight - rect.bottom);
      (menu.querySelector('[aria-selected=true]:not(:disabled)') || menu.querySelector('button:not(:disabled)'))?.focus();
    };
    trigger.addEventListener('click', event => {
      event.stopPropagation();
      if (!trigger.disabled) picker.classList.contains('open') ? closeResolutionPicker() : open();
    });
    picker.addEventListener('pointerdown', event => event.stopPropagation());
    menu.addEventListener('wheel', event => event.stopPropagation(), {passive:true});
    picker.addEventListener('keydown', event => {
      if (event.key === 'Escape') { event.preventDefault(); event.stopPropagation(); closeResolutionPicker(); trigger.focus(); return; }
      if (event.key === 'Tab') { closeResolutionPicker(); return; }
      if (!['ArrowDown','ArrowUp','Home','End'].includes(event.key)) return;
      event.preventDefault();event.stopPropagation();
      if (!picker.classList.contains('open')) { if (!trigger.disabled) open(); return; }
      const enabled = [...menu.querySelectorAll('button:not(:disabled)')];
      const index = enabled.indexOf(event.target);
      const next = event.key === 'Home' ? 0 : event.key === 'End' ? enabled.length-1 : (index + (event.key === 'ArrowDown' ? 1 : -1) + enabled.length) % enabled.length;
      enabled[next]?.focus();
    });
    picker.append(trigger, menu);
    row.append(picker);
    return select;
  };
  const decorateStyle = element => {
    const model = element.querySelector('[data-style-model]')?.closest('.form-row');
    const strength = element.querySelector('[data-style-strength]')?.closest('.form-row');
    const ratio = element.querySelector('[data-style-output]')?.closest('.form-row');
    const resolution = element.querySelector('.resolution-row');
    if (model && strength && ratio && resolution) {
      const settings = document.createElement('div');
      settings.className = 'test-style-settings';
      model.before(settings);
      settings.append(model, strength, ratio, resolution);
      strength.querySelector('label').textContent = '风格强度';
      ratio.querySelector('label').textContent = '比例尺寸';
      resolution.querySelector('label').textContent = '精度';
      strength.querySelectorAll('[data-style-strength]').forEach(button => {
        const fullText = button.textContent;
        button.textContent = ({subtle:'轻度',standard:'标准',strong:'强烈'})[button.dataset.styleStrength] || fullText;
        button.title = fullText;
      });
      compactResolution(resolution, '[data-style-resolution]', '风格迁移精度');
    }
    const prompt = element.querySelector('[data-style-prompt]');
    if (prompt) {
      prompt.closest('.field').classList.add('test-style-prompt');
      const label = document.createElement('label');
      label.textContent = '提示词';
      prompt.id = 'style-prompt-' + element.dataset.id;
      label.htmlFor = prompt.id;
      prompt.before(label);
    }
  };
  const decorateNode = (element, node) => {
    if (element.dataset.testDecorated) return element;
    element.dataset.testDecorated = 'true';
    decorateSwitches(element, node);
    decorateMediaFrame(element, node);
    labelButton(element.querySelector('.node-menu [data-duplicate]'), '复制节点', 'copy', true);
    labelButton(element.querySelector('.node-menu [data-delete]'), '删除节点', 'trash', true);
    // The library already has a full-size, labelled button in the prompt toolbar.
    if (node.type === 'generator') element.querySelector('.node-menu [data-prompt-library]')?.remove();
    if (node.type === 'result') {
      const menu = element.querySelector('.node-menu');
      menu.querySelector('[data-favorite]')?.remove();
      menu.querySelector('[data-duplicate]')?.remove();
      const remove = menu.querySelector('[data-delete]');
      remove?.setAttribute('aria-label', '删除结果');
      for (const selector of ['[data-favorite]', '[data-regenerate]', '[data-download]']) {
        const button = element.querySelector('.preview ' + selector);
        if (button) menu.insertBefore(button, remove);
      }
      for (const [attribute, name, label] of [['favorite','star',node.favorite ? '取消收藏' : '收藏结果'],['regenerate','refresh','重新生成'],['download','download','下载图片'],['delete','trash','删除结果']]) {
        labelButton(menu.querySelector('[data-' + attribute + ']'), label, name, true);
      }
      if (node.directorPreview) {
        const old = menu.querySelector('[data-regenerate]');
        if (old) {
          const local = old.cloneNode(true);
          local.title = '打开导演台重新预演'; local.setAttribute('aria-label', local.title);
          local.addEventListener('click', () => {
            const source = nodes.find(item => item.type === 'director' && links.some(link => link.from === item.id && link.to === node.id));
            if (source) window.WandouDirector.open(source);
            else showToast('原导演台节点已移除，请新建导演台。');
          });
          old.replaceWith(local);
        }
        const download = menu.querySelector('[data-download]');
        if (download) {download.title = '下载本地预演'; download.setAttribute('aria-label', download.title);}
      }
    }
    if (node.type === 'style') decorateStyle(element);
    decorateGenerate(element.querySelector('[data-generate]'));
    if (node.type !== 'generator') return element;
    const addReference = element.querySelector('.generator-reference-field .add-thumb');
    if (addReference) {
      const caption = document.createElement('span');
      caption.textContent = '添加参考图';
      addReference.append(caption);
    }
    const tools = element.querySelector('.prompt-corner-tools');
    const skill = element.querySelector('[data-skill-row-toggle]');
    const skillRow = skill?.closest('.form-row');
    const skillName = skill?.textContent.trim() || '默认绘图规则';
    const popover = element.querySelector('[data-generator-skill-popover]');
    if (popover) tools.append(popover);
    skillRow?.remove();
    const creative = element.querySelector('[data-creative-style-control]');
    const creativeRow = creative?.closest('.form-row');
    const creativeName = creative?.querySelector('[data-creative-style-toggle] span')?.textContent.trim() || '无选择';
    if (creative) {
      const toggle = creative.querySelector('[data-creative-style-toggle]');
      labelButton(toggle, '创作技能', 'bulb');
      toggle.title = '创作技能：' + creativeName;
      toggle.append(icon('chevron-down'));
      tools.insertBefore(creative, tools.querySelector('[data-prompt-library]'));
      creativeRow?.remove();
    }
    labelButton(tools.querySelector('[data-skill-picker-toggle]'), 'Skill', 'stack-2');
    labelButton(tools.querySelector('[data-prompt-library]'), '提示词库', 'clipboard-text');
    const refineButton = tools.querySelector('[data-prompt-refine-open]');
    labelButton(refineButton, 'AI 润色', 'sparkles');
    if (refineButton) {
      refineButton.classList.add('test-refine-button');
      const sparkle = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
      sparkle.classList.add('ui-icon', 'test-refine-icon');
      sparkle.setAttribute('viewBox', '0 0 24 24');
      sparkle.setAttribute('aria-hidden', 'true');
      sparkle.setAttribute('focusable', 'false');
      const sparklePath = document.createElementNS('http://www.w3.org/2000/svg', 'path');
      sparklePath.setAttribute('d', 'M16 18a2 2 0 0 1 2 2a2 2 0 0 1 2 -2a2 2 0 0 1 -2 -2a2 2 0 0 1 -2 2zm0 -12a2 2 0 0 1 2 2a2 2 0 0 1 2 -2a2 2 0 0 1 -2 -2a2 2 0 0 1 -2 2zm-7 12a6 6 0 0 1 6 -6a6 6 0 0 1 -6 -6a6 6 0 0 1 -6 6a6 6 0 0 1 6 6z');
      sparkle.append(sparklePath);
      refineButton.querySelector('.ui-icon')?.replaceWith(sparkle);
      refineButton.title = '先写好提示词，再点 AI 润色';
      refineButton.dataset.tooltip = refineButton.title;
      const label = refineButton.querySelector('span');
      label.className = 'test-refine-label';
      label.replaceChildren(...[...'AI 润色'].map((letter, index) => {
        const glyph = document.createElement('span');
        glyph.className = 'test-refine-letter';
        glyph.textContent = letter === ' ' ? '\u00a0' : letter;
        glyph.style.setProperty('--letter-order', String(index));
        return glyph;
      }));
      if (Date.now() - (refinePulse.get(node.id) || 0) < 1400) refineButton.classList.add('test-refine-activated');
      refineButton.addEventListener('click', event => {
        if (!String(node.prompt || '').trim()) {
          event.preventDefault();
          event.stopImmediatePropagation();
          showToast('请先输入提示词，再点 AI 润色');
          element.querySelector('[data-field="prompt"]')?.focus();
          return;
        }
        refinePulse.set(node.id, Date.now());
        refineButton.classList.add('test-refine-activated');
        setTimeout(() => {
          if (refinePulse.get(node.id) && Date.now() - refinePulse.get(node.id) >= 1350) {
            refinePulse.delete(node.id);
            document.querySelector(`.node[data-id="${node.id}"] [data-prompt-refine-open]`)?.classList.remove('test-refine-activated');
          }
        }, 1450);
      }, { capture:true });
    }
    const summary = document.createElement('p');
    summary.className = 'test-skill-summary';
    summary.textContent = skillName + ' · ' + (creativeName === '无选择' ? '未选择创作技能' : creativeName);
    tools.after(summary);
    const prompt = element.querySelector('[data-field="prompt"]');
    if (prompt) {
      const counter = document.createElement('span');
      counter.className = 'test-character-count';
      // No invented 1000-character limit: the original editor supports long prompts.
      const sync = () => counter.textContent = prompt.value.length + ' 字';
      prompt.after(counter);
      prompt.addEventListener('input', sync);
      sync();
    }

    const ratio = element.querySelector('.ratio-menu')?.closest('.form-row');
    element.querySelectorAll('.ratio-menu .node-select-option').forEach(option => {
      if (/^(1:1|16:9|9:16|4:3|3:4)(?:\s|$)/.test(option.textContent.trim()) && !option.querySelector('.test-common-ratio')) {
        const badge = document.createElement('span');badge.className = 'test-common-ratio';badge.textContent = '（常用）';(option.querySelector('span') || option).append(badge);
      }
    });
    const resolution = element.querySelector('.resolution-row');
    const count = element.querySelector('.generator-count-row');
    if (ratio && resolution && count) {
      const settings = document.createElement('div');
      settings.className = 'test-compact-settings';
      ratio.before(settings);
      settings.append(ratio, resolution, count);
      ratio.querySelector('label').textContent = '比例';
      resolution.querySelector('label').textContent = '精度';
      compactResolution(resolution, '[data-resolution]', '生成精度');
      const stepper = document.createElement('div');
      stepper.className = 'test-stepper';
      stepper.innerHTML = '<button type="button" aria-label="减少生成数量"></button><output aria-label="生成数量"></output><button type="button" aria-label="增加生成数量"></button>';
      stepper.querySelector('output').textContent = node.count || 1;
      const buttons = stepper.querySelectorAll('button');
      buttons.forEach((button, index) => {
        button.append(icon(index ? 'plus' : 'minus'));
        const next = Number(node.count || 1) + (index ? 1 : -1);
        const target = count.querySelector(`[data-count="${next}"]`);
        button.disabled = !!node.autoSplit || !target || target.disabled;
        button.addEventListener('click', () => { if (!button.disabled) target?.click(); });
      });
      count.querySelector('.count-options').hidden = true;
      count.append(stepper);
    }
    return element;
  };
  renderNode = function (node, ...args) {
    return decorateMotion(decorateNode(originalRenderNode(node, ...args), node), node);
  };
  // DOM-only regressions use the same decorators as the live test page.
  const installLauncherMotion = (button, star = false) => {
    if (!button || button.dataset.launcherMotion) return;
    const glyph = button.querySelector('.ui-icon,svg');
    if (!glyph) return;
    button.dataset.launcherMotion = 'true';
    const wrapper = document.createElement('span');
    wrapper.className = 'test-launcher-motion-glyph';
    wrapper.setAttribute('aria-hidden', 'true');
    glyph.before(wrapper);wrapper.append(glyph);
    let running;
    const play = pressed => {
      running?.cancel();
      if (window.matchMedia?.('(prefers-reduced-motion: reduce)').matches || !wrapper.animate) return;
      const direction = button.id === 'collapseSidebarButton' || (button.id === 'assistantRailButton' && button.getAttribute('aria-expanded') !== 'true') ? -1 : 1;
      const frames = star ? [
        {transform:'rotate(0deg) scale(1)'},
        {transform:`rotate(${pressed ? -24 : 24}deg) scale(${pressed ? .8 : 1.28})`,offset:.4},
        {transform:'rotate(0deg) scale(1)'}
      ] : [
        {transform:'translateX(0)',opacity:1},
        {transform:`translateX(${direction * 10}px)`,opacity:0,offset:.4},
        {transform:`translateX(${-direction * 8}px)`,opacity:0,offset:.41},
        {transform:'translateX(0)',opacity:1}
      ];
      running = wrapper.animate(frames,{duration:pressed ? 360 : 560,easing:'cubic-bezier(.2,.8,.2,1)',iterations:1});
    };
    button.addEventListener('pointerenter',event=>{if(event.pointerType !== 'touch') play(false);});
    button.addEventListener('focus',()=>play(false));
    button.addEventListener('pointerdown',event=>{if(event.button === 0) play(true);});
    button.addEventListener('keydown',event=>{if(!event.repeat && ['Enter',' '].includes(event.key)) play(true);});
    button.addEventListener('pointercancel',()=>running?.cancel());
  };
  window.WandouCanvasTestUI = {decorateNode, compactResolution, decorateMotion, fitImageResize, installLauncherMotion};

  const boot = () => {
    if (document.body.dataset.canvasReady !== 'true') return setTimeout(boot, 100);
    ['expandSidebarButton','collapseSidebarButton','assistantRailButton','assistantToggleButton'].forEach(id => installLauncherMotion(document.getElementById(id), id === 'assistantToggleButton'));
    document.querySelector('.brand h1').innerHTML = '豌豆 AI<span class="brand-subtitle">绘图节点画布</span>';
    const badge = document.createElement('span');
    badge.className = 'test-version-badge';
    badge.textContent = typeof canvasStoragePrefix !== 'undefined' && !canvasStoragePrefix ? '2.0.5 · 节点画布' : '测试版 · 独立数据';
    badge.title = typeof canvasStoragePrefix !== 'undefined' && !canvasStoragePrefix ? '当前正式版本：2.0.5' : '测试项目与正式版隔离；API 设置需要在测试页单独配置。';
    document.querySelector('.sidebar').append(badge);
    const creation = {
      image:['photo','参考图','blue'],sketch:['pencil','画板'],generator:['sparkles','AI 绘图','blue'],
      video:['video','AI 视频'],batch:['layout-grid','批量改图','blue'],keyword:['clipboard-text','提示词反推','blue'],png:['scissors','抠图 PNG','blue'],
      outpaint:['arrows-maximize','扩图','green'],style:['palette','风格迁移'],psd:['stack-2','分层 PSD','blue'],
      vector:['vector-bezier','SVG / AI','blue'],audio:['music','AI 音频','blue']
    };
    document.querySelectorAll('[data-add-node]').forEach(button => {
      const [name, label, color] = creation[button.dataset.addNode];
      labelButton(button, label, name);
      if (color) button.querySelector('.ui-icon').classList.add(color);
    });
    // Reuse real icons instead of absolutely positioned legacy glyphs, so long
    // menu labels never collide with their icon. Keep the original buttons/events.
    document.querySelectorAll('[data-menu-node]').forEach(button => {
      const entry = creation[button.dataset.menuNode];
      if (!entry) return;
      labelButton(button, button.textContent.trim(), entry[0]);
      button.classList.add('test-create-menu-item');
    });
    document.querySelector('#newProjectButton').prepend(icon('plus'));
    for (const [id, name, label] of [
      ['lightboxContextCopy','copy','复制图片'],
      ['lightboxContextDownload','download','下载图片'],
      ['lightboxContextPrompt','clipboard-text','查看关键词'],
      ['lightboxContextRegenerate','refresh','重新生成']
    ]) {
      const button = document.getElementById(id);
      if (!button) continue;
      button.classList.add('test-frame-button');
      delete button.dataset.wdAction;
      labelButton(button, label, name);
    }
    document.querySelectorAll('.assistant-title-mark,.assistant-orb').forEach(mark => {
      mark.replaceChildren(icon('sparkles', 'green'));
    });
    document.querySelectorAll('.assistant-starters button').forEach((button, index) => {
      const text = document.createElement('div');
      while (button.firstChild) text.append(button.firstChild);
      button.append(icon(['bulb','sitemap','compass','sparkles'][index]), text);
    });
    labelButton(document.querySelector('#assistantAttachButton'), '上传图片', 'paperclip', true);
    labelButton(document.querySelector('#assistantSendButton'), '发送', 'send', true);
    labelButton(document.querySelector('#assistantClearButton'), '新对话（当前对话将存入历史记录）', 'plus', true);
    document.querySelector('#assistantClearButton').dataset.tooltip = '新对话 · 自动保存历史';
    // A paint-contained canvas creates a containing block even for fixed children.
    // Move the existing bar out so it stays at the viewport's upper-right corner.
    document.body.append(document.querySelector('.topbar'));
    document.querySelector('#clearButton').hidden = true;
    document.querySelector('#autoLayoutButton').hidden = true;
    document.querySelector('#openGalleryButton').closest('.tool-group').querySelector('h2').textContent = '资源与工具';
    projectHub.classList.add('open');
    projectHubButton.setAttribute('aria-expanded', 'true');
    // Keep project collection open until the user explicitly collapses it.
    projectHubPinned = true;
    document.querySelectorAll('.assistant-select-field').forEach(field => {
      const label = field.querySelector(':scope > span');
      const trigger = field.querySelector('.assistant-picker-trigger');
      if (label && trigger) trigger.prepend(label);
    });
    const chatView = document.getElementById('assistantChatView');
    const chatScroll = document.createElement('div');
    chatScroll.className = 'test-assistant-scroll';
    chatView.prepend(chatScroll);
    chatView.querySelectorAll('.assistant-intro,.assistant-starters,.assistant-messages').forEach(part => chatScroll.append(part));
    const toolbar = document.createElement('nav');
    toolbar.className = 'test-canvas-toolbar';
    toolbar.setAttribute('aria-label', '画布工具');
    toolbar.innerHTML = '<button type="button" data-tool="select" aria-label="选择节点" title="选择节点" aria-pressed="true">↖</button><button type="button" data-tool="select-all" aria-label="整体选中" title="整体选中画布节点">□</button><button type="button" data-tool="pan" aria-label="平移画布" title="平移画布" aria-pressed="false">✋</button><i></i><button type="button" data-tool="minus" aria-label="缩小">−</button><output data-test-zoom>100%</output><button type="button" data-tool="plus" aria-label="放大">+</button><i></i><button type="button" data-tool="fit">适应画布</button><button type="button" data-tool="arrange">自动排列</button><i></i><button type="button" data-tool="undo" aria-label="撤销" title="撤销">↶</button><button type="button" data-tool="redo" aria-label="重做" title="重做">↷</button>';
    const toolIcons = {select:'pointer','select-all':'select-all',pan:'hand-stop',minus:'minus',plus:'plus',arrange:'layout-grid',undo:'arrow-back-up',redo:'arrow-forward-up'};
    for (const [tool, name] of Object.entries(toolIcons)) {
      const button = toolbar.querySelector('[data-tool="' + tool + '"]');
      labelButton(button, button.getAttribute('aria-label') || button.textContent, name, tool !== 'arrange');
    }
    document.body.append(toolbar);
    document.querySelectorAll('.sidebar [data-add-node],#newProjectButton,.project-transfer-actions button,.topbar-actions button,.assistant-launcher,.assistant-close,.assistant-starters button,.assistant-picker-trigger,.assistant-tool-button,#assistantSendButton,.test-canvas-toolbar button').forEach(button => button.classList.add('test-motion-button'));
    let mode = 'select';
    toolbar.addEventListener('click', event => {
      const action = event.target.closest('[data-tool]')?.dataset.tool;
      if (!action) return;
      if (action === 'select-all') {
        if (typeof selectAllCanvasNodes === 'function') selectAllCanvasNodes();
      } else if (action === 'select' || action === 'pan') {
        mode = action;
        toolbar.querySelector('[data-tool="select"]').setAttribute('aria-pressed', mode === 'select');
        toolbar.querySelector('[data-tool="pan"]').setAttribute('aria-pressed', mode === 'pan');
        canvasWrap.classList.toggle('test-pan-mode', mode === 'pan');
      } else if (action === 'fit') fitCanvasToContent(false);
      else if (action === 'arrange') autoLayout();
      else if (action === 'undo') undoCanvas();
      else if (action === 'redo') redoCanvas();
      else {
        const rect = canvasWrap.getBoundingClientRect();
        const x = rect.width / 2, y = rect.height / 2;
        const zoom = Math.max(.15, Math.min(2, view.zoom * (action === 'plus' ? 1.15 : 1 / 1.15)));
        view.x = x - (x - view.x) * zoom / view.zoom;
        view.y = y - (y - view.y) * zoom / view.zoom;
        view.zoom = zoom;
        applyCanvasTransform();
        scheduleCanvasSave();
      }
    });
    canvasWrap.addEventListener('pointerdown', event => {
      if (mode !== 'pan' || event.button !== 0 || event.target.closest('.topbar,button,input,textarea,select')) return;
      event.stopImmediatePropagation();
      event.preventDefault();
      panState = { startX: event.clientX, startY: event.clientY, viewX: view.x, viewY: view.y };
      canvasWrap.classList.add('is-panning');
      document.body.classList.add('no-select');
      canvasWrap.setPointerCapture(event.pointerId);
    }, true);
    const syncZoom = () => toolbar.querySelector('[data-test-zoom]').textContent = Math.round(view.zoom * 100) + '%';
    new MutationObserver(syncZoom).observe(document.getElementById('zoomValue'), { childList: true, subtree: true, characterData: true });
    syncZoom();
    // Rebuild once to decorate nodes restored before this script loaded.
    canvas.querySelectorAll('.node').forEach(node => { releaseMountedNode(node); node.remove(); });
    render();
    if (!canvasTestStorage.getItem('test-layout-initialized')) {
      requestAnimationFrame(() => { fitCanvasToContent(false); canvasTestStorage.setItem('test-layout-initialized', '1'); });
    }
    document.body.dataset.testReady = 'true';
  };
  if (!canvasStoragePrefix || (!window.wandouShell && !window.chrome?.webview)) boot();
})();
