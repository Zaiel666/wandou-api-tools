const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { pathToFileURL } = require('node:url');
const { _electron: electron } = require('playwright');

const repoRoot = path.resolve(__dirname, '..');
const packagedExe = process.env.WANDOU_LIVE_APP_EXE || '';
const appRoot = process.env.WANDOU_LIVE_APP_ROOT || path.join(repoRoot, 'app');
const configPath = path.join(process.env.APPDATA || '', '豌豆AI', 'local-data', 'json', 'api-config-v1.json');
const config = JSON.parse(fs.readFileSync(configPath, 'utf8'));
const userDataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'wandou-live-smoke-'));
const sourceDataFile = process.env.WANDOU_LIVE_SOURCE_DATA_FILE || '';
const externalSourceUrl = sourceDataFile ? fs.readFileSync(sourceDataFile, 'utf8').trim() : '';
const liveImageModel = process.env.WANDOU_LIVE_IMAGE_MODEL || 'gpt-image-2.5-sunburst';

function safeError(error) {
  return String(error?.stack || error?.message || error || '').replaceAll(config.key || '__none__', '[hidden]').replaceAll(config.key2 || '__none__', '[hidden]');
}

(async () => {
  const app = await electron.launch(packagedExe ? {
    executablePath:packagedExe,
    cwd:path.dirname(packagedExe),
    env:{ ...process.env, WANDOU_TEST_USER_DATA_DIR:userDataDir },
    timeout:30000,
  } : {
    args:[path.join(repoRoot, 'desktop-client')],
    cwd:repoRoot,
    env:{ ...process.env, WANDOU_TEST_USER_DATA_DIR:userDataDir },
    timeout:30000,
  });
  try {
    const page = await app.firstWindow();
    page.setDefaultTimeout(600000);
    const pageErrors = [];
    page.on('pageerror', (error) => pageErrors.push(error.message));
    await page.goto(pathToFileURL(path.join(appRoot, 'ai-node-canvas.html')).href);
    await page.waitForFunction(() => document.body.dataset.canvasReady === 'true');
    await page.evaluate(({ url, key, key2 }) => {
      apiUrlInput.value = url;
      apiUrl2Input.value = url;
      apiKeyInput.value = key;
      apiKey2Input.value = key2;
    }, { url:config.url, key:config.key, key2:config.key2 || '' });

    if (process.env.WANDOU_LIVE_SKIP_AUDIO !== '1') {
      const audio = await page.evaluate(async () => {
      const node = createNode('audio', 60, 60, {
        model:'gemini-3.1-flash-tts-preview',
        prompt:'请自然清晰地朗读：豌豆音频节点真实测试成功。',
        audioVoice:'Kore',
        audioFormat:'wav',
        audioSpeed:1,
        _deferRender:true,
      });
      await generateAudioFromNode(node.id);
      const result = nodes.find((item) => item.type === 'result' && item.mediaType === 'audio' && !item.pending);
      if (!result?.mediaUrl) return { success:false, status:node.status, resultStatus:result?.status || '' };
      const bytes = new Uint8Array(await (await fetch(result.mediaUrl)).arrayBuffer());
      return {
        success:true,
        status:node.status,
        resultStatus:result.status,
        mime:result.audioMimeType,
        bytes:bytes.length,
        riff:String.fromCharCode(...bytes.slice(0, 4)),
      };
      });
      assert.equal(audio.success, true, `${audio.status} ${audio.resultStatus}`);
      assert.equal(audio.riff, 'RIFF', 'Gemini PCM must be wrapped into a valid WAV file');
      assert.ok(audio.bytes > 10000, 'real audio result should contain playable samples');
      console.log(`LIVE_AUDIO_PASS mime=${audio.mime} bytes=${audio.bytes}`);
    }

    const psd = await page.evaluate(async ({ providedSourceUrl, selectedImageModel }) => {
      assistantModelOptions.splice(0, assistantModelOptions.length, 'gpt-6-astra', 'gpt-5.6-sol', 'gpt-5.6-terra', 'gpt-5.6-luna');
      if (!gptImageModelOptions.includes(selectedImageModel)) gptImageModelOptions.unshift(selectedImageModel);
      let sourceUrl = providedSourceUrl;
      let sourceWidth = 1024;
      let sourceHeight = 1024;
      if (sourceUrl) {
        const dimensions = await getImageDimensions(sourceUrl);
        sourceWidth = dimensions.width;
        sourceHeight = dimensions.height;
      } else {
        const sourceCanvas = document.createElement('canvas');
        sourceCanvas.width = sourceWidth;
        sourceCanvas.height = sourceHeight;
        const context = sourceCanvas.getContext('2d');
        context.fillStyle = '#dcecff';
        context.fillRect(0, 0, sourceWidth, sourceHeight);
        context.fillStyle = '#ed3f3f';
        context.beginPath();
        context.arc(512, 512, 230, 0, Math.PI * 2);
        context.fill();
        sourceUrl = sourceCanvas.toDataURL('image/png');
      }
      const node = createNode('psd', 80, 80, {
        model:selectedImageModel,
        references:[{ url:sourceUrl, mediaType:'image', width:sourceWidth, height:sourceHeight, name:'live-psd-source.png' }],
        mediaUrl:sourceUrl,
        _deferRender:true,
      });
      await generatePsdFromNode(node.id);
      const exported = psdExportFiles.get(node.id);
      if (!exported) return { success:false, status:node.status };
      const buffer = await exported.blob.arrayBuffer();
      const parsed = agPsd.readPsd(buffer, { useImageData:true });
      const visible = parsed.children.filter((layer) => !layer.hidden);
      const alphaCoverage = visible.slice(0, -1).map((layer) => {
        let covered = 0;
        for (let index = 3; index < layer.imageData.data.length; index += 4) if (layer.imageData.data[index] > 24) covered += 1;
        return covered / (parsed.width * parsed.height);
      });
      return {
        success:true,
        status:node.status,
        bytes:buffer.byteLength,
        names:parsed.children.map((layer) => layer.name),
        hidden:parsed.children.map((layer) => Boolean(layer.hidden)),
        alphaCoverage,
      };
    }, { providedSourceUrl:externalSourceUrl, selectedImageModel:liveImageModel });
    assert.equal(psd.success, true, psd.status);
    assert.ok(psd.bytes > 1000, 'real PSD should contain layer pixels');
    assert.ok(psd.names.length >= 3, 'real PSD should contain object, background, and hidden original layers');
    assert.match(psd.names.at(-2), /背景/);
    assert.equal(psd.hidden.at(-1), true);
    assert.ok(psd.alphaCoverage.every((coverage) => coverage > 0.00002 && coverage < 0.95), `invalid object coverage: ${psd.alphaCoverage.join(',')}`);
    console.log(`LIVE_PSD_PASS bytes=${psd.bytes} layers=${JSON.stringify(psd.names)} coverage=${psd.alphaCoverage.map((value) => value.toFixed(4)).join(',')}`);
    assert.deepEqual(pageErrors, []);
  } finally {
    await app.close();
    fs.rmSync(userDataDir, { recursive:true, force:true });
  }
})().catch((error) => {
  console.error(safeError(error));
  process.exitCode = 1;
});
