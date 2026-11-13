import { Tabs } from "antd";
import { useCallback, useMemo, useState } from "react";
import { PageHeader } from "@/components/kit";
import FactoryCodeCard from "./FactoryCodeCard";
import ProcessesPage from "./ProcessesPage";
import ProductsPage from "./ProductsPage";
import MasterDataPage, { type MasterEmbedTab } from "./MasterDataPage";

type BaseTab =
  | "processes"
  | "products"
  | "persons"
  | "skills"
  | "shifts"
  | "teams"
  | "roster"
  | "equipments";

const MASTER_TO_BASE: Partial<Record<MasterEmbedTab, BaseTab>> = {
  persons: "persons",
  skills: "skills",
  shifts: "shifts",
  resources: "teams",
  roster: "roster",
  equipments: "equipments",
};

/**
 * 生产进度 · 基础信息：工序 / 产品 / 人员 / 技能 / 班制 / 班组 / 排班 / 设备 合并为一个菜单，Tab 切换。
 */
export default function BaseInfoPage() {
  const [tab, setTab] = useState<BaseTab>("processes");

  const navigateMaster = useCallback((key: MasterEmbedTab) => {
    const next = MASTER_TO_BASE[key];
    if (next) setTab(next);
  }, []);

  const items = useMemo(
    () => [
      {
        key: "processes",
        label: "工序",
        children: <ProcessesPage embedded />,
      },
      {
        key: "products",
        label: "产品",
        children: <ProductsPage embedded />,
      },
      {
        key: "persons",
        label: "人员",
        children: <MasterDataPage embedTab="persons" onEmbedNavigate={navigateMaster} />,
      },
      {
        key: "skills",
        label: "技能",
        children: <MasterDataPage embedTab="skills" onEmbedNavigate={navigateMaster} />,
      },
      {
        key: "shifts",
        label: "班制",
        children: <MasterDataPage embedTab="shifts" onEmbedNavigate={navigateMaster} />,
      },
      {
        key: "teams",
        label: "班组",
        children: <MasterDataPage embedTab="resources" onEmbedNavigate={navigateMaster} />,
      },
      {
        key: "roster",
        label: "排班",
        children: <MasterDataPage embedTab="roster" onEmbedNavigate={navigateMaster} />,
      },
      {
        key: "equipments",
        label: "设备",
        children: <MasterDataPage embedTab="equipments" onEmbedNavigate={navigateMaster} />,
      },
    ],
    [navigateMaster],
  );

  return (
    <div>
      <PageHeader
        title="基础信息"
        subtitle="统一维护工序 / 产品 / 人员 / 技能 / 班制 / 班组 / 排班 / 设备。每页均支持搜索；列表中由系统统计的字段（如人数、占用工序、今日当班）不可在表单中手填。"
      />
      <FactoryCodeCard />
      <Tabs
        activeKey={tab}
        onChange={(k) => setTab(k as BaseTab)}
        items={items}
        destroyOnHidden
      />
    </div>
  );
}
