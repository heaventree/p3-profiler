/* Heaventree Performance Profiler — admin UI
 * Vanilla JS, no jQuery UI dependency, no build step required.
 */
(function () {
  'use strict';

  const { nonce, ajax, profiling, ip, opts, site_url, admin_url, woo_active } = window.HTP_Data || {};

  // ------------------------------------------------------------------ utils
  function el(tag, attrs = {}, ...children) {
    const node = document.createElement(tag);
    Object.entries(attrs).forEach(([k, v]) => {
      if (k === 'cls') node.className = v;
      else if (k === 'on') Object.entries(v).forEach(([ev, fn]) => node.addEventListener(ev, fn));
      else if (k === 'innerHTML') node.innerHTML = v;
      else node.setAttribute(k, v);
    });
    children.flat().filter(Boolean).forEach(c => node.append(typeof c === 'string' ? c : c));
    return node;
  }

  function post(action, data = {}) {
    const fd = new FormData();
    fd.append('action', action);
    fd.append('nonce', nonce);
    Object.entries(data).forEach(([k, v]) => fd.append(k, v));
    return fetch(ajax, { method: 'POST', body: fd })
      .then(r => r.json())
      .then(r => { if (!r.success) throw new Error(r.data || 'Request failed'); return r.data; });
  }

  function fmtMs(ms) {
    if (ms == null) return '—';
    return ms >= 1000 ? (ms / 1000).toFixed(2) + 's' : ms.toFixed(1) + 'ms';
  }

  function speedCls(ms) {
    if (ms < 500)  return 'htp-good';
    if (ms < 1500) return 'htp-warn';
    return 'htp-bad';
  }

  function bar(pct, cls = '') {
    return el('div', { cls: 'htp-bar-wrap' },
      el('div', { cls: 'htp-bar-fill ' + cls, style: `width:${Math.min(pct, 100)}%` })
    );
  }

  function renderMarkdown(text) {
    return text
      .replace(/^### (.+)$/gm, '<h4>$1</h4>')
      .replace(/^## (.+)$/gm,  '<h3>$1</h3>')
      .replace(/^# (.+)$/gm,   '<h2>$1</h2>')
      .replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>')
      .replace(/`([^`]+)`/g, '<code>$1</code>')
      .replace(/^[-*] (.+)$/gm, '<li>$1</li>')
      .replace(/(<li>[\s\S]+?<\/li>)/g, '<ul>$1</ul>')
      .replace(/\n{2,}/g, '</p><p>');
  }

  // ------------------------------------------------------------------ state
  let state = {
    tab: 'dashboard',
    scans: [],
    activeScan: null,
    profiles: [],
    selectedProfile: null,
    isProfilingNow: !!profiling,
    profilingIp: ip || '',
    scanName: '',
    settings: { ...opts },
    loading: false,
    aiLoading: false,
  };

  const app = document.getElementById('htp-app');

  function render() {
    app.innerHTML = '';
    app.append(renderHeader(), renderTabs(), renderBody());
  }

  function renderHeader() {
    const badge = state.isProfilingNow
      ? el('span', { cls: 'htp-badge htp-badge--on' }, '● Profiling active')
      : el('span', { cls: 'htp-badge htp-badge--off' }, '○ Idle');
    return el('div', { cls: 'htp-header' },
      el('h1', {}, 'Performance Profiler'),
      el('div', { cls: 'htp-header-right' }, badge)
    );
  }

  function renderTabs() {
    return el('div', { cls: 'htp-tabs' },
      ...['dashboard', 'profiles', 'settings'].map(t =>
        el('button', {
          cls: 'htp-tab' + (state.tab === t ? ' htp-tab--active' : ''),
          on: { click: () => { state.tab = t; render(); } }
        }, t.charAt(0).toUpperCase() + t.slice(1))
      )
    );
  }

  function renderBody() {
    if (state.tab === 'dashboard') return renderDashboard();
    if (state.tab === 'profiles')  return renderProfiles();
    if (state.tab === 'settings')  return renderSettings();
    return el('div', {});
  }

  // ----------------------------------------------------------- dashboard
  function renderDashboard() {
    const section = el('div', { cls: 'htp-section' });
    const card    = el('div', { cls: 'htp-card' });

    if (state.isProfilingNow) {
      const stored = window.HTP_Data.opts || {};
      const exp    = stored.profiling_expires ? new Date(stored.profiling_expires * 1000).toLocaleTimeString() : '';
      card.append(
        el('p', { cls: 'htp-status-text htp-good' }, 'Profiling active for IP: ' + (stored.profiling_ip || ip)),
        exp ? el('p', { cls: 'htp-hint' }, 'Auto-stops at ' + exp) : '',
        el('p', { cls: 'htp-hint' }, 'Browse your site or wp-admin now. Results are saved automatically after each page load.'),
        el('div', { cls: 'htp-row htp-mt' },
          el('a', { href: site_url, target: '_blank', cls: 'htp-btn htp-btn--ghost' }, '↗ Visit site'),
          el('a', { href: admin_url, target: '_blank', cls: 'htp-btn htp-btn--ghost' }, '↗ wp-admin'),
          el('button', { cls: 'htp-btn htp-btn--danger', on: { click: stopScan } }, 'Stop profiling')
        )
      );
    } else {
      const nameInput = el('input', { type: 'text', cls: 'htp-input', placeholder: 'e.g. woocommerce-orders-page' });
      const ipInput   = el('input', { type: 'text', cls: 'htp-input', value: ip || '' });
      card.append(
        el('h3', {}, 'Start a profiling session'),
        el('p', { cls: 'htp-hint' }, 'Only your IP is profiled. Browse the slow pages after clicking Start.'),
        el('label', { cls: 'htp-label' }, 'Scan name'), nameInput,
        el('label', { cls: 'htp-label' }, 'Your IP (auto-detected)'), ipInput,
        el('div', { cls: 'htp-row htp-mt' },
          el('button', {
            cls: 'htp-btn htp-btn--primary',
            on: { click: () => {
              state.scanName    = nameInput.value.trim() || ('scan_' + Date.now());
              state.profilingIp = ipInput.value.trim();
              startScan();
            }}
          }, 'Start profiling')
        )
      );
    }

    section.append(card);

    if (woo_active) {
      section.append(el('div', { cls: 'htp-card htp-card--info' },
        el('strong', {}, 'WooCommerce detected'),
        el('p', { cls: 'htp-hint' }, 'WC hook timing and query attribution are enabled. For best results, profile /wp-admin/edit.php?post_type=shop_order and /wp-admin/admin.php?page=wc-reports')
      ));
    }

    return section;
  }

  async function startScan() {
    try {
      const data = await post('htp_start_scan', { scan_name: state.scanName, ip: state.profilingIp, duration: 3600 });
      state.isProfilingNow = true;
      window.HTP_Data.opts.profiling_ip      = data.ip;
      window.HTP_Data.opts.profiling_expires = data.expires;
      render();
    } catch (e) { alert('Failed to start: ' + e.message); }
  }

  async function stopScan() {
    try {
      const data = await post('htp_stop_scan');
      state.isProfilingNow = false;
      state.tab = 'profiles';
      await loadProfiles(data.scan_name);
    } catch (e) { alert('Failed to stop: ' + e.message); }
  }

  // ----------------------------------------------------------- profiles
  async function loadScans() {
    try { state.scans = await post('htp_list_scans') || []; } catch { state.scans = []; }
  }

  async function loadProfiles(scanName) {
    state.activeScan = scanName;
    state.loading    = true;
    render();
    try {
      state.profiles       = await post('htp_get_profiles', { scan_name: scanName }) || [];
      state.selectedProfile = state.profiles.length ? 0 : null;
    } catch { state.profiles = []; }
    state.loading = false;
    render();
  }

  function renderProfiles() {
    const section = el('div', { cls: 'htp-section' });

    const scanSelect = el('select', { cls: 'htp-input htp-select' });
    scanSelect.append(el('option', { value: '' }, '— Select a scan —'));
    (state.scans || []).forEach(s => {
      const o = el('option', { value: s }, s);
      if (s === state.activeScan) o.selected = true;
      scanSelect.append(o);
    });
    scanSelect.addEventListener('change', () => loadProfiles(scanSelect.value));

    section.append(el('div', { cls: 'htp-row htp-mb' },
      el('label', { cls: 'htp-label', style: 'margin:0' }, 'Scan:'),
      scanSelect,
      el('button', { cls: 'htp-btn htp-btn--ghost', on: { click: async () => { await loadScans(); render(); } } }, 'Refresh')
    ));

    if (state.loading) { section.append(el('p', { cls: 'htp-hint' }, 'Loading…')); return section; }
    if (!state.activeScan || !state.profiles.length) {
      section.append(el('p', { cls: 'htp-hint' }, 'No profiles yet. Start a scan and browse your site.'));
      return section;
    }

    const list = el('div', { cls: 'htp-profile-list' });
    state.profiles.forEach((p, i) => {
      list.append(el('div', {
        cls: 'htp-profile-item' + (state.selectedProfile === i ? ' htp-profile-item--active' : ''),
        on:  { click: () => { state.selectedProfile = i; render(); } }
      },
        el('span', { cls: speedCls(p.total_ms) }, fmtMs(p.total_ms)),
        el('span', { cls: 'htp-profile-meta' }, (p.is_admin ? '[admin] ' : '') + (p.url || '')),
        el('span', { cls: 'htp-profile-date' }, p.date ? new Date(p.date).toLocaleTimeString() : '')
      ));
    });
    section.append(list);

    if (state.selectedProfile !== null) {
      section.append(renderDetail(state.profiles[state.selectedProfile], state.selectedProfile));
    }
    return section;
  }

  function renderDetail(p, index) {
    const card = el('div', { cls: 'htp-card htp-mt' });

    card.append(
      el('div', { cls: 'htp-row' },
        el('h3', {}, fmtMs(p.total_ms) + ' — ' + (p.url || '')),
        el('span', { cls: 'htp-hint' }, new Date(p.date).toLocaleString())
      ),
      el('div', { cls: 'htp-metrics-row' },
        tile('Memory',     p.memory_mb + 'MB'),
        tile('DB queries', p.db?.total ?? '—'),
        tile('DB time',    fmtMs(p.db?.total_ms)),
        ...(p.woo ? [tile('WC queries', p.woo.wc_queries), tile('WC query time', fmtMs(p.woo.wc_query_ms))] : [])
      )
    );

    // Checkpoints
    if (Object.keys(p.checkpoints || {}).length) {
      const t = el('table', { cls: 'htp-table' });
      Object.entries(p.checkpoints).forEach(([k, v]) =>
        t.append(el('tr', {}, el('td', {}, k), el('td', { cls: speedCls(v) }, fmtMs(v))))
      );
      card.append(el('h4', {}, 'Request timeline'), t);
    }

    // Plugin hook counts
    if (Object.keys(p.plugin_hooks || {}).length) {
      const maxVal = Math.max(...Object.values(p.plugin_hooks));
      const t = el('table', { cls: 'htp-table' });
      Object.entries(p.plugin_hooks).slice(0, 20).forEach(([slug, count]) =>
        t.append(el('tr', {},
          el('td', { cls: 'htp-slug' }, slug),
          el('td', { style: 'width:40%' }, bar(count / maxVal * 100, count > maxVal * 0.5 ? 'htp-bar--warn' : '')),
          el('td', { cls: 'htp-mono' }, count + ' hooks')
        ))
      );
      card.append(el('h4', {}, 'Plugin hook registrations'), t);
    }

    // Slow queries
    if (p.db?.slowest?.length) {
      const t = el('table', { cls: 'htp-table' });
      t.append(el('tr', {}, el('th', {}, 'Time'), el('th', {}, 'SQL'), el('th', {}, 'Caller')));
      p.db.slowest.forEach(q =>
        t.append(el('tr', {},
          el('td', { cls: 'htp-mono htp-bad' }, fmtMs(q.ms)),
          el('td', { cls: 'htp-sql' }, q.sql),
          el('td', { cls: 'htp-hint' }, q.caller)
        ))
      );
      card.append(el('h4', {}, `Slow queries (>${p.db.slow_threshold_ms}ms)`), t);
    }

    // WooCommerce
    if (p.woo?.hook_timings && Object.keys(p.woo.hook_timings).length) {
      const t = el('table', { cls: 'htp-table' });
      Object.entries(p.woo.hook_timings).forEach(([hook, ms]) =>
        t.append(el('tr', {}, el('td', {}, hook), el('td', { cls: speedCls(ms) }, fmtMs(ms))))
      );
      card.append(el('h4', {}, 'WooCommerce ' + p.woo.wc_version), t);
    }

    // AI section
    card.append(el('div', { cls: 'htp-ai-section' },
      el('div', { cls: 'htp-row' },
        el('h4', {}, 'AI Recommendations'),
        p.ai_analysis
          ? el('span', { cls: 'htp-badge htp-badge--on' }, 'Analysed')
          : el('button', {
              cls: 'htp-btn htp-btn--primary',
              on:  { click: () => runAI(state.activeScan, index) }
            }, state.aiLoading ? 'Analysing…' : '✦ Analyse with AI')
      ),
      p.ai_analysis
        ? el('div', { cls: 'htp-ai-result', innerHTML: renderMarkdown(p.ai_analysis) })
        : el('p', { cls: 'htp-hint' }, 'Click the button to get AI-powered recommendations for this profile.')
    ));

    return card;
  }

  function tile(label, value) {
    return el('div', { cls: 'htp-metric' },
      el('span', { cls: 'htp-metric-val' }, String(value ?? '—')),
      el('span', { cls: 'htp-metric-label' }, label)
    );
  }

  async function runAI(scanName, index) {
    state.aiLoading = true; render();
    try {
      const data = await post('htp_ai_analyze', { scan_name: scanName, index });
      state.profiles[index].ai_analysis = data.analysis;
    } catch (e) { alert('AI analysis failed: ' + e.message); }
    state.aiLoading = false; render();
  }

  // ----------------------------------------------------------- settings
  function renderSettings() {
    const s    = state.settings || {};
    const card = el('div', { cls: 'htp-card' });

    const providerSel = el('select', { cls: 'htp-input htp-select' },
      el('option', { value: 'anthropic' }, 'Anthropic Claude'),
      el('option', { value: 'openai' },    'OpenAI')
    );
    providerSel.value = s.ai_provider || 'anthropic';

    const modelInput = el('input', { type: 'text', cls: 'htp-input', placeholder: 'Leave blank for default', value: s.ai_model || '' });
    const keyInput   = el('input', { type: 'password', cls: 'htp-input', autocomplete: 'off',
      placeholder: s.ai_api_key ? 'API key is set (enter new key to change)' : 'Enter API key' });

    card.append(
      el('h3', {}, 'AI Settings'),
      el('p',  { cls: 'htp-hint' }, 'Used for generating performance recommendations from profiling data.'),
      el('label', { cls: 'htp-label' }, 'AI Provider'), providerSel,
      el('label', { cls: 'htp-label' }, 'Model (optional)'), modelInput,
      el('label', { cls: 'htp-label' }, 'API Key'), keyInput,
      el('div', { cls: 'htp-mt' },
        el('button', {
          cls: 'htp-btn htp-btn--primary',
          on:  { click: async () => {
            try {
              await post('htp_save_settings', { ai_provider: providerSel.value, ai_model: modelInput.value, ai_api_key: keyInput.value });
              alert('Settings saved.');
            } catch (e) { alert('Save failed: ' + e.message); }
          }}
        }, 'Save settings')
      )
    );

    return el('div', { cls: 'htp-section' }, card);
  }

  // ------------------------------------------------------------------ init
  (async function init() {
    await loadScans();
    if (state.scans.length) {
      await loadProfiles(state.scans[0]);
    }
    render();
  })();

})();
