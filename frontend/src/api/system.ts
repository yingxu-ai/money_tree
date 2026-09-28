import { deleteData, getData, postData, putData } from "./client";
import type {
  ConfigItem,
  DashboardDetail,
  DashboardItem,
  DeptItem,
  DictItemRow,
  DictTypeItem,
  MenuItem,
  PageResult,
  RoleItem,
  UserItem,
} from "@/types";

export const fetchUsers = (page = 1, pageSize = 20) =>
  getData<PageResult<UserItem>>("/users", { page, page_size: pageSize });

export const createUser = (data: unknown) => postData<UserItem>("/users", data);
export const updateUser = (id: number, data: unknown) => putData<UserItem>(`/users/${id}`, data);
export const deleteUser = (id: number) => deleteData(`/users/${id}`);

export const fetchRoles = () => getData<RoleItem[]>("/roles");
export const createRole = (data: unknown) => postData<RoleItem>("/roles", data);
export const updateRole = (id: number, data: unknown) => putData<RoleItem>(`/roles/${id}`, data);
export const deleteRole = (id: number) => deleteData(`/roles/${id}`);

export const fetchMenus = () => getData<MenuItem[]>("/menus");
export const createMenu = (data: unknown) => postData<MenuItem>("/menus", data);
export const updateMenu = (id: number, data: unknown) => putData<MenuItem>(`/menus/${id}`, data);
export const deleteMenu = (id: number) => deleteData(`/menus/${id}`);
export const fetchPermissions = () =>
  getData<Array<{ id: number; code: string; name: string }>>("/permissions");

export type ApiPermissionRule = {
  id: number;
  method: string;
  path_pattern: string;
  permission_code: string;
  name: string;
  enabled: boolean;
  sort: number;
  updated_at?: string | null;
};

export const fetchApiPermissions = () => getData<ApiPermissionRule[]>("/api-permissions");

export const fetchRegisteredRoutes = () =>
  getData<Array<{ method: string; path_pattern: string; name: string; tags: string[] }>>(
    "/api-permissions/routes",
  );

export const syncApiPermissions = () =>
  postData<{ created: number; total_routes: number }>("/api-permissions/sync");

export const createApiPermission = (data: unknown) =>
  postData<ApiPermissionRule>("/api-permissions", data);

export const updateApiPermission = (id: number, data: unknown) =>
  putData<ApiPermissionRule>(`/api-permissions/${id}`, data);

export const deleteApiPermission = (id: number) => deleteData(`/api-permissions/${id}`);

export const fetchDepts = () => getData<DeptItem[]>("/depts");
export const createDept = (data: unknown) => postData<DeptItem>("/depts", data);
export const updateDept = (id: number, data: unknown) => putData<DeptItem>(`/depts/${id}`, data);
export const deleteDept = (id: number) => deleteData(`/depts/${id}`);

export const fetchDictTypes = () => getData<DictTypeItem[]>("/dicts/types");
export const createDictType = (data: unknown) => postData<DictTypeItem>("/dicts/types", data);
export const updateDictType = (id: number, data: unknown) =>
  putData<DictTypeItem>(`/dicts/types/${id}`, data);
export const deleteDictType = (id: number) => deleteData(`/dicts/types/${id}`);

export const fetchDictItems = (params?: { type_id?: number; type_code?: string }) =>
  getData<DictItemRow[]>("/dicts/items", params);
export const createDictItem = (data: unknown) => postData<DictItemRow>("/dicts/items", data);
export const updateDictItem = (id: number, data: unknown) =>
  putData<DictItemRow>(`/dicts/items/${id}`, data);
export const deleteDictItem = (id: number) => deleteData(`/dicts/items/${id}`);

export const fetchDashboards = (page = 1, pageSize = 20, keyword?: string) =>
  getData<PageResult<DashboardItem>>("/dashboards", {
    page,
    page_size: pageSize,
    keyword,
  });

export const fetchDashboard = (id: number) => getData<DashboardDetail>(`/dashboards/${id}`);
export const executeTool = (name: string, inputs: Record<string, unknown>) =>
  postData(`/tools/${name}/execute`, { inputs });
export const executeSkill = (name: string, inputs: Record<string, unknown>) =>
  postData(`/skills/${name}/execute`, { inputs });
export const aiQuery = (query: string, factoryId = 1) =>
  postData<Record<string, unknown>>("/ai/query", { query, factory_id: factoryId });

export const fetchConfigs = () => getData<ConfigItem[]>("/configs");
export const upsertConfig = (data: unknown) => postData<ConfigItem>("/configs", data);
export const deleteConfig = (id: number) => deleteData(`/configs/${id}`);
