import Link from "next/link";
import {
  createFilterHref,
  modelOptions,
  riskOptions,
  statusOptions,
  type PromptFilters,
} from "./prompt-policy";

type FilterGroupProps = {
  label: string;
  options: readonly string[];
  active: string;
  current: PromptFilters;
  param: keyof PromptFilters;
};

function FilterGroup({
  label,
  options,
  active,
  current,
  param,
}: FilterGroupProps) {
  return (
    <div>
      <p className="text-xs font-medium text-slate-500">{label}</p>
      <div className="mt-2 flex flex-wrap gap-2">
        {options.map((option) => {
          const next = {
            ...current,
            [param]: option,
          } as PromptFilters;
          const isActive = option === active;

          return (
            <Link
              key={option}
              href={createFilterHref(next)}
              className={`rounded-full border px-3 py-1.5 text-xs font-medium transition ${
                isActive
                  ? "border-slate-950 bg-slate-950 text-white"
                  : "border-slate-200 bg-white text-slate-600 hover:border-slate-300"
              }`}
            >
              {option}
            </Link>
          );
        })}
      </div>
    </div>
  );
}

export function PromptFilterSection({ filters }: { filters: PromptFilters }) {
  return (
    <section className="mt-6 rounded-xl border border-slate-200 bg-white p-5 shadow-sm">
      <div className="grid gap-5 lg:grid-cols-3">
        <FilterGroup
          label="模型档位"
          options={modelOptions}
          active={filters.model}
          current={filters}
          param="model"
        />
        <FilterGroup
          label="风险等级"
          options={riskOptions}
          active={filters.risk}
          current={filters}
          param="risk"
        />
        <FilterGroup
          label="接入状态"
          options={statusOptions}
          active={filters.status}
          current={filters}
          param="status"
        />
      </div>
    </section>
  );
}
