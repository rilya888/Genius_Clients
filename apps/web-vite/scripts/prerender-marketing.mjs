import { mkdir, readFile, writeFile } from "node:fs/promises";
import { resolve, dirname } from "node:path";

const distRoot = resolve(process.cwd(), "dist");
const indexPath = resolve(distRoot, "index.html");

const routes = [
  {
    route: "/",
    title: "Genius Clients | Booking Platform for Modern Salons",
    description:
      "Automate bookings, reminders, and operations with a multilingual platform built for service businesses.",
    canonical: "/"
  },
  {
    route: "/pricing",
    title: "Pricing | Genius Clients",
    description: "Flexible plans for growing salons and enterprise-ready teams.",
    canonical: "/pricing"
  },
  {
    route: "/faq",
    title: "FAQ | Genius Clients",
    description: "Answers about setup, multilingual support, and booking operations.",
    canonical: "/faq"
  }
];

function injectMeta(html, meta) {
  const enriched = html
    .replace(/<title>.*?<\/title>/i, `<title>${meta.title}</title>`)
    .replace(
      "</head>",
      [
        `<meta name=\"description\" content=\"${meta.description}\" />`,
        `<meta property=\"og:title\" content=\"${meta.title}\" />`,
        `<meta property=\"og:description\" content=\"${meta.description}\" />`,
        `<meta property=\"og:type\" content=\"website\" />`,
        `<link rel=\"canonical\" href=\"${meta.canonical}\" />`,
        `<link rel=\"alternate\" hreflang=\"en\" href=\"${meta.canonical}?lang=en\" />`,
        `<link rel=\"alternate\" hreflang=\"it\" href=\"${meta.canonical}?lang=it\" />`,
        "</head>"
      ].join("\n")
    );

  return enriched;
}

const indexHtml = await readFile(indexPath, "utf8");

for (const meta of routes) {
  const targetDir = meta.route === "/" ? distRoot : resolve(distRoot, meta.route.slice(1));
  await mkdir(targetDir, { recursive: true });
  const html = injectMeta(indexHtml, meta);
  const targetFile = resolve(targetDir, "index.html");
  await mkdir(dirname(targetFile), { recursive: true });
  await writeFile(targetFile, html, "utf8");
}

console.log(`Prerendered ${routes.length} marketing routes into ${distRoot}`);
