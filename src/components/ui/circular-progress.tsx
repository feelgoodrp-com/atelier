/**
 * Circular progress ring. `value` is 0..100; pass `null` for indeterminate
 * (a spinning arc) — used when the total is unknown or no progress has
 * arrived yet, so the UI never has to invent a number.
 */

import { cn } from "@/lib/utils";

interface CircularProgressProps {
  /** 0..100, or null for indeterminate. */
  value: number | null;
  /** Outer diameter in px. */
  size?: number;
  strokeWidth?: number;
  className?: string;
  /** Rendered in the middle of the ring. */
  children?: React.ReactNode;
}

export function CircularProgress({
  value,
  size = 128,
  strokeWidth = 8,
  className,
  children,
}: CircularProgressProps) {
  const radius = (size - strokeWidth) / 2;
  const circumference = 2 * Math.PI * radius;
  const determinate = value !== null && Number.isFinite(value);
  const clamped = determinate ? Math.min(100, Math.max(0, value)) : 0;
  // Indeterminate: a fixed quarter arc that spins.
  const dash = determinate ? (clamped / 100) * circumference : circumference * 0.25;

  return (
    <div
      className={cn("relative inline-flex items-center justify-center", className)}
      style={{ width: size, height: size }}
      role="progressbar"
      aria-valuenow={determinate ? Math.round(clamped) : undefined}
      aria-valuemin={0}
      aria-valuemax={100}
    >
      <svg
        width={size}
        height={size}
        viewBox={`0 0 ${size} ${size}`}
        className={cn("-rotate-90", !determinate && "animate-spin")}
        style={!determinate ? { animationDuration: "1.4s" } : undefined}
      >
        <circle
          cx={size / 2}
          cy={size / 2}
          r={radius}
          fill="none"
          strokeWidth={strokeWidth}
          className="stroke-white/10"
        />
        <circle
          cx={size / 2}
          cy={size / 2}
          r={radius}
          fill="none"
          strokeWidth={strokeWidth}
          strokeLinecap="round"
          strokeDasharray={`${dash} ${circumference}`}
          className="stroke-[#7289DA]"
          style={determinate ? { transition: "stroke-dasharray 220ms ease-out" } : undefined}
        />
      </svg>
      {children && (
        <div className="absolute inset-0 flex flex-col items-center justify-center gap-0.5">
          {children}
        </div>
      )}
    </div>
  );
}
