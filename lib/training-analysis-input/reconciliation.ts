import type { Prisma } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { TRAINING_ANALYSIS_LEGACY_VERSION } from "@/lib/training-analysis-version.mjs";
import { calculateInputHashes } from "./calculation";
import { findLegacyInputChangesSince } from "./legacy-changes";
import type {
  AnalysisVersionRecord,
  InputVersionReconciliation,
} from "./types";

type ReconciliationDependencies = Readonly<{
  calculateHashes: typeof calculateInputHashes;
  findLegacyChanges: typeof findLegacyInputChangesSince;
  updateAnalyses: (
    args: Prisma.TrainingAnalysisUpdateManyArgs,
  ) => Promise<{ count: number }>;
}>;

const DEFAULT_DEPENDENCIES: ReconciliationDependencies = {
  calculateHashes: calculateInputHashes,
  findLegacyChanges: findLegacyInputChangesSince,
  updateAnalyses: (args) => prisma.trainingAnalysis.updateMany(args),
};

const LEGACY_VERSION_DATA = {
  promptVersion: TRAINING_ANALYSIS_LEGACY_VERSION,
  schemaVersion: TRAINING_ANALYSIS_LEGACY_VERSION,
  modelVersion: TRAINING_ANALYSIS_LEGACY_VERSION,
  ruleVersion: TRAINING_ANALYSIS_LEGACY_VERSION,
} as const;

export async function reconcileTrainingAnalysisInputVersionWithDependencies(
  sessionId: string,
  analysis: AnalysisVersionRecord,
  dependencies: ReconciliationDependencies,
): Promise<InputVersionReconciliation> {
  const hashes = await dependencies.calculateHashes(sessionId);
  if (!hashes || analysis.status !== "COMPLETED") {
    return {
      stale: false,
      reason: null,
      currentInputHash: hashes?.current ?? null,
      backfilled: false,
    };
  }

  if (analysis.inputHash === hashes.current) {
    return {
      stale: false,
      reason: null,
      currentInputHash: hashes.current,
      backfilled: false,
    };
  }

  // 已有 v1/v2 哈希能证明训练内容未变化；兼容升级到包含生成契约的 v3。
  if (
    analysis.inputHash &&
    (analysis.inputHash === hashes.previous ||
      analysis.inputHash === hashes.legacy)
  ) {
    const upgraded = await dependencies.updateAnalyses({
      where: {
        id: analysis.id,
        status: "COMPLETED",
        inputHash: analysis.inputHash,
      },
      data: {
        inputHash: hashes.current,
        ...LEGACY_VERSION_DATA,
      },
    });
    return {
      stale: false,
      reason: null,
      currentInputHash: hashes.current,
      backfilled: upgraded.count > 0,
    };
  }

  if (analysis.inputHash) {
    return {
      stale: true,
      reason: "analysis input hash differs from the current training input",
      currentInputHash: hashes.current,
      backfilled: false,
    };
  }

  const legacyChanges = await dependencies.findLegacyChanges(
    sessionId,
    analysis.updatedAt,
  );
  if (legacyChanges.length > 0) {
    return {
      stale: true,
      reason: `legacy analysis inputs changed: ${legacyChanges.join(",")}`,
      currentInputHash: hashes.current,
      backfilled: false,
    };
  }

  // 再读一次，避免在兼容检查和回填之间遗漏并发输入变更。
  const confirmedHashes = await dependencies.calculateHashes(sessionId);
  if (!confirmedHashes || confirmedHashes.current !== hashes.current) {
    return {
      stale: true,
      reason: "analysis input changed while upgrading legacy report",
      currentInputHash: confirmedHashes?.current ?? null,
      backfilled: false,
    };
  }

  const backfilled = await dependencies.updateAnalyses({
    where: {
      id: analysis.id,
      status: "COMPLETED",
      inputHash: "",
      updatedAt: analysis.updatedAt,
    },
    data: {
      inputHash: confirmedHashes.current,
      ...LEGACY_VERSION_DATA,
    },
  });

  return {
    stale: false,
    reason: null,
    currentInputHash: confirmedHashes.current,
    backfilled: backfilled.count > 0,
  };
}

export function reconcileTrainingAnalysisInputVersion(
  sessionId: string,
  analysis: AnalysisVersionRecord,
) {
  return reconcileTrainingAnalysisInputVersionWithDependencies(
    sessionId,
    analysis,
    DEFAULT_DEPENDENCIES,
  );
}
