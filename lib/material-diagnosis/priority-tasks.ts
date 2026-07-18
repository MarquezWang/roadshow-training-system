import { isRecord } from "@/lib/type-guards";
import { asString, asStringArray } from "./primitives";
import type {
  MaterialDiagnosisPriorityTask,
  RawMaterialDiagnosisPriorityTask,
} from "./types";

function asPriorityTask(value: unknown): MaterialDiagnosisPriorityTask | null {
  if (!isRecord(value)) {
    return null;
  }

  const rawTask = value as RawMaterialDiagnosisPriorityTask;
  const title = asString(rawTask.title);
  const action = asString(rawTask.action);
  if (!title && !action) {
    return null;
  }

  return {
    title: title || "补充材料证据",
    reason: asString(rawTask.reason, "当前材料证据不足。"),
    action: action || "补充可核验的事实、数据、案例或证明材料。",
    relatedCriteria: asStringArray(rawTask.relatedCriteria),
  };
}

function isPriorityTask(
  value: MaterialDiagnosisPriorityTask | null,
): value is MaterialDiagnosisPriorityTask {
  return value !== null;
}

export function normalizePriorityTasks(value: unknown) {
  return Array.isArray(value)
    ? value.map(asPriorityTask).filter(isPriorityTask).slice(0, 5)
    : [];
}
