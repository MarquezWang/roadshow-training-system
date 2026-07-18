import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import ts from "typescript";

async function transpileModule(relativePath, replacements = {}) {
  let source = await readFile(new URL(relativePath, import.meta.url), "utf8");

  for (const [specifier, replacement] of Object.entries(replacements)) {
    source = source.replaceAll(
      JSON.stringify(specifier),
      JSON.stringify(replacement),
    );
  }

  const transpiled = ts.transpileModule(source, {
    compilerOptions: {
      module: ts.ModuleKind.ESNext,
      target: ts.ScriptTarget.ES2022,
    },
  }).outputText;

  return `data:text/javascript;base64,${Buffer.from(transpiled).toString("base64")}`;
}

const typeGuardsUrl = await transpileModule("../../lib/type-guards.ts");
const typesUrl = await transpileModule("../../lib/trl-assessment/types.ts");
const utilsUrl = await transpileModule("../../lib/trl-assessment/utils.ts");
const normalizationUrl = await transpileModule(
  "../../lib/trl-assessment/normalization.ts",
  {
    "@/lib/type-guards": typeGuardsUrl,
    "./types": typesUrl,
    "./utils": utilsUrl,
  },
);
const recognitionInputUrl = await transpileModule(
  "../../lib/trl-assessment/recognition-input.ts",
);
const evidenceVerificationUrl = await transpileModule(
  "../../lib/trl-assessment/evidence-verification.ts",
  {
    "./types": typesUrl,
    "./utils": utilsUrl,
  },
);
const assessmentUrl = await transpileModule(
  "../../lib/trl-assessment/assessment.ts",
  {
    "./evidence-verification": evidenceVerificationUrl,
    "./types": typesUrl,
    "./utils": utilsUrl,
  },
);
const facadeUrl = await transpileModule("../../lib/trl-assessment.ts", {
  "./trl-assessment/assessment": assessmentUrl,
  "./trl-assessment/normalization": normalizationUrl,
  "./trl-assessment/recognition-input": recognitionInputUrl,
  "./trl-assessment/types": typesUrl,
});
const {
  assessTrlFromEvidence,
  buildLayeredRecognitionInput,
  createDefaultTrlEvidence,
  inspectTrlEvidencePayload,
  parseTrlEvidence,
} = await import(facadeUrl);
const jsonSource = await readFile(
  new URL("../../lib/json-utils.ts", import.meta.url),
  "utf8",
);
const jsonTranspiled = ts.transpileModule(jsonSource, {
  compilerOptions: {
    module: ts.ModuleKind.ESNext,
    target: ts.ScriptTarget.ES2022,
  },
}).outputText;
const { parseAIJson, parseFirstAIJsonObject } = await import(
  `data:text/javascript;base64,${Buffer.from(jsonTranspiled).toString("base64")}`
);
const projectProfileSource = await readFile(
  new URL("../../lib/project-profile.ts", import.meta.url),
  "utf8",
);
const projectProfileTranspiled = ts.transpileModule(projectProfileSource, {
  compilerOptions: {
    module: ts.ModuleKind.ESNext,
    target: ts.ScriptTarget.ES2022,
  },
}).outputText;
const { extractLooseProjectProfile, normalizeTechnicalKeywords } = await import(
  `data:text/javascript;base64,${Buffer.from(projectProfileTranspiled).toString("base64")}`
);

const evidenceKeys = [
  "conceptPlan",
  "architectureOrModel",
  "prototype",
  "labValidation",
  "simulatedOrRelevantValidation",
  "realEnvironmentTest",
  "productFinalization",
  "productionReadiness",
  "certificationOrMarketAccess",
  "actualUseProof",
  "batchDeliveryOrMassProduction",
  "commercialRevenue",
  "auxiliarySignals",
];

function emptyEvidence(deliverableType) {
  return {
    deliverableType,
    hasConceptPlan: false,
    hasArchitectureOrModel: false,
    hasPrototype: false,
    hasLabValidation: false,
    hasSimulatedOrRelevantValidation: false,
    hasRealEnvironmentTest: false,
    hasProductFinalization: false,
    hasProductionReadiness: false,
    hasCertificationOrMarketAccess: false,
    hasActualUseProof: false,
    hasBatchDeliveryOrMassProduction: false,
    hasCommercialRevenue: false,
    evidence: Object.fromEntries(evidenceKeys.map((key) => [key, []])),
    missingEvidence: [],
    confidence: "低",
  };
}

function assess(text, deliverableType) {
  return assessTrlFromEvidence(emptyEvidence(deliverableType), text);
}

test("AI 说明文字中可提取第一个合法 JSON 对象", () => {
  const result = parseAIJson(
    '以下是识别结果：\n{"name":"第一个项目"}\n补充：{"name":"第二个项目"}',
  );

  assert.deepEqual(result, { name: "第一个项目" });
});

