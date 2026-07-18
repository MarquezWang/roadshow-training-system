export type AnalysisVersionRecord = Readonly<{
  id: string;
  status: string;
  inputHash: string | null;
  updatedAt: Date;
}>;

export type InputHashes = Readonly<{
  current: string;
  previous: string;
  legacy: string;
}>;

export type InputVersionReconciliation = Readonly<{
  stale: boolean;
  reason: string | null;
  currentInputHash: string | null;
  backfilled: boolean;
}>;
