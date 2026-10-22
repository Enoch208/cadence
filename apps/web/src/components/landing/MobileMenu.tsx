import { GithubIcon, NewTwitterIcon } from "@hugeicons/core-free-icons";
import { KeyLink } from "@/components/ui/KeyLink";
import { links } from "@/lib/links";
import { sections } from "./sections";

type MenuToggleProps = {
  open: boolean;
  onToggle: () => void;
};

const bar =
  "absolute left-1/2 h-0.5 w-[18px] -translate-x-1/2 rounded-[3px] bg-ink transition duration-500 ease-settle";

export function MenuToggle({ open, onToggle }: MenuToggleProps) {
  return (
    <button
      type="button"
      aria-expanded={open}
      aria-controls="mobile-menu"
      aria-label={open ? "Close menu" : "Open menu"}
      onClick={onToggle}
      className="relative size-[38px] rounded-btn border border-ink bg-paper shadow-key-sm transition-colors duration-700 hover:bg-hover lg:hidden"
    >
      <span className={`${bar} ${open ? "top-[17px] rotate-45" : "top-[13px]"}`} />
      <span className={`${bar} ${open ? "top-[17px] -rotate-45" : "top-[22px]"}`} />
    </button>
  );
}

type MobileMenuProps = {
  onNavigate: () => void;
};

export function MobileMenu({ onNavigate }: MobileMenuProps) {
  return (
    <div
      id="mobile-menu"
      className="absolute inset-x-0 top-full mt-5 flex flex-col gap-5 rounded-card border border-ink bg-paper p-[30px]"
    >
      <ul className="flex flex-col gap-5">
        {sections.map((section) => (
          <li key={section.id}>
            <a href={`#${section.id}`} className="t-menu block" onClick={onNavigate}>
              {section.label}
            </a>
          </li>
        ))}
      </ul>
      <div className="flex gap-2.5">
        <KeyLink href={links.repository} label="Cadence on GitHub" icon={GithubIcon} />
        <KeyLink href={links.x} label="Cadence on X" icon={NewTwitterIcon} />
      </div>
    </div>
  );
}
