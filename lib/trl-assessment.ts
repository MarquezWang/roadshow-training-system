export const DELIVERABLE_TYPES = [
  "软件系统/平台/App/SaaS",
  "硬件设备/智能装备",
  "工业系统/工程装备/成套解决方案",
  "方法/算法/数据处理系统",
  "工艺/生产流程",
  "服务/课程/培训",
  "新材料",
  "医疗器械",
  "生产线/新工厂建设",
  "其他",
] as const;

export type DeliverableType = (typeof DELIVERABLE_TYPES)[number];
export type TrlConfidence = "高" | "中" | "低";

type EvidenceMatrix = {
  conceptPlan: string[];
  architectureOrModel: string[];
  prototype: string[];
  labValidation: string[];
  simulatedOrRelevantValidation: string[];
  realEnvironmentTest: string[];
  productFinalization: string[];
  productionReadiness: string[];
  certificationOrMarketAccess: string[];
  actualUseProof: string[];
  batchDeliveryOrMassProduction: string[];
  commercialRevenue: string[];
  auxiliarySignals: string[];
};

const EVIDENCE_KEYS: Array<keyof EvidenceMatrix> = [
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
const TRL_BOOLEAN_KEYS = [
  "hasConceptPlan",
  "hasArchitectureOrModel",
  "hasPrototype",
  "hasLabValidation",
  "hasSimulatedOrRelevantValidation",
  "hasRealEnvironmentTest",
  "hasProductFinalization",
  "hasProductionReadiness",
  "hasCertificationOrMarketAccess",
  "hasActualUseProof",
  "hasBatchDeliveryOrMassProduction",
  "hasCommercialRevenue",
] as const;

export type TrlEvidence = {
  deliverableType: DeliverableType;
  hasConceptPlan: boolean;
  hasArchitectureOrModel: boolean;
  hasPrototype: boolean;
  hasLabValidation: boolean;
  hasSimulatedOrRelevantValidation: boolean;
  hasRealEnvironmentTest: boolean;
  hasProductFinalization: boolean;
  hasProductionReadiness: boolean;
  hasCertificationOrMarketAccess: boolean;
  hasActualUseProof: boolean;
  hasBatchDeliveryOrMassProduction: boolean;
  hasCommercialRevenue: boolean;
  evidence: EvidenceMatrix;
  missingEvidence: string[];
  confidence: TrlConfidence;
};

const PROFILE_TEXT_LIMIT = 30_000;
const MATURITY_EVIDENCE_TEXT_LIMIT = 50_000;
const MATURITY_KEYWORDS = [
  "技术方案",
  "体系架构",
  "功能模型",
  "仿真",
  "样机",
  "样件",
  "Demo",
  "MVP",
  "实验室",
  "测试",
  "验证",
  "模拟环境",
  "相关环境",
  "实际环境",
  "生产现场",
  "操作现场",
  "客户现场",
  "试用",
  "试点",
  "接入",
  "运行",
  "产品定型",
  "技术资料归档",
  "小批试产",
  "生产条件",
  "认证",
  "型式认可",
  "市场准入",
  "检测合格",
  "验收",
  "使用证明",
  "稳定运行",
  "量产",
  "批量生产",
  "批量交付",
  "全面应用",
  "销售回款",
] as const;
const PROSPECTIVE_OR_NEGATIVE_PATTERN =
  /(计划|规划|预计|预期|目标|将于|待实现|尚未|未见|未有|暂无|未来|力争|意向|拟(?:于|在|将|开展|建设|实施|完成|投入|部署|接入|申请|进行|实现|量产|交付|生产|销售|推广|上线))/i;
const EVIDENCE_PATTERNS: Record<keyof EvidenceMatrix, RegExp> = {
  conceptPlan:
    /(技术方案|应用设想|技术路线|功能清单|需求方案|解决方案|总体方案)/i,
  architectureOrModel:
    /(体系架构|系统架构|功能模型|原理模型|仿真|关键功能论证|数据模型|流程框图)/i,
  prototype:
    /(原型|样机|样件|初样|正样|试制品|Demo|MVP|初步系统|演示系统|源代码程序|完整系统)/i,
  labValidation:
    /(实验室.{0,20}(验证|测试)|关键功能.{0,20}(验证通过|测试通过|达标)|实验验证通过|测试报告|检测报告|测试结果|实验结果)/i,
  simulatedOrRelevantValidation:
    /(模拟环境|相关环境|接近真实环境|工程样机|正样|中试环境).{0,30}(测试|验证|运行|合格|满足要求)/i,
  realEnvironmentTest:
    /((实际|真实|生产|操作|客户|用户).{0,24}(现场|环境|场景|任务).{0,40}(测试|试用|接入|运行|应用))|((测试|试用|接入|运行|应用).{0,40}(实际|真实|生产|操作|客户|学校|医院|设备))|(已接入|已部署|已应用|已试用).{0,50}(设备|系统|平台|客户|用户|机构|现场)/i,
  productFinalization:
    /(产品定型|系统定型|设计定型|技术资料归档|不再修改|规格冻结|版本定版)/i,
  productionReadiness:
    /(小批试产合格|生产条件完备|工艺基本稳定|工艺成熟|生产线.{0,12}(建成|就绪|完备)|代工.{0,12}(准备|就绪)|可批量生产|量产准备)/i,
  certificationOrMarketAccess:
    /(认证|型式认可|市场准入|准入许可|检测合格|注册证|许可证|质量合格|符合.{0,12}(标准|规范))/i,
  actualUseProof:
    /(实际任务运行.{0,30}(满足全部|满足所有|符合全部).{0,12}要求|使用证明|验收证明|稳定运行记录|持续稳定运行|正式投入使用|现场验收|交钥匙|运行测试验收)/i,
  batchDeliveryOrMassProduction:
    /(大批量生产|规模化生产|正式量产|已量产|批量交付|多批交付|批量部署|全面应用|规模化应用|规模化推广|正式交付使用|投入大批量生产运行)/i,
  commercialRevenue:
    /(销售回款|收到货款|销售收入到账|实际销售收入|销售发票|销售统计|批量销售)/i,
  auxiliarySignals:
    /(订单意向|合作协议|融资计划|未来收入|收入预测|市场规模|短期运行无故障|历史数据集.{0,16}准确率|获奖|专利|软著|页面原型|演示系统)/i,
};
const HIGH_EVIDENCE_KEYS = new Set<keyof EvidenceMatrix>([
  "realEnvironmentTest",
  "productFinalization",
  "productionReadiness",
  "certificationOrMarketAccess",
  "actualUseProof",
  "batchDeliveryOrMassProduction",
  "commercialRevenue",
]);
const REAL_SUBJECT_OR_ENVIRONMENT_PATTERN =
  /((真实|实际|正式|生产|客户).{0,20}(用户|客户|学校|医院|船舶|设备|工厂|产线|赛事|机构|业务系统|业务场景|任务|现场|环境))|(\d+\s*(名|位|个|艘|台|家|所).{0,24}(用户|客户|学生|选手|受试者|患者|教师|船舶|设备|机构|学校))|(测试对象|受试者|客户机构|生产现场|操作现场|客户现场|实际任务|真实场景|真实环境)/i;
const ACTUAL_USE_ACTION_PATTERN =
  /((已|正在|实际|正式|完成|开展|投入|供).{0,40}(试用|部署|接入|运行|上线|现场测试|训练|使用|投入运行))|((测试对象|受试者|\d+\s*(名|位|个).{0,20}(用户|学生|选手|患者|客户)).{0,35}(使用|试用|训练|练习|操作))/i;
const PROCESS_OR_RESULT_PROOF_PATTERN =
  /(反馈|数据|记录|验收|运行证明|使用证明|测试结果|使用频率|使用时间|准确率|稳定运行.{0,12}(时长|\d+|月|天|年)|运行.{0,8}\d+\s*(个月|月|天|年)|报告|全天候监测)/i;
const STRONG_ACTUAL_USE_PROOF_PATTERN =
  /(完成.{0,12}验收|验收.{0,12}(通过|完成|证明)|使用证明|运行证明|持续稳定运行|稳定运行记录|运行.{0,8}\d+\s*(个月|月|天|年)|实际任务运行.{0,30}(满足全部|满足所有|符合全部).{0,12}要求|正式投入使用|现场验收|交钥匙)/i;
const COMPLETED_RESULT_PATTERN =
  /(已|正式|完成|通过|取得|获得|颁发|批准|合格|完备|稳定|建成|就绪|到账|收到|开具|持续)/i;
const SOFTWARE_EXECUTABLE_ARTIFACT_PATTERN =
  /(可运行|Demo|MVP|内部测试版|测试版本|初步系统|完整系统)/i;
const SOFTWARE_INTERNAL_TEST_RESULT_PATTERN =
  /(内部测试.{0,24}(通过|完成|达标))|((通过|完成|达标).{0,24}内部测试)/i;
const SOFTWARE_CORE_FLOW_RESULT_PATTERN =
  /((主链路|核心流程|核心功能).{0,24}(通过|跑通|完成|达标))|((通过|跑通|完成|达标).{0,24}(主链路|核心流程|核心功能))/i;
const DELIVERABLE_ALIASES: Array<{
  type: DeliverableType;
  pattern: RegExp;
}> = [
  {
    type: "生产线/新工厂建设",
    pattern: /(生产线|新工厂|工厂建设|产线建设|生产基地)/i,
  },
  {
    type: "医疗器械",
    pattern: /(医疗器械|医疗仪器|诊断设备|治疗设备)/i,
  },
  {
    type: "新材料",
    pattern: /(新材料|复合材料|功能材料|材料制备)/i,
  },
  {
    type: "工艺/生产流程",
    pattern: /(生产工艺|工艺流程|制造流程|制备工艺)/i,
  },
  {
    type: "方法/算法/数据处理系统",
    pattern: /(方法|算法|数据处理|分析模型|计算模型)/i,
  },
  {
    type: "软件系统/平台/App/SaaS",
    pattern:
      /(软件系统|软件平台|平台系统|App|SaaS|小程序|信息系统|数据系统|监测平台|管理平台|信息平台)/i,
  },
  {
    type: "工业系统/工程装备/成套解决方案",
    pattern: /(工业系统|工程装备|成套系统|成套解决方案|工程系统)/i,
  },
  {
    type: "硬件设备/智能装备",
    pattern: /(硬件设备|智能装备|智能设备|仪器|装置|机器)/i,
  },
  {
    type: "服务/课程/培训",
    pattern: /(服务模式|课程|培训|咨询服务|运营服务)/i,
  },
];

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

export function inspectTrlEvidencePayload(value: unknown):
  | {
      usable: true;
      payload: Record<string, unknown>;
      wrapped: boolean;
    }
  | {
      usable: false;
      reason: string;
      wrapped: boolean;
    } {
  if (!isRecord(value)) {
    return {
      usable: false,
      reason: "AI 返回的 TRL 顶层不是 JSON 对象",
      wrapped: false,
    };
  }

  const wrapped = Object.prototype.hasOwnProperty.call(value, "trlEvidence");
  const candidate = wrapped ? value.trlEvidence : value;

  if (!isRecord(candidate)) {
    return {
      usable: false,
      reason: wrapped
        ? "trlEvidence 缺失或不是 JSON 对象"
        : "未找到 trlEvidence 对象或直接证据对象",
      wrapped,
    };
  }

  const hasEvidenceMatrix = isRecord(candidate.evidence);
  const booleanFieldCount = TRL_BOOLEAN_KEYS.filter(
    (key) => typeof candidate[key] === "boolean",
  ).length;

  if (!hasEvidenceMatrix && booleanFieldCount === 0) {
    return {
      usable: false,
      reason: "trlEvidence 缺少 evidence 矩阵和 has... 证据字段",
      wrapped,
    };
  }

  return {
    usable: true,
    payload: candidate,
    wrapped,
  };
}

function readBoolean(value: unknown) {
  return value === true;
}

function uniqueStrings(values: string[], limit = 10) {
  return [...new Set(values.map((item) => item.trim()).filter(Boolean))].slice(
    0,
    limit,
  );
}

function readStringArray(value: unknown) {
  if (typeof value === "string") {
    return uniqueStrings([value]);
  }

  if (!Array.isArray(value)) return [];
  return uniqueStrings(value.filter((item): item is string => typeof item === "string"));
}

function normalizeDeliverableType(value: unknown, sourceText: string) {
  if (typeof value === "string") {
    const exact = DELIVERABLE_TYPES.find((item) => item === value.trim());

    if (exact && exact !== "其他") return exact;

    const alias = DELIVERABLE_ALIASES.find((item) =>
      item.pattern.test(value),
    );

    if (alias && alias.type !== "其他") return alias.type;

    if (!exact) return "其他";
  }

  return (
    DELIVERABLE_ALIASES.find((item) => item.pattern.test(sourceText))?.type ??
    "其他"
  );
}

function readConfidence(value: unknown): TrlConfidence {
  return value === "高" || value === "中" || value === "低" ? value : "低";
}

function createEmptyEvidenceMatrix(): EvidenceMatrix {
  return {
    conceptPlan: [],
    architectureOrModel: [],
    prototype: [],
    labValidation: [],
    simulatedOrRelevantValidation: [],
    realEnvironmentTest: [],
    productFinalization: [],
    productionReadiness: [],
    certificationOrMarketAccess: [],
    actualUseProof: [],
    batchDeliveryOrMassProduction: [],
    commercialRevenue: [],
    auxiliarySignals: [],
  };
}

export function createDefaultTrlEvidence(): TrlEvidence {
  return {
    deliverableType: "其他",
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
    evidence: createEmptyEvidenceMatrix(),
    missingEvidence: ["缺少可核验的成熟度证据"],
    confidence: "低",
  };
}

export function parseTrlEvidence(
  value: unknown,
  sourceText = "",
): TrlEvidence {
  const defaults = createDefaultTrlEvidence();
  const record = isRecord(value) ? value : {};
  const evidenceRecord = isRecord(record.evidence) ? record.evidence : {};

  const evidence = {} as EvidenceMatrix;

  for (const key of EVIDENCE_KEYS) {
    evidence[key] = readStringArray(evidenceRecord[key]);
  }

  return {
    deliverableType: normalizeDeliverableType(record.deliverableType, sourceText),
    hasConceptPlan: readBoolean(record.hasConceptPlan),
    hasArchitectureOrModel: readBoolean(record.hasArchitectureOrModel),
    hasPrototype: readBoolean(record.hasPrototype),
    hasLabValidation: readBoolean(record.hasLabValidation),
    hasSimulatedOrRelevantValidation: readBoolean(
      record.hasSimulatedOrRelevantValidation,
    ),
    hasRealEnvironmentTest: readBoolean(record.hasRealEnvironmentTest),
    hasProductFinalization: readBoolean(record.hasProductFinalization),
    hasProductionReadiness: readBoolean(record.hasProductionReadiness),
    hasCertificationOrMarketAccess: readBoolean(
      record.hasCertificationOrMarketAccess,
    ),
    hasActualUseProof: readBoolean(record.hasActualUseProof),
    hasBatchDeliveryOrMassProduction: readBoolean(
      record.hasBatchDeliveryOrMassProduction,
    ),
    hasCommercialRevenue: readBoolean(record.hasCommercialRevenue),
    evidence,
    missingEvidence:
      readStringArray(record.missingEvidence).length > 0
        ? readStringArray(record.missingEvidence)
        : defaults.missingEvidence,
    confidence: readConfidence(record.confidence),
  };
}

function extractMaturityWindows(sourceText: string) {
  const lowerText = sourceText.toLowerCase();
  const windows: Array<{ start: number; text: string; score: number }> = [];

  for (const keyword of MATURITY_KEYWORDS) {
    const lowerKeyword = keyword.toLowerCase();
    let fromIndex = 0;

    while (fromIndex < lowerText.length) {
      const index = lowerText.indexOf(lowerKeyword, fromIndex);

      if (index < 0) break;

      const start = Math.max(0, index - 220);
      const end = Math.min(sourceText.length, index + keyword.length + 480);
      const text = sourceText.slice(start, end).trim();
      const existing = windows.find(
        (item) => Math.abs(item.start - start) < 180 || item.text.includes(text),
      );

      if (existing) existing.score += 1;
      else if (text) windows.push({ start, text, score: 1 });

      fromIndex = index + lowerKeyword.length;
    }
  }

  return windows
    .sort((left, right) => right.score - left.score || left.start - right.start)
    .map((item) => item.text);
}

export function buildLayeredRecognitionInput(
  fileName: string,
  sourceText: string,
) {
  const profileText = sourceText.slice(0, PROFILE_TEXT_LIMIT);
  const selectedWindows: string[] = [];
  let remaining = MATURITY_EVIDENCE_TEXT_LIMIT;

  for (const window of extractMaturityWindows(sourceText)) {
    if (remaining <= 0) break;

    const selected = window.slice(0, remaining);
    selectedWindows.push(selected);
    remaining -= selected.length;
  }

  return [
    `【文件：${fileName}】`,
    "【项目基础信息区：材料前部】",
    profileText,
    "【TRL 成熟度证据区：从全文检索得到，位置不限于材料前部】",
    selectedWindows.join("\n\n---\n\n") || "未检索到明确成熟度证据片段。",
  ].join("\n\n");
}

function normalizeForMatch(value: string) {
  return value.toLowerCase().replace(/\s+/g, "");
}

function sourceSegments(sourceText: string) {
  return sourceText
    .split(/[\n。！？；]+/)
    .map((segment) => segment.trim())
    .filter(
      (segment) =>
        segment.length >= 4 &&
        segment.length <= 600 &&
        !PROSPECTIVE_OR_NEGATIVE_PATTERN.test(segment),
    );
}

function verifyAiEvidence(
  sourceText: string,
  values: string[],
  pattern: RegExp,
) {
  const normalizedSource = normalizeForMatch(sourceText);

  return values.filter((value) => {
    const normalizedValue = normalizeForMatch(value);

    return (
      normalizedValue.length >= 4 &&
      normalizedSource.includes(normalizedValue) &&
      pattern.test(value) &&
      !PROSPECTIVE_OR_NEGATIVE_PATTERN.test(value)
    );
  });
}

function verifyAiSourceQuotes(sourceText: string, values: string[]) {
  const normalizedSource = normalizeForMatch(sourceText);

  return values.filter((value) => {
    const normalizedValue = normalizeForMatch(value);

    return (
      normalizedValue.length >= 4 &&
      normalizedSource.includes(normalizedValue) &&
      !PROSPECTIVE_OR_NEGATIVE_PATTERN.test(value)
    );
  });
}

function matchingSegments(segments: string[], pattern: RegExp) {
  return uniqueStrings(segments.filter((segment) => pattern.test(segment)));
}

function sourceEvidenceWindows(sourceText: string) {
  const segments = sourceText
    .split(/[\n。！？；]+/)
    .map((segment) => segment.trim())
    .filter((segment) => segment.length >= 4 && segment.length <= 600);
  const windows: string[] = [];

  for (let start = 0; start < segments.length; start += 1) {
    let window = "";

    for (
      let index = start;
      index < Math.min(segments.length, start + 4);
      index += 1
    ) {
      const segment = segments[index];
      if (PROSPECTIVE_OR_NEGATIVE_PATTERN.test(segment)) break;

      window = window ? `${window}。${segment}` : segment;
      windows.push(window);
    }
  }

  return [...new Set(windows)];
}

function validatesRealEnvironmentTest(text: string) {
  return (
    REAL_SUBJECT_OR_ENVIRONMENT_PATTERN.test(text) &&
    ACTUAL_USE_ACTION_PATTERN.test(text) &&
    PROCESS_OR_RESULT_PROOF_PATTERN.test(text)
  );
}

function validatesActualUseProof(text: string) {
  return (
    REAL_SUBJECT_OR_ENVIRONMENT_PATTERN.test(text) &&
    ACTUAL_USE_ACTION_PATTERN.test(text) &&
    STRONG_ACTUAL_USE_PROOF_PATTERN.test(text)
  );
}

function validatesProductFinalization(text: string) {
  return (
    /(产品|系统|设计|技术资料|规格|版本)/i.test(text) &&
    /(定型|归档|冻结|定版|不再修改)/i.test(text) &&
    COMPLETED_RESULT_PATTERN.test(text)
  );
}

function validatesProductionReadiness(text: string) {
  return (
    /(小批试产|生产条件|工艺|生产线|代工|量产准备)/i.test(text) &&
    /(合格|完备|稳定|建成|就绪|完成|通过)/i.test(text) &&
    COMPLETED_RESULT_PATTERN.test(text)
  );
}

function validatesCertificationOrMarketAccess(text: string) {
  return (
    /(认证|型式认可|市场准入|准入许可|检测|注册证|许可证)/i.test(text) &&
    COMPLETED_RESULT_PATTERN.test(text)
  );
}

function validatesBatchDeliveryOrMassProduction(text: string) {
  return (
    /(量产|批量生产|批量交付|多批交付|批量部署|全面应用|规模化应用|规模化推广|正式交付使用|正式客户.{0,12}持续使用)/i.test(
      text,
    ) &&
    /(已|正式|完成|多批|大批量|规模化|全面|投入|持续)/i.test(text)
  );
}

function validatesCommercialRevenue(text: string) {
  return (
    /(销售|货款|收入|回款|发票)/i.test(text) &&
    /(已|实际|收到|到账|开具|统计|持续|\d+)/i.test(text)
  );
}

const HIGH_EVIDENCE_GATES: Partial<
  Record<keyof EvidenceMatrix, (text: string) => boolean>
> = {
  realEnvironmentTest: validatesRealEnvironmentTest,
  productFinalization: validatesProductFinalization,
  productionReadiness: validatesProductionReadiness,
  certificationOrMarketAccess: validatesCertificationOrMarketAccess,
  actualUseProof: validatesActualUseProof,
  batchDeliveryOrMassProduction: validatesBatchDeliveryOrMassProduction,
  commercialRevenue: validatesCommercialRevenue,
};

function deriveEvidenceMatrix(evidence: TrlEvidence, sourceText: string) {
  const segments = sourceSegments(sourceText);
  const candidateWindows = sourceEvidenceWindows(sourceText);
  const verified = {} as EvidenceMatrix;

  for (const key of EVIDENCE_KEYS) {
    const gate = HIGH_EVIDENCE_GATES[key];

    if (HIGH_EVIDENCE_KEYS.has(key) && gate) {
      const verifiedAiQuotes = verifyAiSourceQuotes(
        sourceText,
        evidence.evidence[key],
      ).filter((quote) => gate(quote));
      const verifiedCandidates = candidateWindows.filter((window) =>
        gate(window),
      );

      verified[key] = uniqueStrings([
        ...verifiedAiQuotes,
        ...verifiedCandidates,
      ]);
      continue;
    }

    verified[key] = uniqueStrings([
      ...verifyAiEvidence(
        sourceText,
        evidence.evidence[key],
        EVIDENCE_PATTERNS[key],
      ),
      ...matchingSegments(segments, EVIDENCE_PATTERNS[key]),
    ]);
  }

  if (evidence.deliverableType === "软件系统/平台/App/SaaS") {
    const internalTestValidation = candidateWindows.filter(
      (window) =>
        SOFTWARE_EXECUTABLE_ARTIFACT_PATTERN.test(window) &&
        SOFTWARE_INTERNAL_TEST_RESULT_PATTERN.test(window),
    );
    const coreFlowValidation = internalTestValidation.filter((window) =>
      SOFTWARE_CORE_FLOW_RESULT_PATTERN.test(window),
    );

    if (internalTestValidation.length > 0) {
      verified.prototype = uniqueStrings([
        ...verified.prototype,
        ...internalTestValidation,
      ]);
      verified.labValidation = uniqueStrings([
        ...verified.labValidation,
        ...internalTestValidation,
      ]);
    }

    if (coreFlowValidation.length > 0) {
      verified.simulatedOrRelevantValidation = uniqueStrings([
        ...verified.simulatedOrRelevantValidation,
        ...coreFlowValidation,
      ]);
    }
  }

  return verified;
}

function hasVerifiedEvidence(values: string[]) {
  return values.length > 0;
}

function qualifiesForTrl9(
  deliverableType: DeliverableType,
  signals: {
    realEnvironmentTest: boolean;
    productFinalization: boolean;
    productionReadiness: boolean;
    certificationOrMarketAccess: boolean;
    actualUseProof: boolean;
    batchDeliveryOrMassProduction: boolean;
    commercialRevenue: boolean;
  },
) {
  const {
    realEnvironmentTest,
    productFinalization,
    productionReadiness,
    certificationOrMarketAccess,
    actualUseProof,
    batchDeliveryOrMassProduction,
    commercialRevenue,
  } = signals;

  if (deliverableType === "软件系统/平台/App/SaaS") {
    return (
      realEnvironmentTest &&
      actualUseProof &&
      (batchDeliveryOrMassProduction || commercialRevenue)
    );
  }

  if (deliverableType === "方法/算法/数据处理系统") {
    return (
      realEnvironmentTest &&
      actualUseProof &&
      (batchDeliveryOrMassProduction || commercialRevenue)
    );
  }

  if (deliverableType === "工艺/生产流程") {
    return (
      batchDeliveryOrMassProduction &&
      (productFinalization || productionReadiness)
    );
  }

  if (deliverableType === "生产线/新工厂建设") {
    return actualUseProof && batchDeliveryOrMassProduction;
  }

  if (deliverableType === "医疗器械") {
    return (
      certificationOrMarketAccess &&
      actualUseProof &&
      batchDeliveryOrMassProduction
    );
  }

  if (deliverableType === "服务/课程/培训") {
    return actualUseProof && batchDeliveryOrMassProduction;
  }

  if (
    deliverableType === "硬件设备/智能装备" ||
    deliverableType === "工业系统/工程装备/成套解决方案" ||
    deliverableType === "新材料"
  ) {
    return (
      batchDeliveryOrMassProduction &&
      (productionReadiness || productFinalization) &&
      (actualUseProof || certificationOrMarketAccess || commercialRevenue)
    );
  }

  return batchDeliveryOrMassProduction && actualUseProof;
}

function missingEvidenceForLevel(
  level: number,
  deliverableType: DeliverableType,
) {
  if (level >= 9) return [];

  if (level === 8) {
    if (
      deliverableType === "软件系统/平台/App/SaaS" ||
      deliverableType === "方法/算法/数据处理系统"
    ) {
      return ["实际任务运行满足全部使用要求的证明、验收证明或持续稳定运行记录"];
    }

    if (deliverableType === "生产线/新工厂建设") {
      return ["正式交付使用、现场验收/交钥匙或投入大批量生产运行证明"];
    }

    return ["大批量生产、批量交付或全面应用证明", "实际使用、质量体系、市场准入或销售回款证明"];
  }

  if (level === 7) {
    return ["产品定型或技术资料归档证明", "生产交付准备、认证/型式认可或实际环境测试合格证明"];
  }

  if (level === 6) {
    return ["真实生产、操作或客户现场中的测试、接入、试用或运行证明"];
  }

  if (level === 5) {
    return ["工程样机、正样或 MVP 在模拟/相关环境中的测试合格证明"];
  }

  if (level === 4) {
    return ["初样、样件或核心功能测试通过证明"];
  }

  if (level === 3) {
    return ["关键功能实验室验证通过和指标测试结果"];
  }

  return ["架构、模型、仿真或关键功能论证证据", "实验室验证、原型或样机证据"];
}

function confidenceForAssessment(level: number, verified: EvidenceMatrix) {
  const stageEvidenceCount = Object.entries(verified)
    .filter(([key]) => key !== "auxiliarySignals")
    .filter(([, values]) => values.length > 0).length;

  if ((level >= 7 && stageEvidenceCount >= 3) || stageEvidenceCount >= 5) {
    return "高" as const;
  }

  if (stageEvidenceCount >= 2) return "中" as const;
  return "低" as const;
}

function highlightsForLevel(level: number, verified: EvidenceMatrix) {
  const keysByLevel: Array<keyof EvidenceMatrix> =
    level >= 9
      ? [
          "batchDeliveryOrMassProduction",
          "actualUseProof",
          "certificationOrMarketAccess",
          "commercialRevenue",
        ]
      : level === 8
        ? [
            "realEnvironmentTest",
            "productFinalization",
            "productionReadiness",
            "certificationOrMarketAccess",
          ]
        : level === 7
          ? ["realEnvironmentTest"]
          : level === 6
            ? ["prototype", "simulatedOrRelevantValidation"]
            : level === 5
              ? ["prototype", "labValidation"]
              : level === 4
                ? ["labValidation"]
                : level === 3
                  ? ["architectureOrModel", "prototype"]
                  : ["conceptPlan"];

  return uniqueStrings(
    keysByLevel.flatMap((key) => verified[key]),
    4,
  );
}

function buildTooltipReason(
  trl: string,
  deliverableType: DeliverableType,
  highlights: string[],
  missingEvidence: string[],
  confidence: TrlConfidence,
) {
  return [
    `推荐 TRL：${trl}`,
    `交付物类型：${deliverableType}`,
    `关键支撑证据：${
      highlights.length > 0
        ? highlights.map((item) => `“${item.slice(0, 120)}”`).join("；")
        : "未检索到可核验的阶段性证据"
    }`,
    `缺失证据：${missingEvidence.join("；") || "当前等级所需关键证据已基本齐备"}`,
    `置信度：${confidence}`,
  ].join("\n");
}

export function assessTrlFromEvidence(
  evidence: TrlEvidence,
  sourceText: string,
) {
  const verified = deriveEvidenceMatrix(evidence, sourceText);
  const conceptPlan = hasVerifiedEvidence(verified.conceptPlan);
  const architectureOrModel = hasVerifiedEvidence(
    verified.architectureOrModel,
  );
  const prototype = hasVerifiedEvidence(verified.prototype);
  const labValidation = hasVerifiedEvidence(verified.labValidation);
  const simulatedOrRelevantValidation = hasVerifiedEvidence(
    verified.simulatedOrRelevantValidation,
  );
  const actualUseProof = hasVerifiedEvidence(verified.actualUseProof);
  const realEnvironmentTest =
    hasVerifiedEvidence(verified.realEnvironmentTest) || actualUseProof;
  const productFinalization = hasVerifiedEvidence(
    verified.productFinalization,
  );
  const productionReadiness = hasVerifiedEvidence(
    verified.productionReadiness,
  );
  const certificationOrMarketAccess = hasVerifiedEvidence(
    verified.certificationOrMarketAccess,
  );
  const batchDeliveryOrMassProduction = hasVerifiedEvidence(
    verified.batchDeliveryOrMassProduction,
  );
  const commercialRevenue = hasVerifiedEvidence(verified.commercialRevenue);
  const softwareExecutableArtifact =
    evidence.deliverableType === "软件系统/平台/App/SaaS" &&
    verified.prototype.some((item) =>
      SOFTWARE_EXECUTABLE_ARTIFACT_PATTERN.test(item),
    );
  let level = 1;

  if (conceptPlan) level = 2;
  if (architectureOrModel || prototype) level = 3;
  if (labValidation || softwareExecutableArtifact) level = 4;
  if (prototype && labValidation) level = 5;
  if (prototype && simulatedOrRelevantValidation) level = 6;
  if (realEnvironmentTest) level = 7;
  if (
    realEnvironmentTest &&
    (productFinalization ||
      productionReadiness ||
      certificationOrMarketAccess ||
      actualUseProof)
  ) {
    level = 8;
  }

  const trl9Qualified = qualifiesForTrl9(evidence.deliverableType, {
    realEnvironmentTest,
    productFinalization,
    productionReadiness,
    certificationOrMarketAccess,
    actualUseProof,
    batchDeliveryOrMassProduction,
    commercialRevenue,
  });

  if (trl9Qualified) level = 9;

  const trl = `TRL ${level}`;
  const missingEvidence = missingEvidenceForLevel(
    level,
    evidence.deliverableType,
  );
  const confidence = confidenceForAssessment(level, verified);
  const highlights = highlightsForLevel(level, verified);

  return {
    trl,
    deliverableType: evidence.deliverableType,
    reason: buildTooltipReason(
      trl,
      evidence.deliverableType,
      highlights,
      missingEvidence,
      confidence,
    ),
    keyEvidence: highlights,
    missingEvidence,
    confidence,
    verifiedEvidence: verified,
    matrix: {
      conceptPlan,
      architectureOrModel,
      prototype,
      labValidation,
      simulatedOrRelevantValidation,
      realEnvironmentTest,
      productFinalization,
      productionReadiness,
      certificationOrMarketAccess,
      actualUseProof,
      batchDeliveryOrMassProduction,
      commercialRevenue,
      softwareExecutableArtifact,
      trl9Qualified,
    },
  };
}
