import plane from "@/assets/landing/hero-plane.webp";
import { Appear } from "@/components/ui/Appear";
import { WordReveal } from "@/components/ui/WordReveal";
import { HeroDecor } from "./HeroDecor";

function PlaneAvatar() {
  return (
    <img
      src={plane}
      alt="A white paper plane in flight"
      width={105}
      height={105}
      className="size-[105px] rounded-[60px] border border-ink object-cover"
    />
  );
}

export function Hero() {
  return (
    <section
      id="top"
      className="relative bg-lavender px-[30px] pt-[175px] pb-20 md:pt-[220px] md:pb-[120px] lg:pt-[280px] lg:pb-40"
    >
      <div className="shell relative">
        <HeroDecor />
        <div className="mx-auto flex max-w-[750px] flex-col items-center text-center">
          <Appear variant="fade" delay={0.2} className="mb-[30px] md:hidden">
            <PlaneAvatar />
          </Appear>
          <h1 className="t-display">
            <WordReveal text="One" delay={0.1} />{" "}
            <Appear
              inline
              variant="fade"
              delay={0.2}
              className="mx-[0.06em] hidden align-middle md:inline-block"
            >
              <PlaneAvatar />
            </Appear>{" "}
            <WordReveal text="trade idea." delay={0.3} tween />
            <br />
            <WordReveal text="Your own risk." delay={0.4} />
          </h1>
          <Appear delay={0.6} className="mt-[30px]">
            <p className="t-lead">
              Cadence turns a setup posted in your <strong>Telegram</strong> group into a{" "}
              <strong>Strike</strong> order sized for <strong>you</strong>, with its{" "}
              <strong>stop</strong> and <strong>target</strong> attached.
            </p>
          </Appear>
        </div>
      </div>
    </section>
  );
}
