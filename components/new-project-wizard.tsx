"use client";

import Link from "next/link";
import { useEffect, useRef, useState } from "react";
import {
  COOPERATION_DEMAND_OPTIONS,
  PROJECT_FIELD_OPTIONS,
  PROJECT_TRL_OPTIONS,
} from "@/lib/project-profile";

type RecognitionStatus =
  | "idle"
  | "pending"
  | "recognized"
  | "empty"
  | "failed"
  | "manual";
type ProfileField =
  | "name"
  | "summary"
  | "field"
  | "applicationScenario"
  | "technicalKeywords"
  | "productForm"
  | "trl";

type BaseRecognitionProfile = {
  name: string | null;
  summary: string | null;
  field: string | null;
  applicationScenario: string | null;
  technicalKeywords: string[];
  productForm: string | null;
};

type TrlRecognitionProfile = {
  trl: string | null;
  trlReason: string | null;
};

type RecognitionResponse =
  | {
      status: "recognized";
      mode: "base";
      baseStatus: "recognized" | "partial";
      notices: string[];
      profile: BaseRecognitionProfile;
    }
  | {
      status: "recognized";
      mode: "trl";
      trlStatus: "recognized" | "failed";
      notices: string[];
      profile: TrlRecognitionProfile;
    }
  | {
      status: "failed";
      reason:
        | "material_parse_failed"
        | "ai_call_failed"
        | "profile_unavailable";
      message: string;
    };

type MaterialParseResponse =
  | {
      status: "parsed";
      material: {
        fileName: string;
        fileType: "pdf" | "ppt" | "pptx";
        extractedText: string;
      };
    }
  | { status: "failed" | "validation_error"; message: string };

type ParsedMaterial = Extract<
  MaterialParseResponse,
  { status: "parsed" }
>["material"];

type WorkflowStatus =
  | "not_uploaded"
  | "uploading"
  | "parsing"
  | "recognizing_base"
  | "recognizing_trl"
  | "ready";

type NewProjectWizardProps = Readonly<{
  action: (formData: FormData) => Promise<void>;
}>;

const profileFields: ProfileField[] = [
  "name",
  "summary",
  "field",
  "applicationScenario",
  "technicalKeywords",
  "productForm",
  "trl",
];

const inputClass =
  "mt-2 w-full rounded-md border border-slate-300 bg-white px-3 py-2 text-sm text-slate-950 shadow-sm outline-none transition focus:border-teal-600 focus:ring-2 focus:ring-teal-100";

class MaterialValidationError extends Error {}
class MaterialParseError extends Error {}

const MATERIAL_PARSE_FAILURE_MESSAGE =
  "材料解析失败，请更换文件或手动填写项目档案。";

function getProcessingStatusMessage(status: WorkflowStatus) {
  if (status === "uploading") {
    return "正在上传材料…";
  }

  if (status === "parsing") {
    return "正在解析材料内容…";
  }

  if (status === "recognizing_base") {
    return "AI 正在识别基础项目档案…";
  }

  if (status === "recognizing_trl") {
    return "AI 正在判断 TRL 成熟度…";
  }

  return "";
}

function uploadAndParseMaterial(
  file: File,
  onUploadComplete: () => void,
) {
  return new Promise<Extract<MaterialParseResponse, { status: "parsed" }>>(
    (resolve, reject) => {
      const request = new XMLHttpRequest();
      const body = new FormData();
      body.append("materials", file);
      request.open("POST", "/api/projects/material-parse");
      request.responseType = "json";
      request.upload.addEventListener("load", onUploadComplete);
      request.addEventListener("load", () => {
        const response = request.response as MaterialParseResponse | null;

        if (response?.status === "parsed") {
          resolve(response);
          return;
        }

        if (response?.status === "validation_error") {
          reject(new MaterialValidationError(response.message));
          return;
        }

        reject(
          new MaterialParseError(
            response?.message || MATERIAL_PARSE_FAILURE_MESSAGE,
          ),
        );
      });
      request.addEventListener("error", () =>
        reject(new MaterialParseError(MATERIAL_PARSE_FAILURE_MESSAGE)),
      );
      request.send(body);
    },
  );
}

function initialStatuses(status: RecognitionStatus) {
  return Object.fromEntries(
    profileFields.map((field) => [field, status]),
  ) as Record<ProfileField, RecognitionStatus>;
}

function wait(ms: number) {
  return new Promise((resolve) => window.setTimeout(resolve, ms));
}

function prefersReducedMotion() {
  return window.matchMedia("(prefers-reduced-motion: reduce)").matches;
}

function FieldStatus({
  status,
  select = false,
  tooltip,
  pendingMessage,
  recognizedMessage,
  emptyMessage,
  failedMessage,
}: Readonly<{
  status: RecognitionStatus;
  select?: boolean;
  tooltip?: string;
  pendingMessage?: string;
  recognizedMessage?: string;
  emptyMessage?: string;
  failedMessage?: string;
}>) {
  const styles = {
    idle: "border-slate-200 bg-slate-50 text-slate-600",
    pending: "border-sky-200 bg-sky-50 text-sky-700",
    recognized: "border-teal-200 bg-teal-50 text-teal-700",
    empty: "border-amber-200 bg-amber-50 text-amber-700",
    failed: "border-red-200 bg-red-50 text-red-700",
    manual: "border-violet-200 bg-violet-50 text-violet-700",
  };
  const labels = {
    idle: "未开始",
    pending: "识别中",
    recognized: "已识别",
    empty: "未识别",
    failed: "识别失败",
    manual: "已手动修改",
  };
  const messages = {
    idle: "等待开始识别。",
    pending: pendingMessage || "正在识别，请稍候…",
    recognized: recognizedMessage || "AI 已自动填入，请确认或修改。",
    empty: emptyMessage || `未识别到，请${select ? "手动选择" : "补充"}。`,
    failed:
      failedMessage || `自动识别未完成，请手动${select ? "选择" : "填写"}。`,
    manual: "已手动修改，AI 返回后不会自动覆盖。",
  };

  return (
    <div
      className="mt-2 flex flex-wrap items-center gap-2"
      aria-live="polite"
    >
      <span
        className={`rounded-full border px-2 py-0.5 text-xs font-medium ${styles[status]}`}
      >
        {status === "pending" ? (
          <span className="mr-1 inline-block h-1.5 w-1.5 animate-pulse rounded-full bg-current" />
        ) : null}
        {labels[status]}
      </span>
      <span className="text-xs text-slate-500">{messages[status]}</span>
      {tooltip ? (
        <span
          className="group relative inline-flex cursor-help"
          tabIndex={0}
          aria-label="查看系统判断依据"
        >
          <span className="text-sm font-semibold text-slate-500" aria-hidden="true">
            ⓘ
          </span>
          <span
            role="tooltip"
            className="pointer-events-none invisible absolute bottom-full left-1/2 z-20 mb-2 w-80 -translate-x-1/2 rounded-md bg-slate-950 p-3 text-xs font-normal leading-5 text-white opacity-0 shadow-lg transition group-hover:visible group-hover:opacity-100 group-focus:visible group-focus:opacity-100"
          >
            <span className="block font-semibold">系统判断依据：</span>
            <span className="mt-1 block whitespace-pre-line">{tooltip}</span>
            <span className="mt-2 block text-slate-300">
              如你已手动调整等级，请以手动选择为准。
            </span>
          </span>
        </span>
      ) : null}
    </div>
  );
}

