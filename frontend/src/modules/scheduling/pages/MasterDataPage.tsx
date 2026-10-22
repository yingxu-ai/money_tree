import {
  Alert,
  Button,
  Card,
  Col,
  DatePicker,
  Form,
  Input,
  InputNumber,
  Modal,
  Popover,
  Row,
  Select,
  Skeleton,
  Space,
  Tabs,
  Tag,
  Tooltip,
  Typography,
  message,
  theme,
} from "antd";
import {
  ArrowDownOutlined,
  ArrowUpOutlined,
  CheckCircleOutlined,
  EditOutlined,
  EyeOutlined,
  HistoryOutlined,
  PlusCircleOutlined,
  StopOutlined,
  SwapOutlined,
} from "@ant-design/icons";
import dayjs from "dayjs";
import { useEffect, useMemo, useRef, useState, type CSSProperties, type ReactNode } from "react";
import {
  closeLeave,
  createLeave,
  createEquipment,
  createPerson,
  createResource,
  createShift,
  createShiftAssignment,
  createSkill,
  createTemplate,
  deleteEquipment,
  deleteResource,
  deleteSkill,
  disableShiftFamily,
  fetchMasterData,
  fetchShiftHistory,
  fetchShiftUsage,
  PERSON_STATUS_LABEL,
  publishShiftVersion,
  reassignForLeave,
  reorderShifts,
  type EquipmentItem,
  type LeaveItem,
  type PersonItem,
  type ResourceItem,
  type ShiftItem,
  type ShiftUsageResponse,
  type SkillItem,
  type SubstitutionItem,
  type TemplateItem,
  updateEquipment,
  updatePerson,
  updateResource,
  updateSkill,
  updateTemplate,
} from "@/modules/scheduling/api/scheduling";
import { DataTable, DeleteAction, FormModal, PageHeader, StatusTag } from "@/components/kit";
import { useMutation } from "@/hooks/useMutation";
import { useRequest } from "@/hooks/useRequest";
import RosterWeekPanel from "@/modules/scheduling/pages/RosterWeekPanel";

/** 建厂配置顺序（排班为日常，放最后） */
const MASTER_TAB_ORDER = [
  "shifts",
  "resources",
  "skills",
  "equipments",
  "persons",
  "templates",
  "roster",
] as const;

type MasterTabKey = (typeof MASTER_TAB_ORDER)[number];

const SETUP_STEP_META: Array<{
  key: MasterTabKey;
  label: string;
  purpose: string;
  nextKey?: MasterTabKey;
  nextLabel?: string;
}> = [
  {
    key: "shifts",
    label: "班制",
    purpose: "定义一天有几班、几点到几点。人员可上班次、排班与甘特班次都依赖这里。",
    nextKey: "resources",
    nextLabel: "下一步：班组",
  },
  {
    key: "resources",
    label: "班组",
    purpose: "产线/工段组织。人员挂班组，设备也可挂到班组。",
    nextKey: "skills",
    nextLabel: "下一步：技能",
  },
  {
    key: "skills",
    label: "技能",
    purpose: "工种能力字典（焊接、装配等）。人员勾选会什么，工序模板声明需要什么。",
    nextKey: "equipments",
    nextLabel: "下一步：设备",
  },
  {
    key: "equipments",
    label: "设备",
    purpose: "机台台账（各班共用）。工序模板绑设备池，甘特排产选具体机台；公共设备可不挂班组。",
    nextKey: "persons",
    nextLabel: "下一步：人员",
  },
  {
    key: "persons",
    label: "人员",
    purpose: "谁属于哪班组、会什么技能、能上哪些班。技能请先在「技能」页维护。",
    nextKey: "templates",
    nextLabel: "下一步：工序模板",
  },
  {
    key: "templates",
    label: "工序模板",
    purpose: "标准工艺链 + 所需技能 + 可用设备池。配好后再排班，再到甘特排产。",
    nextKey: "roster",
    nextLabel: "下一步：排班",
  },
  {
    key: "roster",
    label: "排班",
    purpose:
      "本周谁上哪班、请假与替班。请假按自然日：请 11 号假 = 挡白/中班（挂牌 11）和夜班「11 号凌晨」那班（挂牌 10），不挡 12 号凌晨的夜班。机台在甘特选；哪天干哪单到「排产甘特」。",
  },
];

function bySortName<T extends { sort?: number; name: string }>(a: T, b: T) {
  return (a.sort ?? 999) - (b.sort ?? 999) || a.name.localeCompare(b.name, "zh");
}

function cleanNames(names: string[]) {
  return names.map((name) => name.trim()).filter(Boolean);
}

const OVERVIEW_CARD_GAP = 14;

/** 低饱和色点，区分类型但不抢数字 */
const OVERVIEW_ACCENTS = {
  shifts: { bar: "#1ABB9C", soft: "rgba(26, 187, 156, 0.12)", text: "#0f766e" },
  resources: { bar: "#3b82f6", soft: "rgba(59, 130, 246, 0.10)", text: "#1d4ed8" },
  skills: { bar: "#8b5cf6", soft: "rgba(139, 92, 246, 0.10)", text: "#6d28d9" },
  equipments: { bar: "#64748b", soft: "rgba(100, 116, 139, 0.10)", text: "#475569" },
  persons: { bar: "#f59e0b", soft: "rgba(245, 158, 11, 0.12)", text: "#b45309" },
  templates: { bar: "#0ea5e9", soft: "rgba(14, 165, 233, 0.08)", text: "#0369a1" },
} as const;

type OverviewAccentKey = keyof typeof OVERVIEW_ACCENTS;

const OVERVIEW_MOTION_CSS = `
.master-overview-card {
  transition: transform 0.18s ease, box-shadow 0.18s ease, border-color 0.18s ease;
}
.master-overview-card:hover {
  transform: translateY(-3px);
  box-shadow: 0 8px 18px rgba(15, 23, 42, 0.08) !important;
}
.master-overview-card:active {
  transform: translateY(-1px) scale(0.992);
}
.master-overview-soft-tag {
  border: none !important;
  border-radius: 999px !important;
  margin: 0 !important;
  padding: 0 8px !important;
  line-height: 22px !important;
  font-size: 12px !important;
}
`;

function OverviewStatCard({
  title,
  value,
  unit,
  active,
  accent,
  tone = "primary",
  onClick,
  footer,
}: {
  title: string;
  value: number | string;
  unit?: string;
  active?: boolean;
  accent: OverviewAccentKey;
  /** primary=班次/班组/技能；secondary=设备/人员更扁 */
  tone?: "primary" | "secondary";
  onClick?: () => void;
  footer?: ReactNode;
}) {
  const { token } = theme.useToken();
  const palette = OVERVIEW_ACCENTS[accent];
  const isPrimary = tone === "primary";

  const style: CSSProperties = {
    height: "100%",
    minHeight: isPrimary ? 142 : 118,
    background: token.colorBgContainer,
    border: `1px solid ${token.colorBorderSecondary}`,
    borderRadius: 10,
    boxShadow: "0 1px 3px rgba(15, 23, 42, 0.04)",
    cursor: onClick ? "pointer" : undefined,
    overflow: "hidden",
    position: "relative",
  };

  return (
    <Card
      size="small"
      className="master-overview-card"
      onClick={onClick}
      style={style}
      styles={{
        body: {
          padding: isPrimary ? "14px 14px 12px 16px" : "12px 14px 10px 16px",
          display: "flex",
          flexDirection: "column",
          gap: isPrimary ? 10 : 6,
          height: "100%",
        },
      }}
    >
      <span
        aria-hidden
        style={{
          position: "absolute",
          left: 0,
          top: 0,
          bottom: 0,
          width: active ? 3 : 2,
          background: palette.bar,
          opacity: active ? 1 : 0.55,
          transition: "width 0.15s ease, opacity 0.15s ease",
        }}
      />
      <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
        <span
          aria-hidden
          style={{
            width: 7,
            height: 7,
            borderRadius: "50%",
            background: palette.bar,
            flex: "0 0 auto",
            boxShadow: `0 0 0 3px ${palette.soft}`,
          }}
        />
        <Typography.Text type="secondary" style={{ fontSize: 12, letterSpacing: 0.2 }}>
          {title}
        </Typography.Text>
      </div>
      <div
        style={{
          display: "flex",
          alignItems: "baseline",
          gap: 4,
          lineHeight: 1,
          letterSpacing: "-0.02em",
        }}
      >
        <span
          style={{
            fontSize: isPrimary ? 30 : 24,
            fontWeight: 600,
            color: token.colorText,
            fontVariantNumeric: "tabular-nums",
          }}
        >
          {value}
        </span>
        {unit ? (
          <span style={{ fontSize: isPrimary ? 14 : 13, color: token.colorTextSecondary, fontWeight: 500 }}>
            {unit}
          </span>
        ) : null}
      </div>
      {footer ? <div style={{ marginTop: "auto" }}>{footer}</div> : null}
    </Card>
  );
}

function SoftTagRow({ names, accent }: { names: string[]; accent: OverviewAccentKey }) {
  const cleaned = cleanNames(names);
  const palette = OVERVIEW_ACCENTS[accent];
  if (!cleaned.length) {
    return (
      <Typography.Text type="secondary" style={{ fontSize: 12 }}>
        暂无
      </Typography.Text>
    );
  }
  return (
    <Space wrap size={[6, 6]}>
      {cleaned.map((name) => (
        <Tag
          key={name}
          className="master-overview-soft-tag"
          style={{ background: palette.soft, color: palette.text }}
        >
          {name}
        </Tag>
      ))}
    </Space>
  );
}

