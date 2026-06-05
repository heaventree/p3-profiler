/* Heaventree Performance Profiler — admin UI
 * Vanilla JS, no jQuery UI dependency, no build step required.
 */
(function () {
  'use strict';

  const { nonce, ajax, profiling, ip, opts, site_url, admin_url, woo_active } = window.HTP_Data || {};

  // ------------------------------------------------------------------ utils
  function el(tag, attrs, ...children) {
    attrs = attrs || {};
    const node = document.createElement(tag);
    Object.entries(attrs).forEach(([k, v]) => {
      if (k === 'cls') node.className = v;
      else if (k === 'on') Object.entries(v).forEach(([ev, fn]) => node.addEventListener(ev, fn));
      else if (k === 'innerHTML') node.innerHTML = v;
      else node.setAttribute(k, v);
    });
    children.flat(Infinity).filter(function (c) { return c != null && c !== false && c !== ''; })
      .forEach(function (c) { node.append(c); });
    return node;
  }

  function post(action, data) {
    data = data || {};
    const fd = new FormData();
    fd.append('action', action);
    fd.append('nonce', nonce);
    Object.entries(data).forEach(([k, v]) => fd.append(k, v));
    return fetch(ajax, { method: 'POST', body: fd })
      .then(function (r) { return r.json(); })
      .then(function (r) {
        if (!r.success) throw new Error(r.data || 'Request failed');
        return r.data;
      });
  }

  function fmtMs(ms) {
    if (ms == null) return '—';
    return ms >= 1000 ? (ms / 1000).toFixed(2) + 's' : Number(ms).toFixed(1) + 'ms';
  }

  function speedCls(ms) {
    if (ms < 500)  return 'htp-good';
    if (ms < 1500) return 'htp-warn';
    return 'htp-bad';
  }

  function bar(pct, cls) {
    cls = cls || '';
    return el('div', { cls: 'htp-bar-wrap' },
      el('div', { cls: 'htp-bar-fill ' + cls, style: 'width:' + Math.min(pct, 100) + '%' })
    );
  }

  function renderMarkdown(text) {
    if (!text) return '';
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
  var state = {
    tab: 'dashboard',
    scans: [],
    activeScan: null,
    profiles: [],
    selectedProfile: null,
    isProfilingNow: !!profiling,
    profilingIp: ip || '',
    scanName: '',
    settings: Object.assign({}, opts),
    loading: false,
    aiLoading: false,
  };

  var app = document.getElementById('htp-app');

  function render() {
    if (!app) return;
    app.innerHTML = '';
    app.append(renderHeader(), renderTabs(), renderBody());
  }

  function renderHeader() {
    var badge = state.isProfilingNow
      ? el('span', { cls: 'htp-badge htp-badge--on' }, '● Profiling active')
      : el('span', { cls: 'htp-badge htp-badge--off' }, '○ Idle');
    return el('div', { cls: 'htp-header' },
      el('h1', {}, 'Performance Profiler'),
      el('div', { cls: 'htp-header-right' }, badge)
    );
  }

  function renderTabs() {
    return el('div', { cls: 'htp-tabs' },
      ['dashboard', 'profiles', 'settings'].map(function (t) {
        return el('button', {
          cls: 'htp-tab' + (state.tab === t ? ' htp-tab--active' : ''),
          on: { click: function () { state.tab = t; render(); } }
        }, t.charAt(0).toUpperCase() + t.slice(1));
      })
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
    var section = el('div', { cls: 'htp-section' });
    var card    = el('div', { cls: 'htp-card' });

    if (state.isProfilingNow) {
      var stored = (window.HTP_Data && window.HTP_Data.opts) || {};
      var exp    = stored.profiling_expires ? new Date(stored.profiling_expires * 1000).toLocaleTimeString() : '';
      card.append(
        el('p', { cls: 'htp-status-text htp-good' }, 'Profiling active for IP: ' + (stored.profiling_ip || ip || '')),
        exp ? el('p', { cls: 'htp-hint' }, 'Auto-stops at ' + exp) : null,
        el('p', { cls: 'htp-hint' }, 'Browse your site or wp-admin now. Results are saved automatically after each page load.'),
        el('div', { cls: 'htp-row htp-mt' },
          el('a', { href: site_url, target: '_blank', cls: 'htp-btn htp-btn--ghost' }, '↗ Visit site'),
          el('a', { href: admin_url, target: '_blank', cls: 'htp-btn htp-btn--ghost' }, '↗ wp-admin'),
          el('button', { cls: 'htp-btn htp-btn--danger', on: { click: stopScan } }, 'Stop profiling')
        )
      );
    } else {
      var nameInput = el('input', { type: 'text', cls: 'htp-input', placeholder: 'e.g. woocommerce-orders-page' });
      var ipInput   = el('input', { type: 'text', cls: 'htp-input', value: ip || '' });
      card.append(
        el('h3', {}, 'Start a profiling session'),
        el('p', { cls: 'htp-hint' }, 'Only your IP is profiled. Browse the slow pages after clicking Start.'),
        el('label', { cls: 'htp-label' }, 'Scan name'), nameInput,
        el('label', { cls: 'htp-label' }, 'Your IP (auto-detected)'), ipInput,
        el('div', { cls: 'htp-row htp-mt' },
          el('button', {
            cls: 'htp-btn htp-btn--primary',
            on: { click: function () {
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

  function startScan() {
    post('htp_start_scan', { scan_name: state.scanName, ip: state.profilingIp, duration: 3600 })
      .then(function (data) {
        state.isProfilingNow = true;
        if (window.HTP_Data && window.HTP_Data.opts) {
          window.HTP_Data.opts.profiling_ip      = data.ip;
          window.HTP_Data.opts.profiling_expires = data.expires;
        }
        render();
      })
      .catch(function (e) { alert('Failed to start: ' + e.message); });
  }

  function stopScan() {
    post('htp_stop_scan')
      .then(function (data) {
        state.isProfilingNow = false;
        state.tab = 'profiles';
        return loadProfiles(data.scan_name);
      })
      .catch(function (e) { alert('Failed to stop: ' + e.message); });
  }

  // ----------------------------------------------------------- profiles
  function loadScans() {
    return post('htp_list_scans')
      .then(function (data) { state.scans = data || []; })
      .catch(function () { state.scans = []; });
  }

  function loadProfiles(scanName) {
    state.activeScan = scanName;
    state.loading    = true;
    render();
    return post('htp_get_profiles', { scan_name: scanName })
      .then(function (data) {
        state.profiles        = data || [];
        state.selectedProfile = state.profiles.length ? 0 : null;
      })
      .catch(function () { state.profiles = []; })
      .then(function () {
        state.loading = false;
        render();
      });
  }

  function renderProfiles() {
    var section = el('div', { cls: 'htp-section' });

    var scanSelect = el('select', { cls: 'htp-input htp-select' });
    scanSelect.append(el('option', { value: '' }, '— Select a scan —'));
    (state.scans || []).forEach(function (s) {
      var o = el('option', { value: s }, s);
      if (s === state.activeScan) o.selected = true;
      scanSelect.append(o);
    });
    scanSelect.addEventListener('change', function () { loadProfiles(scanSelect.value); });

    section.append(el('div', { cls: 'htp-row htp-mb' },
      el('label', { cls: 'htp-label', style: 'margin:0' }, 'Scan:'),
      scanSelect,
      el('button', { cls: 'htp-btn htp-btn--ghost', on: { click: function () { loadScans().then(render); } } }, 'Refresh')
    ));

    if (state.loading) {
      section.append(el('p', { cls: 'htp-hint' }, 'Loading…'));
      return section;
    }
    if (!state.activeScan || !state.profiles.length) {
      section.append(el('p', { cls: 'htp-hint' }, 'No profiles yet. Start a scan and browse your site.'));
      return section;
    }

    var list = el('div', { cls: 'htp-profile-list' });
    state.profiles.forEach(function (p, i) {
      list.append(el('div', {
        cls: 'htp-profile-item' + (state.selectedProfile === i ? ' htp-profile-item--active' : ''),
        on:  { click: function () { state.selectedProfile = i; render(); } }
      },
        el('span', { cls: speedCls(p.total_ms) }, fmtMs(p.total_ms)),
        el('span', { cls: 'htp-profile-meta' }, (p.is_admin ? '[admin] ' : '') + (p.url || '')),
        el('span', { cls: 'htp-profile-date' }, p.date ? new Date(p.date).toLocaleTimeString() : '')
      ));
    });
    section.append(list);

    if (state.selectedProfile !== null && state.profiles[state.selectedProfile]) {
      section.append(renderDetail(state.profiles[state.selectedProfile], state.selectedProfile));
    }
    return section;
  }

  function renderDetail(p, index) {
    var card = el('div', { cls: 'htp-card htp-mt' });

    var wooTiles = [];
    if (p.woo) {
      wooTiles.push(tile('WC queries', p.woo.wc_queries));
      wooTiles.push(tile('WC query time', fmtMs(p.woo.wc_query_ms)));
    }

    card.append(
      el('div', { cls: 'htp-row' },
        el('h3', {}, fmtMs(p.total_ms) + ' — ' + (p.url || '')),
        el('span', { cls: 'htp-hint' }, new Date(p.date).toLocaleString())
      ),
      el('div', { cls: 'htp-metrics-row' },
        [tile('Memory', (p.memory_mb || 0) + 'MB'),
         tile('DB queries', p.db ? p.db.total : '—'),
         tile('DB time', fmtMs(p.db ? p.db.total_ms : null))]
        .concat(wooTiles)
      )
    );

    // Checkpoints
    var checkpoints = p.checkpoints || {};
    if (Object.keys(checkpoints).length) {
      var t = el('table', { cls: 'htp-table' });
      Object.entries(checkpoints).forEach(function (entry) {
        t.append(el('tr', {}, el('td', {}, entry[0]), el('td', { cls: speedCls(entry[1]) }, fmtMs(entry[1]))));
      });
      card.append(el('h4', {}, 'Request timeline'), t);
    }

    // Plugin hook counts
    var pluginHooks = p.plugin_hooks || {};
    if (Object.keys(pluginHooks).length) {
      var vals = Object.values(pluginHooks);
      var maxVal = vals.length ? Math.max.apply(null, vals) : 1;
      var t2 = el('table', { cls: 'htp-table' });
      Object.entries(pluginHooks).slice(0, 20).forEach(function (entry) {
        var slug = entry[0], count = entry[1];
        t2.append(el('tr', {},
          el('td', { cls: 'htp-slug' }, slug),
          el('td', { style: 'width:40%' }, bar(count / maxVal * 100, count > maxVal * 0.5 ? 'htp-bar--warn' : '')),
          el('td', { cls: 'htp-mono' }, count + ' hooks')
        ));
      });
      card.append(el('h4', {}, 'Plugin hook registrations'), t2);
    }

    // Slow queries
    if (p.db && p.db.slowest && p.db.slowest.length) {
      var t3 = el('table', { cls: 'htp-table' });
      t3.append(el('tr', {}, el('th', {}, 'Time'), el('th', {}, 'SQL'), el('th', {}, 'Caller')));
      p.db.slowest.forEach(function (q) {
        t3.append(el('tr', {},
          el('td', { cls: 'htp-mono htp-bad' }, fmtMs(q.ms)),
          el('td', { cls: 'htp-sql' }, q.sql || ''),
          el('td', { cls: 'htp-hint' }, q.caller || '')
        ));
      });
      card.append(el('h4', {}, 'Slow queries (>' + (p.db.slow_threshold_ms || 3) + 'ms)'), t3);
    }

    // WooCommerce hook timings
    if (p.woo && p.woo.hook_timings && Object.keys(p.woo.hook_timings).length) {
      var t4 = el('table', { cls: 'htp-table' });
      Object.entries(p.woo.hook_timings).forEach(function (entry) {
        t4.append(el('tr', {}, el('td', {}, entry[0]), el('td', { cls: speedCls(entry[1]) }, fmtMs(entry[1]))));
      });
      card.append(el('h4', {}, 'WooCommerce ' + (p.woo.wc_version || '')), t4);
    }

    // AI section
    card.append(el('div', { cls: 'htp-ai-section' },
      el('div', { cls: 'htp-row' },
        el('h4', {}, 'AI Recommendations'),
        p.ai_analysis
          ? el('span', { cls: 'htp-badge htp-badge--on' }, 'Analysed')
          : el('button', {
              cls: 'htp-btn htp-btn--primary',
              on:  { click: function () { runAI(state.activeScan, index); } }
            }, state.aiLoading ? 'Analysing…' : '✶ Analyse with AI')
      ),
      p.ai_analysis
        ? el('div', { cls: 'htp-ai-result', innerHTML: renderMarkdown(p.ai_analysis) })
        : el('p', { cls: 'htp-hint' }, 'Click the button to get AI-powered recommendations for this profile.')
    ));

    return card;
  }

  function tile(label, value) {
    return el('div', { cls: 'htp-metric' },
      el('span', { cls: 'htp-metric-val' }, String(value != null ? value : '—')),
      el('span', { cls: 'htp-metric-label' }, label)
    );
  }

  function runAI(scanName, index) {
    state.aiLoading = true;
    render();
    post('htp_ai_analyze', { scan_name: scanName, index: index })
      .then(function (data) {
        state.profiles[index].ai_analysis = data.analysis;
      })
      .catch(function (e) { alert('AI analysis failed: ' + e.message); })
      .then(function () {
        state.aiLoading = false;
        render();
      });
  }

  // ----------------------------------------------------------- settings
  function renderSettings() {
    var s    = state.settings || {};
    var card = el('div', { cls: 'htp-card' });

    var providerSel = el('select', { cls: 'htp-input htp-select' },
      el('option', { value: 'anthropic' }, 'Anthropic Claude'),
      el('option', { value: 'openai' },    'OpenAI')
    );
    providerSel.value = s.ai_provider || 'anthropic';

    var modelInput = el('input', { type: 'text', cls: 'htp-input', placeholder: 'Leave blank for default', value: s.ai_model || '' });
    var keyInput   = el('input', { type: 'password', cls: 'htp-input', autocomplete: 'off',
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
          on:  { click: function () {
            post('htp_save_settings', { ai_provider: providerSel.value, ai_model: modelInput.value, ai_api_key: keyInput.value })
              .then(function () { alert('Settings saved.'); })
              .catch(function (e) { alert('Save failed: ' + e.message); });
          }}
        }, 'Save settings')
      )
    );

    return el('div', { cls: 'htp-section' }, card);
  }

  // ------------------------------------------------------------------ init
  loadScans().then(function () {
    if (state.scans.length) {
      return loadProfiles(state.scans[0]);
    }
    render();
  });

})();
