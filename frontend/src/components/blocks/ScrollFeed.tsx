import { Card, Tag, Typography } from "antd";
import "./ScrollFeed.css";

export type FeedLevel = "info" | "warn" | "error";

export interface FeedItem {
  time: string;
  text: string;
  level?: FeedLevel;
}

export interface ScrollFeedProps {
  title?: string;
  items: FeedItem[];
  loading?: boolean;
  /** 可视区域高度 */
  height?: number;
}

const levelColor: Record<FeedLevel, string> = {
  info: "blue",
  warn: "orange",
  error: "red",
};

const levelLabel: Record<FeedLevel, string> = {
  info: "信息",
  warn: "警告",
  error: "故障",
};

/** 底部滚动信息流：条目由数据驱动。 */
export default function ScrollFeed({
  title = "实时动态",
  items,
  loading,
  height = 180,
}: ScrollFeedProps) {
  // 条目少时复制一份做无缝滚动
  const track = items.length > 0 && items.length < 8 ? [...items, ...items] : items;

  return (
    <Card size="small" title={title} loading={loading}>
      <div className="scroll-feed" style={{ height }}>
        <div className={`scroll-feed-track${items.length >= 4 ? " is-rolling" : ""}`}>
          {track.map((item, index) => {
            const level = item.level ?? "info";
            return (
              <div className="scroll-feed-row" key={`${item.time}-${index}`}>
                <Typography.Text type="secondary" className="scroll-feed-time">
                  {item.time}
                </Typography.Text>
                <Tag color={levelColor[level]}>{levelLabel[level]}</Tag>
                <Typography.Text className="scroll-feed-text" ellipsis>
                  {item.text}
                </Typography.Text>
              </div>
            );
          })}
          {!items.length ? (
            <Typography.Text type="secondary">暂无动态</Typography.Text>
          ) : null}
        </div>
      </div>
    </Card>
  );
}
