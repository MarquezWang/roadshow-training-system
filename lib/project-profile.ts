export const PROJECT_FIELD_OPTIONS = [
  "人工智能与数字技术",
  "高端装备与智能制造",
  "新能源与新型储能",
  "节能环保与双碳",
  "新材料",
  "生物医药与医疗器械",
  "航空航天与低空经济",
  "集成电路与先进计算",
  "机器人与自动化",
  "智慧交通与智慧城市",
  "现代农业与食品科技",
  "海洋工程与高技术船舶",
  "科技服务与企业服务",
  "文化科技与数字创意",
  "其他",
] as const;

export const COOPERATION_DEMAND_OPTIONS = [
  "场景试点",
  "产业合作",
  "客户/订单导入",
  "投融资对接",
  "技术验证",
  "联合研发",
  "路演展示/赛事晋级",
  "政策/平台支持",
  "其他",
] as const;

export const PROJECT_TRL_OPTIONS = [
  ["TRL 1", "基础原理阶段：有基础理论或科学原理，但还没有明确技术方案"],
  ["TRL 2", "技术概念阶段：已提出技术概念、应用设想或初步方案"],
  ["TRL 3", "原理验证阶段：已完成关键原理、算法、功能或实验验证"],
  ["TRL 4", "实验室样机阶段：已形成实验室样机、Demo、模型或初步系统"],
  ["TRL 5", "相关环境验证阶段：已在实验环境、模拟环境或相关场景中验证"],
  ["TRL 6", "工程样机验证阶段：已形成较完整原型，并完成接近真实环境的测试"],
  ["TRL 7", "真实场景试点阶段：已在真实用户、真实场景或示范项目中试用"],
  ["TRL 8", "定型应用阶段：产品或系统基本定型，具备交付、部署或推广条件"],
  ["TRL 9", "成熟应用阶段：已稳定运行、商业化应用、批量交付或规模推广"],
] as const;

export type ProjectField = (typeof PROJECT_FIELD_OPTIONS)[number];
export type CooperationDemand = (typeof COOPERATION_DEMAND_OPTIONS)[number];

const FIELD_KEYWORDS: Array<{
  field: ProjectField;
  keywords: string[];
}> = [
  {
    field: "文化科技与数字创意",
    keywords: ["文化", "文创", "数字创意", "数字人", "数字替身", "CG", "影视", "游戏"],
  },
  {
    field: "生物医药与医疗器械",
    keywords: ["生物", "医药", "医疗", "器械", "诊疗", "健康"],
  },
  {
    field: "航空航天与低空经济",
    keywords: ["航空", "航天", "低空", "无人机", "飞行器"],
  },
  {
    field: "集成电路与先进计算",
    keywords: ["集成电路", "芯片", "半导体", "先进计算", "算力"],
  },
  {
    field: "机器人与自动化",
    keywords: ["机器人", "自动化", "机械臂"],
  },
  {
    field: "新能源与新型储能",
    keywords: ["新能源", "储能", "光伏", "风电", "氢能", "电池"],
  },
  {
    field: "节能环保与双碳",
    keywords: ["节能", "环保", "双碳", "碳中和", "碳减排", "循环经济"],
  },
  {
    field: "智慧交通与智慧城市",
    keywords: ["智慧交通", "智慧城市", "城市治理", "车路协同", "交通"],
  },
  {
    field: "现代农业与食品科技",
    keywords: ["农业", "种植", "养殖", "食品", "农产品"],
  },
  {
    field: "海洋工程与高技术船舶",
    keywords: ["海洋", "船舶", "海工", "水下"],
  },
  {
    field: "高端装备与智能制造",
    keywords: ["高端装备", "智能制造", "工业", "制造", "装备", "数控"],
  },
  {
    field: "新材料",
    keywords: ["新材料", "复合材料", "纳米材料", "功能材料", "材料"],
  },
  {
    field: "科技服务与企业服务",
    keywords: ["科技服务", "企业服务", "SaaS", "咨询", "供应链服务"],
  },
  {
    field: "人工智能与数字技术",
    keywords: ["人工智能", "AI", "大模型", "算法", "大数据", "云计算", "数字技术", "软件"],
  },
];

export function isProjectField(value: string): value is ProjectField {
  return PROJECT_FIELD_OPTIONS.some((option) => option === value);
}

export function isCooperationDemand(
  value: string,
): value is CooperationDemand {
  return COOPERATION_DEMAND_OPTIONS.some((option) => option === value);
}

export function normalizeProjectField(value: string | null): ProjectField {
  if (!value) {
    return "其他";
  }

  const normalizedValue = value.trim();

  if (isProjectField(normalizedValue)) {
    return normalizedValue;
  }

  const lowerValue = normalizedValue.toLowerCase();
  const matched = FIELD_KEYWORDS.find(({ keywords }) =>
    keywords.some((keyword) => lowerValue.includes(keyword.toLowerCase())),
  );

  return matched?.field ?? "其他";
}

export function normalizeTechnicalKeywords(value: unknown) {
  const values = Array.isArray(value) ? value : [value];
  const keywords = values.flatMap((item) =>
    typeof item === "string" ? item.split(/[、,，;；\n\r]+/) : [],
  );

  return [...new Set(keywords.map((item) => item.trim()).filter(Boolean))].slice(
    0,
    12,
  );
}

function decodeJsonString(value: string) {
  try {
    return JSON.parse(value) as unknown;
  } catch {
    return null;
  }
}

function extractLooseString(rawText: string, key: string) {
  const match = rawText.match(
    new RegExp(`"${key}"\\s*:\\s*("(?:\\\\.|[^"\\\\])*")`, "i"),
  );
  const value = match ? decodeJsonString(match[1]) : null;
  return typeof value === "string" ? value : null;
}

function extractLooseKeywords(rawText: string) {
  const stringValue = extractLooseString(rawText, "technicalKeywords");
  if (stringValue) return stringValue;

  const arrayMatch = rawText.match(
    /"technicalKeywords"\s*:\s*\[([\s\S]*?)(?:\]|$)/i,
  );
  if (!arrayMatch) return [];

  return [...arrayMatch[1].matchAll(/"((?:\\.|[^"\\])*)"/g)]
    .map((match) => decodeJsonString(`"${match[1]}"`))
    .filter((value): value is string => typeof value === "string");
}

export function extractLooseProjectProfile(rawText: string) {
  return {
    name: extractLooseString(rawText, "name"),
    summary: extractLooseString(rawText, "summary"),
    field: extractLooseString(rawText, "field"),
    applicationScenario: extractLooseString(rawText, "applicationScenario"),
    technicalKeywords: extractLooseKeywords(rawText),
    productForm: extractLooseString(rawText, "productForm"),
  };
}
