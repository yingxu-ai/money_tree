import { useMemo, useState, type ReactNode } from "react";
import ReactECharts from "echarts-for-react";
import type { EChartsOption } from "echarts";
import { Alert, Button, Card, Col, Row, Space, Tag, Typography } from "antd";
import "echarts-gl";

export interface MultidimSample {
  id: number;
  t_idx: number;
  time_label: string;
  cluster: "normal" | "drift" | "abnormal" | string;
  features: number[];
  pca: [number, number] | number[];
}

export interface MultidimPanelData {
  title: string;
  overview: string;
  method_note?: string;
  feature_axes: Array<{ key: string; name: string }>;
  samples: MultidimSample[];
  cluster_legend: Array<{ key: string; label: string; color: string }>;
  cluster_counts?: Record<string, number>;
  fft_slices: Array<{
    sample_id: number;
    t_idx: number;
    time_label: string;
    unit?: string;
    points: Array<{ f: number; amp: number }>;
    peaks?: Array<{ f: number; amp: number; label: string }>;
  }>;
  waterfall: {
    freq_hz: number[];
    time_labels: string[];
    grid: number[][];
    unit: string;
    highlight_freq_hz?: number;
  };
  f0_hz?: number;
  rpm?: number;
}

const CLUSTER_COLOR: Record<string, string> = {
  normal: "#1677ff",
  drift: "#52c41a",
  abnormal: "#cf1322",
};

function colorOf(cluster: string, legend?: MultidimPanelData["cluster_legend"]) {
  const fromLegend = legend?.find((l) => l.key === cluster)?.color;
  return fromLegend || CLUSTER_COLOR[cluster] || "#8c8c8c";
}

/** 框选/点击后的联动选择：样本 id 集合 */
function useLinkedSelection(samples: MultidimSample[]) {
  const [selectedIds, setSelectedIds] = useState<number[] | null>(null);

  const selectedSet = useMemo(() => {
    if (!selectedIds?.length) return null;
    return new Set(selectedIds);
  }, [selectedIds]);

  const selectedTimeIdx = useMemo(() => {
    if (!selectedSet) return null;
    const ts = new Set<number>();
    for (const s of samples) {
      if (selectedSet.has(s.id)) ts.add(s.t_idx);
    }
    return ts.size ? ts : null;
  }, [samples, selectedSet]);

  const clear = () => setSelectedIds(null);
  const selectIds = (ids: number[]) => setSelectedIds(ids.length ? ids : null);
  const selectByTime = (tIdxs: number[]) => {
    const set = new Set(tIdxs);
    selectIds(samples.filter((s) => set.has(s.t_idx)).map((s) => s.id));
  };
  const selectByCluster = (cluster: string) => {
    selectIds(samples.filter((s) => s.cluster === cluster).map((s) => s.id));
  };

  return { selectedIds, selectedSet, selectedTimeIdx, clear, selectIds, selectByTime, selectByCluster };
}

function ChartCard({
  title,
  hint,
  children,
  extra,
}: {
  title: string;
  hint: string;
  children: ReactNode;
  extra?: ReactNode;
}) {
  return (
    <Card
      size="small"
      title={title}
      extra={extra}
      styles={{ body: { padding: 8 } }}
      style={{ height: "100%" }}
    >
      <Typography.Paragraph type="secondary" style={{ fontSize: 12, margin: "0 0 8px" }}>
        {hint}
      </Typography.Paragraph>
      {children}
    </Card>
  );
}

