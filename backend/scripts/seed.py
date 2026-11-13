"""初始化种子数据：管理员、角色、菜单、权限、示例驾驶舱。"""

from __future__ import annotations

import asyncio
import sys
from pathlib import Path

# 允许在 backend 目录下直接 `python scripts/seed.py`
_ROOT = Path(__file__).resolve().parents[1]
if str(_ROOT) not in sys.path:
    sys.path.insert(0, str(_ROOT))

from sqlalchemy import select

from app.core.config import get_settings
from app.core.database import async_session_factory, init_db
from app.core.security import hash_password
from app.models.dashboard import Dashboard, DashboardLayout, DashboardWidget, WidgetDefinition
from app.models.infra import SysConfig
from app.models.system import (
    SysApiPermission,
    SysDept,
    SysDictItem,
    SysApiPermission,
    SysDictType,
    SysMenu,
    SysPermission,
    SysRole,
    SysRoleApiPermission,
    SysRoleMenu,
    SysRolePermission,
    SysTenant,
    SysUser,
    SysUserRole,
)

settings = get_settings()

PERMISSIONS = [
    ("user:view", "查看用户", "user", "view"),
    ("user:create", "创建用户", "user", "create"),
    ("user:update", "更新用户", "user", "update"),
    ("user:delete", "删除用户", "user", "delete"),
    ("role:view", "查看角色", "role", "view"),
    ("role:assign", "分配角色", "role", "assign"),
    ("menu:view", "查看菜单", "menu", "view"),
    ("dept:view", "查看部门", "dept", "view"),
    ("dept:create", "创建部门", "dept", "create"),
    ("dept:update", "更新部门", "dept", "update"),
    ("dept:delete", "删除部门", "dept", "delete"),
    ("dict:view", "查看字典", "dict", "view"),
    ("dict:create", "创建字典", "dict", "create"),
    ("dict:update", "更新字典", "dict", "update"),
    ("dict:delete", "删除字典", "dict", "delete"),
    ("dashboard:view", "查看驾驶舱", "dashboard", "view"),
    ("dashboard:create", "创建驾驶舱", "dashboard", "create"),
    ("dashboard:update", "更新驾驶舱", "dashboard", "update"),
    ("dashboard:delete", "删除驾驶舱", "dashboard", "delete"),
    ("dashboard:export", "导出驾驶舱", "dashboard", "export"),
    ("tool:execute", "执行 Tool", "tool", "execute"),
    ("tool:execute:query_metric", "执行指标查询", "tool", "execute"),
    ("skill:execute", "执行 Skill", "skill", "execute"),
    ("skill:execute:production_anomaly_analysis", "执行异常分析", "skill", "execute"),
    ("file:view", "查看文件", "file", "view"),
    ("file:upload", "上传文件", "file", "upload"),
    ("file:delete", "删除文件", "file", "delete"),
    ("audit:view", "查看审计", "audit", "view"),
    ("api_perm:view", "查看接口权限", "api_perm", "view"),
    ("api_perm:manage", "管理接口权限", "api_perm", "manage"),
    ("scheduling:view", "查看排产", "scheduling", "view"),
    ("scheduling:gantt:edit", "调整排产计划", "scheduling", "gantt_edit"),
    ("scheduling:report:start", "工序开工报工", "scheduling", "report_start"),
    ("scheduling:report:early_start", "提前开工", "scheduling", "early_start"),
    ("scheduling:variance:resolve", "计划实绩偏差处置", "scheduling", "variance"),
    ("scheduling:baseline:restore", "恢复排产测试数据", "scheduling", "baseline_restore"),
    ("scheduling:shop_floor:review", "生产日报确认", "scheduling", "shop_floor_review"),
    ("production_progress:view", "查看生产进度", "production_progress", "view"),
    ("production_progress:report", "生产进度报工", "production_progress", "report"),
    ("production_progress:review", "生产进度日报确认", "production_progress", "review"),
    ("progress_analytics:view", "多维生产分析", "progress_analytics", "view"),
    ("tenant:view", "查看租户", "tenant", "view"),
    ("tenant:create", "创建租户", "tenant", "create"),
    ("tenant:update", "更新租户", "tenant", "update"),
    ("tenant:delete", "删除租户", "tenant", "delete"),
]