test("截断响应会跳过数组并提取第一个完整 JSON 子对象", () => {
  const result = parseFirstAIJsonObject(
    '{"name":"项目","technicalKeywords":["识别"],"trlEvidence":{"deliverableType":"其他","evidence":{}}',
  );

  assert.equal(result.deliverableType, "其他");
  assert.deepEqual(result.evidence, {});
});

test("TRL 缺失字段会补齐安全默认值", () => {
  const defaults = createDefaultTrlEvidence();
  const normalized = parseTrlEvidence({
    deliverableType: "不在枚举中的类型",
    evidence: { conceptPlan: "材料中的技术方案原文" },
    confidence: "非常高",
  });

  assert.equal(defaults.deliverableType, "其他");
  assert.equal(defaults.hasRealEnvironmentTest, false);
  assert.deepEqual(defaults.missingEvidence, ["缺少可核验的成熟度证据"]);
  assert.equal(normalized.deliverableType, "其他");
  assert.deepEqual(normalized.evidence.conceptPlan, ["材料中的技术方案原文"]);
  assert.deepEqual(normalized.evidence.realEnvironmentTest, []);
  assert.equal(normalized.confidence, "低");
});

test("AI 返回完整但证据为空的 TRL 矩阵仍属于可计算结构", () => {
  const inspection = inspectTrlEvidencePayload({
    deliverableType: "其他",
    hasConceptPlan: false,
    evidence: {},
    confidence: "低",
  });

  assert.equal(inspection.usable, true);
});

test("AI 未返回证据矩阵或 has 字段时标记为结构不可用", () => {
  const inspection = inspectTrlEvidencePayload({
    deliverableType: "其他",
    confidence: "低",
  });

  assert.equal(inspection.usable, false);
  assert.match(inspection.reason, /缺少 evidence 矩阵和 has\.\.\. 证据字段/);
});

test("trlEvidence 包装字段为空时不会被默认结构伪装成有效证据", () => {
  const inspection = inspectTrlEvidencePayload({ trlEvidence: null });

  assert.equal(inspection.usable, false);
  assert.match(inspection.reason, /缺失或不是 JSON 对象/);
});

test("分层识别输入会从材料全文保留后部成熟度证据", () => {
  const sourceText = `${"基础档案。".repeat(6_000)}系统已在真实客户现场持续稳定运行并完成验收。`;
  const input = buildLayeredRecognitionInput("项目材料.pdf", sourceText);

  assert.match(input, /【项目基础信息区：材料前部】/);
  assert.match(input, /【TRL 成熟度证据区：从全文检索得到/);
  assert.match(input, /真实客户现场持续稳定运行并完成验收/);
});

test("字符串形式的技术关键词可按常见分隔符归一化", () => {
  assert.deepEqual(
    normalizeTechnicalKeywords("数字孪生、故障诊断，智能运维\n边缘计算"),
    ["数字孪生", "故障诊断", "智能运维", "边缘计算"],
  );
});

test("JSON 截断时仍可保留已经完整返回的基础档案字段", () => {
  const result = extractLooseProjectProfile(
    '{"name":"稳定性项目","summary":"用于验证容错","field":"人工智能与数字技术","technicalKeywords":["识别","容错"],"trlEvidence":{',
  );

  assert.equal(result.name, "稳定性项目");
  assert.equal(result.summary, "用于验证容错");
  assert.deepEqual(result.technicalKeywords, ["识别", "容错"]);
});

test("页面原型和功能构想保持在 TRL 2-3", () => {
  const result = assess(
    "项目已形成应用设想、功能清单、页面原型和产品流程图，页面中的订单、价格和评价均为演示数据。",
    "软件系统/平台/App/SaaS",
  );

  assert.ok(["TRL 2", "TRL 3"].includes(result.trl));
  assert.equal(result.matrix.trl9Qualified, false);
});

test("AI 布尔值或无来源摘录波动不会改变后端最终等级", () => {
  const text =
    "项目已形成应用设想、页面原型和产品流程图，所有订单与评价均为演示数据。";
  const baseline = assess(text, "软件系统/平台/App/SaaS");
  const noisyEvidence = emptyEvidence("软件系统/平台/App/SaaS");

  for (const key of Object.keys(noisyEvidence)) {
    if (key.startsWith("has")) noisyEvidence[key] = true;
  }
  for (const key of evidenceKeys) {
    noisyEvidence.evidence[key] = ["材料中并不存在的量产、验收和回款描述"];
  }

  const noisyResult = assessTrlFromEvidence(noisyEvidence, text);

  assert.equal(noisyResult.trl, baseline.trl);
  assert.equal(noisyResult.matrix.trl9Qualified, false);
});

