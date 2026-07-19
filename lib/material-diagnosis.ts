export {
  evidenceStatuses,
  evidenceStatusLabel,
  LEGACY_DIAGNOSIS_SCHEMA_VERSION,
  MATERIAL_DIAGNOSIS_LEGACY_SCHEMA_VERSION,
  MATERIAL_DIAGNOSIS_SCHEMA_VERSION,
  readinessLevels,
  readinessLevelLabel,
} from "./material-diagnosis/constants";
export type {
  EvidenceStatus,
  ReadinessLevel,
} from "./material-diagnosis/constants";
export {
  calculateReadinessScore,
  deriveReadinessLevel,
} from "./material-diagnosis/criteria";
export { normalizeMaterialDiagnosisResult } from "./material-diagnosis/normalize";
export { parseStoredMaterialDiagnosis } from "./material-diagnosis/storage";
export type {
  EvaluationCriterionForDiagnosis,
  MaterialDiagnosisCriterion,
  MaterialDiagnosisPriorityTask,
  MaterialDiagnosisResult,
} from "./material-diagnosis/types";
