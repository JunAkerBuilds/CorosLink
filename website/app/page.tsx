import { Nav } from "../src/components/Nav";
import { Hero } from "../src/components/Hero";
import { Features } from "../src/components/Features";
import { Highlights } from "../src/components/Highlights";
import { Download } from "../src/components/Download";
import { BuyMeCoffee } from "../src/components/BuyMeCoffee";
import { FAQ } from "../src/components/FAQ";
import { Footer } from "../src/components/Footer";
import { SmoothScroll } from "../src/components/SmoothScroll";
import { GITHUB_REPO_URL } from "../src/lib/github";
import {
  APP_FEATURES,
  FAQS,
  SITE_DESCRIPTION,
  SITE_NAME,
  SITE_URL,
  absoluteUrl,
} from "../src/lib/site";
import { getPublicSupporters } from "../src/lib/supporters";

const structuredData = {
  "@context": "https://schema.org",
  "@graph": [
    {
      "@type": "Organization",
      "@id": `${SITE_URL}/#organization`,
      name: "CorosLink Contributors",
      url: SITE_URL,
      logo: absoluteUrl("/icon.png"),
      sameAs: [GITHUB_REPO_URL],
    },
    {
      "@type": "WebSite",
      "@id": `${SITE_URL}/#website`,
      name: SITE_NAME,
      url: SITE_URL,
      description: SITE_DESCRIPTION,
      publisher: {
        "@id": `${SITE_URL}/#organization`,
      },
    },
    {
      "@type": "SoftwareApplication",
      "@id": `${SITE_URL}/#software`,
      name: SITE_NAME,
      alternateName: "COROS desktop companion",
      url: SITE_URL,
      description: SITE_DESCRIPTION,
      image: absoluteUrl("/og-image.png"),
      screenshot: [
        absoluteUrl("/screenshots/overview.png"),
        absoluteUrl("/screenshots/route-generator.png"),
        absoluteUrl("/screenshots/training-hub.png"),
      ],
      applicationCategory: "UtilitiesApplication",
      applicationSubCategory: "Sports watch companion app",
      operatingSystem: ["macOS", "Windows", "Linux"],
      isAccessibleForFree: true,
      downloadUrl: `${GITHUB_REPO_URL}/releases`,
      softwareRequirements: "macOS, Windows, or Linux desktop with USB access to a COROS watch",
      featureList: APP_FEATURES,
      offers: {
        "@type": "Offer",
        price: "0",
        priceCurrency: "USD",
      },
      publisher: {
        "@id": `${SITE_URL}/#organization`,
      },
      sameAs: [GITHUB_REPO_URL],
    },
    {
      "@type": "FAQPage",
      "@id": `${SITE_URL}/#faq`,
      mainEntity: FAQS.map((item) => ({
        "@type": "Question",
        name: item.question,
        acceptedAnswer: {
          "@type": "Answer",
          text: item.answer,
        },
      })),
    },
  ],
};

export default async function Home() {
  const supporters = await getPublicSupporters();

  return (
    <>
      <script
        type="application/ld+json"
        dangerouslySetInnerHTML={{ __html: JSON.stringify(structuredData) }}
      />
      <SmoothScroll />
      <Nav />
      <main>
        <Hero supporters={supporters} />

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
        <FAQ />
        <Download />

        <section className="px-6 pb-8 pt-4 lg:px-12 md:pb-12">
          <BuyMeCoffee variant="banner" />
        </section>
      </main>
      <Footer />
    </>
  );
}
