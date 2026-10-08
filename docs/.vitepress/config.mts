import { defineConfig } from 'vitepress';
// Written by `npm run docs:api` (TypeDoc) from the TSDoc comments in packages/api
import typedocSidebar from '../api/typedoc-sidebar.json';

const repo = 'https://github.com/yizhanmiao/phy-vscode';

export default defineConfig({
  title: 'phy-vscode',
  description: 'Browse phy/Kilosort spike-sorting datasets in VS Code, and extend it with plugins.',
  base: '/phy-vscode/', // GitHub Pages serves a project site under /<repo>/
  cleanUrls: true,
  srcExclude: ['superpowers/**'], // internal specs and plans, not part of the site
  themeConfig: {
    nav: [
      { text: 'User guide', link: '/user-guide' },
      { text: 'Writing mods', link: '/mods' },
      { text: 'API', link: '/api/' },
    ],
    sidebar: [
      {
        text: 'Guides',
        items: [
          { text: 'User guide', link: '/user-guide' },
          { text: 'Writing mods', link: '/mods' },
        ],
      },
      { text: 'API reference', link: '/api/', items: typedocSidebar },
    ],
    search: { provider: 'local' },
    socialLinks: [{ icon: 'github', link: repo }],
    outline: [2, 3],
  },
});