function ParallelChart({
  panel,
  selectedSet,
  onSelectIds,
}: {
  panel: MultidimPanelData;
  selectedSet: Set<number> | null;
  onSelectIds: (ids: number[]) => void;
}) {
  const axes = panel.feature_axes;
  const option: EChartsOption = useMemo(() => {
    const data = panel.samples.map((s) => {
      const active = !selectedSet || selectedSet.has(s.id);
      return {
        value: s.features,
        sampleId: s.id,
        cluster: s.cluster,
        lineStyle: {
          width: active && selectedSet ? 2.2 : 1,
          opacity: selectedSet ? (active ? 0.85 : 0.06) : 0.28,
          color: colorOf(s.cluster, panel.cluster_legend),
        },
      };
    });
    return {
      animation: false,
      tooltip: {
        formatter: (params: unknown) => {
          const p = params as { data?: { sampleId?: number; cluster?: string; value?: number[] } };
          const d = p.data;
          if (!d?.value) return "";
          const lines = axes.map((a, i) => `${a.name}: ${d.value![i]}`).join("<br/>");
          return `样本 #${d.sampleId} · ${d.cluster}<br/>${lines}`;
        },
      },
      parallelAxis: axes.map((a, i) => ({
        dim: i,
        name: a.name,
        nameLocation: "end" as const,
        nameGap: 6,
        nameTextStyle: { fontSize: 10 },
        min: 0,
        max: 100,
        axisLabel: { fontSize: 9 },
      })),
      parallel: {
        left: 48,
        right: 28,
        top: 36,
        bottom: 28,
        parallelAxisDefault: {
          type: "value",
          axisLine: { lineStyle: { color: "#bfbfbf" } },
          axisTick: { show: false },
        },
      },
      series: [
        {
          type: "parallel",
          smooth: 0.15,
          progressive: 0,
          data,
        },
      ],
    };
  }, [panel, selectedSet, axes]);

  return (
    <ReactECharts
      option={option}
      style={{ height: 320, width: "100%" }}
      notMerge
      lazyUpdate
      onEvents={{
        click: (params: { data?: { sampleId?: number } }) => {
          const id = params.data?.sampleId;
          if (id == null) return;
          onSelectIds([id]);
        },
      }}
    />
  );
}

function ClusterScatter({
  panel,
  selectedSet,
  onSelectIds,
}: {
  panel: MultidimPanelData;
  selectedSet: Set<number> | null;
  onSelectIds: (ids: number[]) => void;
}) {
  const option: EChartsOption = useMemo(() => {
    const byCluster = new Map<string, Array<[number, number, number]>>();
    for (const s of panel.samples) {
      const arr = byCluster.get(s.cluster) || [];
      arr.push([s.pca[0], s.pca[1], s.id]);
      byCluster.set(s.cluster, arr);
    }
    return {
      animation: false,
      legend: {
        top: 0,
        data: panel.cluster_legend.map((l) => l.label),
      },
      grid: { left: 48, right: 16, top: 36, bottom: 40 },
      toolbox: {
        right: 8,
        feature: {
          brush: { type: ["rect", "polygon", "clear"] },
        },
      },
      brush: {
        toolbox: ["rect", "polygon", "clear"],
        xAxisIndex: 0,
        brushLink: "all",
        outOfBrush: { colorAlpha: 0.15 },
      },
      tooltip: {
        formatter: (p: unknown) => {
          const item = p as { data?: number[]; seriesName?: string };
          const d = item.data;
          if (!d) return "";
          return `${item.seriesName}<br/>样本 #${d[2]}<br/>PC1=${d[0]} · PC2=${d[1]}`;
        },
      },
      xAxis: {
        name: "PC1（虚拟）",
        nameLocation: "middle",
        nameGap: 24,
        splitLine: { lineStyle: { type: "dashed" } },
      },
      yAxis: {
        name: "PC2（虚拟）",
        splitLine: { lineStyle: { type: "dashed" } },
      },
      series: panel.cluster_legend.map((leg) => {
        const raw = byCluster.get(leg.key) || [];
        const data = raw.map(([x, y, id]) => {
          const active = !selectedSet || selectedSet.has(id);
          return {
            value: [x, y, id],
            itemStyle: {
              opacity: selectedSet ? (active ? 1 : 0.12) : 0.85,
              color: leg.color,
            },
          };
        });
        return {
          name: leg.label,
          type: "scatter" as const,
          symbolSize: selectedSet ? 9 : 7,
          data,
        };
      }),
    };
  }, [panel, selectedSet]);

  return (
    <ReactECharts
      option={option}
      style={{ height: 320, width: "100%" }}
      notMerge
      lazyUpdate
      onEvents={{
        brushEnd: (params: {
          batch?: Array<{
            selected?: Array<{ seriesIndex: number; dataIndex: number[] }>;
          }>;
        }) => {
          const batch = params.batch?.[0];
          if (!batch?.selected?.length) {
            return;
          }
          const ids: number[] = [];
          for (const sel of batch.selected) {
            const series = panel.cluster_legend[sel.seriesIndex];
            if (!series) continue;
            const clusterSamples = panel.samples.filter((s) => s.cluster === series.key);
            for (const di of sel.dataIndex || []) {
              const s = clusterSamples[di];
              if (s) ids.push(s.id);
            }
          }
          if (ids.length) onSelectIds(ids);
        },
        click: (params: { data?: { value?: number[] } | number[] }) => {
          const raw = params.data;
          const value = Array.isArray(raw) ? raw : raw?.value;
          if (!value || value.length < 3) return;
          onSelectIds([value[2]]);
        },
        legendselectchanged: (params: { selected: Record<string, boolean> }) => {
          const activeLabels = Object.entries(params.selected)
            .filter(([, v]) => v)
            .map(([k]) => k);
          const keys = panel.cluster_legend.filter((l) => activeLabels.includes(l.label)).map((l) => l.key);
          onSelectIds(panel.samples.filter((s) => keys.includes(s.cluster)).map((s) => s.id));
        },
      }}
    />
  );
}