MENUS = [
    # (id, parent_id, name, path, component, type, sort, icon)
    (1, None, "系统管理", None, None, "CATALOG", 100, "SettingOutlined"),
    (2, 1, "账号管理", "/system/users", "system/Users", "MENU", 1, "UserOutlined"),
    (3, 1, "角色管理", "/system/roles", "system/Roles", "MENU", 2, "TeamOutlined"),
    (4, 1, "菜单管理", "/system/menus", "system/Menus", "MENU", 3, "MenuOutlined"),
    (5, None, "驾驶舱", "/dashboards", "dashboard-list/DashboardList", "MENU", 10, "DashboardOutlined"),
    (6, None, "AI 助手", "/ai-assistant", "ai-assistant/Assistant", "MENU", 20, "RobotOutlined"),
    (7, None, "配置中心", "/configs", "system/Configs", "MENU", 30, "ControlOutlined"),
    (8, None, "文件中心", "/files", "system/Files", "MENU", 40, "FolderOutlined"),
    (9, 1, "审计日志", "/system/audit", "system/Audit", "MENU", 4, "FileSearchOutlined"),
    (10, 1, "部门管理", "/system/depts", "system/Depts", "MENU", 5, "ApartmentOutlined"),
    (11, 1, "字典管理", "/system/dicts", "system/Dicts", "MENU", 6, "BookOutlined"),
    (25, 1, "接口权限", "/system/api-permissions", "system/ApiPermissions", "MENU", 7, "ApiOutlined"),
    (27, 1, "租户管理", "/system/tenants", "system/Tenants", "MENU", 0, "ClusterOutlined"),
    # Demo 范本（复制用，非业务）
    (12, None, "Demo 范本", None, None, "CATALOG", 50, "AppstoreOutlined"),
    (13, 12, "总览范本", "/demo/overview", "demo/OverviewTemplate", "MENU", 1, "FundOutlined"),
    (14, 12, "查询表范本", "/demo/query-table", "demo/QueryTableTemplate", "MENU", 2, "TableOutlined"),
    # 设备分析（本分支主业务；钻取页 /devices/:id 不进侧栏）
    (15, None, "设备分析", None, None, "CATALOG", 5, "ClusterOutlined"),
    (16, 15, "采集配置", "/devices/collect", "equipment-analysis/CollectConfig", "MENU", 1, "ApiOutlined"),
    (17, 15, "设备列表", "/devices", "equipment-analysis/DeviceList", "MENU", 2, "UnorderedListOutlined"),
    (18, 15, "分析诊断", "/analysis/diagnosis", "equipment-analysis/AnalysisDiagnosis", "MENU", 3, "ExperimentOutlined"),
    # 生产排产 MVP（与设备分析平级，排在其下）
    (60, None, "生产排产", None, None, "CATALOG", 6, "ScheduleOutlined"),
    (61, 60, "基础数据", "/scheduling/master", "scheduling/MasterData", "MENU", 1, "TeamOutlined"),
    (62, 60, "工单管理", "/scheduling/orders", "scheduling/WorkOrders", "MENU", 2, "UnorderedListOutlined"),
    (63, 60, "排产甘特", "/scheduling/gantt", "scheduling/Gantt", "MENU", 3, "FundOutlined"),
    (64, 60, "工序报工", "/scheduling/report", "scheduling/Report", "MENU", 4, "ThunderboltOutlined"),
    (65, 60, "生产日报", "/scheduling/daily", "scheduling/DailyReport", "MENU", 5, "FormOutlined"),
    # 生产进度（全局看板 → 报工/分析 → 基础信息）
    (80, None, "生产进度", None, None, "CATALOG", 7, "LineChartOutlined"),
    (91, 80, "全局看板", "/production-progress/cockpit", "production-progress/Cockpit", "MENU", 0, "DashboardOutlined"),
    (81, 80, "基础信息", "/production-progress/master", "production-progress/BaseInfo", "MENU", 1, "TeamOutlined"),
    (88, 80, "工单管理", "/production-progress/orders", "production-progress/WorkOrders", "MENU", 2, "UnorderedListOutlined"),
    (89, 80, "每日报工", "/production-progress/daily", "production-progress/DailyReport", "MENU", 3, "FormOutlined"),
    (90, 80, "进度分析", "/production-progress/analysis", "production-progress/ProgressAnalysis", "MENU", 4, "FundOutlined"),
    (92, 80, "多维分析", "/progress-analytics", "progress-analytics/Workbench", "MENU", 5, "ApartmentOutlined"),
    # 工具箱（前端测算工具，可继续加子菜单）
    (70, None, "工具箱", None, None, "CATALOG", 8, "ToolOutlined"),
    (71, 70, "电石质检 ROI", "/tools/calcium-roi", "tools/calcium-roi/CalciumRoi", "MENU", 1, "CalculatorOutlined"),
    (72, 70, "单位换算", "/tools/unit-converter", "tools/unit-converter/UnitConverter", "MENU", 2, "SwapOutlined"),
]

