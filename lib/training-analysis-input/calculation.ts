import { buildProjectAIContext } from "@/lib/project-context";
import {
  getTrainingAnalysisGenerationContract,
  TRAINING_ANALYSIS_INPUT_HASH_VERSION,
} from "@/lib/training-analysis-version.mjs";
import {
  buildCurrentTrainingAnalysisInput,
  buildLegacyTrainingAnalysisInput,
} from "./canonical";
import { sha256 } from "./hash";
import {
  findTrainingAnalysisInputSession,
  type TrainingAnalysisInputSession,
} from "./repository";
import type { InputHashes } from "./types";

const PREVIOUS_INPUT_HASH_VERSION = "v2";

export function buildTrainingAnalysisInputHashes(
  session: TrainingAnalysisInputSession,
  generationContextHash: string,
  generationContract: ReturnType<
    typeof getTrainingAnalysisGenerationContract
  >,
): InputHashes {
  const legacyCanonical = buildLegacyTrainingAnalysisInput(session);
  const currentCanonical = buildCurrentTrainingAnalysisInput(session);
  const previous = `${PREVIOUS_INPUT_HASH_VERSION}:${sha256(currentCanonical)}`;

  return {
    current: `${TRAINING_ANALYSIS_INPUT_HASH_VERSION}:${sha256({
      trainingInput: currentCanonical,
      generationContextHash,
      generationContract,
    })}`,
    previous,
    legacy: sha256(legacyCanonical),
  };
}

type CalculateInputHashesDependencies = Readonly<{
  findSession: typeof findTrainingAnalysisInputSession;
  buildProjectContext: typeof buildProjectAIContext;
  getGenerationContract: typeof getTrainingAnalysisGenerationContract;
}>;

const DEFAULT_DEPENDENCIES: CalculateInputHashesDependencies = {
  findSession: findTrainingAnalysisInputSession,
  buildProjectContext: buildProjectAIContext,
  getGenerationContract: getTrainingAnalysisGenerationContract,
};

export async function calculateInputHashes(
  sessionId: string,
  dependencies: CalculateInputHashesDependencies = DEFAULT_DEPENDENCIES,
): Promise<InputHashes | null> {
  const session = await dependencies.findSession(sessionId);
  if (!session) {
    return null;
  }

  const generationContextHash = session.projectContextSnapshot
    ? sha256(session.projectContextSnapshot)
    : sha256(await dependencies.buildProjectContext(session.project.id));

  return buildTrainingAnalysisInputHashes(
    session,
    generationContextHash,
    dependencies.getGenerationContract(),
  );
}

export async function calculateTrainingAnalysisInputHash(sessionId: string) {
  return (await calculateInputHashes(sessionId))?.current ?? null;
}
