/** 自绘离心水泵横向剖视（免版权示意） */
export function WaterPumpSvg({ className }: { className?: string }) {
  return (
    <svg
      className={className}
      viewBox="0 0 1000 400"
      width="100%"
      height="100%"
      preserveAspectRatio="xMidYMid meet"
      role="img"
      aria-label="离心水泵横向剖视示意"
    >
      <defs>
        <linearGradient id="pump-metal" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor="#dbeafe" />
          <stop offset="100%" stopColor="#93c5fd" />
        </linearGradient>
      </defs>
      <rect width="1000" height="400" fill="#0f172a" />
      <text x="20" y="28" fill="#94a3b8" fontSize="14">
        自绘示意 · 离心水泵
      </text>
      <rect x="40" y="320" width="880" height="14" rx="4" fill="#334155" />

      <rect x="50" y="140" width="160" height="150" rx="10" fill="url(#pump-metal)" stroke="#60a5fa" />
      <circle cx="130" cy="215" r="40" fill="#1e3a5f" stroke="#93c5fd" strokeWidth="3" />
      <text x="130" y="315" textAnchor="middle" fill="#bfdbfe" fontSize="13">
        电机
      </text>

      <rect x="230" y="195" width="60" height="40" rx="4" fill="#64748b" />
      <text x="260" y="260" textAnchor="middle" fill="#cbd5e1" fontSize="11">
        联轴
      </text>

      <rect x="310" y="175" width="70" height="80" rx="6" fill="#475569" stroke="#94a3b8" />
      <text x="345" y="280" textAnchor="middle" fill="#cbd5e1" fontSize="11">
        轴承
      </text>

      <circle cx="520" cy="200" r="95" fill="url(#pump-metal)" stroke="#3b82f6" strokeWidth="3" />
      <circle cx="520" cy="200" r="55" fill="#1e40af" opacity="0.5" />
      <circle cx="520" cy="200" r="28" fill="#0f172a" />
      <path
        d="M520 145 L545 200 L520 255 L495 200 Z"
        fill="#60a5fa"
        opacity="0.7"
      />
      <text x="520" y="320" textAnchor="middle" fill="#bfdbfe" fontSize="13">
        叶轮 / 泵壳
      </text>

      <rect x="450" y="290" width="80" height="28" rx="6" fill="#38bdf8" opacity="0.6" />
      <text x="490" y="345" textAnchor="middle" fill="#7dd3fc" fontSize="11">
        进口
      </text>

      <rect x="700" y="170" width="120" height="50" rx="8" fill="#38bdf8" opacity="0.55" stroke="#7dd3fc" />
      <text x="760" y="200" textAnchor="middle" fill="#e0f2fe" fontSize="12">
        出口
      </text>

      <rect x="430" y="210" width="50" height="40" rx="4" fill="#f59e0b" opacity="0.5" stroke="#fbbf24" />
      <text x="455" y="270" textAnchor="middle" fill="#fcd34d" fontSize="11">
        机封
      </text>
    </svg>
  );
}
