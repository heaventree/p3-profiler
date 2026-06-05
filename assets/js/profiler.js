/* Heaventree Performance Profiler — admin UI
 * Vanilla JS, no jQuery UI dependency, no build step required.
 */
(function () {
  'use strict';

  var HTP = window.HTP_Data || {};
  var nonce = HTP.nonce, ajax = HTP.ajax, profiling = HTP.profiling,
      ip = HTP.ip, opts = HTP.opts, site_url = HTP.site_url,
      admin_url = HTP.admin_url, woo_active = HTP.woo_active;

  // ------------------------------------------------------------------ utils
  function el(tag, attrs) {
    attrs = attrs || {};
    var node = document.createElement(tag);
    var children = Array.prototype.slice.call(arguments, 2);
    Object.keys(attrs).forEach(function (k) {
      var v = attrs[k];
      if (k === 'cls') node.className = v;
      else if (k === 'on') Object.keys(v).forEach(function (ev) { node.addEventListener(ev, v[ev]); });
      else if (k === 'innerHTML') node.innerHTML = v;
      else node.setAttribute(k, v);
    });
    flatten(children).forEach(function (c) {
      if (c != null && c !== false && c !== '') node.append(c);
    });
    return node;
  }

  function flatten(arr) {
    var out = [];
    (arr || []).forEach(function (item) {
      if (Array.isArray(item)) flatten(item).forEach(function (x) { out.push(x); });
      else out.push(item);
    });
    return out;
  }

  function post(action, data) {
    data = data || {};
    var fd = new FormData();
    fd.append('action', action);
    fd.append('nonce', nonce);
    Object.keys(data).forEach(function (k) { fd.append(k, data[k]); });
    return fetch(ajax, { method: 'POST', body: fd })
      .then(function (r) { return r.json(); })
      .then(function (r) {
        if (!r.success) throw new Error(r.data || 'Request failed');
        return r.data;
      });
  }

  function fmtMs(ms) {
    if (ms == null) return '—';
    ms = Number(ms);
    return ms >= 1000 ? (ms / 1000).toFixed(2) + 's' : ms.toFixed(1) + 'ms';
  }

  function speedCls(ms) {
    ms = Number(ms);
    if (ms < 500)  return 'htp-good';
    if (ms < 1500) return 'htp-warn';
    return 'htp-bad';
  }

  function bar(pct, cls) {
    return el('div', { cls: 'htp-bar-wrap' },
      el('div', { cls: 'htp-bar-fill ' + (cls || ''), style: 'width:' + Math.min(pct, 100) + '%' })
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

  function tile(label, value) {
    return el('div', { cls: 'htp-metric' },
      el('span', { cls: 'htp-metric-val' }, String(value != null ? value : '—')),
      el('span', { cls: 'htp-metric-label' }, label)
    );
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
    settings: JSON.parse(JSON.stringify(opts || {})),
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
      var stored = (HTP && HTP.opts) || {};
      var exp = stored.profiling_expires
        ? new Date(stored.profiling_expires * 1000).toLocaleTimeString() : '';
      card.append(
        el('p', { cls: 'htp-status-text htp-good' }, 'Profiling active for IP: ' + (stored.profiling_ip || ip || '')),
        exp ? el('p', { cls: 'htp-hint' }, 'Auto-stops at ' + exp) : null,
        el('p', { cls: 'htp-hint' }, 'Browse your site or wp-admin now. Results are saved after each page load.'),
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
        el('p', { cls: 'htp-hint' }, 'For best results profile: wp-admin/edit.php?post_type=shop_order and wp-admin/edit.php?post_type=product')
      ));
    }

    section.append(el('div', { cls: 'htp-card htp-card--info' },
      el('strong', {}, 'Admin profiling tips'),
      el('ul', { cls: 'htp-hint' },
        el('li', {}, 'Profile wp-admin/index.php (Dashboard) to catch update-check blocking and dashboard widget overhead'),
        el('li', {}, 'Profile wp-admin/edit.php to see admin_menu and admin_init culprits'),
        el('li', {}, 'Profile wp-admin/options-general.php for settings-page plugin overhead')
      )
    ));

    return section;
  }

  function startScan() {
    post('htp_start_scan', { scan_name: state.scanName, ip: state.profilingIp, duration: 3600 })
      .then(function (data) {
        state.isProfilingNow = true;
        if (HTP && HTP.opts) {
          HTP.opts.profiling_ip      = data.ip;
          HTP.opts.profiling_expires = data.expires;
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
      .then(function () { state.loading = false; render(); });
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
      var label = (p.is_admin ? '[admin] ' : '') + (p.url || '');
      list.append(el('div', {
        cls: 'htp-profile-item' + (state.selectedProfile === i ? ' htp-profile-item--active' : ''),
        on:  { click: function () { state.selectedProfile = i; render(); } }
      },
        el('span', { cls: speedCls(p.total_ms) }, fmtMs(p.total_ms)),
        el('span', { cls: 'htp-profile-meta' }, label),
        el('span', { cls: 'htp-profile-date' }, p.date ? new Date(p.date).toLocaleTimeString() : '')
      ));
    });
    section.append(list);

    if (state.selectedProfile !== null && state.profiles[state.selectedProfile]) {
      section.append(renderDetail(state.profiles[state.selectedProfile], state.selectedProfile));
    }
    return section;
  }

  // ----------------------------------------------------------- detail
  function renderDetail(p, index) {
    var card    = el('div', { cls: 'htp-card htp-mt' });
    var adminData = p.admin || null;

    // Screen badge
    var screenBadge = null;
    if (adminData && adminData.screen) {
      var s = adminData.screen;
      screenBadge = el('span', { cls: 'htp-badge htp-badge--screen' },
        'screen: ' + s.id + (s.post_type ? ' / ' + s.post_type : ''));
    }

    card.append(
      el('div', { cls: 'htp-row' },
        el('h3', {}, fmtMs(p.total_ms) + ' — ' + (p.url || '')),
        el('div', { cls: 'htp-row' },
          screenBadge,
          el('span', { cls: 'htp-hint' }, new Date(p.date).toLocaleString())
        )
      )
    );

    // Pending update-check warning
    if (adminData && adminData.pending_checks && adminData.pending_checks.length) {
      card.append(el('div', { cls: 'htp-alert htp-alert--warn' },
        '⚠️ Stale update-check transients detected for: ' +
        adminData.pending_checks.join(', ') +
        ' — WordPress will make blocking HTTP requests on the next admin load. ' +
        'Fix: visit wp-admin/update-core.php or enable a background update plugin.'
      ));
    }

    // Metric tiles
    var wooTiles = [];
    if (p.woo) {
      wooTiles.push(tile('WC queries', p.woo.wc_queries));
      wooTiles.push(tile('WC time', fmtMs(p.woo.wc_query_ms)));
      if (p.woo.hpos_enabled != null) {
        wooTiles.push(tile('HPOS', p.woo.hpos_enabled ? 'enabled' : 'legacy'));
      }
    }
    card.append(
      el('div', { cls: 'htp-metrics-row' },
        [tile('Memory', (p.memory_mb || 0) + 'MB'),
         tile('DB queries', p.db ? p.db.total : '—'),
         tile('DB time', fmtMs(p.db ? p.db.total_ms : null))].concat(wooTiles)
      )
    );

    // Admin hook totals — most important section for admin pages
    if (adminData && adminData.hook_totals && Object.keys(adminData.hook_totals).length) {
      var maxAdminMs = Math.max.apply(null, Object.values(adminData.hook_totals));
      var at = el('table', { cls: 'htp-table' });
      Object.keys(adminData.hook_totals).forEach(function (hook) {
        var ms = adminData.hook_totals[hook];
        at.append(el('tr', {},
          el('td', { cls: 'htp-slug' }, hook),
          el('td', { style: 'width:35%' }, bar(ms / maxAdminMs * 100, ms > 300 ? 'htp-bar--warn' : '')),
          el('td', { cls: 'htp-mono ' + speedCls(ms) }, fmtMs(ms))
        ));
      });
      card.append(el('h4', {}, 'Admin hook totals'), at);
    }

    // Per-plugin attribution — THE key feature for diagnosing admin slowness
    if (adminData && adminData.plugin_timings && Object.keys(adminData.plugin_timings).length) {
      card.append(el('h4', {}, 'Per-plugin time in admin hooks'),
        el('p', { cls: 'htp-hint' }, 'Shows which plugin is responsible for admin_init / admin_menu slowness.'));

      Object.keys(adminData.plugin_timings).forEach(function (hook) {
        var plugins = adminData.plugin_timings[hook];
        var slugs   = Object.keys(plugins);
        if (!slugs.length) return;
        var maxMs = Math.max.apply(null, slugs.map(function (s) { return plugins[s]; }));

        card.append(el('p', { cls: 'htp-hint htp-mt' }, hook + ':'));
        var pt = el('table', { cls: 'htp-table' });
        slugs.forEach(function (slug) {
          var ms = plugins[slug];
          pt.append(el('tr', {},
            el('td', { cls: 'htp-slug' }, slug),
            el('td', { style: 'width:40%' }, bar(ms / maxMs * 100, ms > 100 ? 'htp-bar--warn' : '')),
            el('td', { cls: 'htp-mono ' + speedCls(ms) }, fmtMs(ms))
          ));
        });
        card.append(pt);
      });
    }

    // Enqueued assets per plugin
    if (adminData && adminData.enqueued && Object.keys(adminData.enqueued).length) {
      var maxAssets = Math.max.apply(null, Object.values(adminData.enqueued));
      var et = el('table', { cls: 'htp-table' });
      Object.keys(adminData.enqueued).forEach(function (slug) {
        var count = adminData.enqueued[slug];
        et.append(el('tr', {},
          el('td', { cls: 'htp-slug' }, slug),
          el('td', { style: 'width:40%' }, bar(count / maxAssets * 100, count > 10 ? 'htp-bar--warn' : '')),
          el('td', { cls: 'htp-mono' }, count + ' assets')
        ));
      });
      card.append(el('h4', {}, 'Enqueued assets per plugin'), et);
    }

    // Request timeline checkpoints
    var checkpoints = p.checkpoints || {};
    if (Object.keys(checkpoints).length) {
      var ct = el('table', { cls: 'htp-table' });
      Object.keys(checkpoints).forEach(function (k) {
        var v = checkpoints[k];
        ct.append(el('tr', {}, el('td', {}, k), el('td', { cls: speedCls(v) }, fmtMs(v))));
      });
      card.append(el('h4', {}, 'Request timeline'), ct);
    }

    // Plugin hook registration counts
    var pluginHooks = p.plugin_hooks || {};
    if (Object.keys(pluginHooks).length) {
      var vals   = Object.keys(pluginHooks).map(function (k) { return pluginHooks[k]; });
      var maxVal = vals.length ? Math.max.apply(null, vals) : 1;
      var ht = el('table', { cls: 'htp-table' });
      Object.keys(pluginHooks).slice(0, 20).forEach(function (slug) {
        var count = pluginHooks[slug];
        ht.append(el('tr', {},
          el('td', { cls: 'htp-slug' }, slug),
          el('td', { style: 'width:40%' }, bar(count / maxVal * 100, count > maxVal * 0.5 ? 'htp-bar--warn' : '')),
          el('td', { cls: 'htp-mono' }, count + ' hooks')
        ));
      });
      card.append(el('h4', {}, 'Plugin hook registrations'), ht);
    }

    // Slow queries
    if (p.db && p.db.slowest && p.db.slowest.length) {
      var qt = el('table', { cls: 'htp-table' });
      qt.append(el('tr', {}, el('th', {}, 'Time'), el('th', {}, 'SQL'), el('th', {}, 'Caller')));
      p.db.slowest.forEach(function (q) {
        qt.append(el('tr', {},
          el('td', { cls: 'htp-mono htp-bad' }, fmtMs(q.ms)),
          el('td', { cls: 'htp-sql' }, q.sql || ''),
          el('td', { cls: 'htp-hint' }, q.caller || '')
        ));
      });
      card.append(el('h4', {}, 'Slow queries (>' + (p.db.slow_threshold_ms || 3) + 'ms)'), qt);
    }

    // WooCommerce hook timings
    if (p.woo && p.woo.hook_timings && Object.keys(p.woo.hook_timings).length) {
      var wt = el('table', { cls: 'htp-table' });
      Object.keys(p.woo.hook_timings).forEach(function (hook) {
        var ms = p.woo.hook_timings[hook];
        wt.append(el('tr', {}, el('td', {}, hook), el('td', { cls: speedCls(ms) }, fmtMs(ms))));
      });
      card.append(el('h4', {}, 'WooCommerce ' + (p.woo.wc_version || '') +
        (p.woo.hpos_enabled ? ' (HPOS)' : ' (legacy post meta)')), wt);
    }

    // AI
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
        : el('p', { cls: 'htp-hint' }, 'Click to get AI-powered recommendations for this profile.')
    ));

    return card;
  }

  function runAI(scanName, index) {
    state.aiLoading = true;
    render();
    post('htp_ai_analyze', { scan_name: scanName, index: index })
      .then(function (data) { state.profiles[index].ai_analysis = data.analysis; })
      .catch(function (e) { alert('AI analysis failed: ' + e.message); })
      .then(function () { state.aiLoading = false; render(); });
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

    var modelInput = el('input', { type: 'text', cls: 'htp-input',
      placeholder: 'Leave blank for default', value: s.ai_model || '' });
    var keyInput = el('input', { type: 'password', cls: 'htp-input', autocomplete: 'off',
      placeholder: s.ai_api_key ? 'API key is set (enter new to change)' : 'Enter API key' });

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
            post('htp_save_settings', {
              ai_provider: providerSel.value,
              ai_model:    modelInput.value,
              ai_api_key:  keyInput.value
            })
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
    if (state.scans.length) return loadProfiles(state.scans[0]);
    render();
  });

})();
