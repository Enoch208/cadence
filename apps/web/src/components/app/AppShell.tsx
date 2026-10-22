import type { ReactNode } from "react";
import { MobileAppBar, Sidebar } from "./Sidebar";

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
    <div className="min-h-dvh bg-lavender">
      <Sidebar />
      <div className="px-[30px] pt-5 pb-20 md:pt-10 md:pr-10 md:pl-[298px]">
        <MobileAppBar />
        <div
          className={`mx-auto mt-8 flex flex-col gap-6 md:mt-0 ${wide ? "max-w-[960px]" : "max-w-[760px]"}`}
        >
          {aside !== undefined && aside !== null ? (
            <div className="flex justify-end">{aside}</div>
          ) : null}
          <main className="flex flex-col gap-6">{children}</main>
        </div>
      </div>
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
