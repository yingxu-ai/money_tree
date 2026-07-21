import { Space } from "antd";
import { useCallback, useEffect, useState } from "react";
import { deleteFile, fetchFiles, type FileItem } from "@/api/files";
import {
  DataTable,
  DeleteAction,
  FileDownloadButton,
  FileUploadButton,
  PageHeader,
  SearchBar,
} from "@/components/kit";
import { usePagination } from "@/hooks/usePagination";
import { useRequest } from "@/hooks/useRequest";

function formatSize(size: number) {
  if (size < 1024) return `${size} B`;
  if (size < 1024 * 1024) return `${(size / 1024).toFixed(1)} KB`;
  return `${(size / 1024 / 1024).toFixed(1)} MB`;
}

export default function FilesPage() {
  const [keyword, setKeyword] = useState("");
  const { page, pageSize, setFromResult, tablePagination, setPage } = usePagination({
    pageSize: 20,
  });

  const fetcher = useCallback(
    () => fetchFiles(page, pageSize, keyword || undefined),
    [page, pageSize, keyword],
  );

  const { data, loading, run } = useRequest(fetcher, { immediate: false });

  useEffect(() => {
    void run().then((result) => {
      if (result) setFromResult(result);
    });
  }, [run, setFromResult]);

  const reload = async () => {
    const result = await run();
    if (result) setFromResult(result);
  };

  return (
    <div>
      <PageHeader title="文件中心" />
      <SearchBar
        placeholder="搜索文件名"
        showReset
        onSearch={(v) => {
          setKeyword(v);
          setPage(1);
        }}
        extra={<FileUploadButton onUploaded={reload} />}
      />

      <DataTable<FileItem>
        rowKey="id"
        loading={loading}
        dataSource={data?.items ?? []}
        pagination={tablePagination}
        columns={[
          { title: "文件名", dataIndex: "original_name" },
          { title: "类型", dataIndex: "mime_type", width: 180 },
          {
            title: "大小",
            dataIndex: "size",
            width: 100,
            render: (v: number) => formatSize(v),
          },
          { title: "上传时间", dataIndex: "created_at", width: 180 },
          {
            title: "操作",
            width: 180,
            render: (_, record) => (
              <Space>
                <FileDownloadButton fileId={record.id} filename={record.original_name} />
                <DeleteAction
                  permission="file:delete"
                  title="确认删除文件？"
                  content={`将删除「${record.original_name}」。`}
                  successMessage="已删除"
                  onConfirm={async () => {
                    await deleteFile(record.id);
                    await reload();
                  }}
                />
              </Space>
            ),
          },
        ]}
      />
    </div>
  );
}
