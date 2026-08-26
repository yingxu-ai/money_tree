import {
  ApartmentOutlined,
  AppstoreOutlined,
  BookOutlined,
  ControlOutlined,
  DashboardOutlined,
  FileSearchOutlined,
  FolderOutlined,
  FundOutlined,
  MenuFoldOutlined,
  MenuOutlined,
  MenuUnfoldOutlined,
  RobotOutlined,
  SettingOutlined,
  TableOutlined,
  TeamOutlined,
  UserOutlined,
} from "@ant-design/icons";
import { Button, Dropdown, Layout, Menu, Typography } from "antd";
import type { MenuProps } from "antd";
import { useEffect, useMemo, useState } from "react";
import { useLocation, useNavigate } from "react-router-dom";
import LayoutSwitcher from "@/components/LayoutSwitcher";
import ThemeSwitcher from "@/components/ThemeSwitcher";
import UserAvatar from "@/components/kit/UserAvatar";
import UserProfileModal from "@/components/UserProfileModal";
import { useAppConfig, useDocumentTitle } from "@/hooks/useAppConfig";
import { useAppConfigStore } from "@/stores/appConfigStore";
import { useAuthStore } from "@/stores/authStore";
import type { MenuNode } from "@/types";

const { Header, Sider, Content } = Layout;

const iconMap: Record<string, React.ReactNode> = {
  SettingOutlined: <SettingOutlined />,
  UserOutlined: <UserOutlined />,
  TeamOutlined: <TeamOutlined />,
  MenuOutlined: <MenuOutlined />,
  DashboardOutlined: <DashboardOutlined />,
  RobotOutlined: <RobotOutlined />,
  ControlOutlined: <ControlOutlined />,
  FolderOutlined: <FolderOutlined />,
  FileSearchOutlined: <FileSearchOutlined />,
  ApartmentOutlined: <ApartmentOutlined />,
  BookOutlined: <BookOutlined />,
  AppstoreOutlined: <AppstoreOutlined />,
  FundOutlined: <FundOutlined />,
  TableOutlined: <TableOutlined />,
};

function toMenuItems(nodes: MenuNode[]): Array<{
  key: string;
  icon?: React.ReactNode;
  label: React.ReactNode;
  children?: ReturnType<typeof toMenuItems>;
}> {
  return nodes
    .filter((n) => n.type !== "BUTTON")
    .map((node) => {
      const isCatalog = node.type === "CATALOG";
      // 目录用 menu-{id}，叶子页用真实 path，便于点击跳转与选中
      const key = isCatalog ? `menu-${node.id}` : node.path || `menu-${node.id}`;
      return {
        key,
        icon: node.icon ? iconMap[node.icon] : undefined,
        label: node.name,
        children: node.children?.length ? toMenuItems(node.children) : undefined,
      };
    });
}

function collectOpenKeys(pathname: string, nodes: MenuNode[], parents: string[] = []): string[] {
  for (const node of nodes) {
    const key = node.type === "CATALOG" ? `menu-${node.id}` : node.path || `menu-${node.id}`;
    if (node.path === pathname) return parents;
    if (node.children?.length) {
      const found = collectOpenKeys(pathname, node.children, [...parents, key]);
      if (found.length || node.children.some((c) => c.path === pathname)) {
        return found.length ? found : [...parents, key];
      }
    }
  }
  return [];
}

function DefaultLogo() {
  return (
    <span className="app-logo-mark" aria-hidden>
      <i />
      <i />
      <i />
      <i />
    </span>
  );
}

