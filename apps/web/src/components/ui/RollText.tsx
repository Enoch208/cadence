type RollTextProps = {
  children: string;
  className: string;
};

const layer = "block transition-transform duration-500 ease-settle group-hover:-translate-y-full";

export function RollText({ children, className }: RollTextProps) {
  return (
    <span className="relative block overflow-hidden">
      <span className={`${className} ${layer}`}>{children}</span>
      <span aria-hidden="true" className={`${className} ${layer} absolute inset-x-0 top-full`}>
        {children}
      </span>
    </span>
  );
}
