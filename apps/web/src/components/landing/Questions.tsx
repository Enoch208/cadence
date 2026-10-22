import receipt from "@/assets/landing/faq-receipt.webp";
import stopwatch from "@/assets/landing/faq-stopwatch.webp";
import { Appear } from "@/components/ui/Appear";
import { SectionHeader } from "@/components/ui/SectionHeader";

type Question = {
  image: string;
  imageAlt: string;
  title: string;
  answer: string;
  topics: readonly [string, string];
};

const questions: readonly Question[] = [
  {
    image: receipt,
    imageAlt: "A blank paper receipt and a pen on a mint surface",
    title: "What do I keep after an order?",
    answer:
      "A receipt that links the plan version you approved to Strike’s order IDs, your fills and the fees you paid.",
    topics: ["Receipts", "On Strike"],
  },
  {
    image: stopwatch,
    imageAlt: "A silver stopwatch on a pink surface",
    title: "What happens when a plan expires?",
    answer:
      "New entries stop at once. Positions that already filled keep their stop and target on Strike.",
    topics: ["Plans", "Expiry"],
  },
];

function QuestionCard({ question }: { question: Question }) {
  return (
    <article className="flex w-full max-w-[500px] flex-col overflow-clip rounded-card border border-ink bg-paper">
      <img
        src={question.image}
        alt={question.imageAlt}
        width={1000}
        height={663}
        loading="lazy"
        className="aspect-[1000/663] w-full rounded-t-card object-cover"
      />
      <div className="flex flex-col gap-7 border-t border-ink p-[30px] lg:p-[35px]">
        <div className="flex flex-col gap-[15px]">
          <h3 className="t-post">{question.title}</h3>
          <p className="t-body">{question.answer}</p>
        </div>
        <span className="h-px bg-ink" />
        <span className="t-meta flex items-center gap-4">
          {question.topics[0]}
          <span aria-hidden="true" className="size-[3px] rounded-[3px] bg-ink" />
          {question.topics[1]}
        </span>
      </div>
    </article>
  );
}

export function Questions() {
  return (
    <section id="questions" className="px-[30px] py-[100px] md:py-[140px] lg:py-40">
      <div className="shell flex flex-col gap-10 lg:gap-[60px]">
        <SectionHeader
          width="narrow"
          title="Questions traders ask"
          intro={
            <>
              Plain answers, with the <strong>limits</strong> included.
            </>
          }
        />
        <Appear
          delay={0.25}
          className="mx-auto flex w-full max-w-[1040px] flex-col items-center gap-[30px] md:flex-row md:items-start md:justify-center lg:gap-10"
        >
          {questions.map((question) => (
            <QuestionCard key={question.title} question={question} />
          ))}
        </Appear>
      </div>
    </section>
  );
}
