import Link from "next/link";
import {
  COOPERATION_DEMAND_OPTIONS,
  PROJECT_FIELD_OPTIONS,
  PROJECT_TRL_OPTIONS,
} from "@/lib/project-profile";

type ProjectFormValues = {
  name?: string;
  field?: string;
  stage?: string;
  summary?: string;
  coreTechnology?: string;
  applicationScenario?: string;
  productForm?: string;
  cooperationDemand?: string;
  cooperationDemandDetail?: string;
};

type ProjectFormProps = Readonly<{
  action: (formData: FormData) => Promise<void>;
  submitLabel: string;
  cancelHref: string;
  initialValues?: ProjectFormValues;
}>;

const inputClass =
  "mt-2 w-full rounded-md border border-slate-300 bg-white px-3 py-2 text-sm text-slate-950 shadow-sm outline-none transition focus:border-teal-600 focus:ring-2 focus:ring-teal-100";

function splitCooperationDemand(value?: string) {
  return (value ?? "")
    .split(/[、,，;；\n\r]+/)
    .map((item) => item.trim())
    .filter(Boolean);
}

function getCooperationDemandDraft(value?: string) {
  const parts = splitCooperationDemand(value);
  const selected = parts.filter((item) =>
    COOPERATION_DEMAND_OPTIONS.some((option) => option === item),
  );
  const unknown = parts.filter(
    (item) => !COOPERATION_DEMAND_OPTIONS.some((option) => option === item),
  );

  return {
    selected,
    unknownText: unknown.join("、"),
  };
}

export function ProjectForm({
  action,
  submitLabel,
  cancelHref,
  initialValues,
}: ProjectFormProps) {
  const demandDraft = getCooperationDemandDraft(
    initialValues?.cooperationDemand,
  );
  const selectedDemands = new Set(
    demandDraft.selected.length > 0 || !demandDraft.unknownText
      ? demandDraft.selected
      : ["其他"],
  );
  const cooperationDemandDetail =
    initialValues?.cooperationDemandDetail || demandDraft.unknownText;

  return (
    <form action={action} className="grid gap-6">
      <div className="grid gap-5 sm:grid-cols-2">
        <label className="block text-sm font-medium text-slate-900 sm:col-span-2">
          项目名称 <span className="text-red-600">*</span>
          <input
            name="name"
            defaultValue={initialValues?.name ?? ""}
            required
            placeholder="请输入项目名称"
            className={inputClass}
          />
        </label>

        <label className="block text-sm font-medium text-slate-900 sm:col-span-2">
          一句话简介 <span className="text-red-600">*</span>
          <textarea
            name="summary"
            defaultValue={initialValues?.summary ?? ""}
            required
            rows={3}
            placeholder="用一句话说明项目定位、核心价值或解决的问题"
            className={inputClass}
          />
        </label>

        <label className="block text-sm font-medium text-slate-900">
          所属领域 <span className="text-red-600">*</span>
          <select
            name="field"
            defaultValue={initialValues?.field ?? ""}
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

        <label className="block text-sm font-medium text-slate-900">
          TRL 成熟度 <span className="text-red-600">*</span>
          <select
            name="stage"
            defaultValue={initialValues?.stage ?? ""}
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

        <label className="block text-sm font-medium text-slate-900 sm:col-span-2">
          应用场景 <span className="text-red-600">*</span>
          <textarea
            name="applicationScenario"
            defaultValue={initialValues?.applicationScenario ?? ""}
            required
            rows={3}
            placeholder="描述目标用户、使用场景或落地环节"
            className={inputClass}
          />
        </label>

        <label className="block text-sm font-medium text-slate-900 sm:col-span-2">
          技术关键词 <span className="text-red-600">*</span>
          <textarea
            name="coreTechnology"
            defaultValue={initialValues?.coreTechnology ?? ""}
            required
            rows={3}
            placeholder="多个关键词可用顿号、逗号或换行分隔"
            className={inputClass}
          />
        </label>

        <label className="block text-sm font-medium text-slate-900 sm:col-span-2">
          产品形态{" "}
          <span className="text-xs font-normal text-slate-500">（可选）</span>
          <input
            name="productForm"
            defaultValue={initialValues?.productForm ?? ""}
            placeholder="例如：SaaS 平台、硬件设备、系统解决方案"
            className={inputClass}
          />
        </label>
      </div>

      <fieldset>
        <legend className="text-sm font-medium text-slate-900">
          合作需求 <span className="text-red-600">*</span>
          <span className="ml-2 text-xs font-normal text-slate-500">可多选</span>
        </legend>
        <div className="mt-3 grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
          {COOPERATION_DEMAND_OPTIONS.map((option) => (
            <label
              key={option}
              className="flex cursor-pointer items-center gap-3 rounded-md border border-slate-200 bg-white px-3 py-3 text-sm text-slate-700 transition-colors has-[:checked]:border-teal-500 has-[:checked]:bg-teal-50 has-[:checked]:text-teal-900"
            >
              <input
                type="checkbox"
                name="cooperationDemand"
                value={option}
                defaultChecked={selectedDemands.has(option)}
                className="h-4 w-4 accent-teal-700"
              />
              {option}
            </label>
          ))}
        </div>
      </fieldset>

      <label className="block text-sm font-medium text-slate-900">
        合作需求补充说明
        <textarea
          name="cooperationDemandDetail"
          defaultValue={cooperationDemandDetail}
          rows={3}
          placeholder="如选择其他，或需要补充说明合作需求，请填写在这里"
          className={inputClass}
        />
      </label>

      <div className="flex flex-col-reverse gap-3 border-t border-slate-200 pt-5 sm:flex-row sm:justify-end">
        <Link
          href={cancelHref}
          className="inline-flex h-10 items-center justify-center rounded-md border border-slate-300 bg-white px-4 text-sm font-medium text-slate-700 transition-colors hover:bg-slate-50"
        >
          取消
        </Link>
        <button
          type="submit"
          className="inline-flex h-10 items-center justify-center rounded-md bg-slate-950 px-4 text-sm font-medium text-white transition-colors hover:bg-slate-800"
        >
          {submitLabel}
        </button>
      </div>
    </form>
  );
}
