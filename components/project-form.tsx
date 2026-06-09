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
};

type ProjectFormProps = Readonly<{
  action: (formData: FormData) => Promise<void>;
  submitLabel: string;
  cancelHref: string;
  initialValues?: ProjectFormValues;
}>;

const fields = [
  { name: "name", label: "项目名称", required: true, type: "input" },
  { name: "field", label: "所属赛道", required: false, type: "input" },
  { name: "stage", label: "项目阶段", required: false, type: "input" },
  { name: "summary", label: "项目简介", required: false, type: "textarea" },
  { name: "coreTechnology", label: "核心技术", required: false, type: "textarea" },
  {
    name: "applicationScenario",
    label: "应用场景",
    required: false,
    type: "textarea",
  },
  { name: "businessModel", label: "商业模式", required: false, type: "textarea" },
  {
    name: "cooperationDemand",
    label: "合作/融资诉求",
    required: false,
    type: "textarea",
  },
] as const;

export function ProjectForm({
  action,
  submitLabel,
  cancelHref,
  initialValues,
}: ProjectFormProps) {
  return (
    <form action={action} className="grid gap-5">
      {fields.map((field) => {
        const value =
          initialValues?.[field.name as keyof ProjectFormValues] ?? "";
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
                rows={4}
                className={baseClass}
              />
            ) : (
              <input
                name={field.name}
                defaultValue={value}
                required={field.required}
                className={baseClass}
              />
            )}
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
