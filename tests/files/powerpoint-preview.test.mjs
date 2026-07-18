import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import {
  mkdir,
  mkdtemp,
  readFile,
  rm,
  stat,
  writeFile,
} from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import ts from "typescript";

function dataModule(source) {
  return `data:text/javascript;base64,${Buffer.from(source).toString("base64")}`;
}

const harness = {
  acquire: async () => () => undefined,
  findUnique: async () => null,
  runBoundedProcess: async () => {
    throw new Error("runBoundedProcess test double is not configured");
  },
  updateMany: async () => {
    throw new Error("updateMany test double is not configured");
  },
  writeDiagnosticEvent: async () => undefined,
};
harness.prisma = {
  fileAsset: {
    findUnique: (...args) => harness.findUnique(...args),
    updateMany: (...args) => harness.updateMany(...args),
  },
};
globalThis.__powerPointPreviewTestHarness = harness;

const boundedProcessUrl = dataModule(`
  export async function runBoundedProcess(...args) {
    return globalThis.__powerPointPreviewTestHarness.runBoundedProcess(...args);
  }
`);
const boundaryUrl = dataModule(`
  export function createDocumentParseLimiter() {
    return {
      acquire(options) {
        return globalThis.__powerPointPreviewTestHarness.acquire(options);
      },
    };
  }
`);
const diagnosticUrl = dataModule(`
  export async function writeDiagnosticEvent(...args) {
    return globalThis.__powerPointPreviewTestHarness.writeDiagnosticEvent(...args);
  }
`);
const prismaUrl = dataModule(`
  export const prisma = globalThis.__powerPointPreviewTestHarness.prisma;
`);

async function transpileModule(relativePath, replacements = {}) {
  let source = await readFile(path.resolve(relativePath), "utf8");
  for (const [specifier, replacement] of Object.entries(replacements)) {
    source = source.replaceAll(specifier, replacement);
  }
  const transpiled = ts.transpileModule(source, {
    compilerOptions: {
      module: ts.ModuleKind.ESNext,
      target: ts.ScriptTarget.ES2022,
    },
  }).outputText;
  return dataModule(transpiled);
}

const constantsUrl = await transpileModule(
  "lib/powerpoint-preview/constants.ts",
);
const typesUrl = await transpileModule("lib/powerpoint-preview/types.ts");
const errorsUrl = await transpileModule("lib/powerpoint-preview/errors.ts");
const fileTypesUrl = await transpileModule(
  "lib/powerpoint-preview/file-types.ts",
);
const pathsUrl = await transpileModule("lib/powerpoint-preview/paths.ts");
const loggingUrl = await transpileModule(
  "lib/powerpoint-preview/logging.ts",
  { "./constants": constantsUrl },
);
const availabilityUrl = await transpileModule(
  "lib/powerpoint-preview/libreoffice-availability.ts",
  {
    "@/lib/bounded-process.mjs": boundedProcessUrl,
    "./constants": constantsUrl,
    "./errors": errorsUrl,
    "./logging": loggingUrl,
    "./types": typesUrl,
  },
);
const libreOfficeConvertUrl = await transpileModule(
  "lib/powerpoint-preview/libreoffice-convert.ts",
  {
    "@/lib/bounded-process.mjs": boundedProcessUrl,
    "@/lib/document-parser-boundary.mjs": boundaryUrl,
    "./constants": constantsUrl,
    "./errors": errorsUrl,
    "./libreoffice-availability": availabilityUrl,
    "./logging": loggingUrl,
  },
);
const conversionUrl = await transpileModule(
  "lib/powerpoint-preview/conversion.ts",
  {
    "./constants": constantsUrl,
    "./errors": errorsUrl,
    "./libreoffice-convert": libreOfficeConvertUrl,
  },
);
const repositoryUrl = await transpileModule(
  "lib/powerpoint-preview/repository.ts",
  {
    "@/lib/prisma": prismaUrl,
    "./constants": constantsUrl,
    "./types": typesUrl,
  },
);
const generationUrl = await transpileModule(
  "lib/powerpoint-preview/generation.ts",
  {
    "@/lib/diagnostic-log": diagnosticUrl,
    "@/lib/prisma": prismaUrl,
    "./constants": constantsUrl,
    "./conversion": conversionUrl,
    "./errors": errorsUrl,
    "./file-types": fileTypesUrl,
    "./logging": loggingUrl,
    "./paths": pathsUrl,
    "./repository": repositoryUrl,
    "./types": typesUrl,
  },
);
const facadeUrl = await transpileModule("lib/powerpoint-preview.ts", {
  "./powerpoint-preview/conversion": conversionUrl,
  "./powerpoint-preview/file-types": fileTypesUrl,
  "./powerpoint-preview/generation": generationUrl,
  "./powerpoint-preview/libreoffice-availability": availabilityUrl,
  "./powerpoint-preview/paths": pathsUrl,
  "./powerpoint-preview/types": typesUrl,
});
const preview = await import(facadeUrl);

