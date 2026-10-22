import type { ReactNode } from "react";
import { Link } from "react-router";
import { RollText } from "./RollText";

const surface =
  "group press inline-flex h-[54px] items-center justify-center overflow-clip rounded-btn border border-ink bg-paper px-[25px] pb-[3px] text-ink shadow-key hover:bg-hover";

type ButtonProps = {
  href: string;
  children: string;
  external?: boolean;
};

export function Button({ href, children, external = false }: ButtonProps) {
  return (
    <a
      href={href}
      {...(external ? { target: "_blank", rel: "noreferrer" } : {})}
      className={surface}
    >
      <RollText className="t-button">{children}</RollText>
    </a>
  );
}

export function RouteButton({ to, children }: { to: string; children: string }) {
  return (
    <Link to={to} className={surface}>
      <RollText className="t-button">{children}</RollText>
    </Link>
  );
}

type ActionButtonProps = {
  children: ReactNode;
  onClick?: () => void;
  type?: "button" | "submit";
  disabled?: boolean;
};

export function ActionButton({
  children,
  onClick,
  type = "button",
  disabled = false,
}: ActionButtonProps) {
  return (
    <button
      type={type}
      onClick={onClick}
      disabled={disabled}
      className={`${surface} t-button disabled:bg-hover disabled:opacity-60`}
    >
      {children}
    </button>
  );
}