# 接口权限默认规则已改为：启动时从 FastAPI 路由按 stable_key 自动同步。
# 中文名 / 兼容权限码见 app.application.api_permission_service.API_META_OVERLAYS。
API_PERMISSION_RULES: list[tuple] = []


# equipment-ops 分支曾占用的菜单 id（与本分支 15～20 冲突）；seed 时软删除，避免挂在「运行调优」下
# 19/20：原「全局风险」「运行调优」已并入「分析诊断」
RETIRED_MENU_IDS = [
    12,
    13,
    14,  # Demo 范本（本分支不展示）
    19,
    20,  # 原全局风险 / 运行调优 → 分析诊断
    21,
    22,
    23,
    24,
    26,  # 原设备管理子菜单（parent 曾为 20）
    30,
    31,
    32,
    33,
    34,  # 实时监控
    40,
    41,
    42,
    43,
    44,  # AI 分析（ops）
    50,
    51,
    52,
    53,
    54,  # 设备运营
    82,
    83,
    84,
    85,
    86,
    87,  # 生产进度曾拆开的基础信息子菜单 → 已合并为「基础信息」
]

# 示例部门树（固定 id，便于挂用户）
# 租户 1（内置样板客户）组织树
DEPTS = [
    # (id, parent_id, name, code, sort, tenant_id)
    (1, None, "总部", "HQ", 1, 1),
    (2, 1, "生产部", "PROD", 1, 1),
    (3, 1, "技术部", "TECH", 2, 1),
    (11, 1, "质量部", "QA", 3, 1),
    (4, 2, "一车间", "PROD-1", 1, 1),
    (5, 2, "二车间", "PROD-2", 2, 1),
    (6, 2, "动力部", "POWER", 3, 1),
    (7, 2, "三车间", "PROD-3", 4, 1),
    (8, 2, "仓储物流部", "WH", 5, 1),
    (9, 3, "实验室", "LAB", 1, 1),
    (10, 3, "设备工程部", "ENG", 2, 1),
    (12, 11, "质检中心", "QC", 1, 1),
    (13, 11, "计量站", "MET", 2, 1),
]

# 客户A（tenant_id=2）独立组织树，禁止与租户1共用 dept_id
TENANT_A_DEPTS = [
    (101, None, "客户A总部", "CA-HQ", 1, 2),
    (102, 101, "生产中心", "CA-PROD", 1, 2),
    (103, 101, "计划调度", "CA-PLAN", 2, 2),
    (104, 102, "一车间", "CA-W1", 1, 2),
]

DICT_TYPES = [
    # (code, name, description)
    ("user_status", "用户状态", "用户启用/禁用状态"),
    ("common_status", "通用状态", "通用启用/禁用"),
]

DICT_ITEMS = [
    # (type_code, label, value, sort)
    ("user_status", "启用", "active", 1),
    ("user_status", "禁用", "disabled", 2),
    ("common_status", "启用", "active", 1),
    ("common_status", "禁用", "disabled", 2),
]


BRANDING_CONFIGS = [
    ("app.title", settings.app_title, "系统标题（登录页、浏览器标题）"),
    ("app.subtitle", settings.app_subtitle, "系统副标题"),
    ("app.sidebar_title", settings.app_sidebar_title, "侧栏品牌名"),
    ("app.logo_url", settings.app_logo_url, "Logo 地址"),
    ("app.theme", settings.app_theme, "主题预设：light | dark（Gentelella）"),
]


async def _upsert_branding_configs(session) -> None:
    for key, value, description in BRANDING_CONFIGS:
        result = await session.execute(
            select(SysConfig).where(
                SysConfig.config_key == key,
                SysConfig.scope_type == "SYSTEM",
                SysConfig.scope_id.is_(None),
            )
        )
        config = result.scalar_one_or_none()
        if config is None:
            session.add(
                SysConfig(
                    scope_type="SYSTEM",
                    config_key=key,
                    config_value=value,
                    value_type="string",
                    description=description,
                )
            )
        else:
            config.config_value = value
            config.description = description


