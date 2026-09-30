---
type: integration
title: 图表与模块 Skill
description: 图表模块在调用模型前同步读取 skills 目录里的 SKILL.md。生成器再收紧输出格式。自定义模块只有在模板上挂了 skill_name 时才走同一条路径。
tags: [skills, mermaid, markmap, prd]
verified:
  - by: openwiki/0.6.0
    at: 2026-09-28T02:15:14.097Z
sources:
  - id: openwiki-source-0c2e1badec7d4a2b0a6d37ca
    resource: repo://backend/src/services/moduleBuilder.ts
  - id: openwiki-source-305700adbcd01c703295cc96
    resource: repo://backend/src/services/prd/modules/architecture.ts
  - id: openwiki-source-a0b9e73f74460bed368bb38e
    resource: repo://backend/src/services/prd/modules/custom.ts
  - id: openwiki-source-214e38afcab68860bd424cd9
    resource: repo://backend/src/services/prd/modules/dataModel.ts
  - id: openwiki-source-a134b70c0fdf71cda96cec84
    resource: repo://backend/src/services/prd/modules/flowchart.ts
  - id: openwiki-source-cbfb96b4fb8eb1cbb0a2f5d7
    resource: repo://backend/src/services/prd/modules/infoArch.ts
  - id: openwiki-source-7f1fd1afee120912646da7e9
    resource: repo://backend/src/services/prd/modules/prototypeBasis.ts
  - id: openwiki-source-1c1c75b2bf7fb4a3bb6813c0
    resource: repo://backend/src/services/prdOutline.ts
  - id: openwiki-source-52fa6003cbc9ed98a06b188c
    resource: repo://backend/src/services/sectionEditService.ts
  - id: openwiki-source-08612556bed6d771d40f7d07
    resource: repo://backend/src/services/skillLoader.ts
generated: { by: "cursor", at: "2026-09-28T02:15:14.097Z" }
---

# 图表与模块 Skill

`loadSkill` 从仓库根的 `skills/<名称>/SKILL.md` 同步读文件，缺文件就抛错。`buildSkillBlock` 把正文包成 `<skill name="...">`。生成器把这块放进系统提示。文件缺失会让该模块生成失败，流水线按占位段落继续，见 PRD 生成。

## 四张图和原型依据

大纲生成时，`architecture`、`flowchart`、`infoArch`、`dataModel` 的 `skillRequired` 由代码里的映射补上，不依赖模型是否填写。映射是：

| 模块 | Skill | 生成器实际收下的输出 |
| --- | --- | --- |
| 产品架构 | `skill-prd-architecture` | 只有 `graph TB`。Skill 要求五层顺序不变：用户层、接入层、业务服务层、数据层、外部系统 |
| 业务流程 | `skill-prd-flowchart` | 一个或多个 `flowchart TD`，按 Skill 的节点类型和泳道。多图会被拆开，各自包进 mermaid 容器 |
| 信息架构 | `skill-prd-infoarch` | 从 `#` 开始的 Markdown 树，按 Skill 的 `#` / `##` / `###` / `-` 层级。结果放进 `markmap-data` 脚本，由页面运行时渲染 |
| 数据模型 | `skill-prd-datamodel` | `erDiagram`，然后一行 `---TABLE---`，再为每个实体一张字段表 |

这四个生成器都写明不要输出说明文字。Skill 正文里「图表后再附说明」的步骤因此不会出现在 PRD HTML 里。

`prototypeBasis` 不在这张映射表里。它的生成器写死读取 `skill-prd-prototype`，用来固定页面清单、页面详情、导航关系和设计规范，供原型设计代理使用。

## 自定义模块

内置表里没有的章节走 `custom` 生成器。`module_templates.skill_name` 有值时注入那份 Skill，并要求只输出 HTML 片段。没有关联时只根据要点写 HTML，不读 Skill 文件。

模块构建器可以把新 Skill 写到磁盘，但名称必须匹配 `skill-custom-` 加小写字母、数字和连字符。内容要有 frontmatter、`name`、`description`，并且不超过 500 行，否则校验不通过。它不会改上面五个内置 Skill 的文件名。

整节 AI 重写如果在模板上找到 `skill_name`，会再读同一份文件；读失败就省略这段规范，不让整次编辑失败。

## 接下来读哪里

- [PRD 生成](/openwiki/prd/generation.md)：这些生成器在流水线的哪一步被调用。
- [原型编辑器](/openwiki/prototype/editor.md)：原型依据如何变成设计代理的上下文。
- [对话回合](/openwiki/conversation/agent-turn.md)：收集阶段本身不加载这些 Skill，要等生成或重写。
