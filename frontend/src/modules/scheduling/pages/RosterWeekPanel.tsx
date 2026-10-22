import {
  Button,
  DatePicker,
  Modal,
  Select,
  Space,
  Table,
  Tag,
  Tooltip,
  message,
} from "antd";
import {
  BarChartOutlined,
  FullscreenExitOutlined,
  FullscreenOutlined,
  LeftOutlined,
  RightOutlined,
  SwapOutlined,
  TeamOutlined,
} from "@ant-design/icons";
import dayjs, { type Dayjs } from "dayjs";
import { useEffect, useMemo, useState } from "react";
import {
  assignRosterBatch,
  fetchRosterAnalysis,
  fetchRosterWeek,
  rotateRoster,
  setRosterDay,
  type PersonItem,
  type RosterCell,
  type RosterWeekRow,
} from "@/modules/scheduling/api/scheduling";
import { useMutation } from "@/hooks/useMutation";
import { useRequest } from "@/hooks/useRequest";
import RosterAnalysisChart from "@/modules/scheduling/pages/RosterAnalysisChart";

const WEEKDAY = ["一", "二", "三", "四", "五", "六", "日"];

type Props = {
  persons?: PersonItem[];
  onOpenLeave?: (leaveId: string) => void;
  onRosterChanged?: () => void;
};

function mondayOf(d: Dayjs) {
  const wd = d.day();
  const offset = wd === 0 ? -6 : 1 - wd;
  return d.add(offset, "day").startOf("day");
}

