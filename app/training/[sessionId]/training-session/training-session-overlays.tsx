type TrainingSessionOverlaysProps = Readonly<{
  isGuardResolved: boolean;
  prepCountdown: number | null;
}>;

export function TrainingSessionOverlays({
  isGuardResolved,
  prepCountdown,
}: TrainingSessionOverlaysProps) {
  return (
    <>
      {!isGuardResolved ? (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70">
          <p className="text-xl font-semibold text-white">正在结束训练...</p>
        </div>
      ) : null}
      {isGuardResolved && prepCountdown !== null ? (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70">
          <p className="text-6xl font-bold text-white">
            {prepCountdown >= 4
              ? "请准备"
              : prepCountdown >= 1
                ? String(prepCountdown)
                : "开始路演"}
          </p>
        </div>
      ) : null}
    </>
  );
}
