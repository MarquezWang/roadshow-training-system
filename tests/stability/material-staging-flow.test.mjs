import assert from "node:assert/strict";
import { rm } from "node:fs/promises";
import path from "node:path";
import test from "node:test";

import { PrismaClient } from "@prisma/client";

const baseUrl =
  process.env.STABILITY_TEST_BASE_URL || "http://127.0.0.1:3210";

function makePdf(text = "streamed material") {
  const content = `BT /F1 12 Tf 72 720 Td (${text}) Tj ET`;
  const objects = [
    "<< /Type /Catalog /Pages 2 0 R >>",
    "<< /Type /Pages /Kids [3 0 R] /Count 1 >>",
    "<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Resources << /Font << /F1 4 0 R >> >> /Contents 5 0 R >>",
    "<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>",
    `<< /Length ${Buffer.byteLength(content)} >>\nstream\n${content}\nendstream`,
  ];
  let body = "%PDF-1.4\n";
  const offsets = [0];
  for (let index = 0; index < objects.length; index += 1) {
    offsets.push(Buffer.byteLength(body));
    body += `${index + 1} 0 obj\n${objects[index]}\nendobj\n`;
  }
  const xrefOffset = Buffer.byteLength(body);
  body += `xref\n0 ${objects.length + 1}\n`;
  body += "0000000000 65535 f \n";
  for (const offset of offsets.slice(1)) {
    body += `${String(offset).padStart(10, "0")} 00000 n \n`;
  }
  body += `trailer\n<< /Size ${objects.length + 1} /Root 1 0 R >>\n`;
  body += `startxref\n${xrefOffset}\n%%EOF\n`;
  return Buffer.from(body, "ascii");
}

test("project material upload streams once into a parsed server-side token", async () => {
  const prisma = new PrismaClient();
  const pdf = makePdf();
  let token = null;
  let stagedPath = null;

  try {
    const response = await fetch(`${baseUrl}/api/projects/material-parse`, {
      method: "POST",
      headers: {
        "Content-Type": "application/pdf",
        "X-Material-Upload": "raw-v1",
        "X-Material-Name": encodeURIComponent("streamed-material.pdf"),
        "X-Material-Size": String(pdf.byteLength),
      },
      body: pdf,
    });
    const body = await response.json();

    assert.equal(response.status, 200);
    assert.equal(body.status, "parsed");
    assert.equal("extractedText" in body.material, false);
    token = body.material.materialToken;

    const material = await prisma.pendingProjectMaterial.findUnique({
      where: { id: token },
    });
    assert.ok(material);
    assert.equal(material.parseStatus, "SUCCESS");
    assert.match(material.extractedText, /streamed material/);
    assert.equal(material.fileSize, pdf.byteLength);
    stagedPath = material.filePath;
  } finally {
    if (token) {
      await prisma.pendingProjectMaterial.deleteMany({ where: { id: token } });
    }
    if (stagedPath) {
      await rm(path.resolve(process.cwd(), stagedPath), { force: true });
    }
    await prisma.$disconnect();
  }
});
