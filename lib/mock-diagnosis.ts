import type { ProjectAIContext } from "@/lib/project-context";

export type MaterialDiagnosisResult = {
  projectSummary: string;
  materialCompleteness: string;
  criterionAnalysis: Array<{
    category: string;
    criterion: string;
    maxScore: number;
    materialStatus: string;
    problems: string[];
    suggestions: string[];
  }>;
  keyIssues: string[];
  riskPoints: string[];
  slideSuggestions: string[];
  pitchSuggestions: string[];
  priorityActions: string[];
};

function compactText(value: string) {
  return value.replace(/\s+/g, "");
}

function includesAny(text: string, keywords: string[]) {
  return keywords.some((keyword) => text.includes(keyword));
}

function buildMaterialCorpus(context: ProjectAIContext) {
  return [
    context.project.name,
    context.project.field,
    context.project.stage,
    context.project.summary,
    context.project.coreTechnology,
    context.project.applicationScenario,
    context.project.businessModel,
    context.project.cooperationDemand,
    ...context.files.map((file) => file.extractedText),
  ].join("\n");
}

function trimSentenceFragment(value: string) {
  return value.trim().replace(/[，。；、,.；;]+$/g, "");
}

function getCriterionDiagnosis(
  criterionName: string,
  corpus: string,
): Pick<
  MaterialDiagnosisResult["criterionAnalysis"][number],
  "materialStatus" | "problems" | "suggestions"
> {
  if (includesAny(criterionName, ["知识水平", "团队结构", "稳定程度"])) {
    return {
      materialStatus: includesAny(corpus, ["团队", "负责人", "成员"])
        ? "材料提及团队相关信息，但团队成员、负责人背景和投入稳定性仍需进一步结构化呈现。"
        : "材料未提供团队成员、负责人背景、投入稳定性等信息。",
      problems: [
        "团队成员、负责人背景、投入稳定性等信息未提供或呈现不充分。",
        "缺少核心岗位分工、过往经验和持续研发投入安排的说明。",
      ],
      suggestions: [
        "补充团队负责人、核心成员、专业背景、过往项目经验和职责分工。",
        "增加团队投入时间、合作稳定性、持续研发计划和经费来源说明。",
      ],
    };
  }

  if (includesAny(criterionName, ["主体技术水平", "技术优势", "进入壁垒"])) {
    return {
      materialStatus: includesAny(corpus, ["固态储能", "固态", "储能", "电解质"])
        ? "材料已呈现固态储能方向、核心技术方向和应用目标，但关键技术指标和对标数据仍不足。"
        : "材料对核心技术方向描述不足，依据不足。",
      problems: [
        "材料未充分提供可验证的技术指标、测试数据和行业标杆对比。",
        "核心技术不易被模仿或替代的依据仍需加强。",
      ],
      suggestions: [
        "补充能量密度、循环寿命、安全性、成本等关键指标，并与主流储能方案对比。",
        "说明复合固态电解质、热失控监测算法或电池管理系统的技术边界和壁垒来源。",
      ],
    };
  }

  if (includesAny(criterionName, ["市场需求", "市场价值"])) {
    return {
      materialStatus: includesAny(corpus, ["园区", "工商", "客户", "试点"])
        ? "材料提到园区微电网、工商业储能等应用场景，但客户证据和需求验证仍不充分。"
        : "材料未充分提供目标客户、市场需求和场景验证信息。",
      problems: [
        "客户、试点、订单或意向合作证据材料未提供。",
        "市场规模、客户分层和替代方案对比仍不够明确。",
      ],
      suggestions: [
        "补充目标客户画像、典型场景、客户访谈或试点进展。",
        "增加与液态电池、传统储能方案的市场价值和供应链位置对比。",
      ],
    };
  }

  if (includesAny(criterionName, ["知识产权"])) {
    return {
      materialStatus: includesAny(corpus, ["专利", "知识产权", "软著"])
        ? "材料提及知识产权相关内容，但编号、权属和保护范围需要进一步明确。"
        : "材料未提供知识产权编号、权属状态或保护计划。",
      problems: [
        "材料未提供专利、软著或核心工艺保护的明确证据。",
        "知识产权与竞争壁垒之间的对应关系不清晰。",
      ],
      suggestions: [
        "补充专利名称、申请号或授权号、权属状态和覆盖的关键技术点。",
        "说明知识产权如何保护固态储能核心工艺、算法或系统集成能力。",
      ],
    };
  }

  if (includesAny(criterionName, ["成熟度", "转化", "实施计划"])) {
    return {
      materialStatus: includesAny(corpus, ["中试", "试点", "量产", "融资"])
        ? "材料提到中试验证、试点场景或融资诉求，但转化路线和验收指标仍需细化。"
        : "材料未充分提供技术成熟度、转化路线、验收指标和投融资计划。",
      problems: [
        "测试数据、试点周期、验收标准和量产条件材料未提供或不完整。",
        "融资用途与成果转化里程碑之间的对应关系需要明确。",
      ],
      suggestions: [
        "补充当前技术成熟度、样机或中试验证结果、下一阶段里程碑。",
        "将融资金额、用途、试点计划、量产条件和风险应对措施对应起来。",
      ],
    };
  }

  return {
    materialStatus: "材料有所涉及，但信息颗粒度不足，依据仍需补充。",
    problems: ["该指标相关证据材料未充分展开，评委难以判断项目可靠性。"],
    suggestions: ["围绕该指标补充事实证据、量化数据和可验证材料。"],
  };
}