export function NewProjectWizard({ action }: NewProjectWizardProps) {
  const formRef = useRef<HTMLFormElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const profileFormTopRef = useRef<HTMLDivElement>(null);
  const dirtyFieldsRef = useRef<Set<ProfileField>>(new Set());
  const recognitionRunRef = useRef(0);
  const userInteractedRef = useRef(false);
  const isSubmittingRef = useRef(false);
  const [step, setStep] = useState(1);
  const [workflowStatus, setWorkflowStatus] =
    useState<WorkflowStatus>("not_uploaded");
  const [profileVisible, setProfileVisible] = useState(false);
  const [profileFormVisible, setProfileFormVisible] = useState(false);
  const [parsedMaterial, setParsedMaterial] = useState<ParsedMaterial | null>(
    null,
  );
  const [isRecognitionOverlayVisible, setRecognitionOverlayVisible] =
    useState(false);
  const [fileNames, setFileNames] = useState<string[]>([]);
  const [fileType, setFileType] = useState<"pdf" | "ppt" | "pptx" | "">("");
  const [materialError, setMaterialError] = useState("");
  const [statuses, setStatuses] = useState(initialStatuses("idle"));
  const [animatedFields, setAnimatedFields] = useState<Set<ProfileField>>(
    new Set(),
  );
  const [activeField, setActiveField] = useState<ProfileField | null>(null);
  const [name, setName] = useState("");
  const [summary, setSummary] = useState("");
  const [field, setField] = useState("");
  const [applicationScenario, setApplicationScenario] = useState("");
  const [technicalKeywords, setTechnicalKeywords] = useState<string[]>([]);
  const [keywordDraft, setKeywordDraft] = useState("");
  const [productForm, setProductForm] = useState("");
  const [trl, setTrl] = useState("");
  const [trlReason, setTrlReason] = useState("");
  const [cooperationDemands, setCooperationDemands] = useState<string[]>([]);
  const [otherDemandDetail, setOtherDemandDetail] = useState("");
  const [conversionSupport, setConversionSupport] = useState("");
  const [projectContact, setProjectContact] = useState("");
  const [contactPhone, setContactPhone] = useState("");
  const [stepError, setStepError] = useState("");
  const [isSubmitting, setIsSubmitting] = useState(false);

  useEffect(() => {
    const recognitionActive =
      workflowStatus === "recognizing_base" ||
      workflowStatus === "recognizing_trl";
    if (!recognitionActive || isRecognitionOverlayVisible || !profileFormVisible) {
      return undefined;
    }

    const pause = () => {
      userInteractedRef.current = true;
    };
    window.addEventListener("wheel", pause, { passive: true });
    window.addEventListener("touchstart", pause, { passive: true });

    return () => {
      window.removeEventListener("wheel", pause);
      window.removeEventListener("touchstart", pause);
    };
  }, [workflowStatus, isRecognitionOverlayVisible, profileFormVisible]);

  useEffect(() => {
    if (!isRecognitionOverlayVisible) return undefined;

    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";

    return () => {
      document.body.style.overflow = previousOverflow;
    };
  }, [isRecognitionOverlayVisible]);

  function focusRecognizedField(fieldName: ProfileField) {
    if (userInteractedRef.current || prefersReducedMotion()) return;

    setActiveField(fieldName);
    window.setTimeout(() => {
      if (userInteractedRef.current) return;

      const element = document.querySelector<HTMLElement>(
        `[data-profile-field="${fieldName}"]`,
      );
      element?.scrollIntoView({ behavior: "smooth", block: "center" });
    }, 40);
  }

  function clearActiveFieldLater(runId: number) {
    if (prefersReducedMotion()) {
      setActiveField(null);
      return;
    }

    window.setTimeout(() => {
      if (recognitionRunRef.current === runId) {
        setActiveField(null);
      }
    }, 1500);
  }

  function revealProfileFormAfterRecognition(runId: number) {
    if (recognitionRunRef.current !== runId) return;

    setProfileFormVisible(true);

    if (userInteractedRef.current) return;

    window.setTimeout(() => {
      if (
        recognitionRunRef.current === runId &&
        !userInteractedRef.current
      ) {
        profileFormTopRef.current?.scrollIntoView({
          behavior: prefersReducedMotion() ? "auto" : "smooth",
          block: "start",
        });
      }
    }, 80);
  }

  function markUserInteracted() {
    userInteractedRef.current = true;
  }

  function markFieldManual(fieldName: ProfileField) {
    markUserInteracted();
    const nextDirtyFields = new Set(dirtyFieldsRef.current).add(fieldName);
    dirtyFieldsRef.current = nextDirtyFields;
    setStatuses((current) => ({ ...current, [fieldName]: "manual" }));
  }

  function setFieldStatuses(
    fields: ProfileField[],
    status: RecognitionStatus,
  ) {
    setStatuses((current) => {
      const next = { ...current };

      for (const fieldName of fields) {
        if (!dirtyFieldsRef.current.has(fieldName)) next[fieldName] = status;
      }

      return next;
    });
  }

  function resetProfileDraft(preserveManual = false) {
    recognitionRunRef.current += 1;
    const preserved = preserveManual
      ? new Set(dirtyFieldsRef.current)
      : new Set<ProfileField>();

    if (!preserved.has("name")) setName("");
    if (!preserved.has("summary")) setSummary("");
    if (!preserved.has("field")) setField("");
    if (!preserved.has("applicationScenario")) setApplicationScenario("");
    if (!preserved.has("technicalKeywords")) setTechnicalKeywords([]);
    if (!preserved.has("productForm")) setProductForm("");
    if (!preserved.has("trl")) setTrl("");
    setKeywordDraft("");
    setTrlReason("");
    dirtyFieldsRef.current = preserved;
    setStatuses(
      Object.fromEntries(
        profileFields.map((fieldName) => [
          fieldName,
          preserved.has(fieldName) ? "manual" : "idle",
        ]),
      ) as Record<ProfileField, RecognitionStatus>,
    );
    setAnimatedFields(new Set());
    setActiveField(null);
    userInteractedRef.current = preserved.size > 0;
    setProfileFormVisible(preserved.size > 0);
  }

  async function requestRecognition(
    mode: "base" | "trl",
    fileName: string,
    extractedText: string,
  ) {
    const response = await fetch("/api/projects/profile-recognition", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ fileName, extractedText, mode }),
    });
    const result = (await response.json()) as RecognitionResponse;
    return { response, result };
  }

  function canApplyAiField(fieldName: ProfileField, runId: number) {
    return (
      recognitionRunRef.current === runId &&
      !dirtyFieldsRef.current.has(fieldName)
    );
  }

  function setFieldStatus(fieldName: ProfileField, status: RecognitionStatus) {
    setStatuses((current) =>
      dirtyFieldsRef.current.has(fieldName)
        ? current
        : { ...current, [fieldName]: status },
    );
  }

  async function presentRecognizedField({
    fieldName,
    recognized,
    value,
    apply,
    typingApply,
  }: {
    fieldName: ProfileField;
    recognized: boolean;
    value: string;
    apply: () => void;
    typingApply?: (value: string) => void;
  }, runId: number) {
    if (recognitionRunRef.current !== runId) return false;
    if (dirtyFieldsRef.current.has(fieldName)) return true;

    const reducedMotion = prefersReducedMotion();

    setProfileFormVisible(true);
    setFieldStatus(fieldName, "pending");
    focusRecognizedField(fieldName);

    if (!recognized) {
      if (!reducedMotion) await wait(850);
      if (recognitionRunRef.current !== runId) return false;
      if (dirtyFieldsRef.current.has(fieldName)) return true;

      setFieldStatus(fieldName, "empty");
      setAnimatedFields((current) => new Set(current).add(fieldName));
      if (!reducedMotion) await wait(260);
      return true;
    }

    if (reducedMotion) {
      apply();
    } else if (typingApply && value.length <= 42) {
      typingApply("");
      const characters = Array.from(value);

      for (let index = 0; index < characters.length; index += 1) {
        if (recognitionRunRef.current !== runId) return false;
        if (dirtyFieldsRef.current.has(fieldName)) return true;

        const nextValue = characters.slice(0, index + 1).join("");
        typingApply(nextValue);
        await wait(28);
      }

      const remaining = Math.max(0, 900 - characters.length * 28);
      if (remaining > 0) await wait(remaining);
    } else {
      await wait(900);
      if (recognitionRunRef.current !== runId) return false;
      if (dirtyFieldsRef.current.has(fieldName)) return true;
      apply();
    }

    if (recognitionRunRef.current !== runId) return false;
    if (dirtyFieldsRef.current.has(fieldName)) return true;

    setFieldStatus(fieldName, "recognized");
    setAnimatedFields((current) => new Set(current).add(fieldName));
    clearActiveFieldLater(runId);
    if (!reducedMotion) await wait(260);
    return true;
  }

  async function presentRecognizedKeywords(
    keywords: string[],
    runId: number,
  ) {
    const fieldName: ProfileField = "technicalKeywords";
    if (recognitionRunRef.current !== runId) return false;
    if (dirtyFieldsRef.current.has(fieldName)) return true;

    const reducedMotion = prefersReducedMotion();
    setProfileFormVisible(true);
    setFieldStatus(fieldName, "pending");
    focusRecognizedField(fieldName);

    if (keywords.length === 0) {
      if (!reducedMotion) await wait(850);
      if (recognitionRunRef.current !== runId) return false;
      if (dirtyFieldsRef.current.has(fieldName)) return true;

      setTechnicalKeywords([]);
      setFieldStatus(fieldName, "empty");
      setAnimatedFields((current) => new Set(current).add(fieldName));
      if (!reducedMotion) await wait(260);
      return true;
    }

    if (reducedMotion) {
      setTechnicalKeywords(keywords);
    } else {
      setTechnicalKeywords([]);
      const collected: string[] = [];
      await wait(320);

      for (const keyword of keywords) {
        if (recognitionRunRef.current !== runId) return false;
        if (dirtyFieldsRef.current.has(fieldName)) return true;

        collected.push(keyword);
        setTechnicalKeywords([...collected]);
        await wait(280);
      }

      await wait(420);
    }

    if (recognitionRunRef.current !== runId) return false;
    if (dirtyFieldsRef.current.has(fieldName)) return true;

    setFieldStatus(fieldName, "recognized");
    setAnimatedFields((current) => new Set(current).add(fieldName));
    clearActiveFieldLater(runId);
    if (!reducedMotion) await wait(260);
    return true;
  }

  async function applyBaseRecognition(
    profile: BaseRecognitionProfile,
    runId: number,
  ) {
    const steps: Array<{
      field: ProfileField;
      recognized: boolean;
      value: string;
      apply: () => void;
      typingApply?: (value: string) => void;
    }> = [
      {
        field: "name",
        recognized: Boolean(profile.name),
        value: profile.name ?? "",
        apply: () => setName(profile.name ?? ""),
        typingApply: setName,
      },
      {
        field: "summary",
        recognized: Boolean(profile.summary),
        value: profile.summary ?? "",
        apply: () => setSummary(profile.summary ?? ""),
      },
      {
        field: "field",
        recognized: Boolean(profile.field),
        value: profile.field ?? "",
        apply: () => setField(profile.field ?? ""),
      },
      {
        field: "applicationScenario",
        recognized: Boolean(profile.applicationScenario),
        value: profile.applicationScenario ?? "",
        apply: () =>
          setApplicationScenario(profile.applicationScenario ?? ""),
      },
    ];

    for (const stepItem of steps) {
      if (recognitionRunRef.current !== runId) return false;
      if (dirtyFieldsRef.current.has(stepItem.field)) continue;

      const applied = await presentRecognizedField(
        {
          fieldName: stepItem.field,
          recognized: stepItem.recognized,
          value: stepItem.value,
          apply: stepItem.apply,
          typingApply: stepItem.typingApply,
        },
        runId,
      );
      if (!applied) return false;
    }

    const keywordsApplied = await presentRecognizedKeywords(
      profile.technicalKeywords,
      runId,
    );
    if (!keywordsApplied || recognitionRunRef.current !== runId) return false;

    return presentRecognizedField(
      {
        fieldName: "productForm",
        recognized: Boolean(profile.productForm),
        value: profile.productForm ?? "",
        apply: () => setProductForm(profile.productForm ?? ""),
        typingApply: setProductForm,
      },
      runId,
    );
  }

  async function applyTrlRecognition(
    profile: TrlRecognitionProfile,
    runId: number,
  ) {
    setTrlReason(profile.trlReason ?? "");

    if (!canApplyAiField("trl", runId)) {
      return recognitionRunRef.current === runId;
    }

    return presentRecognizedField(
      {
        fieldName: "trl",
        recognized: Boolean(profile.trl),
        value: profile.trl ?? "",
        apply: () => setTrl(profile.trl ?? ""),
        typingApply: setTrl,
      },
      runId,
    );
  }

  async function uploadMaterial() {
    const files = Array.from(fileInputRef.current?.files ?? []);
    if (files.length === 0) return;

    const runId = recognitionRunRef.current + 1;
    recognitionRunRef.current = runId;
    setWorkflowStatus("uploading");
    setMaterialError("");
    setStepError("");
    setParsedMaterial(null);
    setProfileVisible(false);
    setProfileFormVisible(false);

    try {
      const parsed = await uploadAndParseMaterial(files[0], () => {
        if (recognitionRunRef.current === runId) setWorkflowStatus("parsing");
      });
      if (recognitionRunRef.current !== runId) return;

      setFileType(parsed.material.fileType);
      setParsedMaterial(parsed.material);
      setProfileVisible(true);
      setProfileFormVisible(false);
      setWorkflowStatus("ready");
    } catch (error) {
      if (recognitionRunRef.current !== runId) return;

      if (error instanceof MaterialValidationError) {
        setMaterialError(error.message);
        setWorkflowStatus("not_uploaded");
        setProfileVisible(false);
        setProfileFormVisible(false);
        return;
      }

      setMaterialError(MATERIAL_PARSE_FAILURE_MESSAGE);
      setWorkflowStatus("not_uploaded");
      setProfileVisible(false);
      setProfileFormVisible(false);
    }
  }

  async function recognizeProfile() {
    if (!parsedMaterial) return;

    const runId = recognitionRunRef.current + 1;
    recognitionRunRef.current = runId;
    let stage: "base" | "trl" = "base";
    const minimumOverlay = wait(8000);

    userInteractedRef.current = false;
    setRecognitionOverlayVisible(true);
    setProfileFormVisible(false);
    setStatuses(initialStatuses("pending"));
    setAnimatedFields(new Set());
    setActiveField(null);
    setWorkflowStatus("recognizing_base");

    try {
      const baseRequest = await requestRecognition(
        "base",
        parsedMaterial.fileName,
        parsedMaterial.extractedText,
      );
      if (recognitionRunRef.current !== runId) return;
      await minimumOverlay;
      if (recognitionRunRef.current !== runId) return;

      setRecognitionOverlayVisible(false);
      setProfileFormVisible(true);

      if (
        !baseRequest.response.ok ||
        baseRequest.result.status === "failed" ||
        baseRequest.result.mode !== "base"
      ) {
        setFieldStatuses(profileFields, "empty");
        setWorkflowStatus("ready");
        return;
      }

      const trlRequestPromise = requestRecognition(
        "trl",
        parsedMaterial.fileName,
        parsedMaterial.extractedText,
      );

      const applied = await applyBaseRecognition(
        baseRequest.result.profile,
        runId,
      );
      if (!applied || recognitionRunRef.current !== runId) return;

      setFieldStatuses(["trl"], "pending");
      setWorkflowStatus("recognizing_trl");
      stage = "trl";

      const trlRequest = await trlRequestPromise;
      if (recognitionRunRef.current !== runId) return;

      if (
        !trlRequest.response.ok ||
        trlRequest.result.status === "failed" ||
        trlRequest.result.mode !== "trl"
      ) {
        setFieldStatuses(["trl"], "failed");
        setWorkflowStatus("ready");
        revealProfileFormAfterRecognition(runId);
        return;
      }

      const trlApplied = await applyTrlRecognition(
        trlRequest.result.profile,
        runId,
      );
      if (!trlApplied || recognitionRunRef.current !== runId) return;
      setWorkflowStatus("ready");
      revealProfileFormAfterRecognition(runId);
    } catch {
      if (recognitionRunRef.current !== runId) return;

      if (stage === "base") {
        await minimumOverlay;
        if (recognitionRunRef.current !== runId) return;
        setRecognitionOverlayVisible(false);
        setFieldStatuses(profileFields, "empty");
        setProfileVisible(true);
        setProfileFormVisible(true);
        setWorkflowStatus("ready");
        return;
      }

      setFieldStatuses(["trl"], "failed");
      setProfileVisible(true);
      setWorkflowStatus("ready");
      setRecognitionOverlayVisible(false);
      revealProfileFormAfterRecognition(runId);
    }
  }

  function addKeyword() {
    const keyword = keywordDraft.trim();

    if (!keyword || technicalKeywords.includes(keyword)) {
      setKeywordDraft("");
      return;
    }

    markFieldManual("technicalKeywords");
    setTechnicalKeywords((current) => [...current, keyword]);
    setKeywordDraft("");
  }

  function continueToCooperation() {
    if (
      !name.trim() ||
      !summary.trim() ||
      !field.trim() ||
      !applicationScenario.trim() ||
      technicalKeywords.length === 0 ||
      !trl
    ) {
      setStepError("请先完成所有必填项目档案字段，再进入下一步。");
      return;
    }

    setStepError("");
    setStep(2);
  }

  function toggleCooperationDemand(option: string) {
    if (option === "其他" && cooperationDemands.includes("其他")) {
      setOtherDemandDetail("");
    }

    setCooperationDemands((current) =>
      current.includes(option)
        ? current.filter((item) => item !== option)
        : [...current, option],
    );
  }

  async function handleSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();

    if (isSubmittingRef.current) {
      return;
    }

    if (cooperationDemands.length === 0) {
      setStepError("请至少选择一项合作需求。");
      return;
    }

    if (cooperationDemands.includes("其他") && !otherDemandDetail.trim()) {
      setStepError("请填写其他合作需求说明。");
      return;
    }

    if (!conversionSupport) {
      setStepError("请选择是否需要成果转化机构协助对接。");
      return;
    }

    if (
      conversionSupport === "需要" &&
      (!projectContact.trim() || !/^1[3-9]\d{9}$/.test(contactPhone))
    ) {
      setStepError("请填写项目联系人和有效的 11 位手机号。");
      return;
    }

    const formData = new FormData(event.currentTarget);
    setStepError("");
    isSubmittingRef.current = true;
    setIsSubmitting(true);

    try {
      await action(formData);
    } catch (error) {
      isSubmittingRef.current = false;
      setIsSubmitting(false);
      setStepError(
        error instanceof Error && error.message
          ? error.message
          : "创建项目失败，请稍后重试。",
      );
    }
  }

  const hasRecognizedProfileField = Object.values(statuses).some(
    (status) => status === "recognized",
  );
  const isRecognitionActive = Object.values(statuses).some(
    (status) => status === "pending",
  );
  const fieldRevealClass = (fieldName: ProfileField) =>
    animatedFields.has(fieldName) ? "profile-field-reveal" : "";
  const fieldContainerClass = (fieldName: ProfileField, display = "block") =>
    [
      display,
      "rounded-lg border p-3 transition-all duration-300",
      activeField === fieldName
        ? "border-teal-300 bg-teal-50/70 shadow-sm"
        : "border-transparent bg-transparent",
      fieldRevealClass(fieldName),
    ].join(" ");
  const materialStatusText =
    workflowStatus === "uploading"
      ? "上传中"
      : workflowStatus === "parsing"
        ? "解析中"
        : fileNames.length > 0
          ? "已解析"
          : "未上传";
  const canGoNext = profileFormVisible;

  function resetSelectedMaterial() {
    if (fileInputRef.current) {
      fileInputRef.current.value = "";
    }

    resetProfileDraft();
    setFileNames([]);
    setFileType("");
    setProfileVisible(false);
    setProfileFormVisible(false);
    setWorkflowStatus("not_uploaded");
    setMaterialError("");
    setStepError("");
  }

  return (
    <form ref={formRef} onSubmit={handleSubmit}>
      <ol className="grid gap-3 border-b border-slate-200 pb-6 sm:grid-cols-2">
        {["上传材料并确认档案", "合作需求与转化对接"].map(
          (label, index) => {
            const itemStep = index + 1;
            const active = step === itemStep;
            const completed = step > itemStep;

            return (
              <li
                key={label}
                aria-current={active ? "step" : undefined}
                className={`rounded-lg border px-4 py-3 ${
                  active
                    ? "border-teal-600 bg-teal-50"
                    : completed
                      ? "border-teal-200 bg-white"
                      : "border-slate-200 bg-slate-50"
                }`}
              >
                <p className="text-xs font-medium text-slate-500">
                  第 {itemStep} 步
                </p>
                <p
                  className={`mt-1 text-sm font-semibold ${
                    active ? "text-teal-800" : "text-slate-800"
                  }`}
                >
                  {label}
                </p>
              </li>
            );
          },
        )}
      </ol>

      {isRecognitionOverlayVisible ? (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/35 px-4 backdrop-blur-sm"
          role="status"
          aria-live="polite"
        >
          <div className="w-full max-w-md rounded-2xl bg-white p-6 shadow-2xl">
            <div className="mx-auto flex h-12 w-12 items-center justify-center rounded-full bg-teal-50">
              <span className="h-3 w-3 animate-pulse rounded-full bg-teal-600" />
            </div>
            <h2 className="mt-4 text-center text-lg font-semibold text-slate-950">
              识别中
            </h2>
            <p className="mt-2 text-center text-sm leading-6 text-slate-600">
              系统正在读取材料并生成项目档案，请稍候。
            </p>
            <div className="mt-5 h-2 overflow-hidden rounded-full bg-slate-100">
              <div className="recognition-overlay-progress h-full rounded-full bg-teal-600" />
            </div>
          </div>
        </div>
      ) : null}

      <section className={step === 1 ? "py-6" : "hidden"}>
        <div className={profileVisible ? "hidden" : ""}>
          <h2 className="text-lg font-semibold text-slate-950">上传项目材料</h2>
          <p className="mt-2 text-sm leading-6 text-slate-600">
            请上传 1 个 PPTX 或 PDF 文件。系统将从材料中识别项目名称、所属领域、应用场景、技术关键词和 TRL 成熟度。建议文件大小 20MB 以内，最大不超过 30MB。
          </p>
          <label className="mt-5 block rounded-lg border border-dashed border-slate-300 bg-slate-50 p-6 text-center">
          <span className="block text-sm font-medium text-slate-900">
            选择项目材料
          </span>
          <span className="mt-1 block text-xs text-slate-500">
            可上传路演稿、商业计划书或项目说明文档
          </span>
          <input
            ref={fileInputRef}
            type="file"
            name="materials"
            accept=".ppt,.pptx,.pdf"
            onChange={(event) => {
              const file = event.currentTarget.files?.[0];

              if (!file) {
                resetProfileDraft();
                setFileNames([]);
                setParsedMaterial(null);
                setMaterialError("");
                setFileType("");
                setProfileVisible(false);
                setProfileFormVisible(false);
                setWorkflowStatus("not_uploaded");
                return;
              }

              const extension = file.name
                .slice(file.name.lastIndexOf("."))
                .toLowerCase();
              let error = "";

              if (
                extension !== ".ppt" &&
                extension !== ".pptx" &&
                extension !== ".pdf"
              ) {
                error = "仅支持上传 1 个 PPT、PPTX 或 PDF 文件。";
              } else if (file.size > 30 * 1024 * 1024) {
                error = "文件大小不能超过 30MB，请压缩后重新上传。";
              }

              if (error) {
                event.currentTarget.value = "";
                setFileNames([]);
                setParsedMaterial(null);
                setFileType("");
                setProfileVisible(false);
                setProfileFormVisible(false);
                setWorkflowStatus("not_uploaded");
                setMaterialError(error);
                return;
              }

              const nextFileType =
                extension === ".pdf"
                  ? "pdf"
                  : extension === ".ppt"
                    ? "ppt"
                    : "pptx";
              resetProfileDraft(false);
              setFileNames([file.name]);
              setParsedMaterial(null);
              setFileType(nextFileType);
              setProfileVisible(false);
              setProfileFormVisible(false);
              setWorkflowStatus("not_uploaded");
              setMaterialError("");
            }}
            className="mt-4 block w-full text-sm text-slate-700 file:mr-4 file:rounded-md file:border-0 file:bg-white file:px-3 file:py-2 file:text-sm file:font-medium file:text-slate-700"
          />
          {getProcessingStatusMessage(workflowStatus) ? (
            <span className="mx-auto mt-4 flex w-fit items-center gap-2 rounded-full border border-teal-200 bg-teal-50 px-3 py-1.5 text-xs font-medium text-teal-800">
              <span className="h-2 w-2 animate-pulse rounded-full bg-teal-600" />
              {getProcessingStatusMessage(workflowStatus)}
            </span>
          ) : null}
          </label>
          {materialError ? (
          <p className="mt-4 rounded-md border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700">
            {materialError}
          </p>
          ) : null}
          {fileNames.length > 0 ? (
          <ul className="mt-4 grid gap-2 text-sm text-slate-700">
            {fileNames.map((fileName) => (
              <li key={fileName} className="rounded-md bg-slate-50 px-3 py-2">
                {fileName}
              </li>
            ))}
          </ul>
          ) : null}
          <div className="mt-6 flex flex-col-reverse gap-3 border-t border-slate-200 pt-5 sm:flex-row sm:justify-between">
          <Link
            href="/projects"
            className="inline-flex h-10 items-center justify-center rounded-md border border-slate-300 bg-white px-4 text-sm font-medium text-slate-700 transition-colors hover:bg-slate-50"
          >
            取消
          </Link>
          <div className="flex flex-col gap-3 sm:flex-row">
            <button
              type="button"
              onClick={uploadMaterial}
              disabled={
                fileNames.length === 0 ||
                workflowStatus === "uploading" ||
                workflowStatus === "parsing" ||
                workflowStatus === "recognizing_base" ||
                workflowStatus === "recognizing_trl"
              }
              className="inline-flex h-10 items-center justify-center rounded-md bg-slate-950 px-4 text-sm font-medium text-white transition-colors hover:bg-slate-800 disabled:cursor-not-allowed disabled:bg-slate-300"
            >
              {workflowStatus === "uploading"
                ? "正在上传…"
                : workflowStatus === "parsing"
                  ? "正在解析…"
                  : "确认上传"}
            </button>
          </div>
        </div>
        </div>
      </section>

      <section
        className={step === 1 && profileVisible ? "pb-6" : "hidden"}
      >
        <div className="mx-auto max-w-4xl">
          {fileNames.length > 0 ? (
            <div className="rounded-xl border border-slate-200 bg-slate-50 p-4">
              <div className="flex flex-wrap items-start justify-between gap-4">
                <div className="min-w-0">
                  <p className="text-xs font-medium text-slate-500">当前材料</p>
                  <h2 className="mt-1 truncate text-base font-semibold text-slate-950">
                    {fileNames[0]}
                  </h2>
                  <div className="mt-3 flex flex-wrap gap-2 text-xs">
                    <span className="rounded-full border border-slate-200 bg-white px-2.5 py-1 font-medium uppercase text-slate-600">
                      {fileType || "文件"}
                    </span>
                    <span
                      className={`rounded-full border px-2.5 py-1 font-medium ${
                        isRecognitionActive
                          ? "border-sky-200 bg-sky-50 text-sky-800"
                          : hasRecognizedProfileField
                            ? "border-teal-200 bg-teal-50 text-teal-800"
                            : "border-amber-200 bg-amber-50 text-amber-800"
                      }`}
                    >
                      {materialStatusText}
                    </span>
                  </div>
                </div>
                <div className="flex flex-wrap gap-2">
                  <button
                    type="button"
                    onClick={resetSelectedMaterial}
                    disabled={isRecognitionOverlayVisible || isRecognitionActive}
                    className="rounded-md border border-slate-300 bg-white px-3 py-1.5 text-xs font-medium text-slate-700 hover:bg-slate-50 disabled:cursor-not-allowed disabled:text-slate-300"
                  >
                    重新选择材料
                  </button>
                  <button
                    type="button"
                    onClick={recognizeProfile}
                    disabled={
                      !parsedMaterial ||
                      isRecognitionOverlayVisible ||
                      isRecognitionActive
                    }
                    className="rounded-md bg-slate-950 px-3 py-1.5 text-xs font-medium text-white hover:bg-slate-800 disabled:cursor-not-allowed disabled:bg-slate-300"
                  >
                    开始识别
                  </button>
                </div>
              </div>
            </div>
          ) : null}

          <div
            ref={profileFormTopRef}
            className={profileFormVisible ? "mt-6" : "hidden"}
          >
        <div className="flex flex-wrap items-center justify-between gap-3">
          <h2 className="text-lg font-semibold text-slate-950">确认项目档案</h2>
        </div>
        <p className="mt-2 text-sm leading-6 text-slate-600">
          {isRecognitionActive
            ? "系统正在识别材料内容，字段会逐项自动填入；你也可以直接编辑。"
            : "AI 已生成项目档案，请确认或修改。未识别字段和识别失败场景均可直接手动补充。"}
        </p>
        <div
          className={profileFormVisible ? "mt-6 grid gap-6" : "hidden"}
          onFocusCapture={markUserInteracted}
        >
          <label
            data-profile-field="name"
            className={`${fieldContainerClass("name")} text-sm font-medium text-slate-900`}
          >
            项目名称 <span className="text-red-600">*</span>
            <FieldStatus status={statuses.name} />
            <input
              name="name"
              value={name}
              onChange={(event) => {
                markFieldManual("name");
                setName(event.target.value);
              }}
              required
              className={inputClass}
            />
          </label>

          <label
            data-profile-field="summary"
            className={`${fieldContainerClass("summary")} text-sm font-medium text-slate-900`}
          >
            一句话简介 <span className="text-red-600">*</span>
            <FieldStatus status={statuses.summary} />
            <textarea
              name="summary"
              value={summary}
              onChange={(event) => {
                markFieldManual("summary");
                setSummary(event.target.value);
              }}
              required
              rows={3}
              className={inputClass}
            />
          </label>

          <label
            data-profile-field="field"
            className={`${fieldContainerClass("field")} text-sm font-medium text-slate-900`}
          >
            所属领域 <span className="text-red-600">*</span>
            <FieldStatus status={statuses.field} select />
            <select
              name="field"
              value={field}
              onChange={(event) => {
                markFieldManual("field");
                setField(event.target.value);
              }}
              required
              className={inputClass}
            >
              <option value="">请选择所属领域</option>
              {PROJECT_FIELD_OPTIONS.map((option) => (
                <option key={option} value={option}>
                  {option}
                </option>
              ))}
            </select>
          </label>

          <label
            data-profile-field="applicationScenario"
            className={`${fieldContainerClass("applicationScenario")} text-sm font-medium text-slate-900`}
          >
            应用场景 <span className="text-red-600">*</span>
            <FieldStatus status={statuses.applicationScenario} />
            <textarea
              name="applicationScenario"
              value={applicationScenario}
              onChange={(event) => {
                markFieldManual("applicationScenario");
                setApplicationScenario(event.target.value);
              }}
              required
              rows={3}
              className={inputClass}
            />
          </label>

          <div
            data-profile-field="technicalKeywords"
            className={fieldContainerClass("technicalKeywords")}
          >
            <p className="text-sm font-medium text-slate-900">
              技术关键词 <span className="text-red-600">*</span>
            </p>
            <FieldStatus status={statuses.technicalKeywords} />
            <input
              type="hidden"
              name="technicalKeywords"
              value={technicalKeywords.join("、")}
            />
            {technicalKeywords.length > 0 ? (
              <div className="mt-3 flex flex-wrap gap-2">
                {technicalKeywords.map((keyword) => (
                  <button
                    key={keyword}
                    type="button"
                    onClick={() => {
                      markFieldManual("technicalKeywords");
                      setTechnicalKeywords((current) =>
                        current.filter((item) => item !== keyword),
                      );
                    }}
                    className="profile-keyword-reveal rounded-full border border-teal-200 bg-teal-50 px-3 py-1 text-xs font-medium text-teal-800"
                    aria-label={`删除关键词 ${keyword}`}
                  >
                    {keyword} ×
                  </button>
                ))}
              </div>
            ) : (
              <p className="mt-3 text-xs text-slate-500">暂无关键词，请在下方添加。</p>
            )}
            <div className="mt-3 flex max-w-2xl gap-2">
              <input
                value={keywordDraft}
                onChange={(event) => {
                  markFieldManual("technicalKeywords");
                  setKeywordDraft(event.target.value);
                }}
                onKeyDown={(event) => {
                  if (event.key === "Enter") {
                    event.preventDefault();
                    addKeyword();
                  }
                }}
                placeholder="输入关键词后添加"
                className="w-full rounded-md border border-slate-300 bg-white px-3 py-2 text-sm text-slate-950 shadow-sm outline-none transition focus:border-teal-600 focus:ring-2 focus:ring-teal-100"
              />
              <button
                type="button"
                onClick={addKeyword}
                className="shrink-0 rounded-md border border-slate-300 bg-white px-4 text-sm font-medium text-slate-700 hover:bg-slate-50"
              >
                添加
              </button>
            </div>
          </div>

          <label
            data-profile-field="productForm"
            className={`${fieldContainerClass("productForm")} text-sm font-medium text-slate-900`}
          >
            产品形态 <span className="text-xs font-normal text-slate-500">（可选）</span>
            <FieldStatus status={statuses.productForm} />
            <input
              name="productForm"
              value={productForm}
              onChange={(event) => {
                markFieldManual("productForm");
                setProductForm(event.target.value);
              }}
              className={inputClass}
            />
          </label>

          <label
            data-profile-field="trl"
            className={`${fieldContainerClass("trl")} text-sm font-medium text-slate-900`}
          >
            TRL成熟度 <span className="text-red-600">*</span>
            <FieldStatus
              status={statuses.trl}
              select
              pendingMessage={
                workflowStatus === "recognizing_base"
                  ? "等待基础档案识别完成。"
                  : "正在识别 TRL 成熟度…"
              }
              recognizedMessage="AI 建议，可修改。"
              emptyMessage="TRL 暂未自动判断，请手动选择。"
              failedMessage="TRL 暂未自动判断，请手动选择。"
              tooltip={trlReason || undefined}
            />
            <input type="hidden" name="trlReason" value={trlReason} />
            <select
              name="trl"
              value={trl}
              onChange={(event) => {
                markFieldManual("trl");
                setTrl(event.target.value);
              }}
              required
              className={inputClass}
            >
              <option value="">请选择 TRL成熟度</option>
              {PROJECT_TRL_OPTIONS.map(([value, description]) => (
                <option key={value} value={value}>
                  {value} {description}
                </option>
              ))}
            </select>
          </label>
        </div>

        {stepError ? (
          <p className="mt-5 rounded-md border border-amber-200 bg-amber-50 px-3 py-2 text-sm text-amber-800">
            {stepError}
          </p>
        ) : null}

        <div className="mt-6 flex flex-col-reverse gap-3 border-t border-slate-200 pt-5 sm:flex-row sm:justify-between">
          <button
            type="button"
            onClick={resetSelectedMaterial}
            className="inline-flex h-10 items-center justify-center rounded-md border border-slate-300 bg-white px-4 text-sm font-medium text-slate-700 hover:bg-slate-50"
          >
            重新选择材料
          </button>
          <div className="flex flex-col items-stretch gap-2 sm:items-end">
            {!canGoNext ? (
              <p className="text-xs text-slate-500">
                请补充必填项目档案字段后继续。
              </p>
            ) : null}
            <button
              type="button"
              onClick={continueToCooperation}
              disabled={!canGoNext}
              className="inline-flex h-10 items-center justify-center rounded-md bg-slate-950 px-4 text-sm font-medium text-white hover:bg-slate-800 disabled:cursor-not-allowed disabled:bg-slate-300"
            >
              下一步
            </button>
          </div>
        </div>
          </div>
        </div>
      </section>

      <section className={step === 2 ? "py-6" : "hidden"}>
        <h2 className="text-lg font-semibold text-slate-950">
          合作需求与转化对接
        </h2>
        <p className="mt-2 text-sm leading-6 text-slate-600">
          请选择当前合作需求，并明确是否需要成果转化机构协助对接。
        </p>

        <div className="mt-6 grid gap-6">
          <fieldset>
            <legend className="text-sm font-medium text-slate-900">
              合作需求 <span className="text-red-600">*</span>
              <span className="ml-2 text-xs font-normal text-slate-500">可多选</span>
            </legend>
            <div className="mt-3 grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
              {COOPERATION_DEMAND_OPTIONS.map((option) => (
                <label
                  key={option}
                  className={`flex cursor-pointer items-center gap-3 rounded-md border px-3 py-3 text-sm ${
                    cooperationDemands.includes(option)
                      ? "border-teal-500 bg-teal-50 text-teal-900"
                      : "border-slate-200 bg-white text-slate-700"
                  }`}
                >
                  <input
                    type="checkbox"
                    name="cooperationDemand"
                    value={option}
                    checked={cooperationDemands.includes(option)}
                    onChange={() => toggleCooperationDemand(option)}
                    className="h-4 w-4 accent-teal-700"
                  />
                  {option}
                </label>
              ))}
            </div>
          </fieldset>

          {cooperationDemands.includes("其他") ? (
            <label className="block text-sm font-medium text-slate-900">
              其他合作需求说明 <span className="text-red-600">*</span>
              <textarea
                name="otherDemandDetail"
                value={otherDemandDetail}
                onChange={(event) => setOtherDemandDetail(event.target.value)}
                required
                rows={3}
                placeholder="请填写其他合作需求"
                className={inputClass}
              />
            </label>
          ) : null}

          <fieldset>
            <legend className="text-sm font-medium text-slate-900">
              是否需要成果转化机构协助对接？
              <span className="text-red-600"> *</span>
            </legend>
            <div className="mt-3 grid gap-3 sm:grid-cols-2">
              {["需要", "暂不需要"].map((option) => (
                <label
                  key={option}
                  className={`flex cursor-pointer items-center gap-3 rounded-md border px-4 py-3 text-sm ${
                    conversionSupport === option
                      ? "border-teal-500 bg-teal-50 text-teal-900"
                      : "border-slate-200 bg-white text-slate-700"
                  }`}
                >
                  <input
                    type="radio"
                    name="conversionSupport"
                    value={option}
                    checked={conversionSupport === option}
                    onChange={() => {
                      setConversionSupport(option);

                      if (option === "暂不需要") {
                        setProjectContact("");
                        setContactPhone("");
                      }
                    }}
                    className="h-4 w-4 accent-teal-700"
                  />
                  {option}
                </label>
              ))}
            </div>
          </fieldset>

          {conversionSupport === "需要" ? (
            <div className="grid gap-5 rounded-lg border border-slate-200 bg-slate-50 p-4 sm:grid-cols-2">
              <label className="block text-sm font-medium text-slate-900">
                项目联系人 <span className="text-red-600">*</span>
                <input
                  name="projectContact"
                  value={projectContact}
                  onChange={(event) => setProjectContact(event.target.value)}
                  required
                  placeholder="请输入项目联系人姓名"
                  className={inputClass}
                />
              </label>
              <label className="block text-sm font-medium text-slate-900">
                手机号 <span className="text-red-600">*</span>
                <input
                  type="tel"
                  inputMode="numeric"
                  name="contactPhone"
                  value={contactPhone}
                  onChange={(event) => setContactPhone(event.target.value)}
                  required
                  pattern="1[3-9][0-9]{9}"
                  maxLength={11}
                  placeholder="请输入项目联系人手机号"
                  className={inputClass}
                />
              </label>
              <p className="text-xs leading-5 text-slate-500 sm:col-span-2">
                联系方式仅用于项目转化对接联系，不影响训练功能。
              </p>
            </div>
          ) : null}
        </div>

        {stepError ? (
          <p className="mt-5 rounded-md border border-amber-200 bg-amber-50 px-3 py-2 text-sm text-amber-800">
            {stepError}
          </p>
        ) : null}

        <div className="mt-6 flex flex-col-reverse gap-3 border-t border-slate-200 pt-5 sm:flex-row sm:justify-between">
          <button
            type="button"
            disabled={isSubmitting}
            onClick={() => {
              if (isSubmitting) return;

              setStepError("");
              setStep(1);
            }}
            className="inline-flex h-10 items-center justify-center rounded-md border border-slate-300 bg-white px-4 text-sm font-medium text-slate-700 hover:bg-slate-50 disabled:cursor-not-allowed disabled:opacity-60"
          >
            上一步
          </button>
          <button
            type="submit"
            disabled={isSubmitting}
            className="inline-flex h-10 items-center justify-center rounded-md bg-slate-950 px-5 text-sm font-medium text-white hover:bg-slate-800 disabled:cursor-not-allowed disabled:bg-slate-500"
          >
            {isSubmitting ? "正在创建项目..." : "完成建档并进入项目"}
          </button>
        </div>
      </section>
    </form>
  );
}
