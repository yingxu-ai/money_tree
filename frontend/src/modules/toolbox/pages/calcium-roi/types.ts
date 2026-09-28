/** 电石质检 ROI：参数与结果类型（纯前端，便于后续挂历史回放） */

export type GradeKey = "low" | "mid" | "high";

export interface GradePriceRow {
  key: GradeKey;
  label: string;
  gasRange: string;
  pricePerTon: number;
}

export interface CalciumRoiInputs {
  /** 车间数量 */
  workshopCount: number;
  /** 每天生产批次 */
  batchesPerDay: number;
  /** 每批产量（吨） */
  tonsPerBatch: number;
  /** 年生产天数 */
  productionDays: number;
  /** 原人工检测次数（次/天） */
  manualTestsPerDay: number;
  /** AI 检测次数（次/天）——通常≈每天批次数 */
  aiTestsPerDay: number;
  /** 质检人数 */
  qcStaff: number;
  /** 人均综合人工成本（万元/年） */
  laborCostWanPerPerson: number;
  /** 三档销售价（元/吨） */
  priceLow: number;
  priceMid: number;
  priceHigh: number;
  /** AI 识别占比 0～1 */
  aiShareLow: number;
  aiShareMid: number;
  aiShareHigh: number;
  /**
   * 原人工场景下「本应高品却按中品卖」占年生产批次的比例 0～1。
   * 分母是生产批次，不是化验次数。
   */
  misgradeHighToMidRate: number;
  /** 项目投资（万元） */
  investmentWan: number;
  /** 错定级口径说明（展示用） */
  misgradeNote: string;
}

export interface CalciumRoiResult {
  annualBatches: number;
  manualAnnualTests: number;
  aiAnnualTests: number;
  coverageManual: number;
  coverageAi: number;
  extraTests: number;
  /** 人工一次化验平均套用到多少批产出 */
  batchesPerManualTest: number;
  batchRevenue: Record<GradeKey, number>;
  gradeDiffHighMid: number;
  gradeDiffMidLow: number;
  aiGradeBatches: Record<GradeKey, number>;
  misgradeBatches: number;
  misgradeTons: number;
  upliftWan: number;
  laborReleaseWan: number;
  totalValueWan: number;
  paybackMonths: number | null;
  assumptions: string[];
}
