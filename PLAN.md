# Helm 开发计划

这份计划回答两个问题：**现在建什么**，以及**为什么这样排序**。

## 指导原则

1. **先验证"报告有没有人看"，再投 AI 理解的深度。**
   最大的坑是先花几个月做完美的结构化抽取，结果报告自己没人打开。
   每一版都要能真实地跑起来、产生你能读的报告。

2. **原始数据是可抛弃的，事件和趋势是资产。**
   截屏 12 小时即焚。events / reports / goals / baselines 才是要长期积累的东西。
   架构上从第一天就把"数据源"和"报告引擎"解耦。

3. **感知无关（source-agnostic）。**
   今天数据来自截屏，明天来自音频、眼镜、手动记录。
   事件表带 `source` 字段，报告引擎只消费结构化事件，不碰原始输入。

4. **非评判、只讲变化。**
   报告的产品纪律：一屏、结论先行、最多三条、只讲 delta、语气是教练不是考勤机。

## 数据模型（核心）

```sql
-- 原始感知记录：可抛弃的临时层，12 小时后连记录带文件一起删除
create table raw_captures (
  id integer primary key autoincrement,
  image_path text not null,
  ocr_text text not null default '',
  created_at text not null default ''
);

-- 结构化行为事件：核心资产，感知无关
create table events (
  id integer primary key autoincrement,
  source text not null default 'screen',  -- screen | audio | manual | glasses(未来)
  timestamp text not null,                -- ISO 时间
  app_name text not null default '',
  window_title text not null default '',
  activity text not null default '',      -- 阅读/写作/编程/沟通/浏览/娱乐...
  topic text not null default '',         -- 注意力主题，如 "Rust 学习"
  mode text not null default '',          -- input | output | communication | consumption
  artifacts text not null default '',     -- 相关链接/文件，JSON 数组
  confidence real not null default 0.5,
  raw_ref text not null default '',       -- 指向原始截图（12h 后失效）
  created_at text not null default ''
);
create index events_timestamp on events (timestamp);
create index events_source_time on events (source, timestamp);
create index events_topic on events (topic);

-- 每日/每周报告
create table reports (
  id integer primary key autoincrement,
  kind text not null default 'daily',     -- daily | weekly
  period_start text not null,
  period_end text not null,
  metrics text not null default '',       -- JSON：度量结果
  narrative text not null default '',     -- 报告正文（一屏）
  created_at text not null default ''
);

-- 用户确认的目标
create table goals (
  id integer primary key autoincrement,
  title text not null,
  topic_keywords text not null default '',-- 用于对齐的关键词，JSON
  target_mode text not null default '',   -- 期望增加的模式，如 output
  status text not null default 'active',  -- active | paused | done
  created_at text not null default '',
  updated_at text not null default ''
);

-- 纵向基线：随时间复利的护城河
create table baselines (
  id integer primary key autoincrement,
  metric text not null,                   -- 如 output_ratio / focus_block_min
  period text not null,                   -- 如 2026-W36 / 2026-09
  value real not null,
  sample_size integer not null default 0,
  created_at text not null default ''
);
```

## 从 brain 继承的模块

以下模块从 brain 拆解、改造、去 brain 化后迁入：

| brain 模块 | Helm 位置 | 改动 |
|-----------|----------|------|
| `windows-ocr.ts` | `desktop/src/main/ocr.ts` | 环境变量前缀 `BRAIN_` → `HELM_`，几乎不变 |
| `auto-capture.ts` | `desktop/src/main/perception/screen-capture.ts` | 去 `store` 耦合，事件直接写 `events` 表；保留隐私暂停、12h 清理、可注入 capture/OCR |
| `ai-config.ts` | `desktop/src/main/ai-config.ts` | 配置文件名 `brain-ai-config` → `helm-ai-config`，逻辑不变 |
| `sensitive-redaction.ts` | `desktop/src/shared/redaction.ts` | 原样搬，API Key 脱敏 |
| `dedupe.ts` | `desktop/src/main/perception/dedupe.ts` | 复用指纹逻辑，用于截图去重 |
| `background.ts` / `window-bounds.ts` | `desktop/src/main/` | 托盘、窗口，改标题为 Helm |
| store 的 SQLite 模式 | `desktop/src/main/db.ts` | 全新：events/reports/goals/baselines，去掉盒子/卡片 |

