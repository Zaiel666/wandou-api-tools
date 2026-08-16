(function () {
  const selectedKey = "wandouSelectedSkillV1";
  const fallbacks = [
    { id: "builtin-imagegen", name: "imagegen", description: "根据场景、构图、光线、材质与文字要求整理绘图提示词。", builtin: true },
    { id: "builtin-design", name: "design", description: "为海报、品牌与视觉系统补充规范化的设计语言。", builtin: true },
    { id: "builtin-banner", name: "banner-design", description: "针对海报、横幅和社交媒体画面优化构图与排版。", builtin: true },
    { id: "builtin-prompt", name: "prompt-optimizer", description: "把零散需求整理成明确、完整且可执行的生成提示词。", builtin: true }
  ];
  const builtinInstructions = {
    "builtin-imagegen": "把用户内容优化为可直接用于图片生成的提示词。保持原意和语言，明确主体、环境、构图、镜头、光线、材质、色彩、风格、画幅以及必须保留的文字。只返回优化后的提示词。",
    "builtin-design": "以专业视觉设计师的方式整理绘图提示词，补齐视觉层级、网格、留白、字体层级、配色和品牌一致性。保持用户指定内容不变，只返回优化后的提示词。",
    "builtin-banner": "针对海报和横幅生成任务优化提示词，明确版式、视觉焦点、文案区域、比例、安全边距与平台适配。只返回可用于生图的最终提示词。",
    "builtin-prompt": "把用户的绘图需求整理为清晰、无占位符、可直接执行的提示词。保持原意，消除冲突和歧义，只返回最终提示词。"
  };

  async function list() {
    try {
      const installed = await window.wandouShell?.listSkills?.();
      if (Array.isArray(installed) && installed.length) return installed;
    } catch (_error) {}
    return fallbacks.slice();
  }

  async function read(id) {
    try {
      const result = await window.wandouShell?.readSkill?.(id);
      if (result?.success && result.instructions) return result;
    } catch (_error) {}
    const skill = fallbacks.find((item) => item.id === id);
    if (!skill) return { success: false, error: "Skill 不存在或已卸载" };
    return { success: true, skill, instructions: builtinInstructions[id] || builtinInstructions["builtin-prompt"] };
  }

  function getSelected() {
    try { return JSON.parse(localStorage.getItem(selectedKey) || "null"); } catch (_error) { return null; }
  }

  function setSelected(skill) {
    if (!skill) localStorage.removeItem(selectedKey);
    else localStorage.setItem(selectedKey, JSON.stringify({ id: skill.id, name: skill.name, description: skill.description || "" }));
    window.dispatchEvent(new CustomEvent("wandou-skill-selection", { detail: skill || null }));
  }

  window.WandouSkills = { list, read, getSelected, setSelected, selectedKey, fallbacks };
})();
