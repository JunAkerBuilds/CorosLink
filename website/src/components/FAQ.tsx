import { FAQS } from "../lib/site";

export function FAQ() {
  return (
    <section id="faq" className="mx-auto max-w-[120rem] px-6 py-16 md:py-24 lg:px-12">
      <div className="mx-auto max-w-3xl text-center">
        <p className="eyebrow">FAQ</p>
        <h2 className="mt-3 text-balance text-3xl font-semibold tracking-tight sm:text-4xl">
          Answers for COROS owners searching for a desktop companion.
        </h2>
        <p className="mx-auto mt-4 max-w-2xl text-pretty text-[17px] leading-relaxed text-muted">
          CorosLink covers the everyday jobs that usually require several tools:
          music sync, maps, GPX routes, and training review.
        </p>
      </div>

      <div className="mt-12 grid gap-4 md:grid-cols-2">
        {FAQS.map((item) => (
          <article key={item.question} className="glass-soft rounded-3xl p-6">
            <h3 className="text-lg font-semibold leading-snug">{item.question}</h3>
            <p className="mt-3 text-sm leading-relaxed text-muted">{item.answer}</p>
          </article>
        ))}
      </div>
    </section>
  );
}