**不搬的**：盒子、卡片、GTD 加工字段、批量管理、Android（暂缓）。那是 brain 的形态，不是 Helm 的。

## 里程碑

### v0 —— 跑通"截屏 → 报告"的最小闭环（1~2 周）

**目标**：每天结束能看到一份纯文本的今日报告，哪怕还很粗糙。

- [x] Electron 骨架 + SQLite 事件表（上面的 schema）
- [x] 屏幕感知：定时截屏 + Windows OCR（继承自 brain，Tesseract 兜底）
- [x] 去重：OCR 文本指纹 + 10 分钟重复窗口（会话切分留给 v1）
- [x] 蒸馏 v0（简化版）：当天片段截断后单次调用 LLM 生成报告（map-reduce 分层留到数据量证明有必要时再做）
- [x] 报告 v0：主窗口一屏报告 + 托盘开关感知
- [x] 隐私：手动/隐私暂停、12h 原始图自动焚毁

**当前状态（2026-09-05）**：v0 骨架已落地并通过 37 个测试、lint / typecheck / build 全绿。
尚未真机长时间跑过——下一步是连续运行两周做"报告愿意不愿意打开"的验证。

**验证点**：连续跑两周，问自己——这份粗糙的报告，我愿意每天打开吗？
愿意 → 进 v1 投深度；不愿意 → 停下来改报告形态，而不是加 AI。

### v1 —— 结构化事件 + 度量（2~4 周）

**目标**：从"摘要"升级为"对照"，报告开始说"你比昨天如何"。

- [ ] 蒸馏 v1：逐片段 AI 结构化抽取，写入 events 表（app/activity/topic/mode）
- [ ] 度量引擎：活动模式分布、注意力主题分布、专注质量（窗口切换频率、长会话块）
- [ ] 报告 v1：一屏。3 个数字 + 1 个发现 + 1 句建议。只讲 delta。
- [ ] 纠错入口：误标一处可点"这段其实是工作"，固化成个人规则

**验证点**：报告的每一行是否都"相对基线或目标"在说话，而不是陈述流水账。

### v2 —— 目标循环（4~8 周）

**目标**：形成"现状 → 目标 → 慢慢改变"的完整反馈环。

- [ ] 目标设定零摩擦：AI 从观察到的事实里提议目标，用户只点确认
- [ ] 目标对齐度：内容级的对照（"你定的是学 Rust，今天 Rust 占注意力 12%，昨天 0%"）
- [ ] 周报：讲趋势和目标的渐进调整，日报只讲今天的一个重点
- [ ] 基线积累：baselines 表开始产生纵向趋势

**验证点**：两周后你还会打开报告吗？打开后有没有一次真的改变了你接下来的行为。

### v3 —— 感知扩展（远期，等端侧能力成熟）

- [ ] 第二个数据源：音频转写（`source='audio'`）
- [ ] 本地小模型做片段抽取，只有脱敏后的聚合才走云端
- [ ] 视觉模型补 OCR 覆盖不了的场景（图表、视频、设计稿）
- [ ] AI 眼镜 / 边缘设备感知接入（`source='glasses'`）

**这条线的前提**：感知层会商品化，模型会商品化，而"关于你的纵向数据"和
"如何改变你的 know-how"不会。v0~v2 攒的就是后两者。

## 风险与对应

| 风险 | 对应 |
|------|------|
| 报告两周后没人看 | v0 先用最粗摘要验证形态；只讲 delta、非评判、一屏 |
| 隐私顾虑赶客 | 蒸馏即焚 + 本地 OCR + 原始数据不出设备；把隐私当卖点 |
| 误标一次就失去信任 | v1 的纠错入口 + 置信度标注，宁可少说也不错判 |
| 变成另一个截屏记忆工具 | 不提供"库"可逛；报告是唯一界面；名字和叙事都不说"记录" |
| 大公司入局（Apple/Meta） | 拼纵向数据资产 + 干预 know-how + 非粘性商业模式，不拼感知硬件 |

## 一句话

> v0 用最低成本验证"一屏报告值不值得每天打开"；
> 验证通过后，再把 AI 理解的深度、目标循环、感知扩展一层层加上去。
> 截屏只是今天的传感器，真正的产品是"关于你的纵向数据"和"帮你掌舵的教练"。
