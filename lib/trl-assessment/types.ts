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

export type EvidenceMatrix = {
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

export const EVIDENCE_KEYS: Array<keyof EvidenceMatrix> = [
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

export const TRL_BOOLEAN_KEYS = [
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
