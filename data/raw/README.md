# 原始数据目录

原始 TSV、Excel、Word 等资料可以先放在 `data/raw/`，用于后续清洗和导入。

注意事项：

- 原始资料默认不建议提交到 Git。
- 涉密、敏感、未公开项目资料不要放入仓库。
- 真实资料进入系统前必须先脱敏。
- 后续可以通过导入脚本进行清洗，例如 `scripts/import-expert-comments.mjs`。
