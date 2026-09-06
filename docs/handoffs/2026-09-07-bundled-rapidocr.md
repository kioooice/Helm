# 交接记录：内置冻结版 RapidOCR，移除 Windows 原生 OCR（2026-09-07）

任务来源：用户直接分配（"不执行命令的办法……原生的 OCR 效果真的很烂，其实我都不想要的"）。

## 变更

1. **本地 OCR 引擎随包内置**：用 PyInstaller 把 `rapid-ocr-server.py` 冻结为独立
   `rapid-ocr-server.exe`（98MB，含 PP-OCR 模型与 onnxruntime），打包时放入
   `resources/`，运行时从 `app.asar.unpacked/resources/` 启动。任何机器拷贝
   `dist/win-unpacked` 即用，**零命令、零依赖**。Node 侧优先启动冻结版，
   不存在时才回退 Python 源码 sidecar（开发场景）。
2. **移除 Windows 原生 OCR 与 Tesseract**：`src/main/ocr.ts` 删除，本地链路只剩
   内置 RapidOCR（用户明确判定原生 OCR 质量不可接受）。OCR 失败时截图仍会
   本地保存，状态如实报错，不影响感知循环。
3. 冻结环境兼容：sidecar 脚本加入 snipaste-ocr 同款 `sys.modules` 预注册处理。
4. 可复现构建：`desktop/scripts/build-rapid-ocr-sidecar.cmd`；冻结 exe 不入仓库
   （.gitignore），由打包前本地构建产出。

## 验证

- 冻结 exe 探针：合成图识别正确（含中文），首启 5.9 秒（含解压+模型加载），
  常驻后亚秒级。
- `npm test` 59 通过 + 1 按预期跳过；**集成测试实际走的就是冻结 exe 路径**
  （resources 下存在 exe 时优先）。
- `typecheck` / `lint` / `build` 全通过；重新打包后确认 exe 位于
  `app.asar.unpacked/resources/` 并经过完整性处理；打包版启动冒烟通过。

## 未验证项

- 其他机器（无 Python）上冻结引擎的真实首启时长（onefile 解压受磁盘速度影响）。
- 部分杀软对未签名 PyInstaller exe 的误报可能（与主程序同样属于无签名分发的已知代价）。

## 已知取舍

- 安装包体积增加约 98MB（总计约 551MB）。
- 首次启动感知时有一次 sidecar 解压/模型加载延迟（秒级，之后常驻）。
- 规划助手结论：待验收。
