import { useState } from "react";
import { NavLink } from "react-router";
import { HugeiconsIcon, type IconSvgElement } from "@hugeicons/react";
import {
  DashboardSquare01Icon,
  Home01Icon,
  Logout01Icon,
  NoteAddIcon,
  Wallet01Icon,
} from "@hugeicons/core-free-icons";
import { BrandMark } from "@/components/ui/BrandMark";

type Destination = { to: string; label: string; icon: IconSvgElement };

const destinations: readonly Destination[] = [
  { to: "/app", label: "Dashboard", icon: DashboardSquare01Icon },
  { to: "/author", label: "Publish a plan", icon: NoteAddIcon },
  { to: "/account", label: "Accounts", icon: Wallet01Icon },
];

const row =
  "flex h-12 items-center gap-3 rounded-btn border px-3 t-body font-medium transition-colors duration-500 ease-settle";

async function signOut() {
  await fetch("/api/auth/logout", {
    method: "POST",
    credentials: "include",
    headers: { "X-Cadence-Request": "1" },
  });
  window.location.assign("/");
}

function Destinations({ onNavigate }: { onNavigate?: () => void }) {
  return (
    <ul className="flex flex-col gap-1.5">
      {destinations.map((destination) => (
        <li key={destination.to}>
          <NavLink
            to={destination.to}
            end
            onClick={onNavigate}
            className={({ isActive }) =>
              `${row} ${isActive ? "border-ink bg-sky" : "border-transparent hover:bg-hover"}`
            }
          >
            <HugeiconsIcon icon={destination.icon} size={20} strokeWidth={1.6} />
            {destination.label}
          </NavLink>
        </li>
      ))}
    </ul>
  );
}

function Footer() {
  return (
    <div className="flex flex-col gap-1.5 border-t border-ink pt-4">
      <a href="/" className={`${row} border-transparent hover:bg-hover`}>
        <HugeiconsIcon icon={Home01Icon} size={20} strokeWidth={1.6} />
        Cadence home
      </a>
      <button
        type="button"
        onClick={() => void signOut()}
        className={`${row} w-full border-transparent text-left hover:bg-hover`}
      >
        <HugeiconsIcon icon={Logout01Icon} size={20} strokeWidth={1.6} />
        Sign out
      </button>
    </div>
  );
}

export function Sidebar() {
  return (
    <aside
      aria-label="App"
      className="fixed inset-y-5 left-5 hidden w-[248px] flex-col justify-between rounded-card border border-ink bg-paper p-5 md:flex"
    >
      <div className="flex flex-col gap-8">
        <div className="px-1 pt-1">
          <BrandMark href="/app" />
        </div>
        <nav aria-label="App sections">
          <Destinations />
        </nav>
      </div>
      <Footer />
    </aside>
  );
}

export function MobileAppBar() {
  const [open, setOpen] = useState(false);
  return (
    <div className="relative z-20 md:hidden">
      <div className="flex h-[68px] items-center justify-between rounded-card border border-ink bg-paper px-5">
        <BrandMark href="/app" />
        <button
          type="button"
          aria-expanded={open}
          aria-controls="app-menu"
          onClick={() => {
            setOpen((value) => !value);
          }}
          className="h-[38px] rounded-btn border border-ink bg-paper px-3.5 t-button shadow-key-sm"
        >
          {open ? "Close" : "Menu"}
        </button>
      </div>
      {open ? (
        <nav
          id="app-menu"
          aria-label="App sections"
          className="absolute inset-x-0 top-full mt-3 flex flex-col gap-4 rounded-card border border-ink bg-paper p-5"
        >
          <Destinations
            onNavigate={() => {
              setOpen(false);
            }}
          />
          <Footer />
        </nav>
      ) : null}
    </div>
  );
}
