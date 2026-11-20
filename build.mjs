// Builds one self-contained HTML (double-clickable) + artifact copy.
import * as esbuild from 'esbuild';
import fs from 'node:fs';
import { execSync } from 'node:child_process';
let commit = 'nogit';
try { commit = execSync('git rev-parse --short HEAD').toString().trim() + (execSync('git status --porcelain').toString().trim() ? '-dirty' : ''); } catch (e) { /* not a repo */ }

const pkg = JSON.parse(fs.readFileSync('node_modules/react/package.json'));
const esb = JSON.parse(fs.readFileSync('node_modules/esbuild/package.json'));
const jsp = JSON.parse(fs.readFileSync('node_modules/jspdf/package.json'));
const BUILD = { version: '0.3.0', mode: 'harness', built: new Date().toISOString().replace(/\.\d+Z$/, 'Z'), react: pkg.version, esbuild: esb.version, jspdf: jsp.version, repo: process.env.REPO || '', commit };

const out = await esbuild.build({
  entryPoints: ['src/app.jsx'], bundle: true, format: 'iife', write: false, minify: true,
  jsxFactory: 'React.createElement', jsxFragment: 'React.Fragment', target: 'es2020',
  define: { __BUILD__: JSON.stringify(BUILD) },
});
const esc = (s) => s.replace(/<\/script/gi, '<\\/script').replace(/<!--/g, '\\x3C!--');
const escCss = (s) => s.replace(/<\/style/gi, '<\\/style');
const font = fs.readFileSync('vds/fonts/Flywheel-Vision-Icons.woff').toString('base64');
const html = `<!DOCTYPE html>
<html lang="en" class="vision-dark" data-mode="dark"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>Responder Review (prototype)</title>
<style>@font-face{font-family:'Flywheel-Vision-Icons';src:url(data:font/woff;base64,${font}) format('woff');font-weight:normal;font-style:normal;font-display:block}</style>
<style>${escCss(fs.readFileSync('vds/colors.css', 'utf8'))}</style>
<style>${escCss(fs.readFileSync('vds/bundle.css', 'utf8'))}</style>
<style>${escCss(fs.readFileSync('src/app.css', 'utf8'))}</style>
</head><body class="vision-dark"><div id="root"></div>
<script src="https://cdn.flywheel.io/sdk/extension/flywheel-extension-0.14.9.min.js" onerror="window.__sdkFailed=true"></script>
<script>${esc(fs.readFileSync('node_modules/react/umd/react.production.min.js', 'utf8'))}</script>
<script>${esc(fs.readFileSync('node_modules/react-dom/umd/react-dom.production.min.js', 'utf8'))}</script>
<script>${esc(fs.readFileSync('node_modules/jspdf/dist/jspdf.umd.min.js', 'utf8'))}</script>
<script>${esc(fs.readFileSync('vds/bundle.js', 'utf8'))}</script>
<script>${esc(out.outputFiles[0].text)}</script>
</body></html>`;
fs.mkdirSync('dist', { recursive: true });
fs.writeFileSync('dist/responder-review.html', html);
console.log('built', (html.length / 1024).toFixed(0) + ' KB', BUILD.built);
