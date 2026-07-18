import { EVIDENCE_KEYS, type EvidenceMatrix, type TrlEvidence } from "./types";
import { uniqueStrings } from "./utils";

const PROSPECTIVE_PATTERN =
  /(计划|规划|预计|预期|目标|将于|待实现|未来|力争|意向|拟(?:于|在|将|开展|建设|实施|完成|投入|部署|接入|申请|进行|实现|量产|交付|生产|销售|推广|上线))/i;
const NEGATIVE_EVIDENCE_PATTERN =
  /(尚未|还未|仍未|未曾|未见|未有|未能|未予|未通过|未完成|未取得|未获得|未形成|未投入|未正式|未实现|未开始|未达到|没有|尚无|暂无|缺少|欠缺|不存在|不具备|不符合|不满足|并非|不是|不代表)/i;
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
export const SOFTWARE_EXECUTABLE_ARTIFACT_PATTERN =
  /(可运行|Demo|MVP|内部测试版|测试版本|初步系统|完整系统)/i;
const SOFTWARE_INTERNAL_TEST_RESULT_PATTERN =
  /(内部测试.{0,24}(通过|完成|达标))|((通过|完成|达标).{0,24}内部测试)/i;
const SOFTWARE_CORE_FLOW_RESULT_PATTERN =
  /((主链路|核心流程|核心功能).{0,24}(通过|跑通|完成|达标))|((通过|跑通|完成|达标).{0,24}(主链路|核心流程|核心功能))/i;

function normalizeForMatch(value: string) {
  return value.toLowerCase().replace(/\s+/g, "");
}

function hasDisqualifyingPolarity(value: string) {
  return (
    PROSPECTIVE_PATTERN.test(value) || NEGATIVE_EVIDENCE_PATTERN.test(value)
  );
}

function splitEvidenceClauses(sourceText: string) {
  return sourceText
    .split(/[\n。！？；，,]+|(?:但是|然而|不过|但)/)
    .map((segment) => segment.trim())
    .filter((segment) => segment.length >= 4 && segment.length <= 600);
}

function sourceSegments(sourceText: string) {
  return splitEvidenceClauses(sourceText).filter(
    (segment) => !hasDisqualifyingPolarity(segment),
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
      !hasDisqualifyingPolarity(value)
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
      !hasDisqualifyingPolarity(value)
    );
  });
}

function matchingSegments(segments: string[], pattern: RegExp) {
  return uniqueStrings(segments.filter((segment) => pattern.test(segment)));
}

function sourceEvidenceWindows(sourceText: string) {
  const segments = splitEvidenceClauses(sourceText);
  const windows: string[] = [];

  for (let start = 0; start < segments.length; start += 1) {
    let window = "";

    for (
      let index = start;
      index < Math.min(segments.length, start + 4);
      index += 1
    ) {
      const segment = segments[index];
      if (hasDisqualifyingPolarity(segment)) break;

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
    ) && /(已|正式|完成|多批|大批量|规模化|全面|投入|持续)/i.test(text)
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

export function deriveEvidenceMatrix(
  evidence: TrlEvidence,
  sourceText: string,
) {
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
