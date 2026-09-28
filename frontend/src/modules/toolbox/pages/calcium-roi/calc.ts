import type { CalciumRoiInputs, CalciumRoiResult, GradeKey } from "./types";

function clamp01(n: number) {
  if (!Number.isFinite(n)) return 0;
  return Math.min(1, Math.max(0, n));
}

function round(n: number, digits = 1) {
  const p = 10 ** digits;
  return Math.round(n * p) / p;
}

/**
 * 电石质检 ROI：钱从「生产批次定错级少卖」来，不是从「化验次数」来。
 * 人工一天化验 1 次、当天 12 批都按这一次定级 —— 错定级乘的是年生产批次。
 */
export function calcCalciumRoi(input: CalciumRoiInputs): CalciumRoiResult {
  const workshops = Math.max(0, Number(input.workshopCount) || 0);
  const batchesPerDay = Math.max(0, Number(input.batchesPerDay) || 0);
  const tons = Math.max(0, Number(input.tonsPerBatch) || 0);
  const days = Math.max(0, Number(input.productionDays) || 0);
  const manualPerDay = Math.max(0, Number(input.manualTestsPerDay) || 0);
  const aiPerDay = Math.max(0, Number(input.aiTestsPerDay) || 0);

  const annualBatches = workshops * batchesPerDay * days;
  const manualAnnualTests = workshops * manualPerDay * days;
  const aiAnnualTests = workshops * aiPerDay * days;

  const coverageManual = annualBatches > 0 ? manualAnnualTests / annualBatches : 0;
  const coverageAi = annualBatches > 0 ? Math.min(1, aiAnnualTests / annualBatches) : 0;
  const extraTests = Math.max(0, aiAnnualTests - manualAnnualTests);

  /** 人工一次化验平均代表多少批产出（12 批/天 ÷ 1 次/天 = 12） */
  const batchesPerManualTest =
    manualPerDay > 0 ? round(batchesPerDay / manualPerDay, 1) : batchesPerDay;

  const batchRevenue: Record<GradeKey, number> = {
    low: input.priceLow * tons,
    mid: input.priceMid * tons,
    high: input.priceHigh * tons,
  };
  const gradeDiffHighMid = input.priceHigh - input.priceMid;
  const gradeDiffMidLow = input.priceMid - input.priceLow;

  const shareLow = clamp01(input.aiShareLow);
  const shareMid = clamp01(input.aiShareMid);
  const shareHigh = clamp01(input.aiShareHigh);
  const aiGradeBatches: Record<GradeKey, number> = {
    low: round(annualBatches * shareLow, 0),
    mid: round(annualBatches * shareMid, 0),
    high: round(annualBatches * shareHigh, 0),
  };

  // 错定级只乘「年生产批次」，不乘化验次数
  const misRate = clamp01(input.misgradeHighToMidRate);
  const misgradeBatches = round(annualBatches * misRate, 0);
  const misgradeTons = misgradeBatches * tons;
  const upliftWan = round((misgradeTons * gradeDiffHighMid) / 10000, 1);
  const laborReleaseWan = round(input.qcStaff * input.laborCostWanPerPerson, 1);
  const totalValueWan = round(upliftWan + laborReleaseWan, 1);

  let paybackMonths: number | null = null;
  if (totalValueWan > 0 && input.investmentWan > 0) {
    paybackMonths = round((input.investmentWan / totalValueWan) * 12, 1);
  }

  const assumptions = [
    input.misgradeNote,
    `人工一次化验平均代表 ${batchesPerManualTest} 批产出的售价；错定级按年生产批次计，不是按化验次数。`,
    "增值：本应高品却按中品售出的批次 × 吨位 × 高中价差。",
    "人工项记为工作量释放价值。",
  ].filter(Boolean) as string[];

  return {
    annualBatches,
    manualAnnualTests,
    aiAnnualTests,
    coverageManual,
    coverageAi,
    extraTests,
    batchesPerManualTest,
    batchRevenue,
    gradeDiffHighMid,
    gradeDiffMidLow,
    aiGradeBatches,
    misgradeBatches,
    misgradeTons,
    upliftWan,
    laborReleaseWan,
    totalValueWan,
    paybackMonths,
    assumptions,
  };
}

export function pct(n: number, digits = 1) {
  return `${(n * 100).toFixed(digits)}%`;
}

export function wan(n: number, digits = 1) {
  return `${n.toFixed(digits)} 万元`;
}
