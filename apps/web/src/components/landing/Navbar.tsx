import { useState } from "react";
import { m, useMotionValueEvent, useScroll } from "motion/react";
import { GithubIcon, NewTwitterIcon } from "@hugeicons/core-free-icons";
import { BrandMark } from "@/components/ui/BrandMark";
import { KeyLink } from "@/components/ui/KeyLink";
import { RollText } from "@/components/ui/RollText";
import { links } from "@/lib/links";
import { settle } from "@/lib/motion";
import { useDesktop } from "@/lib/use-media";
import { MobileMenu, MenuToggle } from "./MobileMenu";
import { sections } from "./sections";

export function Navbar() {
  const desktop = useDesktop();
  const { scrollY } = useScroll();
  const [scrolled, setScrolled] = useState(false);
  const [menuOpen, setMenuOpen] = useState(false);
  useMotionValueEvent(scrollY, "change", (y) => {
    setScrolled(y > 120);
  });

  return (
    <m.header
      className="fixed inset-x-0 top-0 z-30 px-[30px]"
      initial={false}
      animate={{ paddingTop: desktop && !scrolled ? 40 : 20 }}
      transition={settle}
    >
      {menuOpen && !desktop ? (
        <button
          type="button"
          aria-label="Close menu"
          className="fixed inset-0 bg-ink/60"
          onClick={() => {
            setMenuOpen(false);
          }}
        />
      ) : null}
      <nav
        aria-label="Main"
        className="shell relative flex h-[76px] items-center justify-between rounded-card border border-ink bg-paper px-[30px]"
      >
        <div className="flex-1">
          <BrandMark />
        </div>
        <ul className="hidden gap-[35px] lg:flex">
          {sections.map((section) => (
            <li key={section.id}>
              <a href={`#${section.id}`} className="group block">
                <RollText className="t-nav">{section.label}</RollText>
              </a>
            </li>
          ))}
        </ul>
        <div className="hidden flex-1 justify-end gap-2.5 lg:flex">
          <KeyLink href={links.repository} label="Cadence on GitHub" icon={GithubIcon} />
          <KeyLink href={links.x} label="Cadence on X" icon={NewTwitterIcon} />
        </div>
        <MenuToggle
          open={menuOpen}
          onToggle={() => {
            setMenuOpen((open) => !open);
          }}
        />
        {menuOpen && !desktop ? (
          <MobileMenu
            onNavigate={() => {
              setMenuOpen(false);
            }}
          />
        ) : null}
      </nav>
    </m.header>
  );
}
