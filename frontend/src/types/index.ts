export interface ApiResponse<T = unknown> {
  code: number;
  message: string;
  data: T;
  trace_id: string;
}

export interface PageResult<T> {
  page: number;
  page_size: number;
  total: number;
  items: T[];
}

export interface UserInfo {
  id: number;
  username: string;
  display_name: string;
  email: string | null;
  avatar_url?: string | null;
  tenant_id: number;
  dept_id?: number | null;
  dept_name?: string | null;
  status?: string;
  data_scope?: string;
  roles: string[];
  role_names?: string[];
  permissions: string[];
  created_at?: string | null;
}

export interface MenuNode {
  id: number;
  name: string;
  type: string;
  path?: string;
  component?: string;
  icon?: string;
  permissions: string[];
  children: MenuNode[];
}

export interface DashboardItem {
  id: number;
  name: string;
  code: string;
  type: string;
  cover_url: string | null;
  description: string | null;
  status: string;
  layout_version: number;
  created_at: string;
  updated_at: string;
}

export interface DashboardDetail extends DashboardItem {
  layout: Record<string, unknown>;
  widgets: Array<{
    widget_code: string;
    type: string;
    position: Record<string, number>;
    config: Record<string, unknown>;
  }>;
}

export type { MetricResult, WidgetConfig, WidgetProps } from "./widget";

export interface UserItem {
  id: number;
  username: string;
  display_name: string;
  email: string | null;
  status: string;
  dept_id: number | null;
  dept_name: string | null;
  tenant_id: number;
  role_ids: number[];
  role_names: string[];
  created_at: string;
}

export interface RoleItem {
  id: number;
  name: string;
  code: string;
  status: string;
  data_scope: string;
  menu_ids: number[];
  permission_ids: number[];
}

export interface MenuItem {
  id: number;
  parent_id: number | null;
  name: string;
  path: string | null;
  component: string | null;
  type: string;
  sort: number;
  visible: boolean;
  icon: string | null;
  children?: MenuItem[];
}

export interface ConfigItem {
  id: number;
  scope_type: string;
  scope_id: number | null;
  config_key: string;
  config_value: string;
  value_type: string;
  description: string | null;
  version: number;
  updated_at: string;
}

export interface DeptItem {
  id: number;
  parent_id: number | null;
  name: string;
  code: string | null;
  sort: number;
  status: string;
  leader: string | null;
  phone: string | null;
  children?: DeptItem[];
}

export interface DictTypeItem {
  id: number;
  code: string;
  name: string;
  status: string;
  description: string | null;
}

export interface DictItemRow {
  id: number;
  type_id: number;
  label: string;
  value: string;
  sort: number;
  status: string;
  remark: string | null;
}
