import { useId } from "react";
import { cn } from "@/lib/cn";
import { BRAND } from "@/lib/brand";

export function BrandMark({
  size = 40,
  className,
  inverted = false,
}: {
  size?: number;
  className?: string;
  inverted?: boolean;
}) {
  const uid = useId().replace(/:/g, "");
  const stroke = inverted ? "#f6efe6" : "var(--seal-stroke)";
  const rimDark = inverted ? "#0b1412" : "#9a8b78";
  const rimLight = inverted ? "#d4c29a" : "#f3eadc";
  const shade = inverted ? "rgba(0,0,0,0.62)" : "rgba(28, 42, 38, 0.34)";
  const lift = inverted ? "rgba(255,246,223,0.7)" : "rgba(255,255,255,0.92)";
  const fillId = `sealFill-${uid}`;
  const sheenId = `sealSheen-${uid}`;
  const wellId = `sealWell-${uid}`;
  const shadowId = `sealDrop-${uid}`;

  const glyph = (
    <>
      <path d="M32 18.6v6.1" />
      <path d="M20.6 28.6c5.2-5.8 17.6-5.8 22.8 0" />
      <path d="M17.8 34.6h28.4" />
      <path d="M32 34.6v15.2" />
      <path d="M17.8 34.6 14.8 49.8" />
      <path d="M46.2 34.6 49.2 49.8" />
      <path d="M14.8 49.8h5.2M44 49.8h5.2" />
    </>
  );

  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 64 64"
      fill="none"
      xmlns="http://www.w3.org/2000/svg"
      className={cn("shrink-0 overflow-visible", className)}
      aria-hidden
    >
      <defs>
        <radialGradient id={fillId} cx="36%" cy="30%" r="74%">
          <stop offset="0%" stopColor={inverted ? "#7aa396" : "#fffdf8"} />
          <stop offset="38%" stopColor={inverted ? "#45675c" : "var(--seal-1)"} />
          <stop offset="100%" stopColor={inverted ? "#16241f" : "#cfc1ad"} />
        </radialGradient>
        <radialGradient id={sheenId} cx="34%" cy="26%" r="54%">
          <stop offset="0%" stopColor={lift} stopOpacity="0.55" />
          <stop offset="55%" stopColor={lift} stopOpacity="0.08" />
          <stop offset="100%" stopColor={lift} stopOpacity="0" />
        </radialGradient>
        <radialGradient id={wellId} cx="64%" cy="72%" r="70%">
          <stop offset="0%" stopColor={inverted ? "#000" : "#2f4840"} stopOpacity="0" />
          <stop offset="62%" stopColor={inverted ? "#000" : "#2f4840"} stopOpacity="0" />
          <stop offset="100%" stopColor={inverted ? "#000" : "#2f4840"} stopOpacity="0.18" />
        </radialGradient>
        <filter id={shadowId} x="-28%" y="-18%" width="156%" height="168%">
          <feDropShadow dx="0" dy="1.8" stdDeviation="1.7" floodColor={inverted ? "#000" : "#3a3228"} floodOpacity="0.3" />
        </filter>
      </defs>
      <g filter={`url(#${shadowId})`}>
        <circle cx="32" cy="32" r="30" fill={rimDark} />
        <circle cx="31.25" cy="30.95" r="29.2" fill={rimLight} />
        <circle cx="32" cy="32" r="27.15" fill={`url(#${fillId})`} />
        <circle cx="32" cy="32" r="27.15" fill={`url(#${wellId})`} />
        <circle
          cx="32"
          cy="32"
          r="25.9"
          stroke={inverted ? "rgba(246,239,226,0.22)" : "rgba(47,72,64,0.18)"}
          strokeWidth="0.8"
        />
        <circle cx="32" cy="32" r="27.15" fill={`url(#${sheenId})`} />
        <path d="M17.8 17.2 A22.2 22.2 0 0 1 44.6 13.6" stroke={lift} strokeWidth="1.9" strokeLinecap="round" />
        <g fill="none" stroke={shade} strokeWidth="2.9" strokeLinecap="round" strokeLinejoin="round" transform="translate(1 1.35)">
          {glyph}
        </g>
        <g fill="none" stroke={lift} strokeWidth="2.7" strokeLinecap="round" strokeLinejoin="round" transform="translate(-0.75 -0.9)">
          {glyph}
        </g>
        <g fill="none" stroke={stroke} strokeWidth="2.55" strokeLinecap="round" strokeLinejoin="round">
          {glyph}
        </g>
      </g>
    </svg>
  );
}

export function BrandWordmarkEn({
  className,
  inverted = false,
}: {
  className?: string;
  inverted?: boolean;
}) {
  return (
    <svg
      viewBox="0 0 72 16"
      fill="none"
      xmlns="http://www.w3.org/2000/svg"
      className={className}
      role="img"
      aria-label={BRAND.nameEn}
    >
      <g
        stroke={inverted ? "rgba(246,239,226,0.82)" : "var(--brand-strong)"}
        strokeWidth="1.55"
        strokeLinecap="round"
        strokeLinejoin="round"
      >
        <path d="M1.6 2.1 8 8.6 14.4 2.1" />
        <path d="M8 8.6v5.5" />
        <path d="M22.4 2.1v12" />
        <path d="M19.8 2.1h5.2" />
        <path d="M35.6 2.1v8.1c0 2.3-1.7 3.5-4 3.5h-2.6" />
        <path d="M44.2 2.1v7.2c0 3.1 2.1 4.5 5.2 4.5s5.2-1.4 5.2-4.5V2.1" />
      </g>
    </svg>
  );
}

export function BrandLockup({
  compact = false,
  inverted = false,
}: {
  compact?: boolean;
  inverted?: boolean;
}) {
  return (
    <div className={cn("flex items-center gap-3", inverted && "text-[#f6efe2]")}>
      <BrandMark size={compact ? 40 : 56} inverted={inverted} />
      <div className="min-w-0">
        <div className="flex items-center gap-2.5">
          <p
            className={cn(
              "font-[family-name:var(--font-display)] leading-none tracking-[0.14em]",
              compact ? "text-[1.15rem]" : "text-[1.45rem]",
            )}
          >
            {BRAND.name}
          </p>
          <BrandWordmarkEn
            inverted={inverted}
            className={cn("block shrink-0", compact ? "h-[11px] w-[50px]" : "h-[13px] w-[60px]")}
          />
        </div>
        {compact ? null : (
          <p className={cn("mt-1.5 text-[11px] tracking-[0.08em]", inverted ? "text-white/65" : "text-[var(--ink-muted)]")}>
            {BRAND.promise}
          </p>
        )}
      </div>
    </div>
  );
}
