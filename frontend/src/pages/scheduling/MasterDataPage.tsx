import {
  Button,
  DatePicker,
  Form,
  Input,
  InputNumber,
  Modal,
  Select,
  Space,
  Tabs,
  Tag,
  Tooltip,
  message,
} from "antd";
import {
  DeleteOutlined,
  EditOutlined,
  EyeOutlined,
  HistoryOutlined,
  PlusCircleOutlined,
  StopOutlined,
  SwapOutlined,
} from "@ant-design/icons";
import dayjs from "dayjs";
import { useMemo, useState } from "react";
import {
  closeLeave,
  closeShiftAssignment,
  createLeave,
  createPerson,
  createShift,
  createShiftAssignment,
  createTemplate,
  deleteShiftAssignment,
  deleteShiftFamily,
  fetchMasterData,
  fetchShiftHistory,
  PERSON_STATUS_LABEL,
  publishShiftVersion,
  reassignForLeave,
  type LeaveItem,
  type PersonItem,
  type ShiftAssignmentItem,
  type ShiftItem,
  type SubstitutionItem,
  type TemplateItem,
  updatePerson,
  updateTemplate,
} from "@/api/scheduling";
import { KpiRow } from "@/components/blocks";
import { DataTable, DeleteAction, FormModal, PageHeader, StatusTag } from "@/components/kit";
import { useMutation } from "@/hooks/useMutation";
import { useRequest } from "@/hooks/useRequest";

