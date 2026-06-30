# Prompt 测试样本

本目录用于沉淀人工回归样本。当前阶段不引入自动化评测框架，先用固定样本约束 Prompt 修改质量。

## 使用方式

1. 修改 Prompt 前，先选择相关样本。
2. 用同一份输入分别跑修改前/修改后结果。
3. 对照样本中的 `expectations` 检查是否满足。
4. 如果输出退化，回滚 Prompt 或继续缩小修改范围。

## 样本结构

```json
{
  "name": "样本名称",
  "task": "reportGeneration",
  "input": {},
  "expectations": [
    "必须指出具体问题",
    "不能虚构材料中没有的数据"
  ],
  "mustNot": [
    "不能给出泛泛鼓励"
  ]
}
```

## 当前覆盖方向

- `report-generation/`：报告生成与路演表现分析。
- `dynamic-followup/`：动态追问。
- `trl-assessment/`：TRL 证据识别。

