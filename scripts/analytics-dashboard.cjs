#!/usr/bin/env node
/**
 * The same numbers as analytics-report.cjs, as a local HTML page — "an own
 * app on this machine to look at" (user, 2026-08-25). Fetches with the same
 * shared code, writes dist-analytics/dashboard.html, opens it in the browser.
 * The page is self-contained and static: the numbers are baked in at build
 * time, nothing in the browser calls anywhere, and the read secret never
 * leaves this script.
 *
 *   node scripts/analytics-dashboard.cjs        # or double-click analytics.cmd
 */
const fs = require('node:fs');
const path = require('node:path');
const { execFile } = require('node:child_process');

const { fetchEvents, aggregate, coverageWarning, share, TIME_ZONE } = require('./analytics-report.cjs');

const esc = (value) => String(value).replace(/[&<>"']/g, (c) => `&#${c.charCodeAt(0)};`);

/**
 * The errors card: app errors by signature (worst first), then failed
 * operations by op + code with their count per day. Everything is escaped —
 * the values are validated by the server, but a page that prints data does
 * not rely on that.
 */
function renderErrors({ appErrors, operations }) {
  const errorRows = appErrors
    .map(
      (row) => `<tr>
      <td class="l"><code>${esc(row.signature)}</code><br><span class="meta">${esc(row.name)} · ${esc(row.kinds.join(', '))}</span></td>
      <td>${row.installs}</td><td>${row.count}</td>
      <td>${esc(row.firstSeen)}<br>${esc(row.lastSeen)}</td>
      <td class="l">${esc(row.versions.join(', ') || '-')}<br><span class="meta">${esc(row.screens.join(', ') || '-')}</span></td>
      <td class="l"><code>${esc(row.frames.join('  ') || '-')}</code></td>
    </tr>`,
    )
    .join('');
  const operationRows = operations
    .map(
      (row) => `<tr>
      <td class="l">${esc(row.op)}</td><td class="l">${esc(row.code)}</td>
      <td>${row.total}</td><td>${row.installs}</td>
      <td class="l">${esc(row.days.slice(-14).map((entry) => `${entry.day.slice(5)}: ${entry.count}`).join('   '))}</td>
    </tr>`,
    )
    .join('');
  return `<div class="card wide"><h2>Virheet — sovellusvirheet allekirjoituksittain, pahimmat ensin</h2>
    ${
      appErrors.length === 0
        ? '<p class="meta">ei sovellusvirheitä</p>'
        : `<table><tr><th class="l">Allekirjoitus</th><th>Asennukset</th><th>Kertaa</th><th>Ensi / viimeksi</th><th class="l">Versiot / ruudut</th><th class="l">Kehykset</th></tr>${errorRows}</table>`
    }
    <h2 style="margin-top:18px">Epäonnistuneet toiminnot — toiminto + koodi, päivittäin</h2>
    ${
      operations.length === 0
        ? '<p class="meta">ei epäonnistuneita toimintoja</p>'
        : `<table><tr><th class="l">Toiminto</th><th class="l">Koodi</th><th>Yhteensä</th><th>Asennukset</th><th class="l">Päivät (14 pv)</th></tr>${operationRows}</table>`
    }
    <p class="meta" style="margin-top:10px">Virheilmoitusten tekstiä ei lähetetä: vain virheen tyyppi, kohta koodissa (paketti:rivi:sarake — hae lähdekartasta), ruutu ja versio.</p></div>`;
}

function render({ dailies, funnels, retention, installsSeen, errors }, meta) {
  const errorsSection = renderErrors(errors ?? { appErrors: [], operations: [] });
  const maxActives = Math.max(1, ...dailies.map((row) => row.actives));
  const dayBars = dailies
    .slice(-30)
    .map((row) => {
      const height = Math.max(4, Math.round((row.actives / maxActives) * 120));
      return `<div class="bar" title="${esc(row.day)}: ${row.actives} aktiivista, ${row.opens} avausta">
        <div class="fill" style="height:${height}px"></div>
        <span>${esc(row.day.slice(8))}</span>
      </div>`;
    })
    .join('');

  // One block per branch, each bar a share of the installs that reached the
  // branch's first row — the same denominators the terminal report prints.
  const funnelRows = funnels
    .map((funnel) => {
      const rows = funnel.rows
        .map((row) => {
          const percent = share(row.count, funnel.base);
          return `<div class="frow">
        <span class="flabel">${esc(row.label)}</span>
        <div class="ftrack"><div class="fbar" style="width:${percent}%"></div></div>
        <span class="fcount">${row.count} <em>(${percent} %)</em></span>
      </div>`;
        })
        .join('');
      return `<h3 class="ftitle">${esc(funnel.title)} <em>(${funnel.base})</em></h3>${rows}`;
    })
    .join('');
  const retentionKpis = retention.windows
    .map(
      (window) =>
        `<div class="kpi"><b>${window.returned}/${window.eligible}</b><span>${esc(window.label)}</span></div>`,
    )
    .join('');

  const dailyRows = dailies
    .slice()
    .reverse()
    .map(
      (row) => `<tr><td>${esc(row.day)}</td><td>${row.actives}</td><td>${row.opens}</td><td>${row.workouts}</td><td>${row.coach}</td><td>${row.paywall}</td></tr>`,
    )
    .join('');

  return `<!doctype html>
<html lang="fi"><head><meta charset="utf-8">
<title>Vinha — käyttötilastot</title>
<style>
  :root { --bg:#15122b; --card:#1e1a3a; --ink:#efeaff; --muted:#9a92c4; --accent:#ff7a3c; --purple:#8b6cf0; --line:#2c2750; }
  * { box-sizing:border-box; margin:0; }
  body { background:var(--bg); color:var(--ink); font:15px/1.5 system-ui,'Segoe UI',sans-serif; padding:28px; }
  h1 { font-size:22px; } h1 b { color:var(--purple); }
  .meta { color:var(--muted); font-size:12.5px; margin:4px 0 22px; }
  .grid { display:grid; grid-template-columns:1fr 1fr; gap:18px; max-width:1080px; }
  .card { background:var(--card); border:1px solid var(--line); border-radius:14px; padding:18px; }
  .card h2 { font-size:12px; letter-spacing:1.2px; text-transform:uppercase; color:var(--muted); margin-bottom:14px; }
  .kpis { display:flex; gap:26px; }
  .kpi b { font-size:30px; display:block; } .kpi span { color:var(--muted); font-size:12px; }
  .bars { display:flex; align-items:flex-end; gap:5px; height:150px; }
  .bar { display:flex; flex-direction:column; align-items:center; justify-content:flex-end; flex:1; height:100%; }
  .bar .fill { width:100%; max-width:26px; background:var(--accent); border-radius:4px 4px 0 0; }
  .bar span { font-size:10px; color:var(--muted); margin-top:4px; }
  .frow { display:flex; align-items:center; gap:10px; margin:7px 0; }
  .flabel { width:230px; font-size:13px; }
  .ftrack { flex:1; background:var(--bg); border-radius:6px; height:16px; overflow:hidden; }
  .fbar { height:100%; background:linear-gradient(90deg,var(--purple),var(--accent)); border-radius:6px; }
  .fcount { width:90px; text-align:right; font-variant-numeric:tabular-nums; } .fcount em { color:var(--muted); font-style:normal; font-size:11.5px; }
  .ftitle { font-size:13px; margin:16px 0 4px; } .ftitle:first-of-type { margin-top:0; } .ftitle em { color:var(--muted); font-style:normal; font-weight:400; }
  .warn { color:var(--accent); font-weight:600; margin:-12px 0 22px; }
  table { width:100%; border-collapse:collapse; font-variant-numeric:tabular-nums; }
  th,td { text-align:right; padding:5px 8px; border-bottom:1px solid var(--line); font-size:13px; }
  th:first-child, td:first-child, th.l, td.l { text-align:left; }
  td code { font-size:11.5px; color:var(--muted); word-break:break-all; }
  th { color:var(--muted); font-weight:600; font-size:11px; text-transform:uppercase; letter-spacing:0.8px; }
  .wide { grid-column:1 / -1; }
  .note { color:var(--muted); font-size:12px; margin-top:20px; }
</style></head><body>
<h1>Vinha <b>käyttötilastot</b></h1>
<p class="meta">Päivitetty ${esc(meta.generatedAt)} · ${meta.eventCount} tapahtumaa, ${meta.batchesFetched}/${meta.batchTotal} erää · päivät ${esc(TIME_ZONE)} · lataukset ja rahat: Play Console</p>
${meta.warning ? `<p class="warn">${esc(meta.warning)}</p>` : ''}
<div class="grid">
  <div class="card"><h2>Paluu</h2><div class="kpis">
    <div class="kpi"><b>${retention.installs}</b><span>asennusta avannut</span></div>
    ${retentionKpis}
  </div><p class="meta" style="margin:10px 0 0">Mukana vain asennukset, joiden ikkuna päättyi ennen ${esc(retention.horizon)}.</p></div>
  <div class="card"><h2>Aktiiviset / päivä (30 pv)</h2><div class="bars">${dayBars || '<span class="meta">ei vielä dataa</span>'}</div></div>
  <div class="card wide"><h2>Suppilo — missä matka katkeaa (${installsSeen} asennusta nähty)</h2>${funnelRows}</div>
  <div class="card wide"><h2>Päivittäin</h2>
    <table><tr><th>Päivä</th><th>Aktiiviset</th><th>Avaukset</th><th>Treenit</th><th>Coach</th><th>Paywall</th></tr>${dailyRows}</table>
  </div>
  ${errorsSection}
</div>
<p class="note">Sivu on staattinen: luvut haettiin skriptillä koneellesi, selain ei kutsu mitään eikä lukusalaisuus ole tässä tiedostossa. Päivitä ajamalla analytics.cmd uudestaan.</p>
</body></html>`;
}

async function main() {
  const fetched = await fetchEvents(undefined);
  const warning = coverageWarning(fetched);
  if (warning) console.warn(warning);
  const summary = aggregate(fetched.events);
  const html = render(summary, {
    generatedAt: new Date().toLocaleString('fi-FI'),
    eventCount: fetched.events.length,
    batchTotal: fetched.batchTotal,
    batchesFetched: fetched.batchesFetched,
    warning,
  });
  const outDir = path.join(__dirname, '..', 'dist-analytics');
  fs.mkdirSync(outDir, { recursive: true });
  const outFile = path.join(outDir, 'dashboard.html');
  fs.writeFileSync(outFile, html);
  console.log(`Wrote ${outFile}`);
  if (process.platform === 'win32' && !process.argv.includes('--no-open')) {
    execFile('cmd', ['/c', 'start', '', outFile]);
  }
}

module.exports = { render };

// Run only as a script, so a test can render a page without fetching one.
if (require.main === module) {
  main().catch((error) => {
    console.error(error.message);
    process.exitCode = 1;
  });
}
