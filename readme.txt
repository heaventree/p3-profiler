=== Heaventree Performance Profiler ===
Contributors: heaventree
Tags: performance, profiler, woocommerce, speed, optimization, ai
Requires at least: 6.0
Tested up to: 6.8
Requires PHP: 8.0
Stable tag: 2.0.0
License: GPLv2 or later

Profiles WordPress plugin performance with WooCommerce support and AI-powered recommendations.

== Description ==

Heaventree Performance Profiler identifies which plugins are slowing down your WordPress site, with special focus on WooCommerce admin slowness.

Key differences from the original P3 Plugin Profiler:

* PHP 8.2 compatible — no deprecated tick-based profiling
* WooCommerce-specific metrics: WC hook timing, WC query count/time
* Database query profiler: total queries, slow query list, per-table breakdown
* AI analysis: sends profiling data to Claude (Anthropic) or OpenAI for actionable recommendations
* Modern admin UI: no jQuery UI dependency, clean responsive design
* Auto-expiry: profiling automatically stops after a configurable duration
* IP-scoped: only profiles requests from your IP, safe to leave configured

== How it works ==

1. Go to Tools → Perf Profiler
2. Click "Start profiling" — this records your IP and enables the profiler
3. Browse the admin pages that are slow (especially WooCommerce pages)
4. Click "Stop profiling" or wait for auto-expiry
5. View the results in the Profiles tab
6. Click "Analyse with AI" for specific recommendations

== WooCommerce Admin Slowness ==

Common causes this plugin helps diagnose:

* Too many plugins registering callbacks on woocommerce_init or admin_init
* Slow database queries on wp_postmeta or wp_options
* Plugin combinations that trigger excessive product/order queries on admin load
* Missing database indexes (shown as repeated slow queries on the same table)

== AI Setup ==

In Settings, add an API key for:
* Anthropic Claude (https://console.anthropic.com) — recommended, claude-3-5-haiku-20241022
* OpenAI (https://platform.openai.com) — gpt-4o-mini

No data is sent to AI providers unless you explicitly click "Analyse with AI".

== Changelog ==

= 2.0.0 =
* Complete rewrite for PHP 8.2 / WordPress 6.x compatibility
* Hook-based timing engine (replaces deprecated declare(ticks=1) approach)
* Added WooCommerce-specific profiling
* Added database query profiling
* Added AI analysis (Anthropic Claude + OpenAI)
* Modern vanilla-JS admin UI

= 1.5.4 =
* Original GoDaddy P3 Plugin Profiler (archived)
