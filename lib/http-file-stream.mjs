import { createReadStream } from "node:fs";
import { Readable } from "node:stream";

export async function fetchWithFileBody(
  url,
  { filePath, headers, signal, method = "POST" },
) {
  const fileStream = createReadStream(filePath);
  const abortStream = () => {
    fileStream.destroy(
      signal?.reason instanceof Error
        ? signal.reason
        : new Error("File upload aborted"),
    );
  };
  signal?.addEventListener("abort", abortStream, { once: true });

  try {
    return await fetch(url, {
      method,
      headers,
      body: Readable.toWeb(fileStream),
      duplex: "half",
      signal,
    });
  } finally {
    signal?.removeEventListener("abort", abortStream);
    fileStream.destroy();
  }
}