export default function MainLayout({ children }: { children: React.ReactNode }) {
  const location = useLocation();
  const navigate = useNavigate();
  const user = useAuthStore((s) => s.user);
  const menus = useAuthStore((s) => s.menus);
  const logout = useAuthStore((s) => s.logout);
  const { appSidebarTitle, appLogoUrl } = useAppConfig();
  const themeName = useAppConfigStore((s) => s.config.theme);
  const navLayout = useAppConfigStore((s) => s.config.navLayout);
  const siderTheme = themeName === "dark" ? "dark" : "light";
  const isTopNav = navLayout === "top";
  useDocumentTitle();

  const [siderOpen, setSiderOpen] = useState(() => {
    return localStorage.getItem("sider_open") !== "0";
  });

  useEffect(() => {
    localStorage.setItem("sider_open", siderOpen ? "1" : "0");
  }, [siderOpen]);

  useEffect(() => {
    document.documentElement.dataset.navLayout = navLayout;
  }, [navLayout]);

  const menuItems = useMemo(() => toMenuItems(menus), [menus]);
  const openKeys = useMemo(
    () => collectOpenKeys(location.pathname, menus),
    [location.pathname, menus]
  );
  const [opened, setOpened] = useState<string[]>([]);
  const [profileOpen, setProfileOpen] = useState(false);

  useEffect(() => {
    setOpened((prev) => Array.from(new Set([...prev, ...openKeys])));
  }, [openKeys]);

  // 驾驶舱详情页也高亮「驾驶舱」菜单
  const selectedKey = location.pathname.startsWith("/dashboards")
    ? "/dashboards"
    : location.pathname;

  const onMenuClick = ({ key }: { key: string }) => {
    // 仅 path 型菜单跳转；目录 key 以 menu- 开头不跳转
    if (key.startsWith("/")) {
      navigate(key);
    }
  };

  const userName = user?.display_name || user?.username || "用户";

  const userMenuItems: MenuProps["items"] = [
    {
      key: "username",
      label: <span className="app-header-user-name">{userName}</span>,
      disabled: true,
    },
    { type: "divider" },
    { key: "profile", label: "详情" },
    { key: "logout", label: "退出" },
  ];

  const onUserMenuClick: MenuProps["onClick"] = ({ key }) => {
    if (key === "profile") {
      setProfileOpen(true);
      return;
    }
    if (key === "logout") {
      logout();
      navigate("/login");
    }
  };

  const brand = (
    <div className="app-header-brand">
      {appLogoUrl ? (
        <img src={appLogoUrl} alt="logo" className="app-logo-img" />
      ) : (
        <DefaultLogo />
      )}
      <Typography.Text className="app-header-brand-title">{appSidebarTitle}</Typography.Text>
    </div>
  );

  const accountActions = (
    <div className="app-header-right">
      <ThemeSwitcher />
      <LayoutSwitcher />
      <Dropdown
        menu={{ items: userMenuItems, onClick: onUserMenuClick }}
        placement="bottomRight"
        trigger={["hover"]}
      >
        <span className="app-header-user" role="button" tabIndex={0} title={userName}>
          <UserAvatar avatarUrl={user?.avatar_url} name={userName} size={22} />
        </span>
      </Dropdown>
    </div>
  );

  return (
    <Layout className={`app-shell app-shell--${navLayout}`}>
      <Header className="app-header">
        <div className="app-header-left">
          {brand}

          {!isTopNav && (
            <Button
              type="text"
              className="app-header-menu-btn"
              icon={siderOpen ? <MenuFoldOutlined /> : <MenuUnfoldOutlined />}
              aria-label={siderOpen ? "隐藏菜单" : "显示菜单"}
              onClick={() => setSiderOpen((v) => !v)}
            />
          )}
        </div>

        {isTopNav && (
          <div className="app-header-center">
            <Menu
              theme={siderTheme}
              mode="horizontal"
              selectedKeys={[selectedKey]}
              items={menuItems}
              className="app-top-menu"
              disabledOverflow={false}
              onClick={onMenuClick}
            />
          </div>
        )}

        {accountActions}
      </Header>

      <Layout className="app-body">
        {!isTopNav && siderOpen && (
          <Sider width={220} className="app-sider" theme={siderTheme} trigger={null}>
            <Menu
              theme={siderTheme}
              mode="inline"
              selectedKeys={[selectedKey]}
              openKeys={opened}
              onOpenChange={setOpened}
              items={menuItems}
              className="app-sider-menu app-thin-scroll"
              onClick={onMenuClick}
            />
          </Sider>
        )}
        <Content className="app-content app-thin-scroll">{children}</Content>
      </Layout>

      <UserProfileModal open={profileOpen} onClose={() => setProfileOpen(false)} />
    </Layout>
  );
}
