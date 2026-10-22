import type { ReactNode } from "react";
import { NavLink } from "react-router";
import { BrandMark } from "@/components/ui/BrandMark";

const destinations = [
  { to: "/app", label: "Dashboard" },
  { to: "/author", label: "Publish" },
  { to: "/account", label: "Accounts" },
] as const;

function AppNav() {
  return (
    <nav aria-label="App" className="order-3 flex w-full gap-2 md:order-2 md:w-auto">
      {destinations.map((destination) => (
        <NavLink
          key={destination.to}
          to={destination.to}
          end
          className={({ isActive }) =>
            `inline-flex h-9 items-center rounded-pill border px-3.5 text-[15px] leading-none font-medium transition-colors duration-500 ease-settle ${isActive ? "border-ink bg-sky" : "border-transparent hover:border-ink"}`
          }
        >
          {destination.label}
        </NavLink>
      ))}
    </nav>
  );
}

export function AppShell({
  aside,
  children,
  wide = false,
}: {
  aside?: ReactNode;
  children: ReactNode;
  wide?: boolean;
}) {
  return (
    <div className="min-h-dvh bg-lavender px-[30px] pt-5 pb-20">
      <header className="mx-auto flex max-w-[960px] flex-wrap items-center justify-between gap-x-4 gap-y-3 rounded-card border border-ink bg-paper px-6 py-4 md:h-[76px] md:flex-nowrap md:py-0">
        <div className="order-1">
          <BrandMark href="/" compact={aside !== undefined && aside !== null} />
        </div>
        <AppNav />
        <div className="order-2 md:order-3">{aside}</div>
      </header>
      <main
        className={`mx-auto mt-10 flex flex-col gap-6 ${wide ? "max-w-[960px]" : "max-w-[760px]"}`}
      >
        {children}
      </main>
    </div>
  );
}

export function Panel({ children, className = "" }: { children: ReactNode; className?: string }) {
  return (
    <section
      className={`flex flex-col gap-5 rounded-card border border-ink bg-paper p-6 md:p-8 ${className}`}
    >
      {children}
    </section>
  );
}
