import dayjs from "dayjs";
import type { GanttOrderRow, OperationItem } from "@/modules/scheduling/api/scheduling";

/** 日×班聚合：天=有任务自然日；班=日×班格；人=各格人次之和 */
export type DayShiftStats = {
  dayCount: number;
  shiftCount: number;
  personCount: number;
  start?: string;
  end?: string;
};

type SlotAgg = { people: Set<string>; fallbackHc: number };

function finalizeDayShiftStats(slots: Map<string, SlotAgg>): DayShiftStats {
  if (!slots.size) return { dayCount: 0, shiftCount: 0, personCount: 0 };
  const days = new Set<string>();
  let personCount = 0;
  for (const [key, agg] of slots) {
    days.add(key.split("__")[0] || key);
    const n =
      agg.people.size > 0 ? agg.people.size : Math.max(1, agg.fallbackHc || 1);
    personCount += n;
  }
  const dayList = [...days].sort();
  return {
    dayCount: days.size,
    shiftCount: slots.size,
    personCount,
    start: dayList[0],
    end: dayList[dayList.length - 1],
  };
}

function addSlotPeople(
  slots: Map<string, SlotAgg>,
  date: string,
  familyId: string,
  personIds: string[],
  fallbackHc: number,
) {
  const key = `${date}__${familyId || "sh-day"}`;
  let agg = slots.get(key);
  if (!agg) {
    agg = { people: new Set(), fallbackHc: 0 };
    slots.set(key, agg);
  }
  for (const pid of personIds) {
    if (pid) agg.people.add(pid);
  }
  agg.fallbackHc = Math.max(agg.fallbackHc, fallbackHc, personIds.length);
}

/** 从工序计划展开日×班×人 */
export function collectPlanDayShiftStats(ops: OperationItem[]): DayShiftStats {
  const slots = new Map<string, SlotAgg>();
  for (const op of ops) {
    const family = op.shift_family_id || "sh-day";
    const segs = (op.plan_segments ?? []).filter((s) => s.start);
    if (segs.length) {
      for (const s of segs) {
        const pids = [
          ...(s.person_ids?.length
            ? s.person_ids
            : s.person_id
              ? [s.person_id]
              : op.assignee_ids?.length
                ? op.assignee_ids
                : op.assignee_id
                  ? [op.assignee_id]
                  : []),
        ].filter(Boolean) as string[];
        const hc = Math.max(
          1,
          Number(s.required_headcount || op.required_headcount || pids.length || 1),
        );
        let cur = dayjs(s.start.slice(0, 10));
        const end = dayjs((s.end || s.start).slice(0, 10));
        while (cur.isBefore(end, "day") || cur.isSame(end, "day")) {
          addSlotPeople(slots, cur.format("YYYY-MM-DD"), family, pids, hc);
          cur = cur.add(1, "day");
        }
      }
      continue;
    }
    if (!op.plan_start) continue;
    const pids = [
      ...(op.assignee_ids?.length
        ? op.assignee_ids
        : op.assignee_id
          ? [op.assignee_id]
          : []),
    ].filter(Boolean) as string[];
    const hc = Math.max(1, Number(op.required_headcount || pids.length || 1));
    let cur = dayjs(op.plan_start.slice(0, 10));
    const end = dayjs((op.plan_end || op.plan_start).slice(0, 10));
    while (cur.isBefore(end, "day") || cur.isSame(end, "day")) {
      addSlotPeople(slots, cur.format("YYYY-MM-DD"), family, pids, hc);
      cur = cur.add(1, "day");
    }
  }
  return finalizeDayShiftStats(slots);
}

/** 从实绩行 cells（签字日×班）汇总 */
export function collectActualDayShiftStats(
  actualRow?: GanttOrderRow | null,
): DayShiftStats {
  const slots = new Map<string, SlotAgg>();
  const cells = actualRow?.cells || {};
  for (const [date, list] of Object.entries(cells)) {
    for (const op of list || []) {
      const family = op.shift_family_id || "sh-day";
      const pids = [
        ...(op.assignee_ids?.length
          ? op.assignee_ids
          : op.assignee_id
            ? [op.assignee_id]
            : []),
      ].filter(Boolean) as string[];
      const nameKeys =
        !pids.length && op.assignee_names?.length
          ? op.assignee_names.map((n, i) => `name:${n}:${i}`)
          : !pids.length && op.assignee_name
            ? [`name:${op.assignee_name}`]
            : [];
      const hc = Math.max(
        1,
        Number(op.required_headcount || pids.length || nameKeys.length || 1),
      );
      addSlotPeople(slots, date.slice(0, 10), family, [...pids, ...nameKeys], hc);
    }
  }
  return finalizeDayShiftStats(slots);
}

/** 单道工序的计划日×班×人（不与其他工序合并） */
export function collectOpPlanDayShiftStats(op: OperationItem): DayShiftStats {
  return collectPlanDayShiftStats([op]);
}

/** 单道工序在实绩行 cells 中的日×班×人 */
export function collectOpActualDayShiftStats(
  opId: string,
  actualRow?: GanttOrderRow | null,
): DayShiftStats {
  if (!actualRow?.cells) return { dayCount: 0, shiftCount: 0, personCount: 0 };
  const slots = new Map<string, SlotAgg>();
  for (const [date, list] of Object.entries(actualRow.cells)) {
    for (const op of list || []) {
      if (op.id !== opId) continue;
      const family = op.shift_family_id || "sh-day";
      const pids = [
        ...(op.assignee_ids?.length
          ? op.assignee_ids
          : op.assignee_id
            ? [op.assignee_id]
            : []),
      ].filter(Boolean) as string[];
      const nameKeys =
        !pids.length && op.assignee_names?.length
          ? op.assignee_names.map((n, i) => `name:${n}:${i}`)
          : !pids.length && op.assignee_name
            ? [`name:${op.assignee_name}`]
            : [];
      const hc = Math.max(
        1,
        Number(op.required_headcount || pids.length || nameKeys.length || 1),
      );
      addSlotPeople(slots, date.slice(0, 10), family, [...pids, ...nameKeys], hc);
    }
  }
  return finalizeDayShiftStats(slots);
}

/** 覆盖 N 个自然日 · M 个班次格 · K 人次 */
export function formatDayShiftBrief(s: DayShiftStats): string {
  if (!s.shiftCount && !s.personCount) return "—";
  return `覆盖 ${s.dayCount} 天 · ${s.shiftCount} 个班次 · ${s.personCount} 人次`;
}

/** 进度：人次为主，班次为辅 */
export function formatDayShiftProgress(actual: DayShiftStats, plan: DayShiftStats): string {
  if (!plan.personCount && !plan.shiftCount) return "—";
  const pct =
    plan.personCount > 0
      ? Math.round((actual.personCount / plan.personCount) * 100)
      : 0;
  return `${actual.personCount}/${plan.personCount} 人次（${pct}%） · ${actual.shiftCount}/${plan.shiftCount} 个班次`;
}

export function formatDateRangeFull(start?: string | null, end?: string | null): string {
  const a = (start || "").slice(0, 10);
  const b = (end || start || "").slice(0, 10);
  if (!a) return "—";
  if (!b || a === b) return a;
  return `${a}～${b}`;
}
