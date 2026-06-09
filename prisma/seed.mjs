import { PrismaClient } from "@prisma/client";

const prisma = new PrismaClient();

const stringify = (value) => JSON.stringify(value, null, 2);

async function main() {
  await prisma.feedback.deleteMany();
  await prisma.answer.deleteMany();
  await prisma.question.deleteMany();
  await prisma.report.deleteMany();
  await prisma.scoreResult.deleteMany();
  await prisma.diagnosis.deleteMany();
  await prisma.fileAsset.deleteMany();
  await prisma.project.deleteMany();
  await prisma.evaluationCriterion.deleteMany();
  await prisma.evaluationRule.deleteMany();
  await prisma.expertComment.deleteMany();
  await prisma.historicalQuestion.deleteMany();
  await prisma.knowledgeSource.deleteMany();
  await prisma.user.deleteMany();

  const admin = await prisma.user.create({
    data: {
      name: "系统管理员",
      email: "admin@roadshow.local",
      role: "ADMIN",
    },
  });

  const teamUser = await prisma.user.create({
    data: {
      name: "项目团队用户",
      email: "team@roadshow.local",
      role: "TEAM",
    },
  });

  const projectData = [
    {
      ownerId: teamUser.id,
      name: "高效固态储能系统",
      field: "新能源",
      stage: "中试验证",
      summary:
        "面向园区微电网和工商业储能场景，提供高安全、高循环寿命的固态储能解决方案。",
      coreTechnology:
        "复合固态电解质制备工艺、热失控监测算法与模块化电池管理系统。",
      applicationScenario:
        "工商业削峰填谷、分布式光伏配储、园区备用电源和低碳能源管理。",
      businessModel: "设备销售、能源托管服务和长期运维订阅相结合。",
      cooperationDemand:
        "寻求产业试点场景、供应链合作伙伴和 800 万元 Pre-A 轮融资。",
    },
    {
      ownerId: teamUser.id,
      name: "柔性产线视觉质检平台",
      field: "智能制造",
      stage: "规模化推广",
      summary:
        "为多品类、小批量制造企业提供快速部署的视觉质检与缺陷追溯平台。",
      coreTechnology:
        "小样本缺陷识别、边缘推理加速、产线数据闭环与多相机标定技术。",
      applicationScenario: "电子装配、汽车零部件、精密加工和消费品包装质检。",
      businessModel: "软硬件一体化交付，按产线授权并叠加算法升级服务费。",
      cooperationDemand: "寻求行业集成商渠道、标杆客户案例和联合实验室合作。",
    },
    {
      ownerId: teamUser.id,
      name: "企业知识库智能问答助手",
      field: "AI应用",
      stage: "产品迭代",
      summary:
        "帮助企业把制度、项目文档和历史案例沉淀为可检索、可追溯的智能问答系统。",
      coreTechnology:
        "检索增强生成、多源文档解析、权限感知检索和回答可信度评估。",
      applicationScenario: "企业内部知识服务、售前资料检索、培训问答和项目复盘。",
      businessModel: "SaaS 订阅、私有化部署和知识治理咨询服务。",
      cooperationDemand:
        "寻求政企客户试点、数据安全合作伙伴和行业知识库共建资源。",
    },
  ];

  await prisma.project.createMany({ data: projectData });

  const rule = await prisma.evaluationRule.create({
    data: {
      name: "路演大赛通用评审规则",
      contestName: "默认创新创业大赛",
      version: "2026-v1",
      totalScore: 100,
      description:
        "用于路演训练场景的默认评审规则，覆盖技术、场景、市场、商业模式、团队、知识产权、转化和表达。",
      rawText:
        "总分100分：技术创新性20分，应用场景清晰度15分，市场价值15分，商业模式15分，团队与实施能力10分，知识产权与竞争壁垒10分，转化可行性10分，路演表达5分。",
    },
  });

  await prisma.evaluationCriterion.createMany({
    data: [
      {
        ruleId: rule.id,
        name: "技术创新性",
        weight: 20,
        description: "评价技术方案的新颖性、先进性和核心技术壁垒。",
        scoringGuide: "重点关注核心技术是否清晰、是否具备可验证优势。",
        sortOrder: 1,
      },
      {
        ruleId: rule.id,
        name: "应用场景清晰度",
        weight: 15,
        description: "评价目标场景、用户痛点和落地路径是否具体。",
        scoringGuide: "场景越聚焦，用户价值和使用流程越明确，得分越高。",
        sortOrder: 2,
      },
      {
        ruleId: rule.id,
        name: "市场价值",
        weight: 15,
        description: "评价市场空间、客户需求强度和增长潜力。",
        scoringGuide: "需结合客户画像、市场规模和竞争替代关系说明。",
        sortOrder: 3,
      },
      {
        ruleId: rule.id,
        name: "商业模式",
        weight: 15,
        description: "评价收入来源、定价逻辑、成本结构和可持续性。",
        scoringGuide: "商业闭环清晰、付费主体明确、毛利结构合理更优。",
        sortOrder: 4,
      },
      {
        ruleId: rule.id,
        name: "团队与实施能力",
        weight: 10,
        description: "评价团队背景、分工完整度和交付执行能力。",
        scoringGuide: "关注关键岗位是否齐备，以及过往项目经验是否匹配。",
        sortOrder: 5,
      },
      {
        ruleId: rule.id,
        name: "知识产权与竞争壁垒",
        weight: 10,
        description: "评价专利、软著、数据资源、渠道和生态壁垒。",
        scoringGuide: "需说明壁垒与业务优势的直接关联。",
        sortOrder: 6,
      },
      {
        ruleId: rule.id,
        name: "转化可行性",
        weight: 10,
        description: "评价试点验证、交付条件、政策适配和推广节奏。",
        scoringGuide: "有真实客户、验证数据和清晰里程碑更优。",
        sortOrder: 7,
      },
      {
        ruleId: rule.id,
        name: "路演表达",
        weight: 5,
        description: "评价表达结构、时间控制、重点呈现和答辩回应。",
        scoringGuide: "叙事清楚、重点突出、回答直接得分更高。",
        sortOrder: 8,
      },
    ],
  });

  await prisma.expertComment.createMany({
    data: [
      {
        contestName: "默认创新创业大赛",
        projectField: "新能源",
        dimension: "技术",
        commentText: "技术路线有一定创新性，但关键性能指标需要与行业标杆做量化对比。",
        problemType: "指标不充分",
        suggestionType: "补充验证数据",
        scoreRange: "15-18",
      },
      {
        contestName: "默认创新创业大赛",
        projectField: "智能制造",
        dimension: "技术",
        commentText: "算法能力描述较完整，但需要说明在复杂工况下的鲁棒性和部署成本。",
        problemType: "工程化不足",
        suggestionType: "强化落地说明",
        scoreRange: "14-17",
      },
      {
        contestName: "默认创新创业大赛",
        projectField: "AI应用",
        dimension: "市场",
        commentText: "目标客户群体明确，但市场规模测算口径需要进一步拆分。",
        problemType: "市场测算粗略",
        suggestionType: "细化客户分层",
        scoreRange: "11-13",
      },
      {
        contestName: "默认创新创业大赛",
        projectField: "新能源",
        dimension: "市场",
        commentText: "应用场景具备政策和产业需求支撑，建议增加已接触客户和试点进展。",
        problemType: "客户证据不足",
        suggestionType: "补充客户验证",
        scoreRange: "12-15",
      },
      {
        contestName: "默认创新创业大赛",
        projectField: "智能制造",
        dimension: "商业模式",
        commentText: "收入模式较清晰，但软硬件交付后的持续服务收入占比需要说明。",
        problemType: "收入结构不清",
        suggestionType: "说明续费逻辑",
        scoreRange: "10-13",
      },
      {
        contestName: "默认创新创业大赛",
        projectField: "AI应用",
        dimension: "商业模式",
        commentText: "SaaS 与私有化部署并行可行，但应避免资源分散并明确优先市场。",
        problemType: "定位分散",
        suggestionType: "聚焦首个市场",
        scoreRange: "10-14",
      },
      {
        contestName: "默认创新创业大赛",
        projectField: "新能源",
        dimension: "知识产权",
        commentText: "已有技术积累较好，建议明确专利布局与核心工艺保护边界。",
        problemType: "壁垒表达不强",
        suggestionType: "补充 IP 布局",
        scoreRange: "7-9",
      },
      {
        contestName: "默认创新创业大赛",
        projectField: "智能制造",
        dimension: "团队",
        commentText: "团队工程背景匹配，但市场拓展和行业渠道能力还需要补强。",
        problemType: "团队结构缺口",
        suggestionType: "补充商务资源",
        scoreRange: "7-8",
      },
      {
        contestName: "默认创新创业大赛",
        projectField: "AI应用",
        dimension: "路演表达",
        commentText: "表达节奏较顺畅，但开场价值主张可以更直接，减少技术铺垫时间。",
        problemType: "重点后置",
        suggestionType: "优化叙事结构",
        scoreRange: "3-4",
      },
      {
        contestName: "默认创新创业大赛",
        projectField: null,
        dimension: "转化落地",
        commentText: "项目具备初步落地条件，但转化路径、试点周期和验收指标还需要更明确。",
        problemType: "转化路径不清",
        suggestionType: "补充实施里程碑",
        scoreRange: "7-9",
      },
    ],
  });

  await prisma.historicalQuestion.createMany({
    data: [
      {
        contestName: "默认创新创业大赛",
        projectField: "新能源",
        perspective: "技术专家",
        questionText: "固态储能方案相对现有液态电池体系的关键性能优势是什么？",
        focus: "技术差异、性能指标、验证数据",
      },
      {
        contestName: "默认创新创业大赛",
        projectField: "新能源",
        perspective: "投资机构",
        questionText: "储能项目从中试到量产还需要多少资金和多长周期？",
        focus: "融资用途、量产计划、资金效率",
      },
      {
        contestName: "默认创新创业大赛",
        projectField: "智能制造",
        perspective: "产业方",
        questionText: "视觉质检平台接入一条新产线通常需要多久？",
        focus: "部署周期、适配成本、交付能力",
      },
      {
        contestName: "默认创新创业大赛",
        projectField: "智能制造",
        perspective: "技术专家",
        questionText: "小样本缺陷识别在缺陷类型变化时如何保持准确率？",
        focus: "算法泛化、数据闭环、模型更新",
      },
      {
        contestName: "默认创新创业大赛",
        projectField: "AI应用",
        perspective: "技术专家",
        questionText: "企业知识库问答如何控制幻觉并保证答案可追溯？",
        focus: "RAG、引用来源、可信度评估",
      },
      {
        contestName: "默认创新创业大赛",
        projectField: "AI应用",
        perspective: "产业方",
        questionText: "客户导入系统时最主要的数据治理成本是什么？",
        focus: "数据清洗、权限、实施门槛",
      },
      {
        contestName: "默认创新创业大赛",
        projectField: null,
        perspective: "知识产权专家",
        questionText: "项目的核心知识产权如何与商业壁垒对应？",
        focus: "专利布局、软著、不可替代性",
      },
      {
        contestName: "默认创新创业大赛",
        projectField: null,
        perspective: "成果转化专家",
        questionText: "目前是否已有真实客户试点，试点验收标准是什么？",
        focus: "客户证据、转化路径、验收指标",
      },
      {
        contestName: "默认创新创业大赛",
        projectField: null,
        perspective: "投资机构",
        questionText: "项目未来三年的收入预测依据是什么？",
        focus: "市场规模、客户转化、财务假设",
      },
      {
        contestName: "默认创新创业大赛",
        projectField: null,
        perspective: "产业方",
        questionText: "如果头部企业进入同一赛道，你们的差异化优势如何保持？",
        focus: "竞争策略、壁垒、客户关系",
      },
    ],
  });

  await prisma.knowledgeSource.createMany({
    data: [
      {
        title: "路演大赛通用评审规则",
        type: "REVIEW_RULE",
        rawText: rule.rawText,
        status: "PROCESSED",
      },
      {
        title: "模拟专家评语与历史问题样本集",
        type: "EXPERT_COMMENT",
        rawText:
          "覆盖技术、市场、商业模式、团队、知识产权、路演表达、转化落地等维度的模拟评语和历史评委问题。",
        status: "PROCESSED",
      },
    ],
  });

  console.log(
    stringify({
      users: [admin.email, teamUser.email],
      projectsCreated: projectData.length,
      evaluationRule: `${rule.name} ${rule.version}`,
      expertComments: 10,
      historicalQuestions: 10,
      knowledgeSources: 2,
    }),
  );
}

main()
  .catch((error) => {
    console.error(error);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
