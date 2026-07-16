import { createWriteStream } from "node:fs";
import { rm } from "node:fs/promises";
import { Readable, Transform } from "node:stream";
import { pipeline } from "node:stream/promises";

export class UploadStreamError extends Error {
  constructor(code, message) {
    super(message);
    this.name = "UploadStreamError";
    this.code = code;
  }
}

export async function streamWebBodyToFile(body, destinationPath, options) {
  if (!body) {
    throw new UploadStreamError("EMPTY", "Upload body is empty");
  }

  const maxBytes = options.maxBytes;
  const expectedBytes = options.expectedBytes ?? null;
  let receivedBytes = 0;
  const limiter = new Transform({
    transform(chunk, _encoding, callback) {
      receivedBytes += chunk.length;
      if (receivedBytes > maxBytes) {
        callback(
          new UploadStreamError(
            "TOO_LARGE",
            `Upload exceeded ${maxBytes} bytes`,
          ),
        );
        return;
      }
      callback(null, chunk);
    },
  });

  try {
    await pipeline(
      Readable.fromWeb(body),
      limiter,
      createWriteStream(destinationPath, { flags: "wx" }),
      options.signal ? { signal: options.signal } : {},
    );
    if (receivedBytes <= 0) {
      throw new UploadStreamError("EMPTY", "Upload body is empty");
    }
    if (expectedBytes !== null && receivedBytes !== expectedBytes) {
      throw new UploadStreamError(
        "SIZE_MISMATCH",
        `Expected ${expectedBytes} bytes but received ${receivedBytes}`,
      );
    }
    return { receivedBytes };
  } catch (error) {
    await rm(destinationPath, { force: true }).catch(() => undefined);
    throw error;
  }
}
