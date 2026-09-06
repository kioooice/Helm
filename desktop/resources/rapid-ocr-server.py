#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""Helm 本地 OCR 常驻服务（RapidOCR，PP-OCR 模型的 ONNX 版）。

协议：stdin 每行一个图片路径；stdout 每行一个 JSON 结果。
  {"ok": true, "text": "..."} 或 {"ok": false, "error": "..."}
引擎只初始化一次，避免每次截图重复加载模型。
"""
import json
import sys


def main():
    try:
        sys.stdout.reconfigure(encoding="utf-8")
        sys.stderr.reconfigure(encoding="utf-8")
    except Exception:
        pass

    try:
        from rapidocr_onnxruntime import RapidOCR
    except Exception as cause:  # 未安装依赖时如实上报，由调用方回退到 Windows OCR
        print(json.dumps({"ok": False, "fatal": f"rapidocr unavailable: {cause}"}), flush=True)
        return 1

    try:
        engine = RapidOCR()
    except Exception as cause:
        print(json.dumps({"ok": False, "fatal": f"engine init failed: {cause}"}), flush=True)
        return 1

    for line in sys.stdin:
        path = line.strip()
        if not path:
            continue
        try:
            result, _ = engine(path)
            text = "\n".join(str(item[1]) for item in result).strip() if result else ""
            print(json.dumps({"ok": True, "text": text}), flush=True)
        except Exception as cause:
            print(json.dumps({"ok": False, "error": str(cause)}), flush=True)
    return 0


if __name__ == "__main__":
    sys.exit(main())