export default function RosterWeekPanel({
  persons = [],
  onOpenLeave,
  onRosterChanged,
}: Props) {
  const [weekStart, setWeekStart] = useState(() => mondayOf(dayjs()).format("YYYY-MM-DD"));
  const [personFilter, setPersonFilter] = useState<string[]>([]);
  const [shiftFilter, setShiftFilter] = useState<string[]>([]);

  const [assignOpen, setAssignOpen] = useState(false);
  const [assignRange, setAssignRange] = useState<[Dayjs, Dayjs]>(() => [
    dayjs(),
    dayjs().add(9, "day"),
  ]);
  const [assignShift, setAssignShift] = useState<string>();
  const [assignPeople, setAssignPeople] = useState<string[]>([]);

  const [switchOpen, setSwitchOpen] = useState(false);
  const [switchRange, setSwitchRange] = useState<[Dayjs, Dayjs]>(() => [
    dayjs(),
    dayjs().add(9, "day"),
  ]);
  const [mapping, setMapping] = useState<Record<string, string>>({});

  const [analysisOpen, setAnalysisOpen] = useState(false);
  const [analysisFullscreen, setAnalysisFullscreen] = useState(false);
  const [analysisRange, setAnalysisRange] = useState<[Dayjs, Dayjs]>(() => [
    mondayOf(dayjs()),
    mondayOf(dayjs()).add(27, "day"),
  ]);

  useEffect(() => {
    if (!analysisOpen) setAnalysisFullscreen(false);
  }, [analysisOpen]);

  const { data: roster, loading, setData: setRoster } = useRequest(
    () => fetchRosterWeek(weekStart),
    { immediate: true, deps: [weekStart] },
  );

  const analysisStart = analysisRange[0].format("YYYY-MM-DD");
  const analysisEnd = analysisRange[1].format("YYYY-MM-DD");
  const {
    data: analysisData,
    loading: analysisLoading,
    refresh: refreshAnalysis,
  } = useRequest(
    () => fetchRosterAnalysis(analysisStart, analysisEnd),
    {
      immediate: analysisOpen,
      deps: [analysisOpen, analysisStart, analysisEnd],
    },
  );

  const shiftOpts = roster?.shift_options ?? [];
  const isTwoShift = shiftOpts.length === 2;
  const isMultiShift = shiftOpts.length >= 3;

  const colorByFam = useMemo(() => {
    const map: Record<string, string> = {};
    for (const s of shiftOpts) {
      if (s.color) map[s.family_id] = s.color;
    }
    return map;
  }, [shiftOpts]);

  const personOptions = useMemo(
    () =>
      persons
        .filter((p) => p.status !== "disabled")
        .map((p) => ({ value: p.id, label: `${p.name}（${p.code}）` })),
    [persons],
  );

  const { mutate: doAssign, loading: assigning } = useMutation(
    () => {
      const [start, end] = assignRange;
      if (!assignShift) throw new Error("请选择班次");
      if (!assignPeople.length) throw new Error("请勾选人员");
      return assignRosterBatch({
        start_date: start.format("YYYY-MM-DD"),
        end_date: end.format("YYYY-MM-DD"),
        shift_family_id: assignShift,
        person_ids: assignPeople,
      });
    },
    {
      successMessage: "排班已保存",
      onSuccess: (data) => {
        setRoster(data);
        if (data.week_start) setWeekStart(data.week_start);
        onRosterChanged?.();
        setAssignOpen(false);
        const g = data.generated;
        if (g) {
          message.info(
            `${g.shift_name || "班次"} · ${g.person_count} 人 · ${g.effective_from?.slice(5)}～${g.end_date?.slice(5)}`,
          );
        }
      },
    },
  );

  const { mutate: doRotate, loading: rotating } = useMutation(
    () => {
      const [start, end] = switchRange;
      return rotateRoster({
        week_start: weekStart,
        effective_from: start.format("YYYY-MM-DD"),
        end_date: end.format("YYYY-MM-DD"),
        mapping: isMultiShift ? mapping : undefined,
      });
    },
    {
      successMessage: "换班已生效",
      onSuccess: (data) => {
        setRoster(data);
        onRosterChanged?.();
        setSwitchOpen(false);
        const g = data.generated;
        if (g) {
          message.info(
            `${g.rotate_chain || "换班"} · ${g.person_count} 人 · ${g.effective_from?.slice(5)}～${g.end_date?.slice(5)}`,
          );
        }
      },
    },
  );

  const { mutate: doSetDay, loading: setting } = useMutation(
    (payload: { person_id: string; day: string; shift_family_id?: string | null }) =>
      setRosterDay(payload),
    {
      successMessage: "已调整",
      onSuccess: (data) => {
        setRoster(data);
        onRosterChanged?.();
      },
    },
  );

  const cellShiftOptions = useMemo(
    () =>
      shiftOpts.map((s) => ({
        value: s.family_id,
        label: s.name,
        disabled: !!(s as { disabled?: boolean }).disabled,
      })),
    [shiftOpts],
  );

  const filteredRows = useMemo(() => {
    let rows = roster?.rows ?? [];
    if (personFilter.length) {
      const set = new Set(personFilter);
      rows = rows.filter((r) => set.has(r.person_id));
    }
    if (shiftFilter.length) {
      const set = new Set(shiftFilter);
      const dates = roster?.dates ?? [];
      rows = rows.filter((r) =>
        dates.some((d) => {
          const fam = r.cells?.[d]?.shift_family_id;
          return fam && set.has(fam);
        }),
      );
    }
    return rows;
  }, [roster?.rows, roster?.dates, personFilter, shiftFilter]);

  const columns = useMemo(() => {
    const dates = roster?.dates ?? [];
    return [
      {
        title: "人员",
        key: "person",
        fixed: "left" as const,
        width: 120,
        render: (_: unknown, r: RosterWeekRow) => (
          <div>
            <div style={{ fontWeight: 600 }}>{r.person_name}</div>
            <div style={{ fontSize: 12, color: "#718096" }}>{r.person_code}</div>
          </div>
        ),
      },
      ...dates.map((d, i) => ({
        title: (
          <div style={{ textAlign: "center", lineHeight: 1.3 }}>
            <div>{d.slice(5)}</div>
            <div style={{ fontSize: 12, color: "#718096", fontWeight: 400 }}>周{WEEKDAY[i]}</div>
          </div>
        ),
        key: d,
        width: 88,
        align: "center" as const,
        render: (_: unknown, r: RosterWeekRow) => {
          const cell: RosterCell = r.cells?.[d] ?? { kind: "empty", label: "—" };
          if (cell.kind === "leave") {
            return (
              <Tooltip title={cell.leave_reason || "请假"}>
                <Tag
                  color="orange"
                  style={{ cursor: cell.leave_id ? "pointer" : "default", margin: 0 }}
                  onClick={() => cell.leave_id && onOpenLeave?.(cell.leave_id)}
                >
                  假
                </Tag>
              </Tooltip>
            );
          }
          const bg =
            cell.kind === "shift" && cell.shift_family_id
              ? colorByFam[cell.shift_family_id] || "#edf2f7"
              : "transparent";
          const fam = cell.shift_family_id;
          const opts =
            fam && !cellShiftOptions.some((o) => o.value === fam)
              ? [
                  ...cellShiftOptions,
                  {
                    value: fam,
                    label: cell.shift_name || cell.label || fam,
                    disabled: true,
                  },
                ]
              : cellShiftOptions;
          return (
            <Select
              size="small"
              variant="borderless"
              allowClear
              placeholder=" "
              style={{ width: "100%", background: bg, borderRadius: 4 }}
              value={fam || undefined}
              options={opts}
              disabled={setting}
              popupMatchSelectWidth={120}
              optionLabelProp="label"
              onChange={(v) => {
                void doSetDay({
                  person_id: r.person_id,
                  day: d,
                  shift_family_id: v || null,
                });
              }}
            />
          );
        },
      })),
    ];
  }, [roster?.dates, cellShiftOptions, colorByFam, setting, doSetDay, onOpenLeave]);

  const weekValue = dayjs(weekStart);
  const nameById = useMemo(() => {
    const m: Record<string, string> = {};
    for (const s of shiftOpts) m[s.family_id] = s.name;
    return m;
  }, [shiftOpts]);

  const openAnalysis = () => {
    const start = mondayOf(dayjs(weekStart));
    setAnalysisRange([start, start.add(27, "day")]);
    setAnalysisOpen(true);
  };

  const openAssign = () => {
    setAssignRange([dayjs(), dayjs().add(9, "day")]);
    setAssignShift(shiftOpts[0]?.family_id);
    setAssignPeople(personOptions.map((p) => p.value));
    setAssignOpen(true);
  };

  const openSwitch = () => {
    setSwitchRange([dayjs(), dayjs().add(9, "day")]);
    if (isMultiShift) {
      const next: Record<string, string> = {};
      shiftOpts.forEach((s, i) => {
        next[s.family_id] = shiftOpts[(i + 1) % shiftOpts.length].family_id;
      });
      setMapping(next);
    } else {
      setMapping({});
    }
    setSwitchOpen(true);
  };

  const canAssign =
    !!assignRange?.[0] && !!assignRange?.[1] && !!assignShift && assignPeople.length > 0;

  const canSwitch = (() => {
    if (!switchRange?.[0] || !switchRange?.[1]) return false;
    if (isTwoShift) return true;
    if (isMultiShift) {
      return Object.entries(mapping).some(([a, b]) => a && b && a !== b);
    }
    return false;
  })();

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
      <Space wrap style={{ justifyContent: "space-between", width: "100%" }}>
        <Space wrap>
          <Button
            icon={<LeftOutlined />}
            onClick={() =>
              setWeekStart(mondayOf(weekValue.subtract(7, "day")).format("YYYY-MM-DD"))
            }
          />
          <DatePicker
            picker="week"
            value={weekValue}
            allowClear={false}
            onChange={(v) => {
              if (v) setWeekStart(mondayOf(v).format("YYYY-MM-DD"));
            }}
            format={(v) =>
              `${mondayOf(v).format("MM-DD")} ~ ${mondayOf(v).add(6, "day").format("MM-DD")}`
            }
          />
          <Button
            icon={<RightOutlined />}
            onClick={() => setWeekStart(mondayOf(weekValue.add(7, "day")).format("YYYY-MM-DD"))}
          />
          <Button onClick={() => setWeekStart(mondayOf(dayjs()).format("YYYY-MM-DD"))}>本周</Button>
        </Space>
        <Space wrap>
          <Button icon={<BarChartOutlined />} onClick={openAnalysis}>
            分析
          </Button>
          <Button type="primary" icon={<TeamOutlined />} onClick={openAssign}>
            排班
          </Button>
          <Button
            icon={<SwapOutlined />}
            disabled={shiftOpts.length < 2}
            onClick={openSwitch}
          >
            换班
          </Button>
        </Space>
      </Space>

      <Space wrap size={[8, 8]}>
        {shiftOpts.map((s) => (
          <Tag
            key={s.family_id}
            style={{
              margin: 0,
              background: s.color || "#edf2f7",
              borderColor: "transparent",
              color: "#2d3748",
            }}
          >
            {s.name}
          </Tag>
        ))}
        <Select
          mode="multiple"
          allowClear
          placeholder="筛选人员"
          style={{ minWidth: 180 }}
          value={personFilter}
          options={personOptions}
          optionFilterProp="label"
          maxTagCount="responsive"
          onChange={setPersonFilter}
        />
        <Select
          mode="multiple"
          allowClear
          placeholder="筛选班次"
          style={{ minWidth: 140 }}
          value={shiftFilter}
          options={shiftOpts.map((s) => ({ value: s.family_id, label: s.name }))}
          maxTagCount="responsive"
          onChange={setShiftFilter}
        />
        <span style={{ fontSize: 12, color: "#a0aec0" }}>
          {filteredRows.length}/{roster?.rows?.length ?? 0} 人
        </span>
      </Space>

      <Table<RosterWeekRow>
        size="small"
        rowKey="person_id"
        loading={loading && !roster}
        pagination={false}
        scroll={{ x: 780 }}
        dataSource={filteredRows}
        columns={columns}
      />

      <Modal
        title={
          <div
            style={{
              display: "flex",
              alignItems: "center",
              justifyContent: "space-between",
              paddingRight: 28,
            }}
          >
            <span>排班人数分析</span>
            <Button
              type="text"
              size="small"
              icon={
                analysisFullscreen ? <FullscreenExitOutlined /> : <FullscreenOutlined />
              }
              onClick={() => setAnalysisFullscreen((v) => !v)}
            >
              {analysisFullscreen ? "退出全屏" : "全屏"}
            </Button>
          </div>
        }
        open={analysisOpen}
        width={analysisFullscreen ? "100vw" : "min(1180px, 96vw)"}
        centered={!analysisFullscreen}
        footer={
          <Button type="primary" onClick={() => setAnalysisOpen(false)}>
            关闭
          </Button>
        }
        onCancel={() => setAnalysisOpen(false)}
        destroyOnHidden
        style={
          analysisFullscreen
            ? { top: 0, paddingBottom: 0, maxWidth: "100vw", margin: 0 }
            : undefined
        }
        styles={{
          body: {
            paddingTop: 8,
            height: analysisFullscreen ? "calc(100vh - 110px)" : undefined,
            maxHeight: analysisFullscreen ? "calc(100vh - 110px)" : "78vh",
            overflow: "auto",
          },
          content: analysisFullscreen ? { borderRadius: 0, height: "100vh" } : undefined,
        }}
      >
        <Space wrap style={{ marginBottom: 12 }}>
          <DatePicker.RangePicker
            value={analysisRange}
            allowClear={false}
            onChange={(v) => {
              if (v?.[0] && v?.[1]) setAnalysisRange([v[0], v[1]]);
            }}
          />
          <Button onClick={() => void refreshAnalysis()} loading={analysisLoading}>
            刷新
          </Button>
          <span style={{ fontSize: 12, color: "#718096" }}>
            在岗 {analysisData?.person_total ?? "—"} 人 · 柱=各班 · 线=当日有班
          </span>
        </Space>
        <RosterAnalysisChart
          data={analysisData}
          loading={analysisLoading}
          active={analysisOpen}
          fullscreen={analysisFullscreen}
        />
      </Modal>

      {/* 排班：时间段 + 班 + 人 */}
      <Modal
        title="排班"
        open={assignOpen}
        confirmLoading={assigning}
        okText="确认排班"
        okButtonProps={{ disabled: !canAssign }}
        onCancel={() => setAssignOpen(false)}
        onOk={() => {
          if (!canAssign) {
            message.warning("请填写时间段、选择班次并勾选人员");
            return;
          }
          void doAssign();
        }}
      >
        <div style={{ display: "flex", flexDirection: "column", gap: 14 }}>
          <div>
            <div style={{ marginBottom: 6 }}>时间段</div>
            <DatePicker.RangePicker
              style={{ width: "100%" }}
              value={assignRange}
              allowClear={false}
              onChange={(v) => {
                if (v?.[0] && v?.[1]) setAssignRange([v[0], v[1]]);
              }}
            />
          </div>
          <div>
            <div style={{ marginBottom: 6 }}>班次</div>
            <Select
              style={{ width: "100%" }}
              placeholder="选一个班，如白班"
              value={assignShift}
              options={shiftOpts.map((s) => ({ value: s.family_id, label: s.name }))}
              onChange={setAssignShift}
            />
          </div>
          <div>
            <div style={{ marginBottom: 6 }}>人员</div>
            <Select
              mode="multiple"
              allowClear
              style={{ width: "100%" }}
              placeholder="勾选这批上该班的人"
              value={assignPeople}
              options={personOptions}
              optionFilterProp="label"
              maxTagCount="responsive"
              onChange={setAssignPeople}
            />
            <Space style={{ marginTop: 8 }}>
              <Button size="small" type="link" onClick={() => setAssignPeople(personOptions.map((p) => p.value))}>
                全选
              </Button>
              <Button size="small" type="link" onClick={() => setAssignPeople([])}>
                清空
              </Button>
            </Space>
          </div>
          <div style={{ fontSize: 12, color: "#718096" }}>
            例：1～10 号选白班，勾一批人 → 确认。另一批人选中班/夜班再排一次即可。
          </div>
        </div>
      </Modal>

      {/* 换班：时间段 + 对换/规则 */}
      <Modal
        title={isTwoShift ? "换班（两班对换）" : "换班"}
        open={switchOpen}
        confirmLoading={rotating}
        okText="确认换班"
        okButtonProps={{ disabled: !canSwitch }}
        onCancel={() => setSwitchOpen(false)}
        onOk={() => {
          if (!canSwitch) {
            message.warning(isMultiShift ? "请填写时间段并配置旧→新规则" : "请填写时间段");
            return;
          }
          void doRotate();
        }}
      >
        <div style={{ display: "flex", flexDirection: "column", gap: 14 }}>
          <div>
            <div style={{ marginBottom: 6 }}>时间段</div>
            <DatePicker.RangePicker
              style={{ width: "100%" }}
              value={switchRange}
              allowClear={false}
              onChange={(v) => {
                if (v?.[0] && v?.[1]) setSwitchRange([v[0], v[1]]);
              }}
            />
            <div style={{ marginTop: 4, fontSize: 12, color: "#718096" }}>
              只改这段；之前的排班不动。一周换、半月换都行。
            </div>
          </div>

          {isTwoShift ? (
            <div
              style={{
                padding: "10px 12px",
                background: "#edf2f7",
                borderRadius: 6,
              }}
            >
              两班直接对换：
              <strong>
                {" "}
                {shiftOpts[0]?.name} ↔ {shiftOpts[1]?.name}
              </strong>
            </div>
          ) : null}

          {isMultiShift ? (
            <div>
              <div style={{ marginBottom: 8 }}>规则（旧 → 新）</div>
              <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
                {shiftOpts.map((s) => (
                  <Space key={s.family_id} wrap>
                    <Tag
                      style={{
                        margin: 0,
                        minWidth: 64,
                        textAlign: "center",
                        background: s.color || "#edf2f7",
                        borderColor: "transparent",
                      }}
                    >
                      {s.name}
                    </Tag>
                    <span>→</span>
                    <Select
                      style={{ minWidth: 120 }}
                      allowClear
                      placeholder="换成"
                      value={mapping[s.family_id] || undefined}
                      options={shiftOpts
                        .filter((t) => t.family_id !== s.family_id)
                        .map((t) => ({ value: t.family_id, label: t.name }))}
                      onChange={(v) => {
                        setMapping((prev) => {
                          const next = { ...prev };
                          if (!v) delete next[s.family_id];
                          else next[s.family_id] = v;
                          return next;
                        });
                      }}
                    />
                  </Space>
                ))}
              </div>
              {Object.keys(mapping).length > 0 ? (
                <div style={{ marginTop: 8, fontSize: 12, color: "#718096" }}>
                  {Object.entries(mapping)
                    .filter(([a, b]) => a && b)
                    .map(([a, b]) => `${nameById[a]}→${nameById[b]}`)
                    .join("；")}
                </div>
              ) : null}
            </div>
          ) : null}
        </div>
      </Modal>
    </div>
  );
}