DEMO_WIDGETS = [
    {
        "widget_code": "today_output",
        "type": "number",
        "position_json": '{"x":0,"y":0,"w":4,"h":2}',
        "config_json": (
            '{"title":"今日产量","refresh_seconds":60,'
            '"data_source":{"mode":"api","target":"/api/v1/metrics/daily_output",'
            '"params":{"metric_code":"daily_output"}}}'
        ),
    },
    {
        "widget_code": "device_uptime",
        "type": "number",
        "position_json": '{"x":4,"y":0,"w":4,"h":2}',
        "config_json": (
            '{"title":"设备稼动率","refresh_seconds":60,'
            '"data_source":{"mode":"api","target":"/api/v1/metrics/device_uptime",'
            '"params":{"metric_code":"device_uptime"}}}'
        ),
    },
    {
        "widget_code": "alarm_count",
        "type": "number",
        "position_json": '{"x":8,"y":0,"w":4,"h":2}',
        "config_json": (
            '{"title":"告警次数","refresh_seconds":60,'
            '"data_source":{"mode":"api","target":"/api/v1/metrics/alarm_count",'
            '"params":{"metric_code":"alarm_count"}}}'
        ),
    },
    {
        "widget_code": "output_trend",
        "type": "line",
        "position_json": '{"x":0,"y":2,"w":8,"h":4}',
        "config_json": (
            '{"title":"产量趋势","refresh_seconds":60,'
            '"data_source":{"mode":"api","target":"/api/v1/metrics/daily_output",'
            '"params":{"metric_code":"daily_output"}}}'
        ),
    },
    {
        "widget_code": "metric_table",
        "type": "table",
        "position_json": '{"x":8,"y":2,"w":4,"h":4}',
        "config_json": (
            '{"title":"指标明细","refresh_seconds":60,'
            '"data_source":{"mode":"api","target":"/api/v1/metrics/daily_output",'
            '"params":{"metric_code":"daily_output"}}}'
        ),
    },
]


async def _sync_demo_dashboard(session) -> None:
    """同步演示驾驶舱三类 Widget（已有库也会升级布局）。"""
    result = await session.execute(
        select(Dashboard).where(Dashboard.code == "production_overview", Dashboard.is_deleted.is_(False))
    )
    dashboard = result.scalar_one_or_none()
    if dashboard is None:
        return

    existing = await session.execute(
        select(DashboardWidget).where(DashboardWidget.dashboard_id == dashboard.id)
    )
    for row in existing.scalars().all():
        await session.delete(row)

    for widget in DEMO_WIDGETS:
        session.add(
            DashboardWidget(
                dashboard_id=dashboard.id,
                widget_code=widget["widget_code"],
                type=widget["type"],
                position_json=widget["position_json"],
                config_json=widget["config_json"],
            )
        )

    for code, name, component in [
        ("today_output", "今日产量", "NumberWidget"),
        ("output_trend", "产量趋势", "LineWidget"),
        ("metric_table", "指标明细", "TableWidget"),
    ]:
        def_result = await session.execute(
            select(WidgetDefinition).where(WidgetDefinition.code == code)
        )
        if def_result.scalar_one_or_none() is None:
            session.add(
                WidgetDefinition(
                    code=code,
                    name=name,
                    component=component,
                    schema_json="{}",
                )
            )


async def _sync_depts_and_dicts(session) -> None:
    """增量同步各租户独立组织树与（平台共享）字典。"""
    for did, parent_id, name, code, sort, tenant_id in [*DEPTS, *TENANT_A_DEPTS]:
        exists = (await session.execute(select(SysDept).where(SysDept.id == did))).scalar_one_or_none()
        if exists is None:
            session.add(
                SysDept(
                    id=did,
                    parent_id=parent_id,
                    name=name,
                    code=code,
                    sort=sort,
                    status="active",
                    tenant_id=tenant_id,
                )
            )
        else:
            exists.parent_id = parent_id
            exists.name = name
            exists.code = code
            exists.sort = sort
            exists.tenant_id = tenant_id
            exists.is_deleted = False
    await session.flush()

    type_id_by_code: dict[str, int] = {}
    for code, name, description in DICT_TYPES:
        exists = (
            await session.execute(
                select(SysDictType).where(SysDictType.code == code, SysDictType.is_deleted.is_(False))
            )
        ).scalar_one_or_none()
        if exists is None:
            row = SysDictType(code=code, name=name, description=description, status="active")
            session.add(row)
            await session.flush()
            type_id_by_code[code] = row.id  # type: ignore[assignment]
        else:
            exists.name = name
            exists.description = description
            type_id_by_code[code] = exists.id  # type: ignore[assignment]

    for type_code, label, value, sort in DICT_ITEMS:
        type_id = type_id_by_code[type_code]
        exists = (
            await session.execute(
                select(SysDictItem).where(
                    SysDictItem.type_id == type_id,
                    SysDictItem.value == value,
                    SysDictItem.is_deleted.is_(False),
                )
            )
        ).scalar_one_or_none()
        if exists is None:
            session.add(
                SysDictItem(type_id=type_id, label=label, value=value, sort=sort, status="active")
            )
        else:
            exists.label = label
            exists.sort = sort