function resetHarness() {
  harness.acquire = async () => () => undefined;
  harness.findUnique = async () => null;
  harness.runBoundedProcess = async () => {
    throw new Error("runBoundedProcess test double is not configured");
  };
  harness.updateMany = async () => {
    throw new Error("updateMany test double is not configured");
  };
  harness.writeDiagnosticEvent = async () => undefined;
}

function configureSuccessfulLibreOffice(processCalls, onConvert = null) {
  harness.runBoundedProcess = async (command, args, options) => {
    processCalls.push({ command, args, options });
    if (args[0] === "--version") {
      return {
        stdout: "  LibreOffice   24.2  \n",
        stderr: "",
        code: 0,
      };
    }

    const outputDir = args[args.indexOf("--outdir") + 1];
    const inputPath = args.at(-1);
    if (onConvert) {
      await onConvert({ inputPath, outputDir });
    } else {
      const extension = path.extname(inputPath);
      const outputPath = path.join(
        outputDir,
        `${path.basename(inputPath, extension)}.pdf`,
      );
      await writeFile(outputPath, "%PDF-1.4\npreview");
    }
    return { stdout: "", stderr: "", code: 0 };
  };
}

test("PowerPoint preview policies remain bounded and deterministic", async (t) => {
  const originalLibreOfficePath = process.env.LIBREOFFICE_PATH;
  process.env.LIBREOFFICE_PATH = "fake-libreoffice";

  try {
    await t.test("file recognition keeps type and extension fallbacks", () => {
      assert.equal(
        preview.isPowerPointFile({ fileType: ".PPTX", originalName: "x.bin" }),
        true,
      );
      assert.equal(
        preview.isPowerPointFile({ fileType: "bin", originalName: "DECK.PPT" }),
        true,
      );
      assert.equal(
        preview.isPowerPointFile({ fileType: "pdf", originalName: "deck.pptx.tmp" }),
        false,
      );
      assert.equal(
        preview.isPdfFile({ fileType: ".PDF", originalName: "x.bin" }),
        true,
      );
      assert.equal(
        preview.isPdfFile({ fileType: "bin", originalName: "REPORT.PDF" }),
        true,
      );
    });

    await t.test("preview paths strip unsafe identifier characters", () => {
      assert.equal(
        preview.getPreviewPdfRelativePath("../project A_1", "项目/.."),
        "uploads/projects/projectA_1/previews/preview.pdf",
      );
      assert.equal(
        preview.getPreviewPdfRelativePath("project-1", "file_2"),
        "uploads/projects/project-1/previews/file_2.pdf",
      );
    });

    await t.test("LibreOffice detection returns the first sanitized version", async () => {
      resetHarness();
      const processCalls = [];
      configureSuccessfulLibreOffice(processCalls);

      const result = await preview.checkLibreOfficeAvailability();

      assert.deepEqual(result, {
        available: true,
        command: "fake-libreoffice",
        version: "LibreOffice 24.2",
      });
      assert.deepEqual(processCalls[0].args, ["--version"]);
      assert.equal(processCalls[0].options.timeoutMs, 5_000);
      assert.equal(processCalls[0].options.maxOutputBytes, 64 * 1024);
    });

    await t.test("missing commands collapse to a stable unavailable reason", async () => {
      resetHarness();
      harness.runBoundedProcess = async (command) => {
        throw new Error(`${command} spawn ENOENT`);
      };

      const result = await preview.checkLibreOfficeAvailability();

      assert.equal(result.available, false);
      assert.equal(result.reason, "command not found");
      assert.equal(result.errors.length, 4);
      assert.match(result.errors[0], /^fake-libreoffice:/);
    });

    await t.test("conversion uses an isolated profile and validates output", async () => {
      resetHarness();
      const temporaryRoot = await mkdtemp(
        path.join(os.tmpdir(), "ppt-preview-policy-"),
      );
      const inputPath = path.join(temporaryRoot, "deck.pptx");
      const outputDir = path.join(temporaryRoot, "output");
      const processCalls = [];
      let releaseCount = 0;
      harness.acquire = async ({ timeoutMs }) => {
        assert.equal(timeoutMs, 60_000);
        return () => {
          releaseCount += 1;
        };
      };
      configureSuccessfulLibreOffice(processCalls);

      try {
        await writeFile(inputPath, "pptx fixture");
        const convertedPath = await preview.convertPowerPointToPdf(
          inputPath,
          outputDir,
        );

        assert.equal(convertedPath, path.join(outputDir, "deck.pdf"));
        assert.equal((await stat(convertedPath)).isFile(), true);
        assert.equal(releaseCount, 1);
        const conversionCall = processCalls[1];
        assert.equal(conversionCall.command, "fake-libreoffice");
        assert.ok(conversionCall.args.includes("--headless"));
        assert.equal(conversionCall.args.at(-1), inputPath);
        assert.equal(conversionCall.options.timeoutMs, 60_000);
        assert.equal(conversionCall.options.maxOutputBytes, 512 * 1024);
        assert.equal(conversionCall.options.env.http_proxy, "http://127.0.0.1:9");
        assert.equal(conversionCall.options.env.SAL_USE_VCLPLUGIN, "svp");
        await assert.rejects(stat(path.join(outputDir, ".lo-profile")));
        await assert.rejects(stat(path.join(outputDir, ".lo-tmp")));
      } finally {
        await rm(temporaryRoot, { recursive: true, force: true });
      }
    });

    await t.test("conversion distinguishes missing input and missing output", async () => {
      resetHarness();
      const temporaryRoot = await mkdtemp(
        path.join(os.tmpdir(), "ppt-preview-errors-"),
      );
      const inputPath = path.join(temporaryRoot, "deck.pptx");
      const outputDir = path.join(temporaryRoot, "output");
      const processCalls = [];

      try {
        await assert.rejects(
          preview.convertPowerPointToPdf(inputPath, outputDir),
          /输入文件不存在/,
        );
        await writeFile(inputPath, "pptx fixture");
        configureSuccessfulLibreOffice(processCalls, async () => undefined);
        await assert.rejects(
          preview.convertPowerPointToPdf(inputPath, outputDir),
          /未找到转换后的 PDF 文件/,
        );
      } finally {
        await rm(temporaryRoot, { recursive: true, force: true });
      }
    });

    await t.test("an active preview attempt returns stored state without conversion", async () => {
      resetHarness();
      let processCallCount = 0;
      harness.runBoundedProcess = async () => {
        processCallCount += 1;
        throw new Error("conversion must not run");
      };
      harness.updateMany = async () => ({ count: 0 });
      harness.findUnique = async () => ({
        previewStatus: "PENDING",
        previewPdfPath: null,
        previewError: null,
      });

      const result = await preview.generatePowerPointPreviewPdf({
        id: "active-file",
        projectId: "active-project",
        originalName: "deck.pptx",
        fileType: "pptx",
        filePath: "uploads/projects/active-project/deck.pptx",
      });

      assert.deepEqual(result, {
        previewStatus: "PENDING",
        previewPdfPath: null,
        previewError: "预览生成任务正在执行。",
      });
      assert.equal(processCallCount, 0);
    });

    await t.test("generation publishes a ready PDF and rejects unsafe input paths", async () => {
      resetHarness();
      const projectId = `ppt-policy-${randomUUID()}`;
      const fileId = `file-${randomUUID()}`;
      const projectRoot = path.resolve("uploads", "projects", projectId);
      const inputRelativePath = `uploads/projects/${projectId}/deck.pptx`;
      const inputPath = path.resolve(inputRelativePath);
      const processCalls = [];
      const databaseCalls = [];
      const diagnostics = [];
      harness.updateMany = async (args) => {
        databaseCalls.push(args);
        return { count: 1 };
      };
      harness.writeDiagnosticEvent = async (event) => {
        diagnostics.push(event);
      };
      configureSuccessfulLibreOffice(processCalls);

      try {
        await mkdir(projectRoot, { recursive: true });
        await writeFile(inputPath, "pptx fixture");
        const result = await preview.generatePowerPointPreviewPdf({
          id: fileId,
          projectId,
          originalName: "deck.pptx",
          fileType: "pptx",
          filePath: inputRelativePath,
        });

        assert.equal(result.previewStatus, "READY");
        assert.equal(
          result.previewPdfPath,
          `uploads/projects/${projectId}/previews/${fileId}.pdf`,
        );
        assert.equal(result.previewError, null);
        assert.equal(
          await readFile(path.resolve(result.previewPdfPath), "utf8"),
          "%PDF-1.4\npreview",
        );
        assert.deepEqual(
          databaseCalls.map((call) => call.data.previewStatus),
          ["PENDING", "FINALIZING", "READY"],
        );
        assert.equal(diagnostics.length, 0);

        resetHarness();
        const failureCalls = [];
        harness.updateMany = async (args) => {
          failureCalls.push(args);
          return { count: 1 };
        };
        harness.writeDiagnosticEvent = async (event) => {
          diagnostics.push(event);
        };
        const failed = await preview.generatePowerPointPreviewPdf({
          id: `${fileId}-unsafe`,
          projectId,
          originalName: "deck.pptx",
          fileType: "pptx",
          filePath: "uploads/projects/../../secrets.pptx",
        });

        assert.equal(failed.previewStatus, "FAILED");
        assert.equal(failed.previewPdfPath, null);
        assert.equal(failed.previewError, "INVALID_UPLOAD_PATH");
        assert.equal(failureCalls.at(-1).data.previewStatus, "FAILED");
        assert.equal(diagnostics.at(-1).meta.reason, "unknown");
      } finally {
        await rm(projectRoot, { recursive: true, force: true });
      }
    });
  } finally {
    if (originalLibreOfficePath === undefined) {
      delete process.env.LIBREOFFICE_PATH;
    } else {
      process.env.LIBREOFFICE_PATH = originalLibreOfficePath;
    }
    delete globalThis.__powerPointPreviewTestHarness;
  }
});
