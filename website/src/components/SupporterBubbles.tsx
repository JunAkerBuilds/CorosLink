"use client";

import Image from "next/image";
import { motion } from "motion/react";
import type { PublicSupporter } from "../lib/supporters";
import { usePrefersReducedMotion } from "../hooks/usePrefersReducedMotion";

const BUBBLE_PATHS = [
  { right: "8%", width: 168, height: 72, drift: [0, -28, 14, -42, 0] },
  { right: "31%", width: 148, height: 64, drift: [0, 24, -12, 34, 0] },
  { right: "2%", width: 158, height: 68, drift: [0, -18, 22, -24, 0] },
  { right: "24%", width: 176, height: 74, drift: [0, 30, -18, 18, 0] },
  { right: "42%", width: 142, height: 62, drift: [0, -22, 14, -30, 0] },
  { right: "14%", width: 154, height: 66, drift: [0, 18, -20, 26, 0] },
];

export function SupporterBubbles({
  supporters,
}: {
  supporters: PublicSupporter[];
}) {
  const reduced = usePrefersReducedMotion();
  const visibleSupporters = supporters.slice(0, BUBBLE_PATHS.length);

  if (reduced) {
    return (
      <div className="hero-supporter-bubbles hero-supporter-bubbles--static" aria-label="CorosLink supporters">
        {visibleSupporters.slice(0, 4).map((supporter, index) => (
          <div
            key={supporter.id}
            className="hero-supporter-bubble hero-supporter-bubble--static"
            style={{
              width: BUBBLE_PATHS[index].width,
              height: BUBBLE_PATHS[index].height,
            }}
          >
            <Image
              src={supporter.avatarUrl}
              alt=""
              width={52}
              height={52}
              className="hero-supporter-bubble__avatar"
            />
            <span>{supporter.name}</span>
          </div>
        ))}
      </div>
    );
  }

  return (
    <div className="hero-supporter-bubbles" aria-label="CorosLink supporters">
      <div className="hero-supporter-bubbles__wake" aria-hidden="true" />
      {visibleSupporters.map((supporter, index) => {
        const path = BUBBLE_PATHS[index];

        return (
          <motion.div
            key={supporter.id}
            className="hero-supporter-bubble"
            style={{
              right: path.right,
              width: path.width,
              height: path.height,
            }}
            initial={{ opacity: 0, x: path.drift[0], y: 170, scale: 0.68 }}
            animate={{
              opacity: [0, 0.92, 0.92, 0.78, 0],
              x: path.drift,
              y: [170, 20, -210, -470, -760],
              scale: [0.68, 1, 1.04, 0.96, 0.8],
              rotate: [
                0,
                index % 2 === 0 ? -3 : 3,
                index % 2 === 0 ? 2 : -2,
                index % 2 === 0 ? -1 : 1,
                0,
              ],
            }}
            transition={{
              duration: 12,
              delay: index * 2.35,
              repeat: Infinity,
              ease: [0.37, 0, 0.63, 1],
              times: [0, 0.16, 0.48, 0.78, 1],
            }}
          >
            <div className="hero-supporter-bubble__surface" aria-hidden="true">
              <div className="hero-supporter-bubble__shine" />
            </div>
            <Image
              src={supporter.avatarUrl}
              alt=""
              width={52}
              height={52}
              className="hero-supporter-bubble__avatar"
            />
            <span>{supporter.name}</span>
            <div className="hero-supporter-bubble__sparks" aria-hidden="true">
              {Array.from({ length: 5 }, (_, sparkIndex) => (
                <i key={sparkIndex} className="hero-supporter-bubble__spark" />
              ))}
            </div>
          </motion.div>
        );
      })}
    </div>
  );
}
