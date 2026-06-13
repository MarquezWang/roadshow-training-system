/**
 * 转写业务失败错误类。
 * 区分于系统错误（500），业务失败返回 200/422。
 */
export class TranscribeBusinessError extends Error {
  public readonly userMessage: string;
  public readonly rawMessage: string;

  constructor(userMessage: string, rawMessage: string) {
    super(userMessage);
    this.name = "TranscribeBusinessError";
    this.userMessage = userMessage;
    this.rawMessage = rawMessage;
  }
}