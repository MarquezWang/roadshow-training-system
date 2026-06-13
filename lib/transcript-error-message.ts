/**
 * 将转写原始错误信息转换为用户友好文案。
 * 不修改数据库中的原始 errorMessage，仅在展示层转换。
 */

const failTypeMap: Record<string, string> = {
  "1": "音频上传失败，可能是网络波动或音频文件未完整上传。请稍后重试。",
  "2": "音频转码失败，可能是录音文件格式异常或文件损坏。",
  "3": "音频识别失败，可能是声音过小、噪声较大或内容过短。",
  "5": "音频时长校验失败，可能是录音文件时长信息异常。",
  "6": "未检测到有效语音内容，可能是静音、声音过小或录音时间过短。建议重新进行本轮训练，确保回答时正常发声。",
};

const fallbackMessage =
  "转写未成功，可能是音频质量、网络或服务状态异常。请稍后重试。";

/** 可重试的 failType：上传失败、转码失败、识别失败等网络/服务侧问题 */
const retryableFailTypes = new Set(["1", "2", "3", "99"]);

export function formatTranscriptErrorMessage(
  errorMessage?: string | null,
): string {
  if (!errorMessage) return fallbackMessage;

  const match = errorMessage.match(/failType=(\d+)/);
  if (match && failTypeMap[match[1]]) {
    return failTypeMap[match[1]];
  }

  return fallbackMessage;
}

/**
 * 判断转写失败后是否允许用户重试。
 * - failType=6（静音/无有效语音）→ 不可重试
 * - failType=4、5（时长限制/校验）→ 不可重试
 * - failType=1、2、3、99 → 可重试
 * - 无法判断 → 默认不可重试，避免滥用转写额度
 */
export function canRetryTranscript(
  errorMessage?: string | null,
): boolean {
  if (!errorMessage) return false;

  // 文案中明确表示无有效语音内容 → 不可重试
  if (errorMessage.includes("未检测到有效语音内容")) return false;

  const match = errorMessage.match(/failType=(\d+)/);
  if (match && retryableFailTypes.has(match[1])) {
    return true;
  }

  return false;
}