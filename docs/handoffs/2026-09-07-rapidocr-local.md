# 交接记录：RapidOCR 本地引擎接入（2026-09-07）

任务来源：用户直接分配（用之前 snipaste-ocr 项目验证过的本地 RapidOCR 替代 Windows 原生 OCR，本地/云端由用户自选）。本任务**不改变外发边界**：RapidOCR 完全本地运行，恰恰强化了默认隐私姿态。

## 实现方式

- 复用 snipaste-ocr 的验证结论：`rapidocr_onnxruntime`（PP-OCR 模型 ONNX 版）在本机 Python 3.14.2 可用，识别约 0.7 秒/张，中英文正常。
- 新增 `desktop/resources/rapid-ocr-server.py`：Python 常驻 sidecar，stdin 每行一个图片路径、stdout 每行一个 JSON 结果，引擎只初始化一次（避免每张截图重复加载模型）。
- 新增 `desktop/src/main/rapid-ocr.ts`：sidecar 生命周期管理（懒启动、协议超时重启、致命错误熔断），打包后从 `app.asar.unpacked/resources/` 解析脚本路径。
- 本地链路改为 **RapidOCR → Windows OCR → Tesseract** 依次回退，首个可用引擎生效；设置界面选项不变（本地 / Paddle 云端），本地默认隐私属性更强了。
- 依赖安装：`pip install -r desktop/resources/rapid-ocr-requirements.txt`（机器上没有 Python/RapidOCR 时自动回退 Windows OCR，不阻塞使用）。

## 验证

- 真实引擎探针：RapidOCR 识别合成图 0.71 秒，文本命中。
- `npm test` 59 通过 + 1 按预期跳过（本机 RapidOCR 可用，"不可用回退"分支跳过）——**含真实 sidecar 集成测试**：测试进程内 spawn Python 服务，空白图协议往返 available=true。
- `npm run typecheck` / `lint` / `build` 全通过；重新打包后确认 sidecar 脚本位于 `app.asar.unpacked/resources/`，与打包模式解析路径一致。

## 未验证项

- 打包 exe 内感知循环走 RapidOCR 的端到端体验（需受控试用；打包外路径解析已按 electron-builder 布局核对）。
- 接收方机器无 Python 时的回退路径由单测逻辑保证，未在无 Python 环境实测。

## 已知取舍

- sidecar 是懒启动的常驻 Python 进程（约几十 MB 内存）；感知停止时不主动杀掉（下次开启直接热启动）。若内存敏感可加空闲退出，留待反馈决定。
- 规划助手结论：待验收。
