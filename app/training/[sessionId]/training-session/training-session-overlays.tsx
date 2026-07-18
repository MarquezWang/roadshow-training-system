type TrainingSessionOverlaysProps = Readonly<{
  isGuardResolved: boolean;
}>;

export function TrainingSessionOverlays({
  isGuardResolved,
}: TrainingSessionOverlaysProps) {
  return !isGuardResolved ? (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70">
      <p className="text-xl font-semibold text-white">正在结束训练...</p>
    </div>
  ) : null;
}