function SkillDetailLink({ names }: { names: string[] }) {
  const cleaned = cleanNames(names);
  const [coarsePointer, setCoarsePointer] = useState(false);
  const [modalOpen, setModalOpen] = useState(false);

  useEffect(() => {
    const mq = window.matchMedia("(hover: none), (pointer: coarse)");
    const sync = () => setCoarsePointer(mq.matches);
    sync();
    mq.addEventListener("change", sync);
    return () => mq.removeEventListener("change", sync);
  }, []);

  if (!cleaned.length) {
    return (
      <Typography.Text type="secondary" style={{ fontSize: 12 }}>
        暂无技能，请先到「技能」页维护
      </Typography.Text>
    );
  }

  const detail = <SoftTagRow names={cleaned} accent="skills" />;

  const link = (
    <Typography.Link
      style={{ fontSize: 12 }}
      onClick={(e) => {
        e.stopPropagation();
        if (coarsePointer) setModalOpen(true);
      }}
    >
      共 {cleaned.length} 项，点击查看明细
    </Typography.Link>
  );

  if (coarsePointer) {
    return (
      <>
        {link}
        <Modal
          title="全部技能"
          open={modalOpen}
          onCancel={() => setModalOpen(false)}
          footer={null}
          destroyOnClose
        >
          {detail}
        </Modal>
      </>
    );
  }

  return (
    <Popover content={detail} title="全部技能" trigger="hover" mouseEnterDelay={0.15}>
      {link}
    </Popover>
  );
}

function MasterOverviewPanel({
  data,
  activeKey,
  onPick,
}: {
  data: {
    shiftNames: string[];
    resourceNames: string[];
    skillNames: string[];
    templateNames: string[];
    equipment: { total: number; active: number; shared: number };
    persons: { total: number; onDuty: number; leave: number };
  };
  activeKey: MasterTabKey;
  onPick: (key: MasterTabKey) => void;
}) {
  const { token } = theme.useToken();
  const { shiftNames, resourceNames, skillNames, templateNames, equipment, persons } = data;
  const tplAccent = OVERVIEW_ACCENTS.templates;
  const overviewCol = { xs: 24, sm: 12, lg: { flex: "1 1 0" as const } };

  return (
    <div style={{ marginBottom: 16 }}>
      <style>{OVERVIEW_MOTION_CSS}</style>
      <Row gutter={[OVERVIEW_CARD_GAP, OVERVIEW_CARD_GAP]} wrap>
        <Col {...overviewCol} style={{ minWidth: 0 }}>
          <OverviewStatCard
            title="班次"
            value={shiftNames.length}
            unit="班"
            accent="shifts"
            active={activeKey === "shifts"}
            onClick={() => onPick("shifts")}
            footer={<SoftTagRow names={shiftNames} accent="shifts" />}
          />
        </Col>
        <Col {...overviewCol} style={{ minWidth: 0 }}>
          <OverviewStatCard
            title="班组"
            value={resourceNames.length}
            unit="个"
            accent="resources"
            active={activeKey === "resources"}
            onClick={() => onPick("resources")}
            footer={<SoftTagRow names={resourceNames} accent="resources" />}
          />
        </Col>
        <Col {...overviewCol} style={{ minWidth: 0 }}>
          <OverviewStatCard
            title="技能"
            value={skillNames.length}
            unit="种"
            accent="skills"
            active={activeKey === "skills"}
            onClick={() => onPick("skills")}
            footer={<SkillDetailLink names={skillNames} />}
          />
        </Col>
        <Col {...overviewCol} style={{ minWidth: 0 }}>
          <OverviewStatCard
            title="设备"
            value={equipment.total}
            unit="台"
            accent="equipments"
            tone="secondary"
            active={activeKey === "equipments"}
            onClick={() => onPick("equipments")}
            footer={
              <Typography.Text type="secondary" style={{ fontSize: 12 }}>
                启用 {equipment.active}
                {equipment.shared ? ` · 公共 ${equipment.shared}` : ""}
              </Typography.Text>
            }
          />
        </Col>
        <Col {...overviewCol} style={{ minWidth: 0 }}>
          <OverviewStatCard
            title="人员"
            value={persons.total}
            unit="人"
            accent="persons"
            tone="secondary"
            active={activeKey === "persons"}
            onClick={() => onPick("persons")}
            footer={
              <Typography.Text type="secondary" style={{ fontSize: 12 }}>
                在岗 {persons.onDuty}
                {persons.leave ? ` · 请假 ${persons.leave}` : ""}
              </Typography.Text>
            }
          />
        </Col>
      </Row>

      <div
        role="button"
        tabIndex={0}
        className="master-overview-card"
        onClick={() => onPick("templates")}
        onKeyDown={(e) => {
          if (e.key === "Enter" || e.key === " ") {
            e.preventDefault();
            onPick("templates");
          }
        }}
        style={{
          marginTop: OVERVIEW_CARD_GAP,
          display: "flex",
          alignItems: "center",
          gap: 12,
          flexWrap: "wrap",
          padding: "10px 14px 10px 16px",
          borderRadius: 10,
          cursor: "pointer",
          background: tplAccent.soft,
          border: `1px solid ${activeKey === "templates" ? tplAccent.bar : token.colorBorderSecondary}`,
          boxShadow: "0 1px 3px rgba(15, 23, 42, 0.03)",
          position: "relative",
          overflow: "hidden",
        }}
      >
        <span
          aria-hidden
          style={{
            position: "absolute",
            left: 0,
            top: 0,
            bottom: 0,
            width: activeKey === "templates" ? 3 : 2,
            background: tplAccent.bar,
            opacity: activeKey === "templates" ? 1 : 0.5,
          }}
        />
        <Typography.Text strong style={{ fontSize: 13, color: tplAccent.text, flex: "0 0 auto" }}>
          工序模板
        </Typography.Text>
        <div style={{ flex: 1, minWidth: 0 }}>
          <SoftTagRow names={templateNames} accent="templates" />
        </div>
      </div>
    </div>
  );
}

