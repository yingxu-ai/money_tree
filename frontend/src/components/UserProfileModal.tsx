import { Descriptions, Form, Input, Modal, Space, Spin, Tag, message } from "antd";
import { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { changePassword, fetchMe, updateProfile } from "@/api/auth";
import { ApiError } from "@/api/errors";
import AvatarPicker from "@/components/kit/AvatarPicker";
import FormModal from "@/components/kit/FormModal";
import UserAvatar from "@/components/kit/UserAvatar";
import { DEFAULT_AVATAR } from "@/config/avatars";
import { useAuthStore } from "@/stores/authStore";
import type { UserInfo } from "@/types";

const DATA_SCOPE_LABEL: Record<string, string> = {
  ALL: "全部数据",
  ORG: "本组织及下级",
  SELF_ORG: "本部门",
  CUSTOM: "自定义",
  SELF: "仅本人",
};

const STATUS_LABEL: Record<string, string> = {
  active: "启用",
  disabled: "停用",
};

interface UserProfileModalProps {
  open: boolean;
  onClose: () => void;
}

export default function UserProfileModal({ open, onClose }: UserProfileModalProps) {
  const navigate = useNavigate();
  const setUser = useAuthStore((s) => s.setUser);
  const logout = useAuthStore((s) => s.logout);
  const cachedUser = useAuthStore((s) => s.user);

  const [profile, setProfile] = useState<UserInfo | null>(cachedUser);
  const [loading, setLoading] = useState(false);
  const [editOpen, setEditOpen] = useState(false);
  const [pwdOpen, setPwdOpen] = useState(false);
  const [saving, setSaving] = useState(false);
  const [avatarDraft, setAvatarDraft] = useState<string | null>(null);
  const [profileForm] = Form.useForm();
  const [pwdForm] = Form.useForm();

  useEffect(() => {
    if (!open) return;
    let cancelled = false;
    setLoading(true);
    fetchMe()
      .then((data) => {
        if (cancelled) return;
        setProfile(data);
        setUser(data);
      })
      .catch((err) => {
        const msg =
          err instanceof ApiError ? err.message : err instanceof Error ? err.message : "加载失败";
        message.error(msg);
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [open, setUser]);

  const roleLabels =
    profile?.role_names?.length ? profile.role_names : profile?.roles?.length ? profile.roles : [];

  const openEdit = () => {
    profileForm.setFieldsValue({
      display_name: profile?.display_name || "",
      email: profile?.email || "",
    });
    setAvatarDraft(profile?.avatar_url || DEFAULT_AVATAR);
    setEditOpen(true);
  };

  const onAvatarChange = async (avatarUrl: string) => {
    setAvatarDraft(avatarUrl);
    // 上传模式已在服务端写入；预设选择需走资料更新
    if (avatarUrl.startsWith("/avatars/")) {
      try {
        const updated = await updateProfile({ avatar_url: avatarUrl });
        setProfile(updated);
        setUser(updated);
      } catch (err) {
        const msg =
          err instanceof ApiError ? err.message : err instanceof Error ? err.message : "更新失败";
        message.error(msg);
      }
    } else if (avatarUrl.startsWith("file:")) {
      // uploadAvatar 已落库，刷新本地
      const me = await fetchMe();
      setProfile(me);
      setUser(me);
    }
  };

  const saveProfile = async () => {
    const values = await profileForm.validateFields();
    setSaving(true);
    try {
      const updated = await updateProfile({
        display_name: values.display_name,
        email: values.email || null,
        avatar_url: avatarDraft,
      });
      setProfile(updated);
      setUser(updated);
      message.success("资料已更新");
      setEditOpen(false);
    } catch (err) {
      const msg =
        err instanceof ApiError ? err.message : err instanceof Error ? err.message : "更新失败";
      message.error(msg);
    } finally {
      setSaving(false);
    }
  };

  const savePassword = async () => {
    const values = await pwdForm.validateFields();
    setSaving(true);
    try {
      await changePassword({
        old_password: values.old_password,
        new_password: values.new_password,
      });
      message.success("密码修改成功，请重新登录");
      setPwdOpen(false);
      onClose();
      logout();
      navigate("/login");
    } catch (err) {
      const msg =
        err instanceof ApiError ? err.message : err instanceof Error ? err.message : "修改失败";
      message.error(msg);
    } finally {
      setSaving(false);
    }
  };

  return (
    <>
      <Modal
        title="用户详情"
        open={open}
        onCancel={onClose}
        footer={
          <Space>
            <a onClick={openEdit}>修改资料</a>
            <a onClick={() => setPwdOpen(true)}>修改密码</a>
          </Space>
        }
        destroyOnHidden
        width={560}
      >
        <Spin spinning={loading}>
          <div style={{ display: "flex", justifyContent: "center", marginBottom: 16 }}>
            <UserAvatar
              avatarUrl={profile?.avatar_url}
              name={profile?.display_name || profile?.username}
              size={72}
            />
          </div>
          <Descriptions column={1} bordered size="small">
            <Descriptions.Item label="用户名">{profile?.username || "-"}</Descriptions.Item>
            <Descriptions.Item label="显示名称">{profile?.display_name || "-"}</Descriptions.Item>
            <Descriptions.Item label="邮箱">{profile?.email || "-"}</Descriptions.Item>
            <Descriptions.Item label="所属部门">{profile?.dept_name || "-"}</Descriptions.Item>
            <Descriptions.Item label="角色">
              {roleLabels.length
                ? roleLabels.map((name) => (
                    <Tag key={name} color="processing">
                      {name}
                    </Tag>
                  ))
                : "-"}
            </Descriptions.Item>
            <Descriptions.Item label="账号状态">
              {STATUS_LABEL[profile?.status || ""] || profile?.status || "-"}
            </Descriptions.Item>
            <Descriptions.Item label="数据权限">
              {DATA_SCOPE_LABEL[profile?.data_scope || ""] || profile?.data_scope || "-"}
            </Descriptions.Item>
            <Descriptions.Item label="创建时间">
              {profile?.created_at ? profile.created_at.replace("T", " ").slice(0, 19) : "-"}
            </Descriptions.Item>
          </Descriptions>
        </Spin>
      </Modal>

      <FormModal
        title="修改资料"
        open={editOpen}
        form={profileForm}
        confirmLoading={saving}
        onCancel={() => setEditOpen(false)}
        onOk={saveProfile}
        okText="保存"
      >
        <Form.Item label="头像">
          <AvatarPicker value={avatarDraft} onChange={onAvatarChange} mode="profile" />
        </Form.Item>
        <Form.Item
          name="display_name"
          label="显示名称"
          rules={[{ required: true, message: "请输入显示名称" }]}
        >
          <Input maxLength={128} placeholder="显示名称" />
        </Form.Item>
        <Form.Item name="email" label="邮箱" rules={[{ type: "email", message: "邮箱格式不正确" }]}>
          <Input maxLength={128} placeholder="邮箱（可选）" />
        </Form.Item>
      </FormModal>

      <FormModal
        title="修改密码"
        open={pwdOpen}
        form={pwdForm}
        confirmLoading={saving}
        onCancel={() => {
          setPwdOpen(false);
          pwdForm.resetFields();
        }}
        onOk={savePassword}
        okText="确认修改"
      >
        <Form.Item
          name="old_password"
          label="当前密码"
          rules={[{ required: true, message: "请输入当前密码" }]}
        >
          <Input.Password placeholder="当前密码" autoComplete="current-password" />
        </Form.Item>
        <Form.Item
          name="new_password"
          label="新密码"
          rules={[
            { required: true, message: "请输入新密码" },
            { min: 6, message: "新密码至少 6 位" },
          ]}
        >
          <Input.Password placeholder="新密码（至少 6 位）" autoComplete="new-password" />
        </Form.Item>
        <Form.Item
          name="confirm_password"
          label="确认新密码"
          dependencies={["new_password"]}
          rules={[
            { required: true, message: "请再次输入新密码" },
            ({ getFieldValue }) => ({
              validator(_, value) {
                if (!value || getFieldValue("new_password") === value) {
                  return Promise.resolve();
                }
                return Promise.reject(new Error("两次输入的新密码不一致"));
              },
            }),
          ]}
        >
          <Input.Password placeholder="再次输入新密码" autoComplete="new-password" />
        </Form.Item>
      </FormModal>
    </>
  );
}
