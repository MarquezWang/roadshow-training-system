import { isRecord } from "@/lib/type-guards";
import {
  DELIVERABLE_TYPES,
  EVIDENCE_KEYS,
  TRL_BOOLEAN_KEYS,
  type DeliverableType,
  type EvidenceMatrix,
  type TrlConfidence,
  type TrlEvidence,
} from "./types";
import { uniqueStrings } from "./utils";

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

function readStringArray(value: unknown) {
  if (typeof value === "string") {
    return uniqueStrings([value]);
  }

  if (!Array.isArray(value)) return [];
  return uniqueStrings(
    value.filter((item): item is string => typeof item === "string"),
  );
}

function normalizeDeliverableType(
  value: unknown,
  sourceText: string,
): DeliverableType {
  if (typeof value === "string") {
    const exact = DELIVERABLE_TYPES.find((item) => item === value.trim());

    if (exact && exact !== "其他") return exact;

    const alias = DELIVERABLE_ALIASES.find((item) => item.pattern.test(value));

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

export function parseTrlEvidence(value: unknown, sourceText = ""): TrlEvidence {
  const defaults = createDefaultTrlEvidence();
  const record = isRecord(value) ? value : {};
  const evidenceRecord = isRecord(record.evidence) ? record.evidence : {};

  const evidence = {} as EvidenceMatrix;

  for (const key of EVIDENCE_KEYS) {
    evidence[key] = readStringArray(evidenceRecord[key]);
  }

  return {
    deliverableType: normalizeDeliverableType(
      record.deliverableType,
      sourceText,
    ),
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