test("真实用户使用并记录测试数据可进入 TRL 7", () => {
  const result = assess(
    "测试选取了167名学生作为测试对象。第二阶段中，测试对象使用设备进行日常练习。项目记录测试对象的学习时间、使用频率、速度和准确率，经过阶段测试后通过数据对比评估实用性和可行性。",
    "硬件设备/智能装备",
  );

  assert.equal(result.trl, "TRL 7");
  assert.equal(result.matrix.realEnvironmentTest, true);
});

test("MVP 在模拟或相关环境测试通过可评为 TRL 6", () => {
  const result = assess(
    "项目已完成可运行MVP，并在模拟环境中完成性能测试，测试结果满足预定要求。",
    "软件系统/平台/App/SaaS",
  );

  assert.equal(result.trl, "TRL 6");
  assert.equal(result.matrix.simulatedOrRelevantValidation, true);
});

test("软件可运行 Demo 与静态页面原型区分并进入 TRL 4", () => {
  const result = assess(
    "软件已完成可运行Demo，可演示主要功能。",
    "软件系统/平台/App/SaaS",
  );

  assert.equal(result.trl, "TRL 4");
  assert.equal(result.matrix.softwareExecutableArtifact, true);
  assert.equal(result.matrix.realEnvironmentTest, false);
});

test("软件内部测试通过但未完成真实场景验证时为 TRL 5", () => {
  const result = assess(
    "软件已完成可运行内部测试版，内部测试通过。",
    "软件系统/平台/App/SaaS",
  );

  assert.equal(result.trl, "TRL 5");
  assert.equal(result.matrix.realEnvironmentTest, false);
});

test("软件内部测试版和主链路跑通但无真实使用证明时最高为 TRL 6", () => {
  const result = assess(
    "软件内部测试版已完成，可运行MVP，主链路已跑通，核心功能完成，内部测试通过。",
    "软件系统/平台/App/SaaS",
  );

  assert.equal(result.trl, "TRL 6");
  assert.equal(result.matrix.realEnvironmentTest, false);
});

test("宽泛测试和场景词即使被 AI 标记也不能升级真实环境证据", () => {
  const text =
    "功能说明包含测试模块、客户验证问题、应用场景分类和用户体验栏目，用于展示核心流程。";
  const evidence = emptyEvidence("软件系统/平台/App/SaaS");
  evidence.hasRealEnvironmentTest = true;
  evidence.evidence.realEnvironmentTest = [text];
  const result = assessTrlFromEvidence(evidence, text);

  assert.equal(result.matrix.realEnvironmentTest, false);
  assert.ok(Number(result.trl.replace("TRL ", "")) < 7);
});

test("高等级字段名称或孤立结论不能直接进入 verified evidence", () => {
  const text =
    "材料目录列出产品定型、生产条件、认证、使用证明、批量交付和销售收入等章节。";
  const evidence = emptyEvidence("软件系统/平台/App/SaaS");
  evidence.hasProductFinalization = true;
  evidence.hasProductionReadiness = true;
  evidence.hasCertificationOrMarketAccess = true;
  evidence.hasActualUseProof = true;
  evidence.hasBatchDeliveryOrMassProduction = true;
  evidence.hasCommercialRevenue = true;
  evidence.evidence.productFinalization = ["产品定型"];
  evidence.evidence.productionReadiness = ["生产条件"];
  evidence.evidence.certificationOrMarketAccess = ["认证"];
  evidence.evidence.actualUseProof = ["使用证明"];
  evidence.evidence.batchDeliveryOrMassProduction = ["批量交付"];
  evidence.evidence.commercialRevenue = ["销售收入"];
  const result = assessTrlFromEvidence(evidence, text);

  assert.equal(result.matrix.productFinalization, false);
  assert.equal(result.matrix.productionReadiness, false);
  assert.equal(result.matrix.certificationOrMarketAccess, false);
  assert.equal(result.matrix.actualUseProof, false);
  assert.equal(result.matrix.batchDeliveryOrMassProduction, false);
  assert.equal(result.matrix.commercialRevenue, false);
});

test("真实对象、实际使用和结果记录组合可升级为 TRL 7", () => {
  const result = assess(
    "系统已在真实赛事中供20名选手完成训练，并收集训练反馈和报告使用记录。",
    "软件系统/平台/App/SaaS",
  );

  assert.equal(result.trl, "TRL 7");
  assert.equal(result.matrix.realEnvironmentTest, true);
  assert.equal(result.matrix.actualUseProof, false);
});

test("客户机构部署、持续运行和验收证明可升级为 TRL 8", () => {
  const result = assess(
    "系统已在客户机构部署运行3个月，完成验收并形成使用证明。",
    "软件系统/平台/App/SaaS",
  );

  assert.equal(result.trl, "TRL 8");
  assert.equal(result.matrix.realEnvironmentTest, true);
  assert.equal(result.matrix.actualUseProof, true);
});

