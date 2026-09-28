import type { CalciumRoiInputs } from "./types";

/** 演示默认值（与业务说明一致，可在页面改） */
export const DEFAULT_CALCIUM_ROI_INPUTS: CalciumRoiInputs = {
  workshopCount: 1,
  batchesPerDay: 12,
  tonsPerBatch: 20,
  productionDays: 365,
  manualTestsPerDay: 1,
  aiTestsPerDay: 24,
  qcStaff: 2,
  laborCostWanPerPerson: 8,
  priceLow: 2800,
  priceMid: 3000,
  priceHigh: 3200,
  aiShareLow: 0.2,
  aiShareMid: 0.6,
  aiShareHigh: 0.2,
  misgradeHighToMidRate: 0.05,
  investmentWan: 50,
  misgradeNote: "",
};
