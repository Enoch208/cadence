import { RollText } from "./RollText";

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
      className="group inline-flex h-[54px] items-center overflow-clip rounded-btn border border-ink bg-paper px-[25px] pb-[3px] text-ink shadow-key transition-colors duration-500 ease-settle hover:bg-hover"
    >
      <RollText className="t-button">{children}</RollText>
    </a>
  );
}