async def _ensure_role_api_from_perm_codes(
    session,
    role_id: int,
    perm_codes: set[str],
) -> None:
    """按权限码给角色挂上对应启用接口规则。"""
    if not perm_codes:
        return
    rules = (
        await session.execute(
            select(SysApiPermission).where(
                SysApiPermission.permission_code.in_(list(perm_codes)),
                SysApiPermission.enabled.is_(True),
            )
        )
    ).scalars().all()
    for rule in rules:
        if rule.id is None:
            continue
        linked = (
            await session.execute(
                select(SysRoleApiPermission).where(
                    SysRoleApiPermission.role_id == role_id,
                    SysRoleApiPermission.api_permission_id == rule.id,
                )
            )
        ).scalar_one_or_none()
        if linked is None:
            session.add(
                SysRoleApiPermission(role_id=role_id, api_permission_id=rule.id)
            )


async def _ensure_role_links(
    session,
    role: SysRole,
    menu_ids: set[int],
    perm_codes: set[str],
) -> None:
    for mid in menu_ids:
        linked = (
            await session.execute(
                select(SysRoleMenu).where(SysRoleMenu.role_id == role.id, SysRoleMenu.menu_id == mid)
            )
        ).scalar_one_or_none()
        if linked is None:
            session.add(SysRoleMenu(role_id=role.id, menu_id=mid))

    for code in perm_codes:
        perm = (
            await session.execute(select(SysPermission).where(SysPermission.code == code))
        ).scalar_one_or_none()
        if perm is None:
            continue
        linked = (
            await session.execute(
                select(SysRolePermission).where(
                    SysRolePermission.role_id == role.id,
                    SysRolePermission.permission_id == perm.id,
                )
            )
        ).scalar_one_or_none()
        if linked is None:
            session.add(SysRolePermission(role_id=role.id, permission_id=perm.id))


async def _sync_org_scope_demo(session) -> None:
    """G1 演示：生产部经理（ORG）+ 一车间账号，便于验证数据范围。"""
    plant_role = (
        await session.execute(select(SysRole).where(SysRole.code == "plant_mgr", SysRole.is_deleted.is_(False)))
    ).scalar_one_or_none()
    if plant_role is None:
        plant_role = SysRole(name="生产部经理", code="plant_mgr", data_scope="ORG")
        session.add(plant_role)
        await session.flush()
    else:
        plant_role.data_scope = "ORG"
        plant_role.is_deleted = False

    await _ensure_role_links(
        session,
        plant_role,
        menu_ids={1, 2, 10},
        perm_codes={"user:view", "dept:view", "dashboard:view"},
    )

    plant = (await session.execute(select(SysUser).where(SysUser.username == "plant"))).scalar_one_or_none()
    if plant is None:
        plant = SysUser(
            username="plant",
            password_hash=hash_password("plant123"),
            display_name="生产部经理",
            status="active",
            tenant_id=1,
            dept_id=2,
        )
        session.add(plant)
        await session.flush()
    else:
        plant.tenant_id = 1
        plant.dept_id = 2
        plant.is_deleted = False
        plant.status = "active"

    linked = (
        await session.execute(
            select(SysUserRole).where(SysUserRole.user_id == plant.id, SysUserRole.role_id == plant_role.id)
        )
    ).scalar_one_or_none()
    if linked is None:
        session.add(SysUserRole(user_id=plant.id, role_id=plant_role.id))

    line1 = (await session.execute(select(SysUser).where(SysUser.username == "line1"))).scalar_one_or_none()
    if line1 is None:
        session.add(
            SysUser(
                username="line1",
                password_hash=hash_password("line123"),
                display_name="一车间员",
                status="active",
                tenant_id=1,
                dept_id=4,
            )
        )
    else:
        line1.tenant_id = 1
        line1.dept_id = 4
        line1.is_deleted = False
        line1.status = "active"


