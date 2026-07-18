export type XfyunConfig = Readonly<{
  appId: string;
  secretKey: string;
  language: string;
}>;

export type XfyunAudioInfo = Readonly<{
  durationSeconds: number;
  codec: string;
  sampleRate: string;
  channels: string;
}>;

export type XfyunUploadResult = Readonly<{
  orderId: string;
  uploadFileName: string;
  uploadFileSize: number;
  uploadDurationMs: number;
  debugDir: string;
}>;

export type XfyunUploadInfo = Readonly<{
  uploadFileName: string;
  uploadFileSize: number;
  uploadDurationMs: number;
  audioInfo: XfyunAudioInfo;
}>;

export type XfyunOrderInfo = Readonly<{
  orderId: string;
  failType: number;
  status: number;
  originalDuration?: number;
  realDuration?: number;
}>;

export type XfyunResultBody = Readonly<{
  code: string;
  descInfo: string;
  content?: {
    taskEstimateTime?: number;
    transResult?: unknown;
    predictResult?: unknown;
    orderResult?: unknown;
    orderInfo?: XfyunOrderInfo;
  };
}>;

export type XfyunResultVariant = Readonly<{
  name: string;
  method: "GET" | "POST";
  resultType: string | null;
}>;

export type XfyunResultResponse = Readonly<{
  body: XfyunResultBody;
  variantName: string;
}>;

export type XfyunDebugInfo = Readonly<{
  orderId: string;
  debugDir: string;
  debugAudioPath: string | null;
  contentKeys: string[];
  orderResultType: string;
  orderResultValue: string;
  taskEstimateTime: string;
  descInfo: string;
}>;
