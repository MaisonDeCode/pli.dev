import { defineConfig } from "astro/config";
import starlight from "@astrojs/starlight";
import starlightSidebarTopics from "starlight-sidebar-topics";
import react from "@astrojs/react";

export default defineConfig({
  site: "https://pli.dev",
  integrations: [
    // React islands: the live editors on the landing page and the product pages.
    react(),
    starlight({
      title: "Pli",
      // Colour, type and shape shared with the landing page (src/styles).
      customCss: ["./src/styles/tokens.css", "./src/styles/components.css", "./src/styles/motion.css", "./src/styles/starlight.css"],
      components: {
        // The section menu at the top of the sidebar, with the front page's icons.
        Sidebar: "./src/components/Sidebar.astro",
        // The Pli mark in the header, and no duplicate h1 on the product pages (their ProductHero has it).
        SiteTitle: "./src/components/SiteTitle.astro",
        PageTitle: "./src/components/PageTitle.astro",
        // The credit and the GitHub link under every docs page.
        Footer: "./src/components/DocsFooter.astro",
      },
      description:
        "Open-source document, spreadsheet, slide and PDF editors for JavaScript, React, Swift and Kotlin.",
      plugins: [
        // One tab per editor, each with its own sidebar.
        starlightSidebarTopics([
          {
            label: "Start here",
            link: "/introduction/",
            icon: "rocket",
            items: ["introduction", "roadmap"],
          },
          {
            label: "Pli.Documents",
            link: "/documents/",
            icon: "document",
            items: [
              "documents",
              "documents/getting-started",
              { label: "Roadmap", slug: "documents/roadmap" },
              {
                label: "Use it",
                items: ["documents/ready-made-ui", "documents/build-your-own", "documents/swift", "documents/kotlin"],
              },
              {
                label: "Features",
                items: [
                  "documents/features/pages-and-layout",
                  "documents/features/ruler-and-indents",
                  "documents/features/footnotes",
                  "documents/features/columns-and-sections",
                  "documents/features/comments",
                  "documents/features/suggestions",
                  "documents/features/headers-and-footers",
                  "documents/features/images",
                  "documents/features/lists",
                  "documents/features/tables",
                  "documents/features/copy-and-paste",
                  "documents/features/table-of-contents",
                  "documents/features/formatting",
                  "documents/features/styles",
                  "documents/features/keyboard-shortcuts",
                ],
              },
              {
                label: "Concepts",
                items: [{ autogenerate: { directory: "documents/concepts" } }],
              },
              {
                label: "Guides",
                items: [{ autogenerate: { directory: "documents/guides" } }],
              },
            ],
          },
          { label: "Pli.Sheets", link: "/sheets/", icon: "list-format", items: ["sheets", "sheets/getting-started", "sheets/grid", "sheets/collaboration", "sheets/charts", "sheets/formatting", "sheets/validation", "sheets/tables", "sheets/pivot-tables", { label: "Roadmap", slug: "sheets/roadmap" }, { label: "Reference", items: ["sheets/formulas", "sheets/files"] }, { label: "Swift and Kotlin", slug: "sheets/swift-and-kotlin" }] },
          { label: "Pli.Decks", link: "/decks/", icon: "laptop", items: ["decks", "decks/getting-started", { label: "Roadmap", slug: "decks/roadmap" }, { label: "Use it", items: ["decks/ready-made-ui", { label: "Swift and Kotlin", slug: "decks/swift-and-kotlin" }] }, { label: "Features", items: ["decks/themes-and-layouts", "decks/charts", "decks/animations", "decks/files", "decks/templates", "decks/collaboration"] }] },
          { label: "Pli.Boards", link: "/boards/", icon: "random", items: ["boards", { label: "Roadmap", slug: "boards/roadmap" }] },
          { label: "Pli.Forms", link: "/forms/", icon: "pencil", items: ["forms", { label: "Roadmap", slug: "forms/roadmap" }] },
          { label: "Pli.PDF", link: "/pdf/", icon: "add-document", items: ["pdf", "pdf/getting-started", { label: "Ready-made editor", slug: "pdf/ready-made-ui" }, { label: "Toolbar and menus", slug: "pdf/toolbar" }, "pdf/viewing", "pdf/annotations", "pdf/pages", { label: "Forms", slug: "pdf/forms" }, { label: "Text and redaction", slug: "pdf/text-and-redaction" }, "pdf/files", "pdf/collaboration", { label: "Swift and Kotlin", slug: "pdf/swift-and-kotlin" }, "pdf/concepts", "pdf/shortcuts", { label: "Roadmap", slug: "pdf/roadmap" }] },
          { label: "Pli.Databases", link: "/databases/", icon: "bars", items: ["databases", { label: "Roadmap", slug: "databases/roadmap" }] },
          { label: "Pli.Scripts", link: "/scripts/", icon: "rocket", items: ["scripts", { label: "Roadmap", slug: "scripts/roadmap" }] },
          {
            label: "Platform",
            link: "/platform/architecture/",
            icon: "puzzle",
            items: [
              "platform/architecture",
              "platform/collaboration",
              "platform/shared-ui",
              "platform/theme-and-buttons",
              "platform/menus-and-file-pickers",
              "platform/saving-files",
              "platform/users",
              "platform/comments",
              "platform/realtime",
              "platform/live-editing",
              "platform/co-editing",
              "platform/fonts",
              "platform/versions",
              "platform/fonts-decision",
              "platform/swift-and-kotlin",
              "platform/example-apps",
              "platform/package-names",
              "platform/scripting",
              {
                label: "Contributing",
                items: ["platform/contributing", "platform/contributing/setup", "platform/contributing/working-on-pli", "platform/contributing/releases", "platform/contributing/bugs-and-changes"],
              },
            ],
          },
        ]),
      ],
    }),
  ],
});