function FftStackChart({
  panel,
  selectedSet,
  selectedTimeIdx,
  onSelectByTime,
  onFreqBrush,
}: {
  panel: MultidimPanelData;
  selectedSet: Set<number> | null;
  selectedTimeIdx: Set<number> | null;
  onSelectByTime: (tIdxs: number[]) => void;
  onFreqBrush: (f0: number, f1: number) => void;
}) {
  const slices = useMemo(() => {
    if (!selectedTimeIdx?.size) return panel.fft_slices;
    // 从选中时间步挑至多 3 个切片：用瀑布行 + 默认切片结构
    const times = [...selectedTimeIdx].sort((a, b) => a - b);
    const pick =
      times.length <= 3
        ? times
        : [times[0], times[Math.floor(times.length / 2)], times[times.length - 1]];
    return pick.map((ti) => {
      const sample = panel.samples.find((s) => s.t_idx === ti);
      const row = panel.waterfall.grid[ti] || [];
      const freq = panel.waterfall.freq_hz;
      // 瀑布抽稀 → 插成折线
      const points = freq.map((f, i) => ({ f, amp: row[i] ?? 0 }));
      const f0 = panel.f0_hz || 50;
      const peakFs = [f0, 2 * f0];
      const peaks = peakFs.map((pf) => {
        const nearest = points.reduce((b, p) => (Math.abs(p.f - pf) < Math.abs(b.f - pf) ? p : b));
        return { f: nearest.f, amp: nearest.amp, label: `${nearest.f}Hz · ${nearest.amp}` };
      });
      return {
        sample_id: sample?.id ?? 0,
        t_idx: ti,
        time_label: panel.waterfall.time_labels[ti] || `t${ti}`,
        unit: panel.waterfall.unit,
        points,
        peaks,
        _fromSelection: true as const,
      };
    });
  }, [panel, selectedTimeIdx]);

  const n = Math.max(slices.length, 1);
  const option: EChartsOption = useMemo(() => {
    const grids = slices.map((_, i) => ({
      left: 48,
      right: 56,
      top: `${(i * 100) / n + 4}%`,
      height: `${88 / n}%`,
    }));
    const xAxes = slices.map((_, i) => ({
      type: "value" as const,
      gridIndex: i,
      min: 0,
      max: 400,
      show: i === n - 1,
      name: i === n - 1 ? "Hz" : undefined,
      nameLocation: "middle" as const,
      nameGap: 22,
    }));
    const yAxes = slices.map((sl, i) => ({
      type: "value" as const,
      gridIndex: i,
      name: sl.time_label,
      nameTextStyle: { fontSize: 10 },
      scale: true,
      axisLabel: { fontSize: 9 },
      splitNumber: 2,
    }));
    const series = slices.flatMap((sl, i) => {
      const dimmed = selectedSet && !selectedSet.has(sl.sample_id) && !selectedTimeIdx?.has(sl.t_idx);
      return [
        {
          type: "line" as const,
          xAxisIndex: i,
          yAxisIndex: i,
          showSymbol: false,
          data: sl.points.map((p) => [p.f, p.amp]),
          lineStyle: { width: 1.2, color: "#1677ff", opacity: dimmed ? 0.25 : 1 },
          areaStyle: { opacity: dimmed ? 0.02 : 0.06 },
        },
        {
          type: "scatter" as const,
          xAxisIndex: i,
          yAxisIndex: i,
          symbolSize: 8,
          data: (sl.peaks || []).map((p) => ({
            value: [p.f, p.amp],
            label: {
              show: true,
              formatter: p.label,
              position: "top" as const,
              fontSize: 10,
              backgroundColor: "rgba(22,119,255,0.12)",
              padding: [2, 4],
              borderRadius: 2,
            },
          })),
          itemStyle: { color: "#1677ff" },
        },
      ];
    });
    return {
      animation: false,
      axisPointer: { link: [{ xAxisIndex: "all" }] },
      brush: {
        xAxisIndex: "all",
        brushLink: "all",
        toolbox: ["lineX", "clear"],
        throttleType: "debounce",
        throttleDelay: 200,
      },
      toolbox: {
        right: 4,
        top: 0,
        feature: { brush: { type: ["lineX", "clear"] } },
      },
      tooltip: { trigger: "axis", axisPointer: { type: "cross" } },
      grid: grids,
      xAxis: xAxes,
      yAxis: yAxes,
      series,
    };
  }, [slices, n, selectedSet, selectedTimeIdx]);

  return (
    <ReactECharts
      option={option}
      style={{ height: 340, width: "100%" }}
      notMerge
      lazyUpdate
      onEvents={{
        brushEnd: (params: {
          areas?: Array<{ coordRange?: number[]; brushType?: string }>;
        }) => {
          const area = params.areas?.[0];
          if (!area?.coordRange || area.coordRange.length < 2) return;
          const [a, b] = area.coordRange;
          onFreqBrush(Math.min(a, b), Math.max(a, b));
        },
        click: (params: { seriesIndex?: number }) => {
          const si = params.seriesIndex ?? 0;
          const sliceIdx = Math.floor(si / 2);
          const sl = slices[sliceIdx];
          if (sl) onSelectByTime([sl.t_idx]);
        },
      }}
    />
  );
}

