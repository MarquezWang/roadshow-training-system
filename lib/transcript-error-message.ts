/**
 * 将转写原始错误信息转换为用户友好文案。
 * 不修改数据库中的原始 errorMessage，仅在展示层转换。
 * 兼容新旧两种格式：旧格式含 failType=N 技术信息，新格式已是用户友好文案。
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

/** 用户友好文案中可重试的关键词 */
const retryablePatterns = [
  "音频上传失败",
  "音频转码失败",
  "音频识别失败",
];

/** 用户友好文案中不可重试的关键词 */
const nonRetryablePatterns = [
  "未检测到有效语音内容",
  "音频时长校验失败",
  "转写结果为空",
];

/**
 * 判断 errorMessage 是否包含技术信息（旧格式）。
 * 旧格式含有 "failType="、"订单"、"讯飞" 等关键词。
 */
function isRawErrorMessage(message: string): boolean {
  return (
    message.includes("failType=") ||
    message.includes("订单") ||
    message.includes("讯飞")
  );
}

export function formatTranscriptErrorMessage(
  errorMessage?: string | null,
): string {
  if (!errorMessage) return fallbackMessage;

  // 旧格式：尝试匹配 failType=N
  const match = errorMessage.match(/failType=(\d+)/);
  if (match && failTypeMap[match[1]]) {
    return failTypeMap[match[1]];
  }

  // 已是用户友好文案（新格式），直接返回
  if (!isRawErrorMessage(errorMessage)) {
    return errorMessage;
  }

  // 旧格式但无法匹配 failType → 兜底
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

  // 新格式：匹配用户友好文案中的关键词
  for (const pattern of nonRetryablePatterns) {
    if (errorMessage.includes(pattern)) return false;
  }
  for (const pattern of retryablePatterns) {
    if (errorMessage.includes(pattern)) return true;
  }

  // 旧格式：匹配 failType=N
  const match = errorMessage.match(/failType=(\d+)/);
  if (match && retryableFailTypes.has(match[1])) {
    return true;
  }

  return false;
}