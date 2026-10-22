import type { ReactNode } from "react";
import { Alert02Icon, Loading03Icon } from "@hugeicons/core-free-icons";
import { HugeiconsIcon } from "@hugeicons/react";
import { ActionButton } from "@/components/ui/Button";

export function Loading({ label }: { label: string }) {
  return (
    <p role="status" className="t-body flex items-center gap-3">
      <HugeiconsIcon
        icon={Loading03Icon}
        size={20}
        strokeWidth={1.6}
        className="animate-spin motion-reduce:animate-none"
      />
      {label}
    </p>
  );
}

export function Problem({
  title,
  children,
  onRetry,
}: {
  title: string;
  children: ReactNode;
  onRetry?: () => void;
}) {
  return (
    <div
      role="alert"
      className="flex flex-col items-start gap-4 rounded-card border border-ink bg-blush p-5"
    >
      <p className="t-card flex items-center gap-2">
        <HugeiconsIcon icon={Alert02Icon} size={20} strokeWidth={1.6} />
        {title}
      </p>
      <div className="t-body">{children}</div>
      {onRetry ? <ActionButton onClick={onRetry}>Try again</ActionButton> : null}
    </div>
  );
}
