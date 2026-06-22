import Link from "next/link";

type ProjectFormValues = {
  name?: string;
  field?: string;
  stage?: string;
  summary?: string;
  coreTechnology?: string;
  applicationScenario?: string;
  businessModel?: string;
  cooperationDemand?: string;
  productForm?: string;
  trlLevel?: number | null;
  trlReason?: string;
  teamInfo?: string;
  currentProgress?: string;
};

type ProjectFormProps = Readonly<{
  action: (formData: FormData) => Promise<void>;
  submitLabel: string;
  cancelHref: string;
  initialValues?: ProjectFormValues;
}>;

type Field = {
  name: keyof ProjectFormValues;
  label: string;
  required?: boolean;
  type: "input" | "number" | "textarea";
  rows?: number;
  placeholder?: string;
  helpText?: string;
};

const fields: Field[] = [
  { name: "name", label: "项目名称", required: true, type: "input" },
  {
    name: "summary",
    label: "一句话简介",
    required: true,
    type: "textarea",
    rows: 3,
    placeholder: "用一句话说明项目做什么、面向谁、解决什么问题。",
  },
  { name: "field", label: "所属领域", required: true, type: "input" },
  {
    name: "applicationScenario",
    label: "应用场景",
    required: true,
    type: "textarea",
    rows: 3,
  },
  {
    name: "coreTechnology",
    label: "技术关键词",
    required: true,
    type: "textarea",
    rows: 3,
    placeholder: "可用顿号、逗号或换行分隔。",
  },
  { name: "productForm", label: "产品形态", type: "input" },
  {
    name: "trlLevel",
    label: "TRL 等级",
    type: "number",
    placeholder: "1-9",
    helpText: "技术成熟度等级，1 为基础原理阶段，9 为成熟应用阶段。",
  },
  {
    name: "stage",
    label: "成熟度描述",
    type: "input",
    placeholder: "如：TRL 6 工程样机验证阶段",
  },
  {
    name: "trlReason",
    label: "TRL 判断依据",
    type: "textarea",
    rows: 3,
  },
  {
    name: "teamInfo",
    label: "团队/单位信息",
    type: "textarea",
    rows: 3,
    placeholder: "填写项目团队、所在单位、核心成员或承担主体。",
  },
  {
    name: "cooperationDemand",
    label: "合作需求",
    type: "textarea",
    rows: 3,
    placeholder: "填写场景试点、产业合作、客户导入、投融资对接等真实诉求。",
  },
  {
    name: "currentProgress",
    label: "当前已有进展",
    type: "textarea",
    rows: 3,
    placeholder: "可填写样机、Demo、测试报告、专利、软著、试点、客户、订单、获奖或立项情况。",
  },
  {
    name: "businessModel",
    label: "商业模式/转化模式",
    type: "textarea",
    rows: 3,
  },
];

function getInitialValue(
  initialValues: ProjectFormValues | undefined,
  fieldName: keyof ProjectFormValues,
) {
  const value = initialValues?.[fieldName];

  if (value === null || value === undefined) {
    return "";
  }

  return String(value);
}

export function ProjectForm({
  action,
  submitLabel,
  cancelHref,
  initialValues,
}: ProjectFormProps) {
  return (
    <form action={action} className="grid gap-5">
      {fields.map((field) => {
        const value = getInitialValue(initialValues, field.name);
        const baseClass =
          "mt-2 w-full rounded-md border border-slate-300 bg-white px-3 py-2 text-sm text-slate-950 shadow-sm outline-none transition focus:border-teal-600 focus:ring-2 focus:ring-teal-100";

        return (
          <label key={field.name} className="block text-sm font-medium text-slate-900">
            {field.label}
            {field.required ? <span className="text-red-600"> *</span> : null}
            {field.type === "textarea" ? (
              <textarea
                name={field.name}
                defaultValue={value}
                rows={field.rows ?? 4}
                required={field.required}
                placeholder={field.placeholder}
                className={baseClass}
              />
            ) : (
              <input
                name={field.name}
                defaultValue={value}
                required={field.required}
                placeholder={field.placeholder}
                type={field.type === "number" ? "number" : "text"}
                min={field.type === "number" ? 1 : undefined}
                max={field.type === "number" ? 9 : undefined}
                className={baseClass}
              />
            )}
            {field.helpText ? (
              <span className="mt-1 block text-xs leading-5 text-slate-500">
                {field.helpText}
              </span>
            ) : null}
          </label>
        );
      })}

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
