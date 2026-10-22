import { HugeiconsIcon, type IconSvgElement } from "@hugeicons/react";

type KeyLinkProps = {
  href: string;
  label: string;
  icon: IconSvgElement;
};

export function KeyLink({ href, label, icon }: KeyLinkProps) {
  return (
    <a
      href={href}
      target="_blank"
      rel="noreferrer"
      aria-label={label}
      className="flex size-[38px] items-center justify-center rounded-btn border border-ink bg-paper pb-px text-ink shadow-key-sm transition duration-700 ease-settle hover:-translate-y-0.5 hover:bg-hover"
    >
      <HugeiconsIcon icon={icon} size={17} strokeWidth={1.6} />
    </a>
  );
}
