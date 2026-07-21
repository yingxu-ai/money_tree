import { Tabs } from "antd";
import { useCallback, useEffect } from "react";
import {
  fetchLoginLogs,
  fetchOperationLogs,
  type LoginLogItem,
  type OperationLogItem,
} from "@/api/files";
import { DataTable, PageHeader, StatusTag } from "@/components/kit";
import { usePagination } from "@/hooks/usePagination";
import { useRequest } from "@/hooks/useRequest";

export default function AuditPage() {
  const opPager = usePagination({ pageSize: 20 });
  const loginPager = usePagination({ pageSize: 20 });

  const opFetcher = useCallback(
    () => fetchOperationLogs(opPager.page, opPager.pageSize),
    [opPager.page, opPager.pageSize],
  );
  const loginFetcher = useCallback(
    () => fetchLoginLogs(loginPager.page, loginPager.pageSize),
    [loginPager.page, loginPager.pageSize],
  );

  const {
    data: opData,
    loading: opLoading,
    run: runOps,
  } = useRequest(opFetcher, { immediate: false });
  const {
    data: loginData,
    loading: loginLoading,
    run: runLogins,
  } = useRequest(loginFetcher, { immediate: false });

  useEffect(() => {
    void runOps().then((result) => {
      if (result) opPager.setFromResult(result);
    });
  }, [runOps, opPager.setFromResult]);

  useEffect(() => {
    void runLogins().then((result) => {
      if (result) loginPager.setFromResult(result);
    });
  }, [runLogins, loginPager.setFromResult]);

  return (
    <div>
      <PageHeader title="审计日志" />
      <Tabs
        items={[
          {
            key: "operations",
            label: "操作审计",
            children: (
              <DataTable<OperationLogItem>
                rowKey="id"
                loading={opLoading}
                dataSource={opData?.items ?? []}
                pagination={opPager.tablePagination}
                columns={[
                  { title: "用户", dataIndex: "user_id", width: 80 },
                  { title: "资源", dataIndex: "resource", width: 120 },
                  { title: "动作", dataIndex: "action", width: 90 },
                  {
                    title: "结果",
                    dataIndex: "result",
                    width: 90,
                    render: (v) => <StatusTag value={v} />,
                  },
                  {
                    title: "请求摘要",
                    dataIndex: "request",
                    ellipsis: true,
                  },
                  { title: "Trace", dataIndex: "trace_id", width: 160, ellipsis: true },
                  { title: "时间", dataIndex: "created_at", width: 180 },
                ]}
              />
            ),
          },
          {
            key: "logins",
            label: "登录日志",
            children: (
              <DataTable<LoginLogItem>
                rowKey="id"
                loading={loginLoading}
                dataSource={loginData?.items ?? []}
                pagination={loginPager.tablePagination}
                columns={[
                  { title: "用户名", dataIndex: "username" },
                  { title: "用户ID", dataIndex: "user_id", width: 90 },
                  { title: "IP", dataIndex: "ip", width: 140 },
                  {
                    title: "结果",
                    dataIndex: "result",
                    width: 100,
                    render: (v) => <StatusTag value={v} />,
                  },
                  { title: "时间", dataIndex: "created_at", width: 180 },
                ]}
              />
            ),
          },
        ]}
      />
    </div>
  );
}
