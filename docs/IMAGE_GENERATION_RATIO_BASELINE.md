# 图片比例与尺寸输出基线

标识：`IMG-RATIO-BASELINE-v1`

适用版本：`v1.0.39` 及以后

以后遇到“图片比例不对、尺寸固定、出现白边、横竖图被压缩或裁错”等问题时，直接按本基线恢复和验证。可以使用“调用图片比例与尺寸输出基线”作为问题名称。

## 必须保持的规则

1. 图片接口只接收服务端支持的原生尺寸：
   - 方图：`1024x1024`
   - 横图：`1536x1024`
   - 竖图：`1024x1536`
2. 用户选择的比例和最终目标尺寸必须写入提示词，让模型按目标画幅直接构图。
3. 不向接口发送自定义 `targetSize` 字段，避免服务端先生成固定比例再补白。
4. 接口返回图片后，使用居中 `cover` 方式规范化为用户选择的精确尺寸。
5. 最终预览、下载和本地保存必须使用同一份规范化图片。
6. 不允许使用 `contain` 补白，不允许出现白边、黑边或画中画边框。

## 关键代码位置

文件：`app/ai-node-canvas.html`

- `promptWithSize`：向提示词补充精确比例和尺寸。
- `apiSizeFromTarget`：把目标画幅映射到接口原生尺寸。
- `normalizeGeneratedImage`：校验并规范化最终输出尺寸。
- `resizeImageToDataUrl`：使用 `cover` 居中铺满目标画布。
- `imageSizeMap`：11 种比例、1K/2K/4K 共 33 组目标尺寸。

## 回归测试

静态尺寸与代码约束：

```powershell
node tests/image-size-regression.test.js
```

浏览器 Canvas 像素与补白检测：

```powershell
$env:NODE_PATH="C:\Users\zl761\.cache\codex-runtimes\codex-primary-runtime\dependencies\node\node_modules"
node tests/image-canvas-pixels.test.cjs
```

可选真实接口检测：

预先在本机环境变量中配置 `WANDOU_API_KEY`，再运行：

```powershell
node tests/real-api-image-ratios.test.cjs
```

真实接口检测只从环境变量读取密钥，禁止把密钥写入源码、测试文件、日志或发布包。

## 发布前验收

- 33 组尺寸映射全部通过。
- 方图、横图、竖图、超宽图、超长图四角像素均无补白。
- 最终宽高与用户选择完全一致。
- 页面提示词包含目标比例和目标尺寸。
- 接口请求中不存在自定义 `targetSize`。
- 用户至少实测一组横图和一组竖图，构图方向正确。

## 备份恢复

`v1.0.39` Git 标签和 GitHub Release 是本基线的只读版本备份。需要恢复时，优先对照该标签中的以下文件：

- `app/ai-node-canvas.html`
- `tests/image-size-regression.test.js`
- `tests/image-canvas-pixels.test.cjs`
- `tests/real-api-image-ratios.test.cjs`
- `docs/IMAGE_GENERATION_RATIO_BASELINE.md`