function Waterfall3D({
  panel,
  selectedTimeIdx,
  onSelectByTime,
}: {
  panel: MultidimPanelData;
  selectedTimeIdx: Set<number> | null;
  onSelectByTime: (tIdxs: number[]) => void;
}) {
  const { freq_hz, time_labels, grid, unit } = panel.waterfall;
  const option = useMemo(() => {
    // echarts-gl surface：data = [x, y, z] 列表
    const data: number[][] = [];
    let zMax = 0.1;
    for (let ti = 0; ti < time_labels.length; ti++) {
      const row = grid[ti] || [];
      const dim = selectedTimeIdx && !selectedTimeIdx.has(ti);
      for (let fi = 0; fi < freq_hz.length; fi++) {
        const z = (row[fi] ?? 0) * (dim ? 0.18 : 1);
        if (z > zMax) zMax = z;
        data.push([freq_hz[fi], ti, z]);
      }
    }
    return {
      tooltip: {},
      toolbox: {
        right: 8,
        feature: {
          restore: {},
        },
      },
      visualMap: {
        show: true,
        min: 0,
        max: zMax,
        dimension: 2,
        inRange: {
          color: ["#313695", "#4575b4", "#74add1", "#fdae61", "#f46d43", "#a50026"],
        },
        calculable: true,
        right: 0,
        top: "middle",
        text: [unit, ""],
      },
      xAxis3D: { type: "value", name: "频率 Hz" },
      yAxis3D: {
        type: "value",
        name: "时间",
        min: 0,
        max: time_labels.length - 1,
        axisLabel: {
          formatter: (v: number) => time_labels[Math.round(v)] || String(v),
        },
      },
      zAxis3D: { type: "value", name: `幅值 ${unit}` },
      grid3D: {
        boxWidth: 120,
        boxDepth: 80,
        boxHeight: 50,
        viewControl: {
          projection: "perspective",
          autoRotate: false,
          distance: 180,
          alpha: 25,
          beta: 40,
        },
        light: {
          main: { intensity: 1.1 },
          ambient: { intensity: 0.4 },
        },
      },
      series: [
        {
          type: "surface",
          wireframe: { show: false },
          shading: "color",
          data,
          itemStyle: { opacity: 0.95 },
        },
      ],
    };
  }, [panel, selectedTimeIdx, freq_hz, time_labels, grid, unit]);

  return (
    <div
      onDoubleClick={() => {
        // 双击：若有高亮频段，选中近窗后半（劣化段）作演示
        const n = time_labels.length;
        onSelectByTime(Array.from({ length: Math.max(1, n - Math.floor(n / 2)) }, (_, i) => Math.floor(n / 2) + i));
      }}
    >
      <ReactECharts option={option as EChartsOption} style={{ height: 340, width: "100%" }} notMerge lazyUpdate />
      <Typography.Text type="secondary" style={{ fontSize: 11 }}>
        拖拽旋转 · 滚轮缩放 · 双击选中后半时段（劣化窗）以联动其余图
      </Typography.Text>
    </div>
  );
}