export default function MasterDataPage() {
  const { data, loading, refresh } = useRequest(fetchMasterData, { immediate: true });
  const [personOpen, setPersonOpen] = useState(false);
  const [editingPerson, setEditingPerson] = useState<PersonItem | null>(null);
  const [tplOpen, setTplOpen] = useState(false);
  const [editingTpl, setEditingTpl] = useState<TemplateItem | null>(null);
  const [leaveOpen, setLeaveOpen] = useState(false);
  const [leaveDetail, setLeaveDetail] = useState<LeaveItem | null>(null);
  const [reassignPick, setReassignPick] = useState<Record<string, string | undefined>>({});
  const [shiftOpen, setShiftOpen] = useState(false);
  const [editingShiftFamily, setEditingShiftFamily] = useState<ShiftItem | null>(null);
  const [shiftHistory, setShiftHistory] = useState<ShiftItem[] | null>(null);
  const [assignOpen, setAssignOpen] = useState(false);
  const [personForm] = Form.useForm();
  const [tplForm] = Form.useForm();
  const [leaveForm] = Form.useForm();
  const [shiftForm] = Form.useForm();
  const [assignForm] = Form.useForm();
  const [skillFilter, setSkillFilter] = useState<string | undefined>();
  const [keyword, setKeyword] = useState("");
  const [activeTab, setActiveTab] = useState("persons");

  const persons = useMemo(() => {
    let rows = data?.persons ?? [];
    if (skillFilter) rows = rows.filter((p) => p.skill_ids?.includes(skillFilter));
    const kw = keyword.trim().toLowerCase();
    if (kw) {
      rows = rows.filter(
        (p) => p.name.toLowerCase().includes(kw) || p.code.toLowerCase().includes(kw),
      );
    }
    return rows;
  }, [data?.persons, skillFilter, keyword]);

  const shiftRows = useMemo(() => {
    const map = new Map<string, ShiftItem>();
    for (const s of data?.shifts ?? []) {
      if (s.status === "superseded") continue;
      const prev = map.get(s.family_id);
      if (!prev || (s.version || 0) > (prev.version || 0)) map.set(s.family_id, s);
    }
    return [...map.values()];
  }, [data?.shifts]);

  const activeShifts = useMemo(() => {
    const opts = data?.shift_options ?? data?.shifts?.filter((s) => s.status === "active") ?? [];
    return opts;
  }, [data?.shift_options, data?.shifts]);

  const shiftFamilyOptions = useMemo(() => {
    const map = new Map<string, string>();
    for (const s of data?.shifts ?? []) {
      if (s.status === "disabled") continue;
      if (!map.has(s.family_id)) map.set(s.family_id, s.name);
    }
    for (const s of activeShifts) map.set(s.family_id, s.name);
    return [...map.entries()].map(([value, label]) => ({ value, label }));
  }, [data?.shifts, activeShifts]);

  const leaves = data?.leaves ?? [];
  const substitutions = data?.substitutions ?? [];
  const shiftAssignments = data?.shift_assignments ?? [];

  const { mutate: savePerson, loading: savingPerson } = useMutation(
    async (values: Record<string, unknown>) => {
      if (editingPerson) return updatePerson(editingPerson.id, values);
      return createPerson(values);
    },
    {
      successMessage: () => (editingPerson ? "人员已更新" : "人员已新增"),
      onSuccess: async () => {
        setPersonOpen(false);
        setEditingPerson(null);
        personForm.resetFields();
        await refresh();
      },
    },
  );

  const { mutate: saveTpl, loading: savingTpl } = useMutation(
    async (values: Record<string, unknown>) => {
      if (editingTpl) return updateTemplate(editingTpl.id, values);
      return createTemplate(values);
    },
    {
      successMessage: () => (editingTpl ? "模板已更新" : "模板已新增"),
      onSuccess: async () => {
        setTplOpen(false);
        setEditingTpl(null);
        tplForm.resetFields();
        await refresh();
      },
    },
  );

  const { mutate: saveShift, loading: savingShift } = useMutation(
    async (values: {
      code: string;
      name: string;
      start_time: string;
      end_time: string;
      crosses_midnight?: boolean;
      note?: string;
      effective_from?: dayjs.Dayjs | string;
      effective_to?: dayjs.Dayjs | string | null;
    }) => {
      const payload = {
        code: values.code,
        name: values.name,
        start_time: values.start_time,
        end_time: values.end_time,
        crosses_midnight: values.crosses_midnight,
        note: values.note,
        effective_from: values.effective_from
          ? dayjs(values.effective_from).format("YYYY-MM-DD")
          : undefined,
        effective_to: values.effective_to
          ? dayjs(values.effective_to).format("YYYY-MM-DD")
          : null,
      };
      if (editingShiftFamily) {
        return publishShiftVersion(editingShiftFamily.family_id, payload);
      }
      return createShift(payload);
    },
    {
      successMessage: () =>
        editingShiftFamily ? "已发布新班次版本，旧版已归档保留" : "班次已创建",
      onSuccess: async () => {
        setShiftOpen(false);
        setEditingShiftFamily(null);
        shiftForm.resetFields();
        await refresh();
      },
    },
  );

  const { mutate: removeShift, loading: removingShift } = useMutation(
    (familyId: string) => deleteShiftFamily(familyId),
    {
      successMessage: "班次已停用",
      onSuccess: async () => {
        await refresh();
      },
    },
  );

  const { mutate: saveAssign, loading: savingAssign } = useMutation(
    async (values: {
      person_id: string;
      shift_family_id: string;
      range: [dayjs.Dayjs | null, dayjs.Dayjs | null];
      note?: string;
    }) => {
      const start = values.range?.[0];
      if (!start) throw new Error("请选择开始日期");
      const end = values.range?.[1];
      return createShiftAssignment({
        person_id: values.person_id,
        shift_family_id: values.shift_family_id,
        start_date: start.format("YYYY-MM-DD"),
        end_date: end ? end.format("YYYY-MM-DD") : null,
        note: values.note,
      });
    },
    {
      successMessage: "任职已登记",
      onSuccess: async () => {
        setAssignOpen(false);
        assignForm.resetFields();
        await refresh();
      },
    },
  );

  const { mutate: endAssign } = useMutation(
    (id: string) => closeShiftAssignment(id),
    {
      successMessage: "任职已结束",
      onSuccess: async () => {
        await refresh();
      },
    },
  );

  const { mutate: removeAssign } = useMutation(
    (id: string) => deleteShiftAssignment(id),
    {
      successMessage: false,
      onSuccess: async () => {
        await refresh();
      },
    },
  );

  const openShiftHistory = async (familyId: string) => {
    try {
      const res = await fetchShiftHistory(familyId);
      setShiftHistory(res.items);
    } catch (e) {
      message.error(e instanceof Error ? e.message : "加载历史失败");
    }
  };

  const { mutate: saveLeave, loading: savingLeave } = useMutation(
    async (values: {
      person_id: string;
      range: [dayjs.Dayjs, dayjs.Dayjs];
      reason?: string;
    }) => {
      const [start, end] = values.range;
      return createLeave({
        person_id: values.person_id,
        start_date: start.format("YYYY-MM-DD"),
        end_date: end.format("YYYY-MM-DD"),
        reason: values.reason,
      });
    },
    {
      successMessage: "请假已登记",
      onSuccess: async (leave) => {
        setLeaveOpen(false);
        leaveForm.resetFields();
        await refresh();
        setLeaveDetail(leave);
        setReassignPick({});
      },
    },
  );

  const { mutate: doCloseLeave, loading: closingLeave } = useMutation(
    (leaveId: string) => closeLeave(leaveId),
    {
      successMessage: "请假已关闭",
      onSuccess: async () => {
        setLeaveDetail(null);
        await refresh();
      },
    },
  );

  const { mutate: doReassign, loading: reassigning } = useMutation(
    async (payload: { op_id: string; assignee_ids: string[]; leave_id: string }) =>
      reassignForLeave(payload),
    {
      successMessage: "已改派并记入替班台账",
      onSuccess: async (res) => {
        await refresh();
        if (res.leave) {
          setLeaveDetail(res.leave);
        } else if (leaveDetail) {
          const latest = (await fetchMasterData()).leaves?.find((l) => l.id === leaveDetail.id);
          setLeaveDetail(latest ?? null);
        }
        setReassignPick({});
      },
    },
  );

  const headerExtra = (() => {
    if (activeTab === "persons") {
      return (
        <Button
          type="primary"
          onClick={() => {
            setEditingPerson(null);
            personForm.resetFields();
            personForm.setFieldsValue({
              status: "active",
              skill_ids: [],
              shift_family_ids: ["sh-day"],
            });
            setPersonOpen(true);
          }}
        >
          ＋ 新增人员
        </Button>
      );
    }
    if (activeTab === "templates") {
      return (
        <Button
          type="primary"
          onClick={() => {
            setEditingTpl(null);
            tplForm.resetFields();
            tplForm.setFieldsValue({ status: "active", std_hours: 1 });
            setTplOpen(true);
          }}
        >
          ＋ 新增工序模板
        </Button>
      );
    }
    if (activeTab === "shifts") {
      return (
        <Space wrap>
          <Button
            onClick={() => {
              assignForm.resetFields();
              assignForm.setFieldsValue({
                range: [dayjs(), null],
              });
              setAssignOpen(true);
            }}
          >
            ＋ 登记任职
          </Button>
          <Button
            type="primary"
            onClick={() => {
              setEditingShiftFamily(null);
              shiftForm.resetFields();
              shiftForm.setFieldsValue({
                start_time: "08:00",
                end_time: "16:00",
                crosses_midnight: false,
                effective_from: dayjs(),
              });
              setShiftOpen(true);
            }}
          >
            ＋ 新建班次
          </Button>
        </Space>
      );
    }
    return (
      <Button
        type="primary"
        onClick={() => {
          leaveForm.resetFields();
          leaveForm.setFieldsValue({
            range: [dayjs(), dayjs()],
            reason: "事假",
          });
          setLeaveOpen(true);
        }}
      >
        ＋ 登记请假
      </Button>
    );
  })();

  return (
    <div>
      <PageHeader
        title="基础数据"
        subtitle="维护人员、班次（可改版并保留旧版）、工序模板；请假与替班。"
        extra={headerExtra}
      />
      <KpiRow items={data?.kpis ?? []} loading={loading && !data} />

      <Tabs
        activeKey={activeTab}
        onChange={setActiveTab}
        items={[
          {
            key: "persons",
            label: "人员技能",
            children: (
              <DataTable<PersonItem>
                rowKey="id"
                loading={loading}
                dataSource={persons}
                title={() => (
                  <Space wrap>
                    <span style={{ fontWeight: 600 }}>人员与技能</span>
                    <Input
                      allowClear
                      placeholder="搜索姓名 / 工号"
                      style={{ width: 160 }}
                      value={keyword}
                      onChange={(e) => setKeyword(e.target.value)}
                    />
                    <Select
                      allowClear
                      placeholder="全部技能"
                      style={{ width: 140 }}
                      value={skillFilter}
                      onChange={setSkillFilter}
                      options={(data?.skills ?? []).map((s) => ({ value: s.id, label: s.name }))}
                    />
                  </Space>
                )}
                columns={[
                  { title: "姓名", dataIndex: "name" },
                  { title: "工号", dataIndex: "code" },
                  {
                    title: "技能",
                    dataIndex: "skill_names",
                    render: (names: string[]) =>
                      names?.length ? (
                        <Space size={[4, 4]} wrap>
                          {names.map((n) => (
                            <Tag key={n}>{n}</Tag>
                          ))}
                        </Space>
                      ) : (
                        "-"
                      ),
                  },
                  {
                    title: "可上班次",
                    dataIndex: "shift_names",
                    render: (names: string[]) =>
                      names?.length ? (
                        names.join("、")
                      ) : (
                        <span style={{ color: "#a0aec0" }}>未限制</span>
                      ),
                  },
                  {
                    title: "当前任职",
                    key: "current_assignment",
                    width: 160,
                    render: (_, r) => {
                      const a = r.current_assignment;
                      if (!a) return <span style={{ color: "#a0aec0" }}>未安排</span>;
                      return (
                        <div>
                          <div>{a.shift_name || a.shift_family_id}</div>
                          <div style={{ fontSize: 12, color: "#718096" }}>
                            {(a.start_date || "").slice(5)} ~ {a.end_date_label || "至今"}
                          </div>
                        </div>
                      );
                    },
                  },
                  {
                    title: "状态",
                    dataIndex: "status",
                    render: (v: string) => (
                      <StatusTag
                        value={v}
                        labelMap={PERSON_STATUS_LABEL}
                        colorMap={{ active: "green", leave: "orange", disabled: "default" }}
                      />
                    ),
                  },
                  {
                    title: "操作",
                    width: 56,
                    render: (_, row) => (
                      <Tooltip title="编辑">
                        <Button
                          type="link"
                          size="small"
                          aria-label="编辑"
                          icon={<EditOutlined />}
                          onClick={() => {
                            setEditingPerson(row);
                            personForm.setFieldsValue(row);
                            setPersonOpen(true);
                          }}
                        />
                      </Tooltip>
                    ),
                  },
                ]}
              />
            ),
          },
          {
            key: "templates",
            label: "工序模板",
            children: (
              <DataTable<TemplateItem>
                rowKey="id"
                loading={loading}
                dataSource={data?.templates ?? []}
                title={() => <span style={{ fontWeight: 600 }}>工序模板</span>}
                columns={[
                  { title: "模板名称", dataIndex: "name" },
                  {
                    title: "标准工时",
                    dataIndex: "std_hours",
                    render: (v: number) => `${v} 小时`,
                  },
                  {
                    title: "实绩建议",
                    key: "suggested",
                    width: 120,
                    render: (_, r) =>
                      r.suggested_days != null ? (
                        <span>
                          {r.suggested_days} 天
                          <span style={{ color: "#718096", fontSize: 12 }}>
                            （{r.sample_count || 0} 次）
                          </span>
                        </span>
                      ) : (
                        <span style={{ color: "#a0aec0" }}>暂无</span>
                      ),
                  },
                  { title: "所需技能", dataIndex: "skill_name" },
                  {
                    title: "前置工序",
                    dataIndex: "prev_template_name",
                    render: (v) => v || "—",
                  },
                  {
                    title: "状态",
                    dataIndex: "status",
                    render: (v: string) => (
                      <StatusTag
                        value={v}
                        labelMap={{ active: "启用", incomplete: "待完善" }}
                        colorMap={{ active: "green", incomplete: "orange" }}
                      />
                    ),
                  },
                  {
                    title: "操作",
                    width: 56,
                    render: (_, row) => (
                      <Tooltip title="编辑">
                        <Button
                          type="link"
                          size="small"
                          aria-label="编辑"
                          icon={<EditOutlined />}
                          onClick={() => {
                            setEditingTpl(row);
                            tplForm.setFieldsValue(row);
                            setTplOpen(true);
                          }}
                        />
                      </Tooltip>
                    ),
                  },
                ]}
              />
            ),
          },
          {
            key: "shifts",
            label: "班次",
            children: (
              <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>
                <DataTable<ShiftItem>
                  rowKey="id"
                  loading={loading || removingShift}
                  dataSource={shiftRows}
                  title={() => (
                    <span style={{ fontWeight: 600 }}>
                      班次定义 · 改时间发新版；停用后不再参与排产
                    </span>
                  )}
                  columns={[
                    { title: "编码", dataIndex: "code", width: 90 },
                    { title: "名称", dataIndex: "name", width: 100 },
                    {
                      title: "时间",
                      dataIndex: "time_label",
                      render: (v, r) => v || `${r.start_time}–${r.end_time}`,
                    },
                    {
                      title: "版本",
                      dataIndex: "version",
                      width: 72,
                      render: (v: number) => `v${v}`,
                    },
                    {
                      title: "生效起",
                      dataIndex: "effective_from",
                      width: 110,
                      render: (v: string) => (v ? v.slice(0, 10) : "—"),
                    },
                    {
                      title: "生效止",
                      dataIndex: "effective_to",
                      width: 110,
                      render: (_, r) => r.effective_to_label || (r.effective_to ? r.effective_to.slice(0, 10) : "至今"),
                    },
                    {
                      title: "状态",
                      dataIndex: "lifecycle",
                      width: 90,
                      render: (_, r) => (
                        <StatusTag
                          value={r.lifecycle || r.status}
                          labelMap={{
                            active: "生效中",
                            upcoming: "未生效",
                            expired: "已过期",
                            superseded: "已归档",
                            disabled: "停用",
                          }}
                          colorMap={{
                            active: "green",
                            upcoming: "blue",
                            expired: "default",
                            superseded: "default",
                            disabled: "red",
                          }}
                        />
                      ),
                    },
                    {
                      title: "操作",
                      width: 112,
                      render: (_, row) => (
                        <Space size={0} wrap={false}>
                          {row.status !== "disabled" ? (
                            <Tooltip title="发新版">
                              <Button
                                type="link"
                                size="small"
                                aria-label="发新版"
                                icon={<PlusCircleOutlined />}
                                onClick={() => {
                                  setEditingShiftFamily(row);
                                  shiftForm.setFieldsValue({
                                    code: row.code,
                                    name: row.name,
                                    start_time: row.start_time,
                                    end_time: row.end_time,
                                    crosses_midnight: !!row.crosses_midnight,
                                    note: row.note || "",
                                    effective_from: dayjs(),
                                    effective_to: undefined,
                                  });
                                  setShiftOpen(true);
                                }}
                              />
                            </Tooltip>
                          ) : null}
                          <Tooltip title="历史">
                            <Button
                              type="link"
                              size="small"
                              aria-label="历史"
                              icon={<HistoryOutlined />}
                              onClick={() => void openShiftHistory(row.family_id)}
                            />
                          </Tooltip>
                          {row.status !== "disabled" ? (
                            <Tooltip title="停用">
                              <span>
                                <DeleteAction
                                  title="停用该班次？"
                                  content="停用后不再可选；历史版本与已排工序仍保留。若有未完成工序占用则无法停用。"
                                  successMessage={false}
                                  onConfirm={() => removeShift(row.family_id)}
                                  buttonProps={{
                                    type: "link",
                                    size: "small",
                                    danger: true,
                                    icon: <StopOutlined />,
                                    "aria-label": "停用",
                                  }}
                                >
                                  {null}
                                </DeleteAction>
                              </span>
                            </Tooltip>
                          ) : null}
                        </Space>
                      ),
                    },
                  ]}
                />

                <DataTable<ShiftAssignmentItem>
                  rowKey="id"
                  loading={loading}
                  dataSource={shiftAssignments}
                  title={() => (
                    <span style={{ fontWeight: 600 }}>
                      人员任职 · 能力≠当班；当前演示默认全员白班
                    </span>
                  )}
                  columns={[
                    {
                      title: "人员",
                      key: "person",
                      render: (_, r) => (
                        <div>
                          <div>{r.person_name || r.person_id}</div>
                          <div style={{ fontSize: 12, color: "#718096" }}>{r.person_code}</div>
                        </div>
                      ),
                    },
                    { title: "班次", dataIndex: "shift_name", width: 100 },
                    {
                      title: "任职起",
                      dataIndex: "start_date",
                      width: 110,
                      render: (v: string) => (v ? v.slice(0, 10) : "—"),
                    },
                    {
                      title: "任职止",
                      dataIndex: "end_date",
                      width: 110,
                      render: (_, r) => r.end_date_label || (r.end_date ? r.end_date.slice(0, 10) : "至今"),
                    },
                    {
                      title: "状态",
                      dataIndex: "lifecycle",
                      width: 90,
                      render: (_, r) => (
                        <StatusTag
                          value={r.lifecycle || r.status}
                          labelMap={{
                            active: "任职中",
                            upcoming: "未开始",
                            expired: "已过期",
                            closed: "已结束",
                          }}
                          colorMap={{
                            active: "green",
                            upcoming: "blue",
                            expired: "default",
                            closed: "default",
                          }}
                        />
                      ),
                    },
                    { title: "备注", dataIndex: "note", render: (v) => v || "—" },
                    {
                      title: "操作",
                      width: 80,
                      render: (_, row) => (
                        <Space size={0} wrap={false}>
                          {row.lifecycle === "active" || row.status === "open" ? (
                            <Tooltip title="结束">
                              <Button
                                type="link"
                                size="small"
                                aria-label="结束"
                                icon={<StopOutlined />}
                                onClick={() => endAssign(row.id)}
                              />
                            </Tooltip>
                          ) : null}
                          <Tooltip title="删除">
                            <span>
                              <DeleteAction
                                content="删除后不可恢复。"
                                onConfirm={() => removeAssign(row.id)}
                                buttonProps={{
                                  type: "link",
                                  size: "small",
                                  danger: true,
                                  icon: <DeleteOutlined />,
                                  "aria-label": "删除",
                                }}
                              >
                                {null}
                              </DeleteAction>
                            </span>
                          </Tooltip>
                        </Space>
                      ),
                    },
                  ]}
                />
              </div>
            ),
          },
          {
            key: "leave",
            label: "请假替班",
            children: (
              <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 16 }}>
                <DataTable<LeaveItem>
                  rowKey="id"
                  loading={loading}
                  dataSource={leaves}
                  title={() => <span style={{ fontWeight: 600 }}>请假</span>}
                  columns={[
                    {
                      title: "人员",
                      key: "person",
                      render: (_, r) => (
                        <div>
                          <div>{r.person_name || r.person_id}</div>
                          <div style={{ fontSize: 12, color: "#718096" }}>{r.person_code}</div>
                        </div>
                      ),
                    },
                    {
                      title: "请假区间",
                      key: "range",
                      width: 150,
                      render: (_, r) => `${r.start_date.slice(5)} ~ ${r.end_date.slice(5)}`,
                    },
                    { title: "事由", dataIndex: "reason", width: 80 },
                    {
                      title: "受影响",
                      dataIndex: "affected_count",
                      width: 72,
                      render: (n: number) =>
                        n > 0 ? <Tag color="orange">{n} 道</Tag> : "0",
                    },
                    {
                      title: "状态",
                      dataIndex: "status",
                      width: 80,
                      render: (v: string) => (
                        <StatusTag
                          value={v}
                          labelMap={{ open: "待处理", closed: "已关闭" }}
                          colorMap={{ open: "orange", closed: "default" }}
                        />
                      ),
                    },
                    {
                      title: "操作",
                      width: 56,
                      render: (_, row) => {
                        const needReassign =
                          row.status === "open" && (row.affected_count || 0) > 0;
                        return (
                          <Tooltip title={needReassign ? "去改派" : "查看"}>
                            <Button
                              type="link"
                              size="small"
                              aria-label={needReassign ? "去改派" : "查看"}
                              icon={needReassign ? <SwapOutlined /> : <EyeOutlined />}
                              onClick={() => {
                                setLeaveDetail(row);
                                setReassignPick({});
                              }}
                            />
                          </Tooltip>
                        );
                      },
                    },
                  ]}
                />

                <DataTable<SubstitutionItem>
                  rowKey="id"
                  loading={loading}
                  dataSource={substitutions}
                  title={() => <span style={{ fontWeight: 600 }}>替班台账</span>}
                  columns={[
                    { title: "时间", dataIndex: "at", width: 130 },
                    {
                      title: "工序 / 订单",
                      key: "op",
                      render: (_, r) => (
                        <div>
                          <div>{r.op_name || r.op_id}</div>
                          <div style={{ fontSize: 12, color: "#718096" }}>
                            {r.order_code || "-"}
                            {r.leave_reason ? ` · 因${r.leave_reason}` : ""}
                          </div>
                        </div>
                      ),
                    },
                    {
                      title: "原责任人 → 替班",
                      key: "who",
                      render: (_, r) => `${r.from_names || "-"} → ${r.to_names || "-"}`,
                    },
                  ]}
                />
              </div>
            ),
          },
        ]}
      />

      <FormModal
        title={editingPerson ? "编辑人员" : "新增人员"}
        open={personOpen}
        form={personForm}
        confirmLoading={savingPerson}
        onCancel={() => {
          setPersonOpen(false);
          setEditingPerson(null);
        }}
        onOk={async () => {
          const values = await personForm.validateFields();
          await savePerson(values);
        }}
      >
        <Form.Item name="name" label="姓名" rules={[{ required: true }]}>
          <Input />
        </Form.Item>
        <Form.Item name="code" label="工号" rules={[{ required: true }]}>
          <Input />
        </Form.Item>
        <Form.Item name="skill_ids" label="技能">
          <Select
            mode="multiple"
            options={(data?.skills ?? []).map((s) => ({ value: s.id, label: s.name }))}
          />
        </Form.Item>
        <Form.Item name="resource_id" label="所属班组">
          <Select
            allowClear
            options={(data?.resources ?? []).map((r) => ({ value: r.id, label: r.name }))}
          />
        </Form.Item>
        <Form.Item
          name="shift_family_ids"
          label="可上班次"
          extra="能力：能上哪些班。实际当班请在「班次」页登记任职区间。"
        >
          <Select
            mode="multiple"
            options={shiftFamilyOptions}
            placeholder="选择可上的班次族"
          />
        </Form.Item>
        <Form.Item name="status" label="状态" rules={[{ required: true }]}>
          <Select
            options={[
              { value: "active", label: "在岗" },
              { value: "leave", label: "休假" },
              { value: "disabled", label: "停用" },
            ]}
          />
        </Form.Item>
      </FormModal>

      <FormModal
        title={editingTpl ? "编辑工序模板" : "新增工序模板"}
        open={tplOpen}
        form={tplForm}
        confirmLoading={savingTpl}
        onCancel={() => {
          setTplOpen(false);
          setEditingTpl(null);
        }}
        onOk={async () => {
          const values = await tplForm.validateFields();
          await saveTpl(values);
        }}
      >
        <Form.Item name="name" label="模板名称" rules={[{ required: true }]}>
          <Input />
        </Form.Item>
        <Form.Item name="std_hours" label="标准工时(小时)" rules={[{ required: true }]}>
          <InputNumber min={0.5} step={0.5} style={{ width: "100%" }} />
        </Form.Item>
        <Form.Item name="skill_id" label="所需技能" rules={[{ required: true }]}>
          <Select options={(data?.skills ?? []).map((s) => ({ value: s.id, label: s.name }))} />
        </Form.Item>
        <Form.Item name="prev_template_id" label="前置工序">
          <Select
            allowClear
            options={(data?.templates ?? [])
              .filter((t) => t.id !== editingTpl?.id)
              .map((t) => ({ value: t.id, label: t.name }))}
          />
        </Form.Item>
        <Form.Item name="status" label="状态" rules={[{ required: true }]}>
          <Select
            options={[
              { value: "active", label: "启用" },
              { value: "incomplete", label: "待完善" },
            ]}
          />
        </Form.Item>
      </FormModal>

      <FormModal
        title="登记请假"
        open={leaveOpen}
        form={leaveForm}
        confirmLoading={savingLeave}
        onCancel={() => setLeaveOpen(false)}
        onOk={async () => {
          const values = await leaveForm.validateFields();
          await saveLeave(values);
        }}
      >
        <Form.Item name="person_id" label="请假人" rules={[{ required: true, message: "请选择人员" }]}>
          <Select
            showSearch
            optionFilterProp="label"
            options={(data?.persons ?? [])
              .filter((p) => p.status !== "disabled")
              .map((p) => ({ value: p.id, label: `${p.name}（${p.code}）` }))}
          />
        </Form.Item>
        <Form.Item name="range" label="请假日期" rules={[{ required: true, message: "请选择日期" }]}>
          <DatePicker.RangePicker style={{ width: "100%" }} />
        </Form.Item>
        <Form.Item name="reason" label="事由">
          <Input placeholder="事假 / 病假 / 培训等" />
        </Form.Item>
      </FormModal>

      <Modal
        title={
          leaveDetail
            ? `请假详情 · ${leaveDetail.person_name || ""}（${leaveDetail.start_date.slice(5)}~${leaveDetail.end_date.slice(5)}）`
            : "请假详情"
        }
        open={!!leaveDetail}
        width={720}
        destroyOnHidden
        footer={
          <Space>
            {leaveDetail?.status === "open" ? (
              <Button
                loading={closingLeave}
                onClick={() => leaveDetail && doCloseLeave(leaveDetail.id)}
              >
                关闭请假
              </Button>
            ) : null}
            <Button type="primary" onClick={() => setLeaveDetail(null)}>
              完成
            </Button>
          </Space>
        }
        onCancel={() => setLeaveDetail(null)}
      >
        {leaveDetail ? (
          <div>
            <div style={{ marginBottom: 12, color: "#4a5568" }}>
              事由：{leaveDetail.reason || "—"} · 状态：
              {leaveDetail.status === "open" ? "待处理" : "已关闭"}
            </div>
            {(leaveDetail.affected_ops?.length || 0) === 0 ? (
              <div style={{ color: "#718096" }}>该时段内没有仍排给此人的工序。</div>
            ) : (
              <DataTable
                rowKey="id"
                size="small"
                pagination={false}
                dataSource={leaveDetail.affected_ops ?? []}
                columns={[
                  {
                    title: "工序",
                    key: "op",
                    render: (_, op) => (
                      <div>
                        <div style={{ fontWeight: 600 }}>{op.name}</div>
                        <div style={{ fontSize: 12, color: "#718096" }}>
                          {op.order_code || "-"} · {op.plan_start?.slice(5)}~{op.plan_end?.slice(5)}
                        </div>
                      </div>
                    ),
                  },
                  {
                    title: "当前责任人",
                    dataIndex: "assignee_name",
                    width: 120,
                    render: (v: string) => v || "—",
                  },
                  {
                    title: "改派给",
                    width: 220,
                    render: (_, op) => (
                      <Space>
                        <Select
                          placeholder="选择替班人"
                          style={{ width: 140 }}
                          value={reassignPick[op.id]}
                          onChange={(v) => setReassignPick((prev) => ({ ...prev, [op.id]: v }))}
                          options={(data?.persons ?? [])
                            .filter(
                              (p) =>
                                p.status === "active" &&
                                p.id !== leaveDetail.person_id &&
                                (!op.skill_id || p.skill_ids?.includes(op.skill_id)),
                            )
                            .map((p) => ({ value: p.id, label: p.name }))}
                        />
                        <Button
                          type="link"
                          size="small"
                          loading={reassigning}
                          disabled={!reassignPick[op.id]}
                          onClick={() => {
                            const pid = reassignPick[op.id];
                            if (!pid || !leaveDetail) {
                              message.warning("请先选择替班人");
                              return;
                            }
                            void doReassign({
                              op_id: op.id,
                              assignee_ids: [pid],
                              leave_id: leaveDetail.id,
                            });
                          }}
                        >
                          确认
                        </Button>
                      </Space>
                    ),
                  },
                ]}
              />
            )}
          </div>
        ) : null}
      </Modal>

      <FormModal
        title={editingShiftFamily ? `发布新版 · ${editingShiftFamily.name}` : "新建班次"}
        open={shiftOpen}
        form={shiftForm}
        confirmLoading={savingShift}
        onCancel={() => {
          setShiftOpen(false);
          setEditingShiftFamily(null);
        }}
        onOk={async () => {
          const values = await shiftForm.validateFields();
          await saveShift(values);
        }}
        okText={editingShiftFamily ? "发布新版本" : "创建"}
      >
        {editingShiftFamily ? (
          <div style={{ marginBottom: 12, color: "#718096", fontSize: 12 }}>
            当前 v{editingShiftFamily.version}（{editingShiftFamily.time_label}）将归档保留；已排工序若绑旧版本仍按旧时间解释。
          </div>
        ) : null}
        <Form.Item name="code" label="编码" rules={[{ required: true }]}>
          <Input placeholder="如 DAY / MID / NIGHT" disabled={!!editingShiftFamily} />
        </Form.Item>
        <Form.Item name="name" label="名称" rules={[{ required: true }]}>
          <Input placeholder="如 白班" />
        </Form.Item>
        <Form.Item name="start_time" label="开始时间" rules={[{ required: true }]}>
          <Input placeholder="08:00" />
        </Form.Item>
        <Form.Item name="end_time" label="结束时间" rules={[{ required: true }]}>
          <Input placeholder="16:00" />
        </Form.Item>
        <Form.Item name="crosses_midnight" label="跨午夜" initialValue={false}>
          <Select
            options={[
              { value: false, label: "否" },
              { value: true, label: "是（如 16:30–00:30）" },
            ]}
          />
        </Form.Item>
        <Form.Item
          name="effective_from"
          label="生效起"
          rules={[{ required: true, message: "请选择生效起" }]}
          initialValue={dayjs()}
        >
          <DatePicker style={{ width: "100%" }} />
        </Form.Item>
        <Form.Item name="effective_to" label="生效止" extra="可空表示至今；到期后状态为已过期">
          <DatePicker style={{ width: "100%" }} placeholder="至今" />
        </Form.Item>
        <Form.Item name="note" label="备注">
          <Input.TextArea rows={2} placeholder="调整说明" />
        </Form.Item>
      </FormModal>

      <FormModal
        title="登记人员任职"
        open={assignOpen}
        form={assignForm}
        confirmLoading={savingAssign}
        onCancel={() => setAssignOpen(false)}
        onOk={async () => {
          const values = await assignForm.validateFields();
          await saveAssign(values);
        }}
      >
        <div style={{ marginBottom: 12, color: "#718096", fontSize: 12 }}>
          与「可上班次」不同：任职表示这段时间实际上哪个班。新任职会自动截断同人重叠区间。
        </div>
        <Form.Item name="person_id" label="人员" rules={[{ required: true }]}>
          <Select
            showSearch
            optionFilterProp="label"
            options={(data?.persons ?? [])
              .filter((p) => p.status !== "disabled")
              .map((p) => ({ value: p.id, label: `${p.name}（${p.code}）` }))}
          />
        </Form.Item>
        <Form.Item name="shift_family_id" label="班次" rules={[{ required: true }]}>
          <Select options={shiftFamilyOptions} />
        </Form.Item>
        <Form.Item
          name="range"
          label="任职区间"
          rules={[{ required: true, message: "请选择开始日期" }]}
          extra="结束日期可空，表示至今"
        >
          <DatePicker.RangePicker
            style={{ width: "100%" }}
            allowEmpty={[false, true]}
          />
        </Form.Item>
        <Form.Item name="note" label="备注">
          <Input placeholder="如：长期白班" />
        </Form.Item>
      </FormModal>

      <Modal
        title="班次版本历史"
        open={!!shiftHistory}
        onCancel={() => setShiftHistory(null)}
        footer={
          <Button type="primary" onClick={() => setShiftHistory(null)}>
            关闭
          </Button>
        }
        width={720}
        destroyOnHidden
      >
        <DataTable<ShiftItem>
          rowKey="id"
          pagination={false}
          dataSource={shiftHistory ?? []}
          columns={[
            {
              title: "版本",
              dataIndex: "version",
              width: 70,
              render: (v: number) => `v${v}`,
            },
            {
              title: "状态",
              dataIndex: "lifecycle",
              width: 90,
              render: (_, r) => (
                <StatusTag
                  value={r.lifecycle || r.status}
                  labelMap={{
                    active: "生效中",
                    upcoming: "未生效",
                    expired: "已过期",
                    superseded: "已归档",
                    disabled: "停用",
                  }}
                  colorMap={{
                    active: "green",
                    upcoming: "blue",
                    expired: "default",
                    superseded: "default",
                    disabled: "red",
                  }}
                />
              ),
            },
            {
              title: "时间",
              key: "time",
              render: (_, r) => r.time_label || `${r.start_time}–${r.end_time}`,
            },
            {
              title: "生效起",
              dataIndex: "effective_from",
              width: 110,
              render: (v: string) => (v ? v.slice(0, 10) : "—"),
            },
            {
              title: "生效止",
              dataIndex: "effective_to",
              width: 110,
              render: (_, r) =>
                r.effective_to_label || (r.effective_to ? r.effective_to.slice(0, 10) : "至今"),
            },
            { title: "备注", dataIndex: "note", render: (v) => v || "—" },
          ]}
        />
      </Modal>
    </div>
  );
}
