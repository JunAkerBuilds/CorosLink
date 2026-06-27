import Image from "next/image";
import { motion, useScroll, useTransform } from "motion/react";
import { useRef } from "react";
import { usePrefersReducedMotion } from "../hooks/usePrefersReducedMotion";

const GITHUB_URL = "https://github.com/JunAkerBuilds/CorosLink";
const BUY_ME_A_COFFEE_URL = "https://www.buymeacoffee.com/addridoa";
const BUY_ME_A_COFFEE_IMAGE =
  "https://img.buymeacoffee.com/button-api/?text=Buy%20me%20a%20coffee&emoji=&slug=addridoa&button_colour=FFDD00&font_colour=000000&font_family=Cookie&outline_colour=000000&coffee_colour=ffffff";

export function Hero() {
  const reduced = usePrefersReducedMotion();
  const sectionRef = useRef<HTMLElement>(null);
  const { scrollYProgress } = useScroll({
    target: sectionRef,
    offset: ["start start", "end start"],
  });
  const stageY = useTransform(scrollYProgress, [0, 1], [0, 96]);
  const copyY = useTransform(scrollYProgress, [0, 1], [0, -42]);
  const copyOpacity = useTransform(scrollYProgress, [0, 0.75], [1, 0]);
  const entrance = (delay = 0) =>
    reduced
      ? {}
      : {
          initial: { opacity: 0, y: 18 },
          animate: { opacity: 1, y: 0 },
          transition: { delay, duration: 0.72, ease: "easeOut" as const },
        };

  return (
    <section className="hero" ref={sectionRef}>
      <motion.div
        className="hero-stage"
        aria-hidden="true"
        style={reduced ? undefined : { y: stageY }}
        animate={reduced ? undefined : { scale: [1.015, 1.045, 1.015] }}
        transition={
          reduced
            ? undefined
            : { duration: 18, ease: "easeInOut", repeat: Infinity }
        }
      >
        <Image
          className="hero-stage-image hero-stage-image--desktop"
          src="/showcase/hero-stage.webp"
          alt=""
          fill
          priority
          sizes="(min-width: 981px) 100vw, 1px"
        />
        <Image
          className="hero-stage-image hero-stage-image--mobile"
          src="/showcase/hero-stage-mobile.webp"
          alt=""
          fill
          priority
          sizes="(max-width: 980px) 100vw, 1px"
        />
      </motion.div>
      <div className="hero-shade" aria-hidden="true" />

      <motion.div
        className="container hero-copy"
        style={reduced ? undefined : { y: copyY, opacity: copyOpacity }}
      >
        <motion.p className="eyebrow" {...entrance(0.08)}>
          Unofficial COROS Pace Pro companion
        </motion.p>
        <motion.h1 {...entrance(0.18)}>CorosLink</motion.h1>
        <motion.p className="hero-lede" {...entrance(0.28)}>
          Music sync, direct USB transfer, and training analytics for Pace Pro owners
          who want one composed desktop command center.
        </motion.p>
        <motion.div className="hero-actions" {...entrance(0.38)}>
          <motion.a
            href="#download"
            className="button button-primary"
            whileHover={reduced ? undefined : { y: -3, scale: 1.02 }}
            whileTap={reduced ? undefined : { scale: 0.98 }}
          >
            Download for free
          </motion.a>
          <motion.a
            href={GITHUB_URL}
            target="_blank"
            rel="noopener noreferrer"
            className="button button-secondary"
            whileHover={reduced ? undefined : { y: -3, scale: 1.02 }}
            whileTap={reduced ? undefined : { scale: 0.98 }}
          >
            View on GitHub
          </motion.a>
          <motion.a
            className="hero-support"
            href={BUY_ME_A_COFFEE_URL}
            target="_blank"
            rel="noopener noreferrer"
            aria-label="Buy me a coffee"
            whileHover={reduced ? undefined : { y: -3, scale: 1.02 }}
            whileTap={reduced ? undefined : { scale: 0.99 }}
          >
            <img src={BUY_ME_A_COFFEE_IMAGE} alt="Buy me a coffee" />
          </motion.a>
        </motion.div>
        <motion.p className="hero-note" {...entrance(0.48)}>
          Not affiliated with or endorsed by COROS.
        </motion.p>
      </motion.div>
    </section>
  );
}
