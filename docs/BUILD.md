# 从源码构建 Windows v2.0.22

本目录说明如何从当前标签的源码生成便携 ZIP 和本地安装器。官方 Release 中的包经过独立验收；自行重新构建会受到工具链、时间戳和依赖下载环境影响，不保证与官方包逐字节相同。不要用重新构建的文件覆盖已验收的 Release 资产。

## 环境

- Windows x64；PowerShell 7 用于构建脚本，Windows PowerShell 5.1 用于旧更新器及安装器兼容回归。
- Node.js 至少 22.12.0。此次锁文件校验使用 Node.js 24.22.1、pnpm 11.25.0。
- Windows .NET Framework C# 编译器：`C:\Windows\Microsoft.NET\Framework64\v4.0.30319\csc.exe`。
- 可访问 npm 和 Electron 发行资源的网络。已有 HTTP(S) 代理可由当前进程继承；不要把代理口令、API 密钥或 GitHub 凭据写进仓库。
- Blender 不是普通图片画布或打包的前置条件。实际测试 `.blend` 导入时，需在 Blender 默认安装位置安装 Blender。

`desktop-client/package.json` 的 Electron 固定为 **45.1.0**；`pnpm-lock.yaml` 使用 v9 格式，同时锁定 electron-builder 26.15.3、Playwright 1.62.1、sharp 0.35.3。构建时使用冻结锁，勿通过删除锁文件修复依赖问题。

## 安装依赖

以下命令在仓库根目录执行：

```powershell
pnpm --dir desktop-client install --frozen-lockfile
if ($LASTEXITCODE -ne 0) { throw 'Desktop dependency installation failed' }
```

如果 pnpm 提示阻止了 Electron 的安装脚本，确认当前依赖是锁定的 45.1.0 后，单独执行其下载脚本：

```powershell
node desktop-client/node_modules/electron/install.js
if ($LASTEXITCODE -ne 0) { throw 'Electron runtime download failed' }
```

DOM 专项测试另需 `pnpm --dir tools/canvas-ui-test install --frozen-lockfile`。公开源码没有附带用户配置、项目、API 密钥或机器专属 QA 制品；部分历史专项测试需要各自明确的合成素材和浏览器路径，不能仅凭整个测试目录都存在就宣称在所有机器均已执行通过。

只校验依赖锁、不安装依赖或运行生命周期脚本，可在 `desktop-client` 中执行：

```powershell
pnpm install --frozen-lockfile --lockfile-only --ignore-scripts --offline
```

## 构建便携包和安装器

先确认 `desktop-client/package.json` 为 2.0.22、`app/VERSION.txt` 首行为 v2.0.22。构建命令不会替你把其它版本源码改成当前版本。

```powershell
$compiler = 'C:\Windows\Microsoft.NET\Framework64\v4.0.30319\csc.exe'
if (-not (Test-Path -LiteralPath $compiler)) { throw 'C# compiler not found' }
& $compiler /nologo /target:winexe /optimize+ /out:desktop-client\portable-updater.exe /reference:System.IO.Compression.dll /reference:System.IO.Compression.FileSystem.dll desktop-client\portable-updater.cs
if ($LASTEXITCODE -ne 0) { throw 'Portable updater compilation failed' }

pnpm --dir desktop-client exec electron-builder --win dir --x64 --publish never
if ($LASTEXITCODE -ne 0) { throw 'Electron package build failed' }

pwsh -NoProfile -File scripts/build-portable-package.ps1 -Version 2.0.22
if ($LASTEXITCODE -ne 0) { throw 'Portable package/installer build failed' }
```

输出文件：

- `dist/wandou-ai-tools-windows-x64.zip`：含外层启动器及 `程序文件` 目录，供便携使用和应用内更新。
- `dist/wandou-ai-tools-setup-2.0.22.exe`：包含同一个 ZIP 的 Windows 本地安装器。
- `dist/installer.manifest`、`dist/installer-build-metadata.cs`：安装器构建中间文件。

