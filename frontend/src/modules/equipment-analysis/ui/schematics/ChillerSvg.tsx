/** 自绘冷水机组分区示意（免版权） */
export function ChillerSvg({ className }: { className?: string }) {
  return (
    <svg
      className={className}
      viewBox="0 0 1000 400"
      width="100%"
      height="100%"
      preserveAspectRatio="xMidYMid meet"
      role="img"
      aria-label="冷水机组分区示意"
    >
      <rect width="1000" height="400" fill="#111827" />
      <text x="20" y="28" fill="#9ca3af" fontSize="14">
        自绘示意 · 冷水机组
      </text>

      {/* 蒸发器 */}
      <rect x="60" y="80" width="220" height="160" rx="12" fill="#164e63" stroke="#22d3ee" strokeWidth="2" />
      <text x="170" y="165" textAnchor="middle" fill="#a5f3fc" fontSize="16">
        蒸发器
      </text>

      {/* 压缩机 */}
      <rect x="360" y="140" width="200" height="130" rx="16" fill="#334155" stroke="#94a3b8" strokeWidth="2" />
      <circle cx="460" cy="205" r="36" fill="#0f172a" stroke="#cbd5e1" />
      <text x="460" y="300" textAnchor="middle" fill="#e2e8f0" fontSize="14">
        压缩机
      </text>

      {/* 冷凝器 */}
      <rect x="640" y="70" width="250" height="150" rx="12" fill="#7c2d12" stroke="#fb923c" strokeWidth="2" />
      <text x="765" y="150" textAnchor="middle" fill="#fed7aa" fontSize="16">
        冷凝器
      </text>

      {/* 膨胀阀 */}
      <rect x="330" y="250" width="100" height="45" rx="8" fill="#581c87" stroke="#c084fc" />
      <text x="380" y="278" textAnchor="middle" fill="#e9d5ff" fontSize="12">
        膨胀阀
      </text>

      {/* 冷冻水泵 */}
      <rect x="80" y="270" width="150" height="70" rx="10" fill="#1e3a8a" stroke="#60a5fa" />
      <text x="155" y="310" textAnchor="middle" fill="#bfdbfe" fontSize="12">
        冷冻水泵
      </text>

      {/* 冷却水泵 */}
      <rect x="700" y="250" width="160" height="70" rx="10" fill="#9a3412" stroke="#fdba74" />
      <text x="780" y="290" textAnchor="middle" fill="#ffedd5" fontSize="12">
        冷却水泵
      </text>

      {/* 电控 */}
      <rect x="860" y="30" width="100" height="70" rx="6" fill="#374151" stroke="#9ca3af" />
      <text x="910" y="70" textAnchor="middle" fill="#e5e7eb" fontSize="12">
        电控
      </text>

      {/* 管路示意 */}
      <path
        d="M280 160 H360 M560 200 H640 M460 270 V250"
        fill="none"
        stroke="#6b7280"
        strokeWidth="4"
        strokeDasharray="8 6"
      />
    </svg>
  );
}