function TabGuide({
  purpose,
  nextLabel,
  onNext,
  extra,
}: {
  purpose: string;
  nextLabel?: string;
  onNext?: () => void;
  extra?: ReactNode;
}) {
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 10, marginBottom: 12 }}>
      <Alert
        type="info"
        showIcon
        message={purpose}
        action={
          nextLabel && onNext ? (
            <Button size="small" type="link" onClick={onNext}>
              {nextLabel}
            </Button>
          ) : undefined
        }
      />
      {extra}
    </div>
  );
}

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
  const [rosterNonce, setRosterNonce] = useState(0);
  const [disableTarget, setDisableTarget] = useState<ShiftItem | null>(null);
  const [disableUsage, setDisableUsage] = useState<ShiftUsageResponse | null>(null);
  const [migrateTo, setMigrateTo] = useState<string | undefined>();
  const [usageLoading, setUsageLoading] = useState(false);
  const [personForm] = Form.useForm();
  const [tplForm] = Form.useForm();
  const [leaveForm] = Form.useForm();
  const [shiftForm] = Form.useForm();
  const [assignForm] = Form.useForm();
  const [resourceForm] = Form.useForm();
  const [resourceOpen, setResourceOpen] = useState(false);
  const [editingResource, setEditingResource] = useState<ResourceItem | null>(null);
  const [deleteTarget, setDeleteTarget] = useState<ResourceItem | null>(null);
  const [migrateResourceTo, setMigrateResourceTo] = useState<string | undefined>();
  const [equipmentForm] = Form.useForm();
  const [equipmentOpen, setEquipmentOpen] = useState(false);
  const [editingEquipment, setEditingEquipment] = useState<EquipmentItem | null>(null);
  const [deleteEquipmentTarget, setDeleteEquipmentTarget] = useState<EquipmentItem | null>(null);
  const [migrateEquipmentTo, setMigrateEquipmentTo] = useState<string | undefined>();
  const [skillForm] = Form.useForm();
  const [skillOpen, setSkillOpen] = useState(false);
  const [editingSkill, setEditingSkill] = useState<SkillItem | null>(null);
  const [deleteSkillTarget, setDeleteSkillTarget] = useState<SkillItem | null>(null);
  const [migrateSkillTo, setMigrateSkillTo] = useState<string | undefined>();
  const [skillFilter, setSkillFilter] = useState<string | undefined>();
  const [resourceFilter, setResourceFilter] = useState<string | undefined>();
  const [keyword, setKeyword] = useState("");
  const [shiftKeyword, setShiftKeyword] = useState("");
  const [shiftStatusFilter, setShiftStatusFilter] = useState<string | undefined>("active");
  const [activeTab, setActiveTab] = useState<MasterTabKey>("shifts");
  /** 配置指引展开态；首次按主数据是否配齐决定默认开/关 */
  const [guideOpen, setGuideOpen] = useState(true);
  const tabInitialized = useRef(false);
  const guideInitialized = useRef(false);

  const bumpRoster = () => setRosterNonce((n) => n + 1);
  const persons = useMemo(() => {
    let rows = data?.persons ?? [];
    if (skillFilter) rows = rows.filter((p) => p.skill_ids?.includes(skillFilter));
    if (resourceFilter) rows = rows.filter((p) => p.resource_id === resourceFilter);
    const kw = keyword.trim().toLowerCase();
    if (kw) {
      rows = rows.filter(
        (p) => p.name.toLowerCase().includes(kw) || p.code.toLowerCase().includes(kw),
      );
    }
    return rows;
  }, [data?.persons, skillFilter, resourceFilter, keyword]);

  const resourceRows = useMemo(() => {
    return [...(data?.resources ?? [])].sort(
      (a, b) => (a.sort ?? 999) - (b.sort ?? 999) || (a.name || "").localeCompare(b.name || ""),
    );
  }, [data?.resources]);

  const activeResourceOptions = useMemo(
    () =>
      resourceRows
        .filter((r) => r.status !== "disabled")
        .map((r) => ({ value: r.id, label: `${r.name}${r.code ? `（${r.code}）` : ""}` })),
    [resourceRows],
  );

  const equipmentRows = useMemo(() => {
    return [...(data?.equipments ?? [])].sort(
      (a, b) => (a.sort ?? 999) - (b.sort ?? 999) || (a.name || "").localeCompare(b.name || ""),
    );
  }, [data?.equipments]);

  const skillRows = useMemo(() => {
    return [...(data?.skills ?? [])].sort(
      (a, b) =>
        ((a as SkillItem).sort ?? 999) - ((b as SkillItem).sort ?? 999) ||
        (a.name || "").localeCompare(b.name || ""),
    ) as SkillItem[];
  }, [data?.skills]);

  const activeSkillOptions = useMemo(
    () =>
      skillRows
        .filter((s) => s.status !== "disabled")
        .map((s) => ({
          value: s.id,
          label: `${s.name}${s.code ? `（${s.code}）` : ""}`,
        })),
    [skillRows],
  );

  const activeEquipmentOptions = useMemo(
    () =>
      equipmentRows
        .filter((e) => e.status !== "disabled")
        .map((e) => ({
          value: e.id,
          label: `${e.name}${e.code ? `（${e.code}）` : ""}${e.is_shared ? " · 公共" : ""}`,
        })),
    [equipmentRows],
  );

  const shiftRows = useMemo(() => {
    const map = new Map<string, ShiftItem>();
    for (const s of data?.shifts ?? []) {
      if (s.status === "superseded") continue;
      const prev = map.get(s.family_id);
      if (!prev || (s.version || 0) > (prev.version || 0)) map.set(s.family_id, s);
    }
    return [...map.values()].sort(
      (a, b) =>
        (a.sort_order ?? 999) - (b.sort_order ?? 999) ||
        (a.start_time || "").localeCompare(b.start_time || "") ||
        (a.name || "").localeCompare(b.name || ""),
    );
  }, [data?.shifts]);

  const filteredShiftRows = useMemo(() => {
    let rows = shiftRows;
    const kw = shiftKeyword.trim().toLowerCase();
    if (kw) {
      rows = rows.filter(
        (s) =>
          (s.code || "").toLowerCase().includes(kw) ||
          (s.name || "").toLowerCase().includes(kw) ||
          (s.time_label || "").toLowerCase().includes(kw) ||
          `${s.start_time || ""}–${s.end_time || ""}`.toLowerCase().includes(kw),
      );
    }
    if (shiftStatusFilter) {
      rows = rows.filter((s) => (s.lifecycle || s.status) === shiftStatusFilter);
    }
    return rows;
  }, [shiftRows, shiftKeyword, shiftStatusFilter]);

  const activeShifts = useMemo(() => {
    const opts = data?.shift_options ?? data?.shifts?.filter((s) => s.status === "active") ?? [];
    return opts;
  }, [data?.shift_options, data?.shifts]);

  const setupDone = useMemo(() => {
    const activeShiftFamilies = new Set(
      (data?.shifts ?? [])
        .filter((s) => s.status === "active" && s.family_id)
        .map((s) => s.family_id),
    );
    const activeResources = (data?.resources ?? []).filter((r) => r.status !== "disabled");
    const activeSkills = (data?.skills ?? []).filter(
      (s) => (s as SkillItem).status !== "disabled",
    );
    const activeEquipments = (data?.equipments ?? []).filter((e) => e.status === "active");
    const activePersons = (data?.persons ?? []).filter((p) => p.status !== "disabled");
    const activeTemplates = (data?.templates ?? []).filter((t) => t.status === "active");
    return {
      shifts: activeShiftFamilies.size > 0,
      resources: activeResources.length > 0,
      skills: activeSkills.length > 0,
      equipments: activeEquipments.length > 0,
      persons: activePersons.length > 0,
      templates: activeTemplates.length > 0,
      /** 排班：有任职或请假即视为已开始用；亦或前五步全齐 */
      roster:
        (data?.shift_assignments?.length ?? 0) > 0 ||
        (data?.leaves?.length ?? 0) > 0 ||
        false,
    } as Record<MasterTabKey, boolean>;
  }, [data]);

  const masterSetupComplete = useMemo(
    () =>
      setupDone.shifts &&
      setupDone.resources &&
      setupDone.skills &&
      setupDone.equipments &&
      setupDone.persons &&
      setupDone.templates,
    [setupDone],
  );

  const firstIncompleteTab = useMemo(() => {
    for (const key of MASTER_TAB_ORDER) {
      if (key === "roster") continue;
      if (!setupDone[key]) return key;
    }
    return null;
  }, [setupDone]);

  useEffect(() => {
    if (!data || tabInitialized.current) return;
    tabInitialized.current = true;
    if (firstIncompleteTab) {
      setActiveTab(firstIncompleteTab);
    } else {
      setActiveTab("roster");
    }
  }, [data, firstIncompleteTab]);

  useEffect(() => {
    if (!data || guideInitialized.current) return;
    guideInitialized.current = true;
    // 主数据已齐默认收起；未齐默认展开
    setGuideOpen(!masterSetupComplete);
  }, [data, masterSetupComplete]);

  const goTab = (key: MasterTabKey) => setActiveTab(key);

  const tabGuideProps = (key: MasterTabKey) => {
    const meta = SETUP_STEP_META.find((s) => s.key === key)!;
    return {
      purpose: meta.purpose,
      nextLabel: meta.nextKey ? meta.nextLabel : undefined,
      onNext: meta.nextKey ? () => goTab(meta.nextKey!) : undefined,
    };
  };

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

  const masterOverview = useMemo(() => {
    const shiftNames = shiftRows
      .filter((s) => s.status !== "disabled" && (s.lifecycle ?? s.status) !== "expired")
      .map((s) => s.name);
    const resourceNames = [...(data?.resources ?? [])]
      .filter((r) => r.status !== "disabled")
      .sort(bySortName)
      .map((r) => r.name);
    const skillNames = [...(data?.skills ?? [])]
      .filter((s) => s.status !== "disabled")
      .sort(bySortName)
      .map((s) => s.name);
    const templateNames = (data?.templates ?? [])
      .filter((t) => t.status === "active")
      .map((t) => t.name);
    const persons = data?.persons ?? [];
    const onDuty = persons.filter((p) => p.status === "active").length;
    const leaveCount = new Set(
      leaves.filter((lv) => lv.status !== "closed" && lv.person_id).map((lv) => lv.person_id),
    ).size;
    const equipments = data?.equipments ?? [];
    const activeEquipments = equipments.filter((e) => e.status === "active").length;
    const sharedEquipments = equipments.filter((e) => e.status === "active" && !e.resource_id).length;
    return {
      shiftNames,
      resourceNames,
      skillNames,
      templateNames,
      equipment: {
        total: equipments.length,
        active: activeEquipments,
        shared: sharedEquipments,
      },
      persons: {
        total: persons.length,
        onDuty,
        leave: leaveCount,
      },
    };
  }, [data, leaves, shiftRows]);

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

  const { mutate: saveResource, loading: savingResource } = useMutation(
    async (values: Record<string, unknown>) => {
      const payload = {
        name: String(values.name || ""),
        code: String(values.code || ""),
        status: String(values.status || "active"),
        sort: values.sort == null ? undefined : Number(values.sort),
      };
      if (editingResource) return updateResource(editingResource.id, payload);
      return createResource(payload);
    },
    {
      successMessage: () => (editingResource ? "班组已更新" : "班组已新增"),
      onSuccess: async () => {
        setResourceOpen(false);
        setEditingResource(null);
        resourceForm.resetFields();
        await refresh();
      },
    },
  );

  const { mutate: saveEquipment, loading: savingEquipment } = useMutation(
    async (values: Record<string, unknown>) => {
      const payload = {
        name: String(values.name || ""),
        code: String(values.code || ""),
        status: String(values.status || "active"),
        sort: values.sort == null ? undefined : Number(values.sort),
        resource_id: (values.resource_id as string | undefined) || null,
      };
      if (editingEquipment) return updateEquipment(editingEquipment.id, payload);
      return createEquipment(payload);
    },
    {
      successMessage: () => (editingEquipment ? "设备已更新" : "设备已新增"),
      onSuccess: async () => {
        setEquipmentOpen(false);
        setEditingEquipment(null);
        equipmentForm.resetFields();
        await refresh();
      },
    },
  );

  const { mutate: saveSkill, loading: savingSkill } = useMutation(
    async (values: Record<string, unknown>) => {
      const payload = {
        name: String(values.name || ""),
        code: String(values.code || ""),
        status: String(values.status || "active"),
        sort: values.sort == null ? undefined : Number(values.sort),
      };
      if (editingSkill) return updateSkill(editingSkill.id, payload);
      return createSkill(payload);
    },
    {
      successMessage: () => (editingSkill ? "技能已更新" : "技能已新增"),
      onSuccess: async () => {
        setSkillOpen(false);
        setEditingSkill(null);
        skillForm.resetFields();
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

  const { mutate: moveShiftOrder, loading: reorderingShift } = useMutation(
    async (args: { familyId: string; direction: "up" | "down" }) => {
      const activeOrdered = shiftRows
        .filter((s) => s.status !== "disabled")
        .map((s) => s.family_id);
      const idx = activeOrdered.indexOf(args.familyId);
      if (idx < 0) return null;
      const swapWith = args.direction === "up" ? idx - 1 : idx + 1;
      if (swapWith < 0 || swapWith >= activeOrdered.length) return null;
      const next = [...activeOrdered];
      [next[idx], next[swapWith]] = [next[swapWith], next[idx]];
      return reorderShifts(next);
    },
    {
      successMessage: "班序已更新（甘特段序与排产同步）",
      onSuccess: () => {
        void refresh();
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
      belong_day_rule?: "start_day" | "previous_day";
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
        belong_day_rule: values.belong_day_rule || "start_day",
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
        editingShiftFamily ? "同班改时段已生效，旧版已归档" : "已增加一种班",
      onSuccess: async () => {
        setShiftOpen(false);
        setEditingShiftFamily(null);
        shiftForm.resetFields();
        await refresh();
      },
    },
  );

  const { mutate: removeShift, loading: removingShift } = useMutation(
    (args: { familyId: string; migrateTo?: string | null }) =>
      disableShiftFamily(args.familyId, args.migrateTo),
    {
      successMessage: (res) => {
        const parts = ["班次已停用"];
        if (res.migrated_op_count > 0) {
          parts.push(`工序切换 ${res.migrated_op_count} 道`);
        }
        if (res.migrated_assignment_count > 0) {
          parts.push(`排班任职切换 ${res.migrated_assignment_count} 条`);
        } else if ((res.closed_assignment_count || 0) > 0) {
          parts.push(`已结束旧任职 ${res.closed_assignment_count} 条（未选替换目标）`);
        }
        return parts.join("，");
      },
      onSuccess: async () => {
        setDisableTarget(null);
        setDisableUsage(null);
        setMigrateTo(undefined);
        await refresh();
        bumpRoster();
      },
    },
  );

  const openDisableShift = async (row: ShiftItem) => {
    setDisableTarget(row);
    setDisableUsage(null);
    setMigrateTo(undefined);
    setUsageLoading(true);
    try {
      const usage = await fetchShiftUsage(row.family_id);
      setDisableUsage(usage);
      // 有占用时默认选中第一个目标，避免漏选导致排班仍挂旧班
      if (usage.migrate_targets.length > 0 && (usage.suggest_migrate || usage.requires_migrate)) {
        setMigrateTo(usage.migrate_targets[0].family_id);
      }
    } catch (e) {
      message.error(e instanceof Error ? e.message : "加载占用失败");
      setDisableTarget(null);
    } finally {
      setUsageLoading(false);
    }
  };

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
        bumpRoster();
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
        bumpRoster();
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
        bumpRoster();
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
            const defaultShifts =
              (data?.shift_options ?? []).map((s) => s.family_id).filter(Boolean).length > 0
                ? (data?.shift_options ?? []).map((s) => s.family_id)
                : ["sh-day", "sh-mid", "sh-night"];
            personForm.setFieldsValue({
              status: "active",
              skill_ids: [],
              shift_family_ids: defaultShifts,
              resource_id: activeResourceOptions[0]?.value,
            });
            setPersonOpen(true);
          }}
        >
          ＋ 新增人员
        </Button>
      );
    }
    if (activeTab === "resources") {
      return (
        <Button
          type="primary"
          onClick={() => {
            setEditingResource(null);
            resourceForm.resetFields();
            resourceForm.setFieldsValue({ status: "active", sort: (resourceRows.length + 1) * 10 });
            setResourceOpen(true);
          }}
        >
          ＋ 新增班组
        </Button>
      );
    }
    if (activeTab === "skills") {
      return (
        <Button
          type="primary"
          onClick={() => {
            setEditingSkill(null);
            skillForm.resetFields();
            skillForm.setFieldsValue({ status: "active", sort: (skillRows.length + 1) * 10 });
            setSkillOpen(true);
          }}
        >
          ＋ 新增技能
        </Button>
      );
    }
    if (activeTab === "equipments") {
      return (
        <Button
          type="primary"
          onClick={() => {
            setEditingEquipment(null);
            equipmentForm.resetFields();
            equipmentForm.setFieldsValue({
              status: "active",
              sort: (equipmentRows.length + 1) * 10,
              resource_id: activeResourceOptions[0]?.value,
            });
            setEquipmentOpen(true);
          }}
        >
          ＋ 新增设备
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
        <Button
          type="primary"
          onClick={() => {
            setEditingShiftFamily(null);
            shiftForm.resetFields();
            shiftForm.setFieldsValue({
              start_time: "08:00",
              end_time: "16:00",
              crosses_midnight: false,
              belong_day_rule: "start_day",
              effective_from: dayjs(),
            });
            setShiftOpen(true);
          }}
        >
          ＋ 增加一种班
        </Button>
      );
    }
    // roster
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
          登记任职区间
        </Button>
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
      </Space>
    );
  })();

  return (
    <div>
      <PageHeader
        title="基础数据"
        subtitle="本页维护「能排什么」；具体哪天谁干哪单、占哪台机，请到「排产甘特」。"
        extra={headerExtra}
      />
      {loading && !data ? (
        <div style={{ marginBottom: 16 }}>
          <Row gutter={[OVERVIEW_CARD_GAP, OVERVIEW_CARD_GAP]} wrap>
            {[1, 2, 3, 4, 5].map((k) => (
              <Col key={k} xs={24} sm={12} lg={{ flex: "1 1 0" }} style={{ minWidth: 0 }}>
                <Card size="small" style={{ background: "#fff", boxShadow: "0 1px 4px rgba(0,0,0,0.06)" }}>
                  <Skeleton active paragraph={{ rows: 3 }} />
                </Card>
              </Col>
            ))}
          </Row>
          <Card size="small" style={{ marginTop: OVERVIEW_CARD_GAP, boxShadow: "0 1px 4px rgba(0,0,0,0.06)" }}>
            <Skeleton active paragraph={{ rows: 1 }} />
          </Card>
        </div>
      ) : (
        <MasterOverviewPanel data={masterOverview} activeKey={activeTab} onPick={goTab} />
      )}

      {guideOpen ? (
        <Alert
          type="warning"
          showIcon
          style={{ marginBottom: 12 }}
          message="建议配置顺序（建厂先走完主数据，再进排班）"
          description={
            <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
              <Space wrap size={[8, 8]}>
                {SETUP_STEP_META.map((step, idx) => {
                  const done = setupDone[step.key];
                  const isMaster = step.key !== "roster";
                  const current = activeTab === step.key;
                  return (
                    <Button
                      key={step.key}
                      size="small"
                      type={current ? "primary" : done ? "default" : "dashed"}
                      icon={done && isMaster ? <CheckCircleOutlined /> : undefined}
                      onClick={() => goTab(step.key)}
                    >
                      {idx + 1} {step.label}
                      {done && isMaster ? " ✓" : ""}
                    </Button>
                  );
                })}
              </Space>
              <span style={{ fontSize: 12, color: "#718096" }}>
                ①班制 → ②班组 → ③技能 → ④设备 → ⑤人员 → ⑥工序模板 → ⑦排班。点上方按钮可跳转；随时可收起本指引。
              </span>
            </div>
          }
          action={
            <Space direction="vertical" size={4}>
              {firstIncompleteTab ? (
                <Button size="small" type="primary" onClick={() => goTab(firstIncompleteTab)}>
                  继续：{SETUP_STEP_META.find((s) => s.key === firstIncompleteTab)?.label}
                </Button>
              ) : null}
              <Button size="small" type="link" onClick={() => setGuideOpen(false)}>
                暂时隐藏
              </Button>
            </Space>
          }
        />
      ) : (
        <div
          style={{
            marginBottom: 12,
            fontSize: 12,
            color: "#718096",
            display: "flex",
            alignItems: "center",
            gap: 8,
            flexWrap: "wrap",
          }}
        >
          {masterSetupComplete ? (
            <CheckCircleOutlined style={{ color: "#52c41a" }} />
          ) : null}
          <span>
            {masterSetupComplete
              ? "主数据已就绪。日常请用「排班」；改工艺/机台再回到对应页。"
              : "配置指引已隐藏。可随时重新打开。"}
          </span>
          <Button size="small" type="link" onClick={() => setGuideOpen(true)}>
            查看配置指引
          </Button>
        </div>
      )}

      <Tabs
        activeKey={activeTab}
        onChange={(k) => setActiveTab(k as MasterTabKey)}
        items={[
          {
            key: "roster",
            label: "排班",
            children: (
              <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>
                <TabGuide {...tabGuideProps("roster")} />
                {!masterSetupComplete ? (
                  <Alert
                    type="warning"
                    showIcon
                    message="主数据尚未配齐，建议先完成班制→班组→技能→设备→人员→工序模板"
                    action={
                      firstIncompleteTab ? (
                        <Button size="small" type="link" onClick={() => goTab(firstIncompleteTab)}>
                          去配置
                        </Button>
                      ) : undefined
                    }
                  />
                ) : null}
                <RosterWeekPanel
                  key={rosterNonce}
                  persons={data?.persons ?? []}
                  onOpenLeave={(leaveId) => {
                    const lv = leaves.find((l) => l.id === leaveId);
                    if (lv) {
                      setLeaveDetail(lv);
                      setReassignPick({});
                    }
                  }}
                  onRosterChanged={() => void refresh()}
                />
                <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 16 }}>
                  <DataTable<LeaveItem>
                    rowKey="id"
                    loading={loading}
                    dataSource={leaves}
                    title={() => (
                      <div>
                        <span style={{ fontWeight: 600 }}>请假</span>
                        <div style={{ fontSize: 12, color: "#718096", fontWeight: 400, marginTop: 2 }}>
                          自然日请假：夜班挡的是「假日凌晨」那班（挂牌前一日），详见「登记请假」说明。
                        </div>
                      </div>
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
              </div>
            ),
          },
          {
            key: "resources",
            label: "班组",
            children: (
              <div>
                <TabGuide {...tabGuideProps("resources")} />
                {!setupDone.shifts ? (
                  <Alert
                    type="warning"
                    showIcon
                    style={{ marginBottom: 12 }}
                    message="建议先配置班制，再维护班组"
                    action={
                      <Button size="small" type="link" onClick={() => goTab("shifts")}>
                        去班制
                      </Button>
                    }
                  />
                ) : null}
                {!resourceRows.length && !loading ? (
                  <Alert
                    type="info"
                    showIcon
                    style={{ marginBottom: 12 }}
                    message="还没有班组"
                    description="先增加装配/焊接等班组，再在「人员」「设备」里挂靠。"
                    action={
                      <Button
                        size="small"
                        type="primary"
                        onClick={() => {
                          setEditingResource(null);
                          resourceForm.resetFields();
                          resourceForm.setFieldsValue({
                            status: "active",
                            sort: 10,
                          });
                          setResourceOpen(true);
                        }}
                      >
                        新增班组
                      </Button>
                    }
                  />
                ) : null}
              <DataTable<ResourceItem>
                rowKey="id"
                loading={loading}
                dataSource={resourceRows}
                title={() => (
                  <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
                    <span style={{ fontWeight: 600 }}>班组管理</span>
                    <span style={{ fontSize: 12, color: "#718096" }}>
                      维护班组后，在「人员」里选择所属班组；删除班组时若仍有人员须先迁出。
                    </span>
                  </div>
                )}
                columns={[
                  { title: "名称", dataIndex: "name" },
                  { title: "编码", dataIndex: "code", width: 120 },
                  {
                    title: "人数",
                    dataIndex: "member_count",
                    width: 80,
                    render: (n: number | undefined) => n ?? 0,
                  },
                  {
                    title: "排序",
                    dataIndex: "sort",
                    width: 80,
                  },
                  {
                    title: "状态",
                    dataIndex: "status",
                    width: 100,
                    render: (v: string) => (
                      <StatusTag
                        value={v}
                        labelMap={{ active: "启用", disabled: "停用" }}
                        colorMap={{ active: "green", disabled: "default" }}
                      />
                    ),
                  },
                  {
                    title: "操作",
                    width: 120,
                    render: (_, row) => (
                      <Space size={4}>
                        <Tooltip title="编辑">
                          <Button
                            type="link"
                            size="small"
                            aria-label="编辑"
                            icon={<EditOutlined />}
                            onClick={() => {
                              setEditingResource(row);
                              resourceForm.setFieldsValue(row);
                              setResourceOpen(true);
                            }}
                          />
                        </Tooltip>
                        <DeleteAction
                          successMessage={false}
                          onConfirm={async () => {
                            if ((row.member_count ?? 0) > 0) {
                              setDeleteTarget(row);
                              setMigrateResourceTo(undefined);
                              return;
                            }
                            await deleteResource(row.id);
                            message.success("班组已删除");
                            await refresh();
                          }}
                        />
                      </Space>
                    ),
                  },
                ]}
              />
              </div>
            ),
          },
          {
            key: "skills",
            label: "技能",
            children: (
              <div>
                <TabGuide {...tabGuideProps("skills")} />
                {!skillRows.length && !loading ? (
                  <Alert
                    type="info"
                    showIcon
                    style={{ marginBottom: 12 }}
                    message="还没有技能"
                    description="先增加焊接、装配等技能，再在人员与工序模板里引用。"
                    action={
                      <Button
                        size="small"
                        type="primary"
                        onClick={() => {
                          setEditingSkill(null);
                          skillForm.resetFields();
                          skillForm.setFieldsValue({ status: "active", sort: 10 });
                          setSkillOpen(true);
                        }}
                      >
                        新增技能
                      </Button>
                    }
                  />
                ) : null}
                <DataTable<SkillItem>
                  rowKey="id"
                  loading={loading}
                  dataSource={skillRows}
                  title={() => (
                    <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
                      <span style={{ fontWeight: 600 }}>技能字典</span>
                      <span style={{ fontSize: 12, color: "#718096" }}>
                        人员勾选「会什么」、工序模板声明「需要什么」。删除时若仍有引用须先迁移。
                      </span>
                    </div>
                  )}
                  columns={[
                    { title: "名称", dataIndex: "name" },
                    { title: "编码", dataIndex: "code", width: 120 },
                    {
                      title: "人员",
                      dataIndex: "person_count",
                      width: 80,
                      render: (n: number | undefined) => n ?? 0,
                    },
                    {
                      title: "模板",
                      dataIndex: "template_count",
                      width: 80,
                      render: (n: number | undefined) => n ?? 0,
                    },
                    { title: "排序", dataIndex: "sort", width: 80 },
                    {
                      title: "状态",
                      dataIndex: "status",
                      width: 100,
                      render: (v: string) => (
                        <StatusTag
                          value={v || "active"}
                          labelMap={{ active: "启用", disabled: "停用" }}
                          colorMap={{ active: "green", disabled: "default" }}
                        />
                      ),
                    },
                    {
                      title: "操作",
                      width: 120,
                      render: (_, row) => (
                        <Space size={4}>
                          <Tooltip title="编辑">
                            <Button
                              type="link"
                              size="small"
                              aria-label="编辑"
                              icon={<EditOutlined />}
                              onClick={() => {
                                setEditingSkill(row);
                                skillForm.setFieldsValue(row);
                                setSkillOpen(true);
                              }}
                            />
                          </Tooltip>
                          <DeleteAction
                            successMessage={false}
                            onConfirm={async () => {
                              const refs =
                                (row.person_count ?? 0) + (row.template_count ?? 0);
                              if (refs > 0) {
                                setDeleteSkillTarget(row);
                                setMigrateSkillTo(undefined);
                                return;
                              }
                              await deleteSkill(row.id);
                              message.success("技能已删除");
                              await refresh();
                            }}
                          />
                        </Space>
                      ),
                    },
                  ]}
                />
              </div>
            ),
          },
          {
            key: "equipments",
            label: "设备",
            children: (
              <div>
                <TabGuide {...tabGuideProps("equipments")} />
                {!setupDone.resources ? (
                  <Alert
                    type="warning"
                    showIcon
                    style={{ marginBottom: 12 }}
                    message="建议先有班组，再挂设备（公共设备可跳过）"
                    action={
                      <Button size="small" type="link" onClick={() => goTab("resources")}>
                        去班组
                      </Button>
                    }
                  />
                ) : null}
                {!equipmentRows.length && !loading ? (
                  <Alert
                    type="info"
                    showIcon
                    style={{ marginBottom: 12 }}
                    message="还没有设备"
                    description="先登记焊机/工位等，再在工序模板里绑设备池。"
                    action={
                      <Button
                        size="small"
                        type="primary"
                        onClick={() => {
                          setEditingEquipment(null);
                          equipmentForm.resetFields();
                          equipmentForm.setFieldsValue({
                            status: "active",
                            sort: 10,
                            resource_id: activeResourceOptions[0]?.value,
                          });
                          setEquipmentOpen(true);
                        }}
                      >
                        新增设备
                      </Button>
                    }
                  />
                ) : null}
              <DataTable<EquipmentItem>
                rowKey="id"
                loading={loading}
                dataSource={equipmentRows}
                title={() => (
                  <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
                    <span style={{ fontWeight: 600 }}>设备台账</span>
                    <span style={{ fontSize: 12, color: "#718096" }}>
                      各班共用。可挂班组或留空表示公共设备；工序模板绑定设备池，甘特排产时选具体机台。
                    </span>
                  </div>
                )}
                columns={[
                  { title: "名称", dataIndex: "name" },
                  { title: "编码", dataIndex: "code", width: 120 },
                  {
                    title: "所属班组",
                    dataIndex: "resource_name",
                    width: 140,
                    render: (v: string | null | undefined, row) =>
                      row.is_shared || !v ? (
                        <Tag>公共</Tag>
                      ) : (
                        v
                      ),
                  },
                  {
                    title: "占用工序",
                    dataIndex: "op_count",
                    width: 90,
                    render: (n: number | undefined) => n ?? 0,
                  },
                  { title: "排序", dataIndex: "sort", width: 80 },
                  {
                    title: "状态",
                    dataIndex: "status",
                    width: 100,
                    render: (v: string) => (
                      <StatusTag
                        value={v}
                        labelMap={{ active: "启用", disabled: "停用" }}
                        colorMap={{ active: "green", disabled: "default" }}
                      />
                    ),
                  },
                  {
                    title: "操作",
                    width: 120,
                    render: (_, row) => (
                      <Space size={4}>
                        <Tooltip title="编辑">
                          <Button
                            type="link"
                            size="small"
                            aria-label="编辑"
                            icon={<EditOutlined />}
                            onClick={() => {
                              setEditingEquipment(row);
                              equipmentForm.setFieldsValue(row);
                              setEquipmentOpen(true);
                            }}
                          />
                        </Tooltip>
                        <DeleteAction
                          successMessage={false}
                          onConfirm={async () => {
                            if ((row.op_count ?? 0) > 0) {
                              setDeleteEquipmentTarget(row);
                              setMigrateEquipmentTo(undefined);
                              return;
                            }
                            await deleteEquipment(row.id);
                            message.success("设备已删除");
                            await refresh();
                          }}
                        />
                      </Space>
                    ),
                  },
                ]}
              />
              </div>
            ),
          },
          {
            key: "persons",
            label: "人员",
            children: (
              <div>
                <TabGuide {...tabGuideProps("persons")} />
                {!setupDone.resources ? (
                  <Alert
                    type="warning"
                    showIcon
                    style={{ marginBottom: 12 }}
                    message="请先创建班组，再新增人员并选择所属班组"
                    action={
                      <Button size="small" type="link" onClick={() => goTab("resources")}>
                        去班组
                      </Button>
                    }
                  />
                ) : null}
                {!setupDone.shifts ? (
                  <Alert
                    type="warning"
                    showIcon
                    style={{ marginBottom: 12 }}
                    message="请先配置班制，以便为人员勾选可上班次"
                    action={
                      <Button size="small" type="link" onClick={() => goTab("shifts")}>
                        去班制
                      </Button>
                    }
                  />
                ) : null}
                {!setupDone.skills ? (
                  <Alert
                    type="warning"
                    showIcon
                    style={{ marginBottom: 12 }}
                    message="请先维护技能字典，再为人员勾选技能"
                    action={
                      <Button size="small" type="link" onClick={() => goTab("skills")}>
                        去技能
                      </Button>
                    }
                  />
                ) : null}
              <DataTable<PersonItem>
                rowKey="id"
                loading={loading}
                dataSource={persons}
                title={() => (
                  <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
                    <Space wrap>
                      <span style={{ fontWeight: 600 }}>人员 · 班组 · 技能 · 可上班次</span>
                      <Input
                        allowClear
                        placeholder="搜索姓名 / 工号"
                        style={{ width: 160 }}
                        value={keyword}
                        onChange={(e) => setKeyword(e.target.value)}
                      />
                      <Select
                        allowClear
                        placeholder="全部班组"
                        style={{ width: 160 }}
                        value={resourceFilter}
                        onChange={setResourceFilter}
                        options={resourceRows.map((r) => ({ value: r.id, label: r.name }))}
                      />
                      <Select
                        allowClear
                        placeholder="全部技能"
                        style={{ width: 140 }}
                        value={skillFilter}
                        onChange={setSkillFilter}
                        options={skillRows.map((s) => ({ value: s.id, label: s.name }))}
                      />
                    </Space>
                    <span style={{ fontSize: 12, color: "#718096" }}>
                      「所属班组」在「班组」页维护；技能在「技能」页维护；「可上班次」= 能力；「今日当班 / 本周」来自排班周历。
                    </span>
                  </div>
                )}
                columns={[
                  { title: "姓名", dataIndex: "name" },
                  { title: "工号", dataIndex: "code" },
                  {
                    title: "所属班组",
                    dataIndex: "resource_name",
                    width: 120,
                    render: (v: string | null | undefined) =>
                      v || <span style={{ color: "#a0aec0" }}>未分配</span>,
                  },
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
                    title: "今日当班",
                    key: "today_roster",
                    width: 120,
                    render: (_, r) => {
                      const t = r.today_roster;
                      if (!t || t.kind === "empty") {
                        return <span style={{ color: "#a0aec0" }}>未排</span>;
                      }
                      if (t.kind === "leave") {
                        return (
                          <Tooltip title={t.leave_reason || "请假"}>
                            <Tag color="orange" style={{ margin: 0 }}>
                              假
                            </Tag>
                          </Tooltip>
                        );
                      }
                      return (
                        <div>
                          <div>{t.shift_name || t.label}</div>
                          <div style={{ fontSize: 12, color: "#718096" }}>
                            {(t.day || "").slice(5)}
                          </div>
                        </div>
                      );
                    },
                  },
                  {
                    title: "本周",
                    key: "week_roster_labels",
                    width: 150,
                    render: (_, r) => {
                      const labels = r.week_roster_labels;
                      if (!labels?.length) {
                        return <span style={{ color: "#a0aec0" }}>—</span>;
                      }
                      return (
                        <Tooltip title="周一～周日（排班周历）">
                          <span style={{ fontFamily: "ui-monospace, monospace", fontSize: 12, letterSpacing: 1 }}>
                            {labels.join(" ")}
                          </span>
                        </Tooltip>
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
              </div>
            ),
          },
          {
            key: "shifts",
            label: "班制",
            children: (
              <div>
                <TabGuide {...tabGuideProps("shifts")} />
                {!shiftRows.length && !loading ? (
                  <Alert
                    type="info"
                    showIcon
                    style={{ marginBottom: 12 }}
                    message="从这里开始：先增加一种班"
                    description="例如白班 08:00–16:00。配好班制后再建班组、设备和人员。"
                    action={
                      <Button
                        size="small"
                        type="primary"
                        onClick={() => {
                          setEditingShiftFamily(null);
                          shiftForm.resetFields();
                          shiftForm.setFieldsValue({
                            start_time: "08:00",
                            end_time: "16:00",
                            crosses_midnight: false,
                            belong_day_rule: "start_day",
                            effective_from: dayjs(),
                          });
                          setShiftOpen(true);
                        }}
                      >
                        增加一种班
                      </Button>
                    }
                  />
                ) : null}
              <DataTable<ShiftItem>
                rowKey="id"
                loading={loading || removingShift}
                dataSource={filteredShiftRows}
                title={() => (
                  <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
                    <div style={{ display: "flex", flexDirection: "column", gap: 4 }}>
                      <span style={{ fontWeight: 600 }}>班制 · 一班/二班/三班都可，时段可长可短</span>
                      <span style={{ fontSize: 12, color: "#718096", fontWeight: 400 }}>
                        「同班改时段」= 还是这个班，只改起止时间；「增加一种班」= 多一种并列的班。不要的旧班：先增加目标班 → 停用并一键切换。
                        班序决定甘特段序；「归属日」决定挂牌/统计进哪一天——跨午夜常用「开班日」，凌晨接续班用「前一日」才能与首班同一生产日。
                      </span>
                    </div>
                    <Space wrap>
                      <Input
                        allowClear
                        placeholder="搜索编码 / 名称 / 时间"
                        style={{ width: 200 }}
                        value={shiftKeyword}
                        onChange={(e) => setShiftKeyword(e.target.value)}
                      />
                      <Select
                        allowClear
                        placeholder="全部状态"
                        style={{ width: 120 }}
                        value={shiftStatusFilter}
                        onChange={setShiftStatusFilter}
                        options={[
                          { value: "active", label: "生效中" },
                          { value: "upcoming", label: "未生效" },
                          { value: "expired", label: "已过期" },
                          { value: "disabled", label: "停用" },
                        ]}
                      />
                      <span style={{ fontSize: 12, color: "#a0aec0" }}>
                        共 {filteredShiftRows.length} / {shiftRows.length} 种班
                      </span>
                    </Space>
                  </div>
                )}
                columns={[
                  {
                    title: "班序",
                    key: "sort_order",
                    width: 88,
                    render: (_, row) => {
                      const ordered = shiftRows.filter((s) => s.status !== "disabled");
                      const idx = ordered.findIndex((s) => s.family_id === row.family_id);
                      if (row.status === "disabled" || idx < 0) {
                        return <span style={{ color: "#a0aec0" }}>—</span>;
                      }
                      return (
                        <Space size={0}>
                          <span style={{ width: 18, display: "inline-block", color: "#718096" }}>
                            {idx + 1}
                          </span>
                          <Tooltip title="上移（甘特靠左）">
                            <Button
                              type="link"
                              size="small"
                              disabled={idx <= 0 || reorderingShift}
                              icon={<ArrowUpOutlined />}
                              onClick={() =>
                                void moveShiftOrder({ familyId: row.family_id, direction: "up" })
                              }
                            />
                          </Tooltip>
                          <Tooltip title="下移（甘特靠右）">
                            <Button
                              type="link"
                              size="small"
                              disabled={idx >= ordered.length - 1 || reorderingShift}
                              icon={<ArrowDownOutlined />}
                              onClick={() =>
                                void moveShiftOrder({ familyId: row.family_id, direction: "down" })
                              }
                            />
                          </Tooltip>
                        </Space>
                      );
                    },
                  },
                  { title: "编码", dataIndex: "code", width: 90 },
                  { title: "名称", dataIndex: "name", width: 100 },
                  {
                    title: "时间",
                    dataIndex: "time_label",
                    render: (_, r) => (
                      <span>
                        {`${r.start_time || ""}–${r.end_time || ""}`}
                        {r.crosses_midnight ? (
                          <Tag style={{ marginInlineStart: 4 }} color="default">
                            跨日
                          </Tag>
                        ) : null}
                      </span>
                    ),
                  },
                  {
                    title: "归属日",
                    dataIndex: "belong_day_rule",
                    width: 110,
                    render: (_, r) => {
                      const rule = r.belong_day_rule || "start_day";
                      const isPrev = rule === "previous_day";
                      return (
                        <Tooltip
                          title={
                            isPrev
                              ? "挂牌/人数/负荷算前一日（跟首班生产日），适合 01:00–09:00 这类凌晨班"
                              : "挂牌/人数/负荷算开班那天，适合白班与跨午夜中班"
                          }
                        >
                          <Tag color={isPrev ? "purple" : "orange"}>
                            {r.belong_day_label || (isPrev ? "前一日" : "开班日")}
                          </Tag>
                        </Tooltip>
                      );
                    },
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
                    render: (_, r) =>
                      r.effective_to_label || (r.effective_to ? r.effective_to.slice(0, 10) : "至今"),
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
                          <Tooltip title="同班改时段">
                            <Button
                              type="link"
                              size="small"
                              aria-label="同班改时段"
                              icon={<PlusCircleOutlined />}
                              onClick={() => {
                                setEditingShiftFamily(row);
                                shiftForm.setFieldsValue({
                                  code: row.code,
                                  name: row.name,
                                  start_time: row.start_time,
                                  end_time: row.end_time,
                                  crosses_midnight: !!row.crosses_midnight,
                                  belong_day_rule:
                                    row.belong_day_rule === "previous_day"
                                      ? "previous_day"
                                      : "start_day",
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
                            <Button
                              type="link"
                              size="small"
                              danger
                              aria-label="停用"
                              icon={<StopOutlined />}
                              onClick={() => void openDisableShift(row)}
                            />
                          </Tooltip>
                        ) : null}
                      </Space>
                    ),
                  },
                ]}
              />
              </div>
            ),
          },
          {
            key: "templates",
            label: "工序模板",
            children: (
              <div>
                <TabGuide {...tabGuideProps("templates")} />
                {!setupDone.skills ? (
                  <Alert
                    type="warning"
                    showIcon
                    style={{ marginBottom: 12 }}
                    message="请先维护技能字典，再配置模板所需技能"
                    action={
                      <Button size="small" type="link" onClick={() => goTab("skills")}>
                        去技能
                      </Button>
                    }
                  />
                ) : null}
                {!setupDone.persons ? (
                  <Alert
                    type="info"
                    showIcon
                    style={{ marginBottom: 12 }}
                    message="人员尚未配置；模板可先建，派工前请补齐人员技能"
                    action={
                      <Button size="small" type="link" onClick={() => goTab("persons")}>
                        去人员
                      </Button>
                    }
                  />
                ) : null}
                {!setupDone.equipments ? (
                  <Alert
                    type="info"
                    showIcon
                    style={{ marginBottom: 12 }}
                    message="尚无设备台账时，模板可先不绑设备池，后续再补"
                    action={
                      <Button size="small" type="link" onClick={() => goTab("equipments")}>
                        去设备
                      </Button>
                    }
                  />
                ) : null}
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
                  {
                    title: "所需技能",
                    dataIndex: "skill_name",
                  },
                  {
                    title: "设备池",
                    key: "equipment_pool",
                    render: (_, r) =>
                      r.equipment_names?.length ? r.equipment_names.join("、") : "—",
                  },
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
              </div>
            ),
          },
        ].sort(
          (a, b) =>
            MASTER_TAB_ORDER.indexOf(a.key as MasterTabKey) -
            MASTER_TAB_ORDER.indexOf(b.key as MasterTabKey),
        )}
      />
      <FormModal
        title={editingResource ? "编辑班组" : "新增班组"}
        open={resourceOpen}
        form={resourceForm}
        confirmLoading={savingResource}
        onCancel={() => {
          setResourceOpen(false);
          setEditingResource(null);
        }}
        onOk={async () => {
          const values = await resourceForm.validateFields();
          await saveResource(values);
        }}
      >
        <Form.Item name="name" label="名称" rules={[{ required: true, message: "请填写班组名称" }]}>
          <Input placeholder="如：装配一组" />
        </Form.Item>
        <Form.Item name="code" label="编码" rules={[{ required: true, message: "请填写班组编码" }]}>
          <Input placeholder="如：ASM1" />
        </Form.Item>
        <Form.Item name="sort" label="排序">
          <InputNumber min={0} style={{ width: "100%" }} />
        </Form.Item>
        <Form.Item name="status" label="状态" rules={[{ required: true }]}>
          <Select
            options={[
              { value: "active", label: "启用" },
              { value: "disabled", label: "停用" },
            ]}
          />
        </Form.Item>
      </FormModal>

      <Modal
        title="删除班组并迁移人员"
        open={!!deleteTarget}
        okText="迁移并删除"
        okButtonProps={{ danger: true, disabled: !migrateResourceTo }}
        onCancel={() => {
          setDeleteTarget(null);
          setMigrateResourceTo(undefined);
        }}
        onOk={async () => {
          if (!deleteTarget || !migrateResourceTo) return;
          await deleteResource(deleteTarget.id, migrateResourceTo);
          message.success("已迁移人员并删除班组");
          setDeleteTarget(null);
          setMigrateResourceTo(undefined);
          await refresh();
        }}
      >
        <p style={{ marginBottom: 12 }}>
          「{deleteTarget?.name}」下仍有 {deleteTarget?.member_count ?? 0}{" "}
          名人员，请选择迁往的目标班组：
        </p>
        <Select
          style={{ width: "100%" }}
          placeholder="选择目标班组"
          value={migrateResourceTo}
          onChange={setMigrateResourceTo}
          options={activeResourceOptions.filter((o) => o.value !== deleteTarget?.id)}
        />
      </Modal>

      <FormModal
        title={editingSkill ? "编辑技能" : "新增技能"}
        open={skillOpen}
        form={skillForm}
        confirmLoading={savingSkill}
        onCancel={() => {
          setSkillOpen(false);
          setEditingSkill(null);
        }}
        onOk={async () => {
          const values = await skillForm.validateFields();
          await saveSkill(values);
        }}
      >
        <Form.Item name="name" label="名称" rules={[{ required: true, message: "请填写技能名称" }]}>
          <Input placeholder="如：焊接" />
        </Form.Item>
        <Form.Item name="code" label="编码" rules={[{ required: true, message: "请填写技能编码" }]}>
          <Input placeholder="如：WELD" />
        </Form.Item>
        <Form.Item name="sort" label="排序">
          <InputNumber min={0} style={{ width: "100%" }} />
        </Form.Item>
        <Form.Item name="status" label="状态" rules={[{ required: true }]}>
          <Select
            options={[
              { value: "active", label: "启用" },
              { value: "disabled", label: "停用" },
            ]}
          />
        </Form.Item>
      </FormModal>

      <Modal
        title="删除技能并迁移引用"
        open={!!deleteSkillTarget}
        okText="迁移并删除"
        okButtonProps={{ danger: true, disabled: !migrateSkillTo }}
        onCancel={() => {
          setDeleteSkillTarget(null);
          setMigrateSkillTo(undefined);
        }}
        onOk={async () => {
          if (!deleteSkillTarget || !migrateSkillTo) return;
          await deleteSkill(deleteSkillTarget.id, migrateSkillTo);
          message.success("已迁移引用并删除技能");
          setDeleteSkillTarget(null);
          setMigrateSkillTo(undefined);
          await refresh();
        }}
      >
        <p style={{ marginBottom: 12 }}>
          「{deleteSkillTarget?.name}」仍被 {deleteSkillTarget?.person_count ?? 0} 名人员、
          {deleteSkillTarget?.template_count ?? 0} 个模板引用，请选择迁往的目标技能：
        </p>
        <Select
          style={{ width: "100%" }}
          placeholder="选择目标技能"
          value={migrateSkillTo}
          onChange={setMigrateSkillTo}
          options={activeSkillOptions.filter((o) => o.value !== deleteSkillTarget?.id)}
        />
      </Modal>

      <FormModal
        title={editingEquipment ? "编辑设备" : "新增设备"}
        open={equipmentOpen}
        form={equipmentForm}
        confirmLoading={savingEquipment}
        onCancel={() => {
          setEquipmentOpen(false);
          setEditingEquipment(null);
        }}
        onOk={async () => {
          const values = await equipmentForm.validateFields();
          await saveEquipment(values);
        }}
      >
        <Form.Item name="name" label="名称" rules={[{ required: true, message: "请填写设备名称" }]}>
          <Input placeholder="如：焊机1" />
        </Form.Item>
        <Form.Item name="code" label="编码" rules={[{ required: true, message: "请填写设备编码" }]}>
          <Input placeholder="如：WELD-01" />
        </Form.Item>
        <Form.Item
          name="resource_id"
          label="所属班组"
          extra="留空表示公共设备，各班组工序均可选用"
        >
          <Select allowClear placeholder="公共 / 选择班组" options={activeResourceOptions} />
        </Form.Item>
        <Form.Item name="sort" label="排序">
          <InputNumber min={0} style={{ width: "100%" }} />
        </Form.Item>
        <Form.Item name="status" label="状态" rules={[{ required: true }]}>
          <Select
            options={[
              { value: "active", label: "启用" },
              { value: "disabled", label: "停用" },
            ]}
          />
        </Form.Item>
      </FormModal>

      <Modal
        title="删除设备并迁移工序"
        open={!!deleteEquipmentTarget}
        okText="迁移并删除"
        okButtonProps={{ danger: true, disabled: !migrateEquipmentTo }}
        onCancel={() => {
          setDeleteEquipmentTarget(null);
          setMigrateEquipmentTo(undefined);
        }}
        onOk={async () => {
          if (!deleteEquipmentTarget || !migrateEquipmentTo) return;
          await deleteEquipment(deleteEquipmentTarget.id, migrateEquipmentTo);
          message.success("已迁移工序并删除设备");
          setDeleteEquipmentTarget(null);
          setMigrateEquipmentTo(undefined);
          await refresh();
        }}
      >
        <p style={{ marginBottom: 12 }}>
          「{deleteEquipmentTarget?.name}」仍被 {deleteEquipmentTarget?.op_count ?? 0}{" "}
          道工序占用，请选择迁往的目标设备：
        </p>
        <Select
          style={{ width: "100%" }}
          placeholder="选择目标设备"
          value={migrateEquipmentTo}
          onChange={setMigrateEquipmentTo}
          options={activeEquipmentOptions.filter((o) => o.value !== deleteEquipmentTarget?.id)}
        />
      </Modal>

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
        <Form.Item
          name="skill_ids"
          label="技能"
          extra={
            activeSkillOptions.length
              ? "选项来自「技能」页；停用技能不会出现在列表中"
              : "暂无启用技能，请先到「技能」页新增"
          }
        >
          <Select
            mode="multiple"
            optionFilterProp="label"
            options={
              editingPerson?.skill_ids?.length
                ? [
                    ...activeSkillOptions,
                    ...editingPerson.skill_ids
                      .filter((id) => !activeSkillOptions.some((o) => o.value === id))
                      .map((id) => {
                        const sk = skillRows.find((s) => s.id === id);
                        return {
                          value: id,
                          label: `${sk?.name || id}${sk?.status === "disabled" ? "（已停用）" : ""}`,
                        };
                      }),
                  ]
                : activeSkillOptions
            }
          />
        </Form.Item>
        <Form.Item
          name="resource_id"
          label="所属班组"
          extra={
            activeResourceOptions.length
              ? undefined
              : "暂无启用班组，请先到「班组」页新增"
          }
        >
          <Select
            allowClear
            placeholder="请选择班组"
            options={
              // 编辑时若当前班组已停用，仍展示当前项，避免空白
              editingPerson?.resource_id &&
              !activeResourceOptions.some((o) => o.value === editingPerson.resource_id)
                ? [
                    {
                      value: editingPerson.resource_id,
                      label: `${editingPerson.resource_name || editingPerson.resource_id}（已停用）`,
                    },
                    ...activeResourceOptions,
                  ]
                : activeResourceOptions
            }
          />
        </Form.Item>
        <Form.Item
          name="shift_family_ids"
          label="可上班次"
          extra="能力：能上哪些班。月轮换/今日当班在「排班」周历生成与调整，不要当长期固定任职。"
        >
          <Select
            mode="multiple"
            options={shiftFamilyOptions}
            placeholder="勾选可上的班次"
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
          <Select
            optionFilterProp="label"
            options={
              editingTpl?.skill_id &&
              !activeSkillOptions.some((o) => o.value === editingTpl.skill_id)
                ? [
                    {
                      value: editingTpl.skill_id,
                      label: `${editingTpl.skill_name || editingTpl.skill_id}（已停用）`,
                    },
                    ...activeSkillOptions,
                  ]
                : activeSkillOptions
            }
          />
        </Form.Item>
        <Form.Item
          name="equipment_ids"
          label="可用设备池"
          extra="甘特排产时从池内选择或自动分配具体机台；可含公共设备"
        >
          <Select
            mode="multiple"
            allowClear
            optionFilterProp="label"
            options={activeEquipmentOptions}
            placeholder="选择一台或多台"
          />
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
        <Alert
          type="info"
          showIcon
          style={{ marginBottom: 12 }}
          message="请假按自然日（日历日），不是按挂牌生产日一刀切"
          description={
            <div style={{ fontSize: 13, lineHeight: 1.65 }}>
              <div>填「11 号」表示 11 号当天落在班里的工时不上：</div>
              <ul style={{ margin: "6px 0 0", paddingLeft: 18 }}>
                <li>白班 / 中班：挂牌 11 号那班不上</li>
                <li>
                  夜班（归属前一日）：不上的是{" "}
                  <b>11 号凌晨</b>那班（挂牌 10 号），不是 12 号凌晨（挂牌 11 号）那班
                </li>
              </ul>
              <div style={{ marginTop: 6, color: "#718096" }}>
                排产甘特按工序计划日×班次对照请假；非请假日仍可派此人。
              </div>
            </div>
          }
        />
        <Form.Item name="person_id" label="请假人" rules={[{ required: true, message: "请选择人员" }]}>
          <Select
            showSearch
            optionFilterProp="label"
            options={(data?.persons ?? [])
              .filter((p) => p.status !== "disabled")
              .map((p) => ({ value: p.id, label: `${p.name}（${p.code}）` }))}
          />
        </Form.Item>
        <Form.Item
          name="range"
          label="请假日期"
          rules={[{ required: true, message: "请选择日期" }]}
          extra="按自然日选择；跨午夜/凌晨班见上方说明。"
        >
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

      <Modal
        title={disableTarget ? `停用「${disableTarget.name}」` : "停用班次"}
        open={!!disableTarget}
        confirmLoading={removingShift || usageLoading}
        okText={
          disableUsage?.suggest_migrate || disableUsage?.requires_migrate
            ? "切换并停用"
            : "确认停用"
        }
        okButtonProps={{
          danger: true,
          disabled: Boolean(disableUsage?.requires_migrate && !migrateTo),
        }}
        onCancel={() => {
          setDisableTarget(null);
          setDisableUsage(null);
          setMigrateTo(undefined);
        }}
        onOk={() => {
          if (!disableTarget) return;
          if (disableUsage?.requires_migrate && !migrateTo) {
            message.warning("请先选择要切换到的目标班次（可先「增加一种班」）");
            return;
          }
          if (
            !migrateTo &&
            (disableUsage?.open_assignment_count || 0) > 0 &&
            (disableUsage?.migrate_targets?.length || 0) > 0
          ) {
            message.warning(
              "当前有排班任职仍挂此班。请选择「切换到」目标，否则只会结束旧任职、不会改挂到新班",
            );
            return;
          }
          void removeShift({
            familyId: disableTarget.family_id,
            migrateTo: migrateTo || null,
          });
        }}
      >
        <div style={{ marginBottom: 12, fontSize: 13, color: "#4a5568" }}>
          建议：先「增加一种班」作为目标，再停用旧班并一键切换占用。同班只改时间请用「同班改时段」。
        </div>
        {usageLoading || !disableUsage ? (
          <div style={{ color: "#a0aec0" }}>正在检查占用…</div>
        ) : (
          <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
            <div>
              未完成工序 <Tag color={disableUsage.open_op_count ? "orange" : "default"}>
                {disableUsage.open_op_count}
              </Tag>
              · 开放任职{" "}
              <Tag color={disableUsage.open_assignment_count ? "blue" : "default"}>
                {disableUsage.open_assignment_count}
              </Tag>
            </div>
            {disableUsage.ops.length > 0 ? (
              <div style={{ fontSize: 12, color: "#718096", maxHeight: 120, overflow: "auto" }}>
                {disableUsage.ops.map((op) => (
                  <div key={op.id}>
                    {op.work_order_code || "-"} · {op.name || op.id}
                    {op.plan_start ? `（${String(op.plan_start).slice(5)}）` : ""}
                  </div>
                ))}
                {disableUsage.open_op_count > disableUsage.ops.length ? (
                  <div>…等共 {disableUsage.open_op_count} 道</div>
                ) : null}
              </div>
            ) : null}
            {(disableUsage.migrate_targets?.length || 0) > 0 ? (
              <div>
                <div style={{ marginBottom: 8, fontWeight: 600 }}>
                  切换到目标班次
                  {disableUsage.requires_migrate ? (
                    <Tag color="red" style={{ marginInlineStart: 8 }}>
                      必选
                    </Tag>
                  ) : disableUsage.open_assignment_count > 0 ? (
                    <Tag color="blue" style={{ marginInlineStart: 8 }}>
                      排班会跟着切
                    </Tag>
                  ) : null}
                </div>
                <Select
                  allowClear={!disableUsage.requires_migrate}
                  style={{ width: "100%" }}
                  placeholder="选择新班（排班任职与工序一并改挂）"
                  value={migrateTo}
                  onChange={setMigrateTo}
                  options={disableUsage.migrate_targets.map((s) => ({
                    value: s.family_id,
                    label: `${s.name}（${s.time_label || `${s.start_time}–${s.end_time}`}）`,
                  }))}
                />
                <div style={{ marginTop: 6, fontSize: 12, color: "#718096" }}>
                  {disableUsage.requires_migrate
                    ? "有未完成工序占用，必须选择目标后才能停用。"
                    : disableUsage.open_assignment_count > 0
                      ? "不选目标将结束旧任职（排班变空），不会改挂到新班。"
                      : "无占用时可直接停用；有目标则一并迁移人员能力。"}
                </div>
              </div>
            ) : disableUsage.requires_migrate || disableUsage.open_assignment_count > 0 ? (
              <div style={{ color: "#c53030", fontSize: 13 }}>
                当前没有其他启用班次。请先点「增加一种班」，再回来停用并切换。
              </div>
            ) : (
              <div style={{ fontSize: 12, color: "#718096" }}>无占用，可直接停用。</div>
            )}
          </div>
        )}
      </Modal>

      <FormModal
        title={editingShiftFamily ? `同班改时段 · ${editingShiftFamily.name}` : "增加一种班"}
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
        okText={editingShiftFamily ? "保存新版时段" : "创建"}
      >
        {editingShiftFamily ? (
          <div style={{ marginBottom: 12, color: "#718096", fontSize: 12 }}>
            仍是「{editingShiftFamily.name}」，只改起止时间与生效日。当前 v{editingShiftFamily.version}
            （{editingShiftFamily.time_label}）将归档；已排工序若绑旧版本仍按旧时段计算。
          </div>
        ) : (
          <div style={{ marginBottom: 12, color: "#718096", fontSize: 12 }}>
            新增一种并列的班（新编码），时长任意。忙时加中/夜；闲时停用多余班并一键切到保留的那一种。
          </div>
        )}
        <Form.Item name="code" label="编码" rules={[{ required: true }]}>
          <Input placeholder="如 DAY / MID / NIGHT" disabled={!!editingShiftFamily} />
        </Form.Item>
        <Form.Item name="name" label="名称" rules={[{ required: true }]}>
          <Input placeholder="如 白班" />
        </Form.Item>
        <Form.Item name="start_time" label="开始时间" rules={[{ required: true }]}>
          <Input placeholder="08:00（自定义即可）" />
        </Form.Item>
        <Form.Item name="end_time" label="结束时间" rules={[{ required: true }]}>
          <Input placeholder="16:00（不必整 8 小时）" />
        </Form.Item>
        <Form.Item
          name="crosses_midnight"
          label="跨午夜"
          initialValue={false}
          extra="钟点是否跨过 0 点（如 17:00–01:00）。与「归属日」分开设置。"
        >
          <Select
            options={[
              { value: false, label: "否" },
              { value: true, label: "是（如 17:00–01:00）" },
            ]}
          />
        </Form.Item>
        <Form.Item
          name="belong_day_rule"
          label="归属日"
          initialValue="start_day"
          extra="甘特挂牌、排班人数、负荷统计都按归属日汇总。凌晨接续班选「前一日」才能与 1 班同一生产日。"
        >
          <Select
            options={[
              {
                value: "start_day",
                label: "开班日（开工那天，如白班 / 跨午夜中班）",
              },
              {
                value: "previous_day",
                label: "前一日（凌晨班跟首班生产日，如 01:00–09:00）",
              },
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
          高级：按日期区间登记当班（与周历一键生成同源）。日常轮换请优先用「排班」周历；这里适合补一段连续区间。
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
