(function extendGridformLayouts() {
  "use strict";

  const layouts = window.PosterLayouts;
  if (!Array.isArray(layouts)) return;

  const createLayout = (id, name, family, description, title, subtitle, body, media, options = {}) => ({
    id,
    name,
    family,
    description,
    title,
    subtitle,
    body,
    media,
    ...options
  });

  const additions = [
    createLayout("editorial", "编辑封面", "headline", "主标题与整幅视觉形成杂志封面式的编辑层级。", [0, 0, 7, 4], [8, 0, 4, 1], [8, 8.4, 4, 2.2], [[0, 4.7, 7, 5.9]], { font: 125 }),
    createLayout("triptych", "三联画廊", "gallery", "三幅图像用高度差建立节奏，上方标题保持稳定重心。", [0, 0, 12, 2.7], [0, 3.2, 5, 1], [7, 9, 5, 1.6], [[0, 4.4, 3.6, 4], [4.2, 4.4, 3.6, 6.2], [8.4, 4.4, 3.6, 4]], { font: 118 }),
    createLayout("margin-note", "边注大图", "split", "窄栏文字像书籍边注，右侧大图承担主要叙事。", [0, 0, 3.5, 6.5], [0, 7, 3.5, 1], [0, 9, 3.5, 1.5], [[4.3, 0, 7.7, 10.6]], { font: 100 }),
    createLayout("cross", "十字分区", "split", "横纵分割线形成十字骨架，让信息与图像彼此咬合。", [0, 0, 7.2, 4.5], [7.8, 0, 4.2, 1], [7.8, 8, 4.2, 2.6], [[0, 5.2, 7.2, 5.4], [7.8, 1.7, 4.2, 5.6]], { font: 112 }),
    createLayout("panorama", "全宽中景", "band", "全宽中景横贯页面，标题与脚注分别固定上下阅读区。", [0, 0, 10, 3.1], [0, 3.4, 6, 1], [8, 8.6, 4, 2], [[0, 4.8, 12, 3.3]], { font: 128, mediaMode: "strip" }),
    createLayout("twin-window", "双窗并列", "gallery", "两扇等权图窗并列陈列，适合对照和系列视觉。", [0, 0, 12, 2.7], [0, 3.1, 5, 1], [7, 9.3, 5, 1.3], [[0, 4.3, 5.7, 4.4], [6.3, 4.3, 5.7, 4.4]], { font: 120 }),
    createLayout("stacked-cards", "叠层卡片", "gallery", "一主一次两层图像交叠，制造类似实体印刷品的纵深。", [0, 0, 8, 3.3], [8.5, 0, 3.5, 1], [8.5, 8.5, 3.5, 2], [[0, 4, 7.3, 6.5], [7.8, 3, 4.2, 4.6]], { font: 116 }),
    createLayout("caption-grid", "图注矩阵", "gallery", "双图矩阵配合底部双向图注，信息整齐而不呆板。", [0, 0, 12, 2.6], [0, 9.2, 5.5, 1.2], [6.5, 9.2, 5.5, 1.2], [[0, 3.3, 5.7, 5.3], [6.3, 3.3, 5.7, 5.3]], { font: 122 }),
    createLayout("letterbox", "电影宽银幕", "band", "宽银幕主视觉制造电影感，上下留白承接标题与说明。", [0, 0, 9, 2.8], [9, 0, 3, 1], [0, 9.2, 6, 1.3], [[0, 3.4, 12, 4.9]], { font: 132, mediaMode: "strip" }),
    createLayout("archive", "档案目录", "index", "左侧大字像档案编号，右侧图文形成理性的目录系统。", [0, 0, 5, 6.4], [6, 0, 6, 1], [6, 7.5, 6, 3], [[6, 1.7, 6, 5.1]], { font: 104 }),
    createLayout("orbit", "环绕留白", "space", "标题悬在中央留白，图像与注释沿边缘形成环绕关系。", [2, 2.3, 8, 3.6], [0, 0, 5, 1], [7, 9.2, 5, 1.4], [[0, 6.5, 4.7, 3.4], [7.3, 0, 4.7, 2.7]], { font: 125, align: "center" }),
    createLayout("catalog", "产品目录", "split", "主图与辅助图组成产品目录结构，信息集中在右侧收束。", [0, 0, 8, 3], [8.5, 0, 3.5, 1], [8.5, 8.7, 3.5, 1.8], [[0, 3.7, 5.7, 6.8], [6.3, 3.7, 5.7, 4.4]], { font: 114 })
  ];

  const knownIds = new Set(layouts.map((layout) => layout.id));
  additions.forEach((layout) => {
    if (!knownIds.has(layout.id)) layouts.push(layout);
  });
})();
