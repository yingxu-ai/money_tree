import type { ModuleRegistration } from "@/platform/modules/types";
import UsersPage from "@/pages/system/UsersPage";
import RolesPage from "@/pages/system/RolesPage";
import MenusPage from "@/pages/system/MenusPage";
import ApiPermissionsPage from "@/pages/system/ApiPermissionsPage";
import AuditPage from "@/pages/system/AuditPage";
import DeptsPage from "@/pages/system/DeptsPage";
import DictsPage from "@/pages/system/DictsPage";

export const systemModule: ModuleRegistration = {
  moduleId: "system",
  routes: [
    { moduleId: "system", path: "/system/users", element: <UsersPage /> },
    { moduleId: "system", path: "/system/roles", element: <RolesPage /> },
    { moduleId: "system", path: "/system/menus", element: <MenusPage /> },
    { moduleId: "system", path: "/system/api-permissions", element: <ApiPermissionsPage /> },
    { moduleId: "system", path: "/system/depts", element: <DeptsPage /> },
    { moduleId: "system", path: "/system/dicts", element: <DictsPage /> },
    { moduleId: "system", path: "/system/audit", element: <AuditPage /> },
  ],
};
