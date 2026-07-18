import {
  deriveEvidenceMatrix,
  SOFTWARE_EXECUTABLE_ARTIFACT_PATTERN,
} from "./evidence-verification";
import type {
  DeliverableType,
  EvidenceMatrix,
  TrlConfidence,
  TrlEvidence,
} from "./types";
import { uniqueStrings } from "./utils";

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

    return [
      "大批量生产、批量交付或全面应用证明",
      "实际使用、质量体系、市场准入或销售回款证明",
    ];
  }

  if (level === 7) {
    return [
      "产品定型或技术资料归档证明",
      "生产交付准备、认证/型式认可或实际环境测试合格证明",
    ];
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
  const architectureOrModel = hasVerifiedEvidence(verified.architectureOrModel);
  const prototype = hasVerifiedEvidence(verified.prototype);
  const labValidation = hasVerifiedEvidence(verified.labValidation);
  const simulatedOrRelevantValidation = hasVerifiedEvidence(
    verified.simulatedOrRelevantValidation,
  );
  const actualUseProof = hasVerifiedEvidence(verified.actualUseProof);
  const realEnvironmentTest =
    hasVerifiedEvidence(verified.realEnvironmentTest) || actualUseProof;
  const productFinalization = hasVerifiedEvidence(verified.productFinalization);
  const productionReadiness = hasVerifiedEvidence(verified.productionReadiness);
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
