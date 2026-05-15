#!/usr/bin/env node
// scripts/inject-build-vars.js
//
// Reads VITE_SUPABASE_URL and VITE_SUPABASE_ANON_KEY from a .env file or
// the process environment and injects them as concrete string values into
// index.html and dashboard.html.
//
// This runs as part of the Netlify build command so that the HTML files
// served to the browser contain the real credentials — no edge function
// or import-map needed.
//
// Usage: node scripts/inject-build-vars.js

const { readFileSync, writeFileSync } = require('fs');
const { resolve } = require('path');

// __dirname is available in CommonJS (Node.js)
const rootDir = resolve(__dirname);

// Load .env if present
const envPath = resolve(rootDir, '.env');
try {
  const envContent = readFileSync(envPath, 'utf8');
  for (const line of envContent.split('\n')) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#')) continue;
    const eqIdx = trimmed.indexOf('=');
    if (eqIdx < 0) continue;
    const key = trimmed.slice(0, eqIdx).trim();
    const val = trimmed.slice(eqIdx + 1).trim().replace(/^['"]|['"]$/g, '');
    if (!process.env[key]) process.env[key] = val;
  }
} catch (_) {}

// Read values from environment
const supabaseUrl     = process.env.VITE_SUPABASE_URL        || '';
const supabaseAnonKey = process.env.VITE_SUPABASE_ANON_KEY || '';

if (!supabaseUrl || !supabaseAnonKey) {
  console.warn(
    '[inject-build-vars] VITE_SUPABASE_URL or VITE_SUPABASE_ANON_KEY not set — ' +
    'HTML files will use empty strings. Set these in .env or Netlify env vars.'
  );
}

const pages = ['index.html', 'dashboard.html'];

for (const page of pages) {
  const filePath = resolve(rootDir, page);
  let html;
  try {
    html = readFileSync(filePath, 'utf8');
  } catch (err) {
    console.error(`[inject-build-vars] Could not read ${page}:`, err.message);
    continue;
  }

  const script = `<script>
  window.__SUPABASE_URL__     = ${JSON.stringify(supabaseUrl)};
  window.__SUPABASE_ANON_KEY__ = ${JSON.stringify(supabaseAnonKey)};
</scr${'ipt>'}`;

  const updated = html.replace('<head>', `<head>\n${script}`);

  writeFileSync(filePath, updated, 'utf8');
  console.log(`[inject-build-vars] Injected env vars into ${page}`);
}