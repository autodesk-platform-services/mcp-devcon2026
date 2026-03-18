import { defineConfig } from "vitepress";

function normalizeBase(input) {
  if (!input) {
    return "/";
  }

  const withLeadingSlash = input.startsWith("/") ? input : `/${input}`;
  return withLeadingSlash.endsWith("/")
    ? withLeadingSlash
    : `${withLeadingSlash}/`;
}

const base = normalizeBase(process.env.VITEPRESS_BASE_PATH || "/");
const withBase = (path) => `${base}${path.replace(/^\//, "")}`;

export default defineConfig({
  title: "DevCon MCP Workshop",
  description:
    "Build, connect, and ship a Model Context Protocol system end-to-end.",

  base,

  srcDir: "src",
  cleanUrls: true,

  markdown: {
    config: (md) => {
      const defaultLinkOpen =
        md.renderer.rules.link_open ||
        function (tokens, idx, options, env, self) {
          return self.renderToken(tokens, idx, options);
        };
      md.renderer.rules.link_open = function (tokens, idx, options, env, self) {
        const hrefIdx = tokens[idx].attrIndex("href");
        if (hrefIdx >= 0) {
          const href = tokens[idx].attrs[hrefIdx][1];
          if (
            href.startsWith("/code-states") ||
            href.startsWith(withBase("code-states"))
          ) {
            tokens[idx].attrSet("target", "_blank");
            tokens[idx].attrSet("rel", "noopener");
          }
        }
        return defaultLinkOpen(tokens, idx, options, env, self);
      };
    },
  },

  head: [
    ["link", { rel: "icon", href: withBase("favicon.webp"), type: "image/webp" }],
  ],

  appearance: "dark",

  themeConfig: {
    logo: null,

    nav: [
      { text: "Home", link: "/" },
      { text: "Start Workshop", link: "/01-establishing-mcp-communication" },
      { text: "Source Code", link: "/code-states" },
      {
        text: "Download Slides",
        link: withBase("MCP_Devcon%2014-04-2026.pdf"),
        target: "_blank",
      },
    ],

    sidebar: [
      {
        text: "Workshop",
        items: [
          {
            text: "Prerequisites",
            link: "/prerequisites",
          },
          {
            text: "1 - Establishing MCP Communication",
            link: "/1-establishing-mcp-communication",
          },
          {
            text: "2 - Linking with External Tools",
            link: "/2-linking-with-external-tools",
          },
          {
            text: "3 - Connecting Autodesk APS (2-Legged)",
            link: "/3-connecting-autodesk-aps",
          },
          {
            text: "4 - User Authentication with APS (3-Legged)",
            link: "/4-three-legged-aps",
          },
          {
            text: "5 - Advanced: Custom Client & Agent",
            link: "/5-advanced",
          },
          {
            text: "Production Checklist",
            link: "/production-checklist",
          },
          {
            text: "Source Code",
            link: "/code-states",
          },
        ],
      },
    ],

    socialLinks: [],

    footer: {
      message: "DevCon MCP Workshop",
      copyright: `© ${new Date().getFullYear()} Nacorm`,
    },

    search: {
      provider: "local",
    },
  },
});
