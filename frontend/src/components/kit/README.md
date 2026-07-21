# 前端通用积木（kit）

供业务分支直接引用，少写样板代码。

## 导入

```ts
import {
  DataTable,
  FormModal,
  PageHeader,
  SearchBar,
  AuthButton,
  EditAction,
  DeleteAction,
  DictSelect,
  DeptTreeSelect,
  StatusTag,
  FileUploadButton,
  FileDownloadButton,
  EmptyState,
  ErrorState,
  notifySuccess,
} from "@/components/kit";
```

## 典型 CRUD 页骨架

```tsx
<PageHeader title="用户管理" extra={<AuthButton type="primary" permission="user:create" onClick={openCreate}>新增</AuthButton>} />
<DataTable columns={[..., { title: "操作", render: (_, r) => (
  <Space>
    <EditAction onClick={() => openEdit(r)} />
    <DeleteAction onConfirm={async () => { await del(r.id); await refresh(); }} />
  </Space>
)}]} />
<FormModal open={open} form={form} title="..." onCancel={close} onOk={submit}>
  <Form.Item name="x" label="X"><Input /></Form.Item>
</FormModal>
```

## 清单

| 积木 | 用途 |
|------|------|
| `useRequest` / `useMutation` / `usePagination` / `useDict` | 请求与分页钩子 |
| `DataTable` | 表壳 + 空态 |
| `FormModal` | Modal + Form CRUD |
| `PageHeader` / `SearchBar` | 页头与搜索 |
| `AuthButton` / `EditAction` / `DeleteAction` | 权限按钮与操作列 |
| `DictSelect` / `DeptTreeSelect` / `StatusTag` | 字典/部门/状态 |
| `FileUploadButton` / `FileDownloadButton` | 文件 |
| `EmptyState` / `ErrorState` | 空态 / 错误态 |
| `LineChart` / `BarChart` / `PieChart` | `@/charts` |
