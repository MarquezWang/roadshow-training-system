export function formatDuration(totalSec: number) {
  const minutes = Math.floor(totalSec / 60)
    .toString()
    .padStart(2, "0");
  const seconds = (totalSec % 60).toString().padStart(2, "0");

  return `${minutes}:${seconds}`;
}