打包脚本会重新编译当前源码中的更新器，校验运行目录版本，并默认调用 `scripts/build-local-installer.ps1`。`-SkipInstaller` 仅生成 ZIP。输出限制在仓库目录内；不要将输出目录指向正在使用的软件或数据目录。安装器未做 Authenticode 签名，构建成功不等于获得代码签名。

## 构建后检查

在隔离配置与合成数据上检查，避免覆盖正在使用的程序。可先执行独立安装/更新回归：

```powershell
node --test tests/desktop-local-installer-v219.test.cjs tests/portable-updater-storage.test.cjs tests/portable-updater-regression.test.cjs tests/update-save-gate.test.cjs
if ($LASTEXITCODE -ne 0) { throw 'Installer/update regression failed' }
pwsh -NoProfile -File tests/portable-package-smoke.ps1 -Package dist/wandou-ai-tools-windows-x64.zip
if ($LASTEXITCODE -ne 0) { throw 'Packaged startup/save/close smoke test failed' }
```

发布前还需要检查包内版本、资源完整性、实际保存与关闭、旧版覆盖升级后的数据完整性，以及相关改动的失败和取消分支。普通浏览器检查不能替代安装包验证。源码重建的产物需独立验收，不继承官方包已有的 SHA256 或测试结论。

## Blender 转换器

二进制 `.blend` / `.fbx` 测试夹具可能嵌入生成电脑的路径，本标签不再附带这两类历史夹具；GLB 合成夹具仍保留。`smoke-test.py` 在任一目标文件已存在时会拒绝覆盖，因此不能直接在保留 GLB 的源码目录运行它来补缺失文件。

需要运行导演台专项时，在新的隔离目录复制两个生成脚本，用 Blender 生成合成默认立方体，再仅补回缺失的两种夹具。以下步骤已使用 Blender 4.2 实际生成成功；请按本机安装位置调整 `$blender`。不会替换仓库已有 GLB，生成的 `.blend` / `.fbx` 已被 `.gitignore` 排除，不要强制提交它们。

```powershell
$fixtureRoot = Join-Path $env:TEMP ('wandou-fixtures-' + [Guid]::NewGuid().ToString('N'))
$fixtureTools = Join-Path $fixtureRoot 'tools/director-blender'
New-Item -ItemType Directory -Path $fixtureTools -Force | Out-Null
Copy-Item -LiteralPath 'tools/director-blender/smoke-test.py','tools/director-blender/convert-blend.py' -Destination $fixtureTools
$blender = 'C:\Program Files\Blender Foundation\Blender 4.2\blender.exe'
& $blender --background --factory-startup --disable-autoexec --python-exit-code 1 --python (Join-Path $fixtureTools 'smoke-test.py')
if ($LASTEXITCODE -ne 0) { throw 'Synthetic fixture generation failed' }
New-Item -ItemType Directory -Path 'artifacts/director-format-test' -Force | Out-Null
foreach ($extension in @('blend','fbx')) {
    $destination = "artifacts/director-format-test/fixture-cube.$extension"
    if (Test-Path -LiteralPath $destination) { throw "Refusing to replace existing fixture: $destination" }
    Copy-Item -LiteralPath (Join-Path $fixtureRoot $destination) -Destination $destination
}
```

`tools/director-blender/convert-blend.py` 是 `package.json` 明确列出的额外资源，打包后位于 `程序文件/resources/director/convert-blend.py`，不可漏掉。它在 Blender 内运行，禁用工程自动脚本、不保存原工程、不覆盖已有输出，把 `.blend` 导出为 GLB。当前 v2.0.22 源码文件与官方包内该资源的 SHA256 一致：

```text
9fa7c7387760c2a9f73cbb36fce48148d38a0fd3f701aa1cc6072ead62afa7f0
```

## 发布与构建分开

本地构建不会自动发布。应用内更新仍依赖固定名称的 ZIP、同名 `.sha256` 和 `update-manifest.json`；安装器是另外的下载资产。校验文件必须根据要上传的实际 ZIP 计算，manifest 中的版本标签与下载路径必须匹配。上传及设置 latest 需按发布检查流程单独执行，不得让工作流重建或覆盖已验收资产。