async def _sync_menus_and_permissions(session) -> None:
    """增量同步菜单与权限，并挂到 admin 角色。"""
    admin_role = (
        await session.execute(select(SysRole).where(SysRole.code == "admin", SysRole.is_deleted.is_(False)))
    ).scalar_one_or_none()
    if admin_role is None:
        return

    for code, name, resource, action in PERMISSIONS:
        exists = (
            await session.execute(select(SysPermission).where(SysPermission.code == code))
        ).scalar_one_or_none()
        if exists is None:
            perm = SysPermission(code=code, name=name, resource=resource, action=action)
            session.add(perm)
            await session.flush()
            session.add(SysRolePermission(role_id=admin_role.id, permission_id=perm.id))
        else:
            linked = (
                await session.execute(
                    select(SysRolePermission).where(
                        SysRolePermission.role_id == admin_role.id,
                        SysRolePermission.permission_id == exists.id,
                    )
                )
            ).scalar_one_or_none()
            if linked is None:
                session.add(SysRolePermission(role_id=admin_role.id, permission_id=exists.id))

    for mid, parent_id, name, path, component, mtype, sort, icon in MENUS:
        exists = (
            await session.execute(select(SysMenu).where(SysMenu.id == mid))
        ).scalar_one_or_none()
        if exists is None:
            menu = SysMenu(
                id=mid,
                parent_id=parent_id,
                name=name,
                path=path,
                component=component,
                type=mtype,
                sort=sort,
                icon=icon,
            )
            session.add(menu)
            await session.flush()
            session.add(SysRoleMenu(role_id=admin_role.id, menu_id=mid))
        else:
            exists.name = name
            exists.parent_id = parent_id
            exists.path = path
            exists.component = component
            exists.icon = icon
            exists.sort = sort
            exists.type = mtype
            exists.visible = True
            exists.is_deleted = False
            linked = (
                await session.execute(
                    select(SysRoleMenu).where(
                        SysRoleMenu.role_id == admin_role.id,
                        SysRoleMenu.menu_id == mid,
                    )
                )
            ).scalar_one_or_none()
            if linked is None:
                session.add(SysRoleMenu(role_id=admin_role.id, menu_id=mid))

    # 清理其他分支遗留菜单，避免侧栏嵌套错乱
    if RETIRED_MENU_IDS:
        retired = (
            await session.execute(select(SysMenu).where(SysMenu.id.in_(RETIRED_MENU_IDS)))
        ).scalars().all()
        for menu in retired:
            menu.is_deleted = True
            menu.visible = False


async def _sync_tenant_admin_role(session) -> None:
    """客户租户管理员：本租户内组织/账号/角色/字典 + 已购业务模块（不含平台租户管理）。"""
    role = (
        await session.execute(
            select(SysRole).where(SysRole.code == "tenant_admin", SysRole.is_deleted.is_(False))
        )
    ).scalar_one_or_none()
    if role is None:
        role = SysRole(name="租户管理员", code="tenant_admin", data_scope="ALL")
        session.add(role)
        await session.flush()
    else:
        role.name = "租户管理员"
        role.data_scope = "ALL"
        role.is_deleted = False

    await _ensure_role_links(
        session,
        role,
        # 1=系统管理目录（否则 users/depts 等子菜单挂不上树）
        menu_ids={1, 2, 3, 10, 11, 60, 61, 62, 63, 64, 65, 80, 81, 88, 89, 90, 91, 92},
        perm_codes={
            "user:view",
            "user:create",
            "user:update",
            "user:delete",
            "role:view",
            "role:assign",
            "dept:view",
            "dept:create",
            "dept:update",
            "dept:delete",
            "dict:view",
            "dict:create",
            "dict:update",
            "dict:delete",
            "scheduling:view",
            "scheduling:gantt:edit",
            "scheduling:report:start",
            "scheduling:report:early_start",
            "scheduling:variance:resolve",
            "scheduling:shop_floor:review",
            "production_progress:view",
            "production_progress:report",
            "production_progress:review",
            "progress_analytics:view",
        },
    )
    await _ensure_role_api_from_perm_codes(
        session,
        role.id,
        {
            "user:view",
            "user:create",
            "user:update",
            "user:delete",
            "role:view",
            "role:assign",
            "dept:view",
            "dept:create",
            "dept:update",
            "dept:delete",
            "dict:view",
            "dict:create",
            "dict:update",
            "dict:delete",
            "scheduling:view",
            "scheduling:gantt:edit",
            "scheduling:report:start",
            "scheduling:report:early_start",
            "scheduling:variance:resolve",
            "scheduling:shop_floor:review",
            "production_progress:view",
            "production_progress:report",
            "production_progress:review",
            "progress_analytics:view",
        },
    )


