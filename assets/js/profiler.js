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
      else node.setAttribute(k, v);
    });
    children.flat().forEach(c => node.append(typeof c === 'string' ? c : c));
    return node;
  }

  function post(action, data = {}) {
    const fd = new FormData();
    fd.append('action', action);
    fd.append('nonce', nonce);
    Object.entries(data).forEach(([k, v]) => fd.append(k, v));
    return fetch(ajax, { method: 'POST', body: fd })
      .then(r => r.json())
      .then(r => {
        if (!r.success) throw new Error(r.data || 'Request failed');
        return r.data;
      });
  }

  function fmtMs(ms) {
    if (ms == null) return '—';
    return ms >= 1000 ? (ms / 1000).toFixed(2) + 's' : ms.toFixed(1) + 'ms';
  }

  function speedColour(ms) {
    if (ms < 500) return 'htp-good';
    if (ms < 1500) return 'htp-warn';
    return 'htp-bad';
  }

  function bar(pct, cls = '') {
    const wrap = el('div', { cls: 'htp-bar-wrap' });
    const fill = el('div', { cls: 'htp-bar-fill ' + cls, style: `width:${Math.min(pct, 100)}%` });
    wrap.append(fill);
    return wrap;
  }

  function md(text) {
    // Minimal markdown: bold, headings, bullets, code
    return text
      .replace(/^### (.+)$/gm, '<h4>$1</h4>')
      .replace(/^## (.+)$/gm, '<h3>$1</h3>')
      .replace(/^# (.+)$/gm, '<h2>$1</h2>')
      .replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>')
      .replace(/`([^`]+)`/g, '<code>$1</code>')
      .replace(/^[-*] (.+)$/gm, '<li>$1</li>')
      .replace(/(<li>.*<\/li>)/gs, '<ul>$1</ul>')
      .replace(/\n{2,}/g, '</p><p>')
      .replace(/^(?!<[hul])(.+)$/gm, '$1');
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

  // ------------------------------------------------------------------ app
  const app = document.getElementById('htp-app');

  function render() {
    app.innerHTML = '';
    app.append(renderHeader(), renderTabs(), renderBody());
  }

  function renderHeader() {
    const status = state.isProfilingNow
      ? el('span', { cls: 'htp-badge htp-badge--on' }, '● Profiling active')
      : el('span', { cls: 'htp-badge htp-badge--off' }, '○ Idle');

    return el('div', { cls: 'htp-header' },
      el('h1', {}, 'Performance Profiler'),
      el('div', { cls: 'htp-header-right' }, status)
    );
  }

  function renderTabs() {
    const tabs = ['dashboard', 'profiles', 'settings'];
    return el('div', { cls: 'htp-tabs' },
      ...tabs.map(t =>
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

  // ----------------------------------------------------------- dashboard tab
  function renderDashboard() {
    const section = el('div', { cls: 'htp-section' });

    // Status card
    const statusCard = el('div', { cls: 'htp-card' });
    if (state.isProfilingNow) {
      const opts_stored = window.HTP_Data.opts || {};
      const expires = opts_stored.profiling_expires ? new Date(opts_stored.profiling_expires * 1000).toLocaleTimeString() : '';
      statusCard.append(
        el('p', { cls: 'htp-status-text htp-good' }, 'Profiling is active for IP: ' + (opts_stored.profiling_ip || ip)),
        expires ? el('p', { cls: 'htp-hint' }, 'Auto-stops at ' + expires) : '',
        el('p', { cls: 'htp-hint' }, 'Browse your site or wp-admin while profiling is active. Results are saved automatically.'),
        el('div', { cls: 'htp-row htp-mt' },
          el('a', { href: site_url, target: '_blank', cls: 'htp-btn htp-btn--ghost' }, '↗ Visit site'),
          el('a', { href: admin_url, target: '_blank', cls: 'htp-btn htp-btn--ghost' }, '↗ wp-admin'),
          el('button', {
            cls: 'htp-btn htp-btn--danger',
            on: { click: stopScan }
          }, 'Stop profiling')
        )
      );
    } else {
      const nameInput = el('input', { type: 'text', cls: 'htp-input', placeholder: 'Scan name (e.g. woocommerce-admin)', value: state.scanName || '' });
      const ipInput   = el('input', { type: 'text', cls: 'htp-input', value: state.profilingIp || ip || '', placeholder: 'Your IP address' });

      statusCard.append(
        el('h3', {}, 'Start a profiling session'),
        el('p', { cls: 'htp-hint' }, 'Profiling runs only for your IP address and saves data automatically. Browse the pages you want to test after starting.'),
        el('label', { cls: 'htp-label' }, 'Scan name'),
        nameInput,
        el('label', { cls: 'htp-label' }, 'Your IP (auto-detected)'),
        ipInput,
        el('div', { cls: 'htp-row htp-mt' },
          el('button', {
            cls: 'htp-btn htp-btn--primary',
            on: {
              click: () => {
                state.scanName = nameInput.value.trim() || ('scan_' + Date.now());
                state.profilingIp = ipInput.value.trim();
                startScan();
              }
            }
          }, 'Start profiling')
        )
      );
    }

    // WooCommerce note
    const wooNote = woo_active
      ? el('div', { cls: 'htp-card htp-card--info' },
          el('strong', {}, 'WooCommerce detected'),
          el('p', { cls: 'htp-hint' }, 'WC-specific hook timing and query attribution are enabled. For best results, profile wp-admin pages like /wp-admin/edit.php?post_type=shop_order and /wp-admin/admin.php?page=wc-reports')
        )
      : null;

    section.append(statusCard);
    if (wooNote) section.append(wooNote);
    return section;
  }

  async function startScan() {
    try {
      const data = await post('htp_start_scan', {
        scan_name: state.scanName,
        ip:        state.profilingIp,
        duration:  3600,
      });
      state.isProfilingNow = true;
      state.activeScan = data.scan_name;
      window.HTP_Data.opts.profiling_ip = data.ip;
      window.HTP_Data.opts.profiling_expires = data.expires;
      render();
    } catch (e) {
      alert('Failed to start scan: ' + e.message);
    }
  }

  async function stopScan() {
    try {
      const data = await post('htp_stop_scan');
      state.isProfilingNow = false;
      state.activeScan = data.scan_name;
      state.tab = 'profiles';
      await loadProfiles(data.scan_name);
      render();
    } catch (e) {
      alert('Failed to stop scan: ' + e.message);
    }
  }

  // ----------------------------------------------------------- profiles tab
  async function loadScans() {
    const data = await post('htp_list_scans');
    state.scans = data || [];
  }

  async function loadProfiles(scanName) {
    state.activeScan = scanName;
    state.loading = true;
    render();
    try {
      const data = await post('htp_get_profiles', { scan_name: scanName });
      state.profiles = data || [];
      state.selectedProfile = data && data.length ? 0 : null;
    } catch (e) {
      state.profiles = [];
    }
    state.loading = false;
    render();
  }

  function renderProfiles() {
    const section = el('div', { cls: 'htp-section' });

    // Scan selector
    const scanRow = el('div', { cls: 'htp-row htp-mb' });
    const scanSelect = el('select', { cls: 'htp-input htp-select' });
    scanSelect.append(el('option', { value: '' }, '— Select a scan —'));
    (state.scans || []).forEach(s => {
      const opt = el('option', { value: s }, s);
      if (s === state.activeScan) opt.selected = true;
      scanSelect.append(opt);
    });
    scanSelect.addEventListener('change', () => loadProfiles(scanSelect.value));
    scanRow.append(
      el('label', { cls: 'htp-label' }, 'Scan: '),
      scanSelect,
      el('button', {
        cls: 'htp-btn htp-btn--ghost',
        on: { click: async () => { await loadScans(); render(); } }
      }, 'Refresh')
    );
    section.append(scanRow);

    if (state.loading) {
      section.append(el('p', { cls: 'htp-hint' }, 'Loading…'));
      return section;
    }

    if (!state.activeScan || !state.profiles.length) {
      section.append(el('p', { cls: 'htp-hint' }, 'No profiles yet. Start a scan and browse your site.'));
      return section;
    }

    // Profile list
    const list = el('div', { cls: 'htp-profile-list' });
    state.profiles.forEach((p, i) => {
      const item = el('div', {
        cls: 'htp-profile-item' + (state.selectedProfile === i ? ' htp-profile-item--active' : ''),
        on: { click: () => { state.selectedProfile = i; render(); } }
      },
        el('span', { cls: speedColour(p.total_ms) }, fmtMs(p.total_ms)),
        el('span', { cls: 'htp-profile-meta' }, (p.is_admin ? '[admin] ' : '') + (p.url || '')),
        el('span', { cls: 'htp-profile-date' }, p.date ? new Date(p.date).toLocaleTimeString() : '')
      );
      list.append(item);
    });
    section.append(list);

    if (state.selectedProfile !== null) {
      section.append(renderProfileDetail(state.profiles[state.selectedProfile], state.selectedProfile));
    }

    return section;
  }

  function renderProfileDetail(p, index) {
    const card = el('div', { cls: 'htp-card htp-mt' });

    // Header
    card.append(
      el('div', { cls: 'htp-row' },
        el('h3', {}, fmtMs(p.total_ms) + ' — ' + (p.url || 'unknown page')),
        el('span', { cls: 'htp-hint' }, new Date(p.date).toLocaleString())
      ),
      el('div', { cls: 'htp-metrics-row' },
        metricTile('Memory', p.memory_mb + 'MB'),
        metricTile('DB queries', p.db?.total ?? '—'),
        metricTile('DB time', fmtMs(p.db?.total_ms)),
        p.woo ? metricTile('WC queries', p.woo.wc_queries) : null,
        p.woo ? metricTile('WC query time', fmtMs(p.woo.wc_query_ms)) : null
      ).filter(Boolean)
    );

    // Checkpoints
    if (p.checkpoints && Object.keys(p.checkpoints).length) {
      card.append(el('h4', {}, 'Request timeline'));
      const cpTable = el('table', { cls: 'htp-table' });
      Object.entries(p.checkpoints).forEach(([k, v]) => {
        cpTable.append(el('tr', {},
          el('td', {}, k),
          el('td', { cls: speedColour(v) }, fmtMs(v))
        ));
      });
      card.append(cpTable);
    }

    // Plugin hook counts
    if (p.plugin_hooks && Object.keys(p.plugin_hooks).length) {
      card.append(el('h4', {}, 'Plugin hook registrations (callback count)'));
      const maxVal = Math.max(...Object.values(p.plugin_hooks));
      const table = el('table', { cls: 'htp-table' });
      Object.entries(p.plugin_hooks).slice(0, 20).forEach(([slug, count]) => {
        table.append(el('tr', {},
          el('td', { cls: 'htp-slug' }, slug),
          el('td', { style: 'width:40%' }, bar(count / maxVal * 100, count > maxVal * 0.5 ? 'htp-bar--warn' : '')),
          el('td', { cls: 'htp-mono' }, count + ' hooks')
        ));
      });
      card.append(table);
    }

    // DB analysis
    if (p.db && p.db.slowest && p.db.slowest.length) {
      card.append(el('h4', {}, `Slow queries (>${p.db.slow_threshold_ms}ms)`));
      const table = el('table', { cls: 'htp-table' });
      table.append(el('tr', {},
        el('th', {}, 'Time'), el('th', {}, 'SQL'), el('th', {}, 'Caller')
      ));
      p.db.slowest.forEach(q => {
        table.append(el('tr', {},
          el('td', { cls: 'htp-mono htp-bad' }, fmtMs(q.ms)),
          el('td', { cls: 'htp-sql' }, q.sql),
          el('td', { cls: 'htp-hint' }, q.caller)
        ));
      });
      card.append(table);
    }

    // WooCommerce section
    if (p.woo) {
      card.append(el('h4', {}, 'WooCommerce ' + p.woo.wc_version));
      if (p.woo.hook_timings && Object.keys(p.woo.hook_timings).length) {
        const table = el('table', { cls: 'htp-table' });
        Object.entries(p.woo.hook_timings).forEach(([hook, ms]) => {
          table.append(el('tr', {},
            el('td', {}, hook),
            el('td', { cls: speedColour(ms) }, fmtMs(ms))
          ));
        });
        card.append(table);
      }
    }

    // AI Analysis
    card.append(el('div', { cls: 'htp-ai-section' },
      el('div', { cls: 'htp-row' },
        el('h4', {}, 'AI Recommendations'),
        p.ai_analysis
          ? el('span', { cls: 'htp-badge htp-badge--on' }, 'Analysed')
          : el('button', {
              cls: 'htp-btn htp-btn--primary',
              on: { click: () => runAI(state.activeScan, index) }
            }, state.aiLoading ? 'Analysing…' : '✦ Analyse with AI')
      ),
      p.ai_analysis
        ? el('div', { cls: 'htp-ai-result', innerHTML: md(p.ai_analysis) })
        : el('p', { cls: 'htp-hint' }, 'Click the button above to get AI-powered recommendations based on this profile.')
    ));

    return card;
  }

  function metricTile(label, value) {
    return el('div', { cls: 'htp-metric' },
      el('span', { cls: 'htp-metric-val' }, String(value ?? '—')),
      el('span', { cls: 'htp-metric-label' }, label)
    );
  }

  async function runAI(scanName, index) {
    state.aiLoading = true;
    render();
    try {
      const data = await post('htp_ai_analyze', { scan_name: scanName, index });
      state.profiles[index].ai_analysis = data.analysis;
    } catch (e) {
      alert('AI analysis failed: ' + e.message);
    }
    state.aiLoading = false;
    render();
  }

  // ----------------------------------------------------------- settings tab
  function renderSettings() {
    const s = state.settings || {};
    const section = el('div', { cls: 'htp-section' });
    const card = el('div', { cls: 'htp-card' });

    const providerSel = el('select', { cls: 'htp-input htp-select', name: 'ai_provider' },
      el('option', { value: 'anthropic' }, 'Anthropic Claude'),
      el('option', { value: 'openai' },    'OpenAI')
    );
    providerSel.value = s.ai_provider || 'anthropic';

    const modelMap = {
      anthropic: 'claude-3-5-haiku-20241022',
      openai:    'gpt-4o-mini',
    };

    const modelInput = el('input', { type: 'text', cls: 'htp-input', name: 'ai_model',
      placeholder: 'Leave blank for default',
      value: s.ai_model || '' });

    const keyInput = el('input', { type: 'password', cls: 'htp-input', name: 'ai_api_key',
      placeholder: s.ai_api_key ? 'API key is set (enter new key to change)' : 'Enter API key',
      autocomplete: 'off' });

    providerSel.addEventListener('change', () => {
      if (!modelInput.value) modelInput.placeholder = 'Default: ' + (modelMap[providerSel.value] || '');
    });

    card.append(
      el('h3', {}, 'AI Settings'),
      el('p', { cls: 'htp-hint' }, 'Used for generating performance recommendations from your profiling data.'),
      el('label', { cls: 'htp-label' }, 'AI Provider'), providerSel,
      el('label', { cls: 'htp-label' }, 'Model (optional)'), modelInput,
      el('label', { cls: 'htp-label' }, 'API Key'), keyInput,
      el('div', { cls: 'htp-mt' },
        el('button', {
          cls: 'htp-btn htp-btn--primary',
          on: {
            click: async () => {
              try {
                await post('htp_save_settings', {
                  ai_provider: providerSel.value,
                  ai_model:    modelInput.value,
                  ai_api_key:  keyInput.value,
                });
                state.settings.ai_provider = providerSel.value;
                state.settings.ai_model    = modelInput.value;
                alert('Settings saved.');
              } catch (e) {
                alert('Save failed: ' + e.message);
              }
            }
          }
        }, 'Save settings')
      )
    );

    section.append(card);
    return section;
  }

  // ------------------------------------------------------------------ init
  (async function init() {
    await loadScans();
    if (state.scans.length && !state.activeScan) {
      state.activeScan = state.scans[0];
      await loadProfiles(state.activeScan);
    }
    render();
  })();

})();