test("否定的正式使用和验收描述不能构成实际使用证明", () => {
  const result = assess(
    "实际客户没有正式使用系统，也未通过现场验收。",
    "软件系统/平台/App/SaaS",
  );

  assert.equal(result.matrix.realEnvironmentTest, false);
  assert.equal(result.matrix.actualUseProof, false);
  assert.ok(Number(result.trl.replace("TRL ", "")) < 7);
});

test("同句中的未认证不能抹掉已经完成的真实客户试用", () => {
  const result = assess(
    "系统已在真实客户现场试用，收集了用户反馈，但尚未通过认证。",
    "软件系统/平台/App/SaaS",
  );

  assert.equal(result.trl, "TRL 7");
  assert.equal(result.matrix.realEnvironmentTest, true);
  assert.equal(result.matrix.certificationOrMarketAccess, false);
  assert.equal(result.matrix.actualUseProof, false);
});

test("无标点转折中的否定证据按子句隔离", () => {
  const result = assess(
    "系统已在真实客户现场试用并收集反馈但未完成现场验收",
    "软件系统/平台/App/SaaS",
  );

  assert.equal(result.matrix.realEnvironmentTest, true);
  assert.equal(result.matrix.actualUseProof, false);
});

test("真实设备接入和认证可将船舶数据系统评为 TRL 8", () => {
  const result = assess(
    "软件系统已接入26艘船舶新能源系统，开展全天候监测。系统已通过船级社认证和型式认可。",
    "软件系统/平台/App/SaaS",
  );

  assert.equal(result.trl, "TRL 8");
  assert.equal(result.matrix.realEnvironmentTest, true);
  assert.equal(result.matrix.certificationOrMarketAccess, true);
  assert.equal(result.matrix.trl9Qualified, false);
});

test("后端可从全文将明确的数据系统从其他归一化为软件交付物", () => {
  const evidence = parseTrlEvidence(
    emptyEvidence("其他"),
    "项目主要交付物为新能源数据系统和全天候监测平台。",
  );

  assert.equal(evidence.deliverableType, "软件系统/平台/App/SaaS");
});

test("已量产、批量交付并有实际使用证明的硬件可评为 TRL 9", () => {
  const result = assess(
    "硬件设备已正式量产并批量交付，生产条件完备，取得市场准入认证，已正式投入使用并收到销售回款。",
    "硬件设备/智能装备",
  );

  assert.equal(result.trl, "TRL 9");
  assert.equal(result.matrix.trl9Qualified, true);
});

test("软件实际任务运行和稳定记录但未全面应用时为 TRL 8", () => {
  const result = assess(
    "软件系统已在实际任务运行中满足所有使用要求，形成使用证明和持续稳定运行记录。",
    "软件系统/平台/App/SaaS",
  );

  assert.equal(result.trl, "TRL 8");
});

test("软件全面应用并有持续客户使用及商业回款证据时可为 TRL 9", () => {
  const result = assess(
    "系统已在真实客户业务系统正式上线运行，正式客户持续使用并形成稳定运行记录，现已全面应用并取得实际销售回款。",
    "软件系统/平台/App/SaaS",
  );

  assert.equal(result.trl, "TRL 9");
  assert.equal(result.matrix.trl9Qualified, true);
});

test("订单、协议、融资、预测、获奖和专利不能单独构成 TRL 9", () => {
  const result = assess(
    "项目获得奖项和专利，签署合作协议，取得订单意向，正在制定融资计划，预计未来收入可观，目标市场规模巨大。",
    "硬件设备/智能装备",
  );

  assert.notEqual(result.trl, "TRL 9");
  assert.equal(result.matrix.trl9Qualified, false);
});

test("历史数据集准确率不能替代算法实际运行证明", () => {
  const result = assess(
    "算法已获得软件著作权，在历史数据集上的准确率达到99%，计划未来接入客户业务。",
    "方法/算法/数据处理系统",
  );

  assert.ok(Number(result.trl.replace("TRL ", "")) < 7);
  assert.equal(result.matrix.actualUseProof, false);
});

test("利润、盈亏平衡和投资回报等 TIRL 10-13 变量不抬升 TRL", () => {
  const result = assess(
    "项目利润率达到预期，已测算盈亏平衡点和投资回报率，并制定人才、管理与资金计划。",
    "其他",
  );

  assert.notEqual(result.trl, "TRL 9");
  assert.equal(result.matrix.trl9Qualified, false);
});

test("判断依据包含推荐等级、关键证据、缺失证据和置信度", () => {
  const result = assess("项目已形成应用设想和功能模型。", "其他");

  assert.match(result.reason, /推荐 TRL：TRL [1-9]/);
  assert.match(result.reason, /关键支撑证据：/);
  assert.match(result.reason, /缺失证据：/);
  assert.match(result.reason, /置信度：(高|中|低)/);
});