async def _sync_tenants_and_sku_demo(session) -> None:
    """租户与模块开通（售卖 SKU）。"""
    from datetime import datetime

    demos = [
        (1, "样板客户（全模块）", "template", "*", "内置样板租户，用于全功能验收", "GSDEMO01"),
        (2, "客户A（仅排产）", "customer_a", "scheduling", "示例：仅开通生产排产模块", "GSCUSTA1"),
    ]
    for tid, name, code, modules, remark, factory_code in demos:
        row = (
            await session.execute(select(SysTenant).where(SysTenant.id == tid))
        ).scalar_one_or_none()
        if row is None:
            session.add(
                SysTenant(
                    id=tid,
                    name=name,
                    code=code,
                    factory_code=factory_code,
                    enabled_modules=modules,
                    status="active",
                    remark=remark,
                )
            )
        else:
            row.name = name
            row.code = code
            if not (row.factory_code or "").strip():
                row.factory_code = factory_code
            row.enabled_modules = modules
            row.status = "active"
            row.remark = remark
            row.updated_at = datetime.utcnow()
            row.is_deleted = False
    await session.flush()

    tenant_admin_role = (
        await session.execute(
            select(SysRole).where(SysRole.code == "tenant_admin", SysRole.is_deleted.is_(False))
        )
    ).scalar_one_or_none()

    user = (
        await session.execute(select(SysUser).where(SysUser.username == "tenant_a"))
    ).scalar_one_or_none()
    if user is None:
        user = SysUser(
            username="tenant_a",
            password_hash=hash_password("tenant_a123"),
            display_name="客户A用户",
            status="active",
            tenant_id=2,
            dept_id=101,
        )
        session.add(user)
        await session.flush()
    else:
        user.tenant_id = 2
        user.dept_id = 101
        user.status = "active"
        user.is_deleted = False
        user.display_name = "客户A用户"

    if tenant_admin_role is not None:
        for rid in (
            await session.execute(
                select(SysUserRole.role_id).where(SysUserRole.user_id == user.id)
            )
        ).scalars().all():
            if rid != tenant_admin_role.id:
                row = (
                    await session.execute(
                        select(SysUserRole).where(
                            SysUserRole.user_id == user.id,
                            SysUserRole.role_id == rid,
                        )
                    )
                ).scalar_one_or_none()
                if row is not None:
                    await session.delete(row)
        linked = (
            await session.execute(
                select(SysUserRole).where(
                    SysUserRole.user_id == user.id,
                    SysUserRole.role_id == tenant_admin_role.id,
                )
            )
        ).scalar_one_or_none()
        if linked is None:
            session.add(SysUserRole(user_id=user.id, role_id=tenant_admin_role.id))


async def _sync_api_permissions(session) -> None:
    """增量写入接口权限规则（按 method + path_pattern 去重）。"""
    for method, path, code, name, enabled, sort in API_PERMISSION_RULES:
        exists = (
            await session.execute(
                select(SysApiPermission).where(
                    SysApiPermission.method == method,
                    SysApiPermission.path_pattern == path,
                )
            )
        ).scalar_one_or_none()
        if exists is None:
            session.add(
                SysApiPermission(
                    method=method,
                    path_pattern=path,
                    permission_code=code,
                    name=name,
                    enabled=enabled,
                    sort=sort,
                )
            )
        else:
            exists.permission_code = code
            exists.name = name
            exists.enabled = enabled
            exists.sort = sort


