import type { ReactNode } from "react";
import { BrandMark } from "@/components/ui/BrandMark";

export function AppShell({ aside, children }: { aside?: ReactNode; children: ReactNode }) {
  return (
    <div className="min-h-dvh bg-lavender px-[30px] pt-5 pb-20">
      <header className="mx-auto flex h-[76px] max-w-[760px] items-center justify-between rounded-card border border-ink bg-paper px-6">
        <BrandMark href="/" compact={aside !== undefined && aside !== null} />
        {aside}
      </header>
      <main className="mx-auto mt-10 flex max-w-[760px] flex-col gap-6">{children}</main>
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
