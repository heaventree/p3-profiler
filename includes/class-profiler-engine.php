<?php
declare(strict_types=1);

if (!defined('ABSPATH')) exit;

/**
 * Core profiling engine.
 * Collects wall-clock checkpoints at key WP lifecycle events,
 * static plugin callback counts, and coordinates DB/WC/admin profilers.
 */
class HTP_Profiler_Engine {

    private static ?self $instance = null;
    private bool  $running    = false;
    private float $start_time = 0.0;
    private array $checkpoints = [];

    private function __construct() {}

    public static function get_instance(): self {
        return self::$instance ??= new self();
    }

    public static function should_profile(): bool {
        $opts = get_option('htp_options', []);
        if (empty($opts['profiling_active'])) return false;
        $expires = (int)($opts['profiling_expires'] ?? 0);
        if ($expires && time() > $expires) { self::stop(); return false; }
        $allowed_ip = trim($opts['profiling_ip'] ?? '');
        return $allowed_ip !== '' && $allowed_ip === self::client_ip();
    }

    public function start(): void {
        if ($this->running) return;
        $this->running    = true;
        $this->start_time = (float)($_SERVER['REQUEST_TIME_FLOAT'] ?? microtime(true));
        $this->mark('profiler_ready');

        add_action('init',           fn () => $this->mark('init'),           PHP_INT_MAX);
        add_action('wp_loaded',      fn () => $this->mark('wp_loaded'),      PHP_INT_MAX);
        add_action('admin_init',     fn () => $this->mark('admin_init'),     PHP_INT_MAX);
        add_action('admin_menu',     fn () => $this->mark('admin_menu'),     PHP_INT_MAX);
        add_action('current_screen', fn () => $this->mark('current_screen'), PHP_INT_MAX);
        add_action('admin_head',     fn () => $this->mark('admin_head'),     PHP_INT_MAX);
        add_action('wp',             fn () => $this->mark('wp'),             PHP_INT_MAX);

        register_shutdown_function([$this, 'shutdown']);
    }

    public function mark(string $label): void {
        $this->checkpoints[$label] = round((microtime(true) - $this->start_time) * 1000, 2);
    }

    public function shutdown(): void {
        if (!$this->running) return;
        $this->running = false;
        $this->mark('total');

        $is_admin = is_admin();

        $profile = [
            'date'           => gmdate('c'),
            'url'            => sanitize_url($_SERVER['REQUEST_URI'] ?? ''),
            'is_admin'       => $is_admin,
            'total_ms'       => $this->checkpoints['total'],
            'memory_mb'      => round(memory_get_peak_usage(true) / 1_048_576, 1),
            'wp_version'     => get_bloginfo('version'),
            'php_version'    => PHP_VERSION,
            'checkpoints'    => $this->checkpoints,
            'plugin_hooks'   => HTP_Plugin_Mapper::get_instance()->plugin_callback_counts(),
            'active_plugins' => array_map(
                static fn (string $p) => basename(dirname($p)) ?: basename($p),
                (array) get_option('active_plugins', [])
            ),
            'db'    => HTP_DB_Profiler::get_instance()->get_results(),
            'woo'   => class_exists('WooCommerce') ? HTP_Woo_Profiler::get_instance()->get_results() : null,
            'admin' => $is_admin ? HTP_Admin_Page_Profiler::get_instance()->get_results() : null,
        ];

        $opts = get_option('htp_options', []);
        $key  = 'htp_scan_' . sanitize_key($opts['scan_name'] ?? 'default');
        $list = get_option($key, []);
        array_unshift($list, $profile);
        update_option($key, array_slice($list, 0, 25), false);
    }

    public static function stop(): void {
        $opts = get_option('htp_options', []);
        $opts['profiling_active']  = false;
        $opts['profiling_ip']      = '';
        $opts['profiling_expires'] = 0;
        update_option('htp_options', $opts);
    }

    public static function client_ip(): string {
        foreach (['HTTP_CF_CONNECTING_IP', 'HTTP_X_REAL_IP', 'HTTP_X_FORWARDED_FOR', 'REMOTE_ADDR'] as $key) {
            $val = trim($_SERVER[$key] ?? '');
            if ($val !== '') return explode(',', $val)[0];
        }
        return '';
    }
}