async def seed() -> None:
    await init_db()
    async with async_session_factory() as session:
        existing = await session.execute(select(SysUser).where(SysUser.username == settings.default_admin_username))
        if existing.scalar_one_or_none():
            await _upsert_branding_configs(session)
            await _sync_demo_dashboard(session)
            await _sync_menus_and_permissions(session)
            await _sync_api_permissions(session)
            await _sync_depts_and_dicts(session)
            await _sync_org_scope_demo(session)
            await _sync_tenants_and_sku_demo(session)
            await _sync_tenant_admin_role(session)
            admin = (
                await session.execute(
                    select(SysUser).where(SysUser.username == settings.default_admin_username)
                )
            ).scalar_one_or_none()
            if admin:
                admin.tenant_id = 0
                admin.dept_id = None
            await session.commit()
            print(
                "种子数据已存在，已同步品牌/菜单/部门/租户。"
                f" 平台管理员 {settings.default_admin_username}（全局，请在顶栏选择代管租户）；"
                " 客户A tenant_a / tenant_a123（租户2，仅排产）"
            )
            return

        permissions: list[SysPermission] = []
        for code, name, resource, action in PERMISSIONS:
            perm = SysPermission(code=code, name=name, resource=resource, action=action)
            session.add(perm)
            permissions.append(perm)
        await session.flush()

        admin_role = SysRole(name="系统管理员", code="admin", data_scope="ALL")
        viewer_role = SysRole(name="只读用户", code="viewer", data_scope="SELF_ORG")
        session.add_all([admin_role, viewer_role])
        await session.flush()

        menus: list[SysMenu] = []
        for mid, parent_id, name, path, component, mtype, sort, icon in MENUS:
            menu = SysMenu(
                id=mid,
                parent_id=parent_id,
                name=name,
                path=path,
                component=component,
                type=mtype,
                sort=sort,
                icon=icon,
            )
            session.add(menu)
            menus.append(menu)
        await session.flush()

        await _sync_depts_and_dicts(session)

        admin = SysUser(
            username=settings.default_admin_username,
            password_hash=hash_password(settings.default_admin_password),
            display_name="平台管理员",
            status="active",
            tenant_id=0,
            dept_id=None,
        )
        session.add(admin)
        await session.flush()

        session.add(SysUserRole(user_id=admin.id, role_id=admin_role.id))

        for menu in menus:
            session.add(SysRoleMenu(role_id=admin_role.id, menu_id=menu.id))
        for perm in permissions:
            session.add(SysRolePermission(role_id=admin_role.id, permission_id=perm.id))

        viewer_menu_ids = [5, 6]
        viewer_perm_codes = {
            "dashboard:view",
            "tool:execute",
            "tool:execute:query_metric",
            "skill:execute",
            "skill:execute:production_anomaly_analysis",
        }
        for menu in menus:
            if menu.id in viewer_menu_ids:
                session.add(SysRoleMenu(role_id=viewer_role.id, menu_id=menu.id))
        for perm in permissions:
            if perm.code in viewer_perm_codes:
                session.add(SysRolePermission(role_id=viewer_role.id, permission_id=perm.id))

        await _sync_org_scope_demo(session)

        widget_def = WidgetDefinition(
            code="today_output",
            name="今日产量",
            component="NumberWidget",
            schema_json='{"type":"number","unit":"吨"}',
        )
        session.add(widget_def)

        dashboard = Dashboard(
            name="生产驾驶舱",
            code="production_overview",
            type="production",
            description="展示今日产量与关键指标",
            status="online",
            created_by=admin.id,
        )
        session.add(dashboard)
        await session.flush()

        session.add(
            DashboardLayout(
                dashboard_id=dashboard.id,
                version=1,
                layout_json='{"columns":12,"rows":6}',
                status="online",
            )
        )
        for widget in DEMO_WIDGETS:
            session.add(
                DashboardWidget(
                    dashboard_id=dashboard.id,
                    widget_code=widget["widget_code"],
                    type=widget["type"],
                    position_json=widget["position_json"],
                    config_json=widget["config_json"],
                )
            )

        await _upsert_branding_configs(session)
        await _sync_api_permissions(session)
        await _sync_tenants_and_sku_demo(session)
        await _sync_tenant_admin_role(session)
        session.add(
            SysConfig(
                scope_type="SYSTEM",
                config_key="dashboard.refresh_interval",
                config_value="60",
                value_type="number",
                description="驾驶舱默认刷新间隔（秒）",
            )
        )

        await session.commit()
        print(
            f"种子数据初始化完成。平台管理员: {settings.default_admin_username} / {settings.default_admin_password}；"
            "客户A: tenant_a / tenant_a123（租户管理员，仅排产）"
        )

if __name__ == "__main__":
    asyncio.run(seed())