export function MultiDimDiagnosisPanel({
  panel,
  loading,
}: {
  panel?: MultidimPanelData | null;
  loading?: boolean;
}) {
  const samples = panel?.samples ?? [];
  const link = useLinkedSelection(samples);
  const selectedCount = link.selectedIds?.length ?? 0;

  if (!panel?.samples?.length) return null;

  const onFreqBrush = (fLo: number, fHi: number) => {
    const { freq_hz, grid } = panel.waterfall;
    const fi0 = freq_hz.findIndex((f) => f >= fLo);
    const fi1 = freq_hz.findIndex((f) => f >= fHi);
    const a = fi0 < 0 ? 0 : fi0;
    const b = fi1 < 0 ? freq_hz.length - 1 : fi1;
    const scores = grid.map((row, ti) => {
      let sum = 0;
      for (let i = a; i <= b; i++) sum += row[i] ?? 0;
      return { ti, sum };
    });
    const sorted = [...scores].sort((x, y) => y.sum - x.sum);
    const top = sorted.slice(0, Math.max(3, Math.ceil(sorted.length * 0.35))).map((x) => x.ti);
    link.selectByTime(top);
  };

  return (
    <Card
      id="ea-multidim-panel"
      size="small"
      loading={loading}
      style={{ marginTop: 12, marginBottom: 12 }}
      title={
        <Space wrap>
          <span>{panel.title}</span>
          {panel.rpm != null ? <Tag>{panel.rpm} rpm</Tag> : null}
          {panel.f0_hz != null ? <Tag>1× = {panel.f0_hz} Hz</Tag> : null}
        </Space>
      }
      extra={
        <Space>
          {selectedCount ? <Tag color="processing">已联动 {selectedCount} 个样本</Tag> : null}
          <Button size="small" onClick={link.clear} disabled={!selectedCount}>
            清除联动
          </Button>
        </Space>
      }
    >
      <Typography.Paragraph style={{ marginBottom: 8 }}>{panel.overview}</Typography.Paragraph>
      <Alert
        type="info"
        showIcon
        style={{ marginBottom: 12 }}
        message="样本联动"
        description={
          <>
            框选 / 点击样本、平行坐标点选、频谱刷选频率带、瀑布点选时段，可在各图同步高亮同源采样点。
            {panel.method_note ? (
              <>
                <br />
                {panel.method_note}
              </>
            ) : null}
          </>
        }
      />

      <Space wrap style={{ marginBottom: 8 }}>
        {panel.cluster_legend.map((l) => (
          <Tag
            key={l.key}
            style={{ cursor: "pointer", color: l.color, borderColor: l.color }}
            onClick={() => link.selectByCluster(l.key)}
          >
            {l.label}
            {panel.cluster_counts?.[l.key] != null ? ` · ${panel.cluster_counts[l.key]}` : ""}
          </Tag>
        ))}
      </Space>

      <Row gutter={[12, 12]}>
        <Col xs={24} xl={12}>
          <ChartCard
            title="平行坐标图 · 多特征同步偏移"
            hint="每条线=一次采样的全套特征；竖轴=指标。异常线会偏离正常集群，用于锁定同步异动的关键参数。"
          >
            <ParallelChart panel={panel} selectedSet={link.selectedSet} onSelectIds={link.selectIds} />
          </ChartCard>
        </Col>
        <Col xs={24} xl={12}>
          <ChartCard
            title="高维特征降维聚类（PCA 示意）"
            hint="每点=一次采样。正常聚基线簇，故障成独立簇；点向异常簇漂移表示缓慢劣化。可用工具箱框选。"
          >
            <ClusterScatter panel={panel} selectedSet={link.selectedSet} onSelectIds={link.selectIds} />
          </ChartCard>
        </Col>
        <Col xs={24} xl={12}>
          <ChartCard
            title="FFT 频域频谱 · 多时间切片"
            hint="横轴频率、纵轴幅值。观察 1×/2×/轴承特征峰。工具箱横向刷选频率带可反查高能量时段。"
          >
            <FftStackChart
              panel={panel}
              selectedSet={link.selectedSet}
              selectedTimeIdx={link.selectedTimeIdx}
              onSelectByTime={link.selectByTime}
              onFreqBrush={onFreqBrush}
            />
          </ChartCard>
        </Col>
        <Col xs={24} xl={12}>
          <ChartCard
            title="3D 时频瀑布曲面"
            hint="X 频率 · Y 时间 · Z/颜色 幅值。跟踪固定频段幅值抬升，支撑劣化与 RUL 研判。"
          >
            <Waterfall3D
              panel={panel}
              selectedTimeIdx={link.selectedTimeIdx}
              onSelectByTime={link.selectByTime}
            />
          </ChartCard>
        </Col>
      </Row>
    </Card>
  );
}
