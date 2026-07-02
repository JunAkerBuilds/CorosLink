import { Nav } from "../src/components/Nav";
import { Hero } from "../src/components/Hero";
import { Features } from "../src/components/Features";
import { Highlights } from "../src/components/Highlights";
import { Download } from "../src/components/Download";
import { Footer } from "../src/components/Footer";
import { SmoothScroll } from "../src/components/SmoothScroll";

export default function Home() {
  return (
    <>
      <SmoothScroll />
      <Nav />
      <main>
        <Hero />

        {/* Section intro */}
        <section className="mx-auto max-w-3xl px-5 pt-16 text-center md:pt-24">
          <p className="eyebrow">One app, four superpowers</p>
          <h2 className="mt-3 text-balance text-3xl font-semibold tracking-tight sm:text-4xl">
            The COROS experience your watch deserves — on the big screen.
          </h2>
          <p className="mx-auto mt-4 max-w-2xl text-pretty text-[17px] leading-relaxed text-muted">
            No web dashboards, no juggling apps. CorosLink talks to your watch
            directly over USB and keeps everything on your own machine.
          </p>
        </section>

        <Features />
        <Highlights />
        <Download />
      </main>
      <Footer />
    </>
  );
}