export function buildMockDiagnosis(
  context: ProjectAIContext,
): MaterialDiagnosisResult {
  const corpus = buildMaterialCorpus(context);
  const compactCorpus = compactText(corpus);
  const hasCustomerEvidence = includesAny(compactCorpus, [
    "客户",
    "试点",
    "订单",
    "合同",
    "意向",
  ]);
  const hasIpEvidence = includesAny(compactCorpus, [
    "专利",
    "知识产权",
    "软著",
    "申请号",
    "授权号",
  ]);
  const criterionAnalysis = context.criteria.map((criterion) => {
    const diagnosis = getCriterionDiagnosis(criterion.name, compactCorpus);

    return {
      category: criterion.category ?? "未分类",
      criterion: criterion.name,
      maxScore: criterion.weight,
      ...diagnosis,
    };
  });

  return {
    projectSummary: `【Mock】${context.project.name}面向${trimSentenceFragment(context.project.applicationScenario) || "目标应用场景"}，以${trimSentenceFragment(context.project.coreTechnology) || "核心技术"}为基础，尝试提供${context.project.field}方向的路演项目方案。当前材料可以支撑项目方向的初步理解，但关键证据仍需补充。`,
    materialCompleteness:
      "【Mock】材料已覆盖项目简介、核心技术、应用场景、商业模式和合作诉求等基础信息；但团队、客户验证、试点进展、测试数据、知识产权编号和成果转化里程碑等评审关键材料仍不完整。",
    criterionAnalysis,
    keyIssues: [
      "团队成员、负责人背景、投入稳定性等信息未提供或不充分。",
      hasCustomerEvidence
        ? "客户和试点信息已有线索，但缺少可验证的合作进展、验收指标或订单证据。"
        : "客户、试点、订单、测试数据等材料未提供。",
      hasIpEvidence
        ? "知识产权信息需要进一步补充编号、权属和保护范围。"
        : "知识产权编号、权属状态和保护计划材料未提供。",
      "核心技术优势需要用量化指标、测试数据和竞品对比支撑。",
    ],
    riskPoints: [
      "如果缺少测试数据和客户验证，项目技术先进性和市场需求判断依据不足。",
      "如果团队结构和投入稳定性不清晰，评委可能质疑项目持续实施能力。",
      "如果知识产权和技术壁垒材料不足，项目竞争优势容易被认为不可验证。",
    ],
    slideSuggestions: [
      "增加一页团队结构与核心成员分工，说明负责人背景、关键岗位和投入安排。",
      "增加一页关键技术指标与竞品对比，重点呈现安全性、循环寿命、成本或效率等指标。",
      "增加一页客户验证和转化计划，明确试点对象、周期、验收指标和下一阶段里程碑。",
    ],
    pitchSuggestions: [
      "开场先说明工商业储能或园区微电网的明确痛点，再引出固态储能方案。",
      "技术表达避免只讲概念，应突出可验证指标和相对传统方案的差异。",
      "融资诉求需要对应具体用途、阶段目标和风险控制措施。",
    ],
    priorityActions: [
      "补充团队负责人和核心成员背景、职责分工、投入稳定性说明。",
      "补充关键技术测试数据和与主流储能方案的量化对比。",
      "补充客户、试点、订单或意向合作等市场验证材料；如没有，应明确当前为待验证事项。",
      "补充知识产权编号、权属状态或后续保护计划；如没有，应明确材料未提供。",
    ],
  };
}
