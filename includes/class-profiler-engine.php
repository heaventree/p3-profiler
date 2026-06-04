<?php
declare(strict_types=1);

if (!defined('ABSPATH')) exit;

/**
 * Core profiling engine.
 *
 * Strategy
 * --------
 * Rather than the old tick-based approach (broken on PHP 8, extreme overhead),
 * we collect:
 *   1. Total wall-clock time from REQUEST_TIME_FLOAT → shutdown
 *   2. Timing checkpoints at key WP lifecycle points (init, admin_init, etc.)
 *   3. Static plugin attribution via callback counting on $wp_filter
 *   4. DB + WooCommerce data from their respective profilers
 *
 * This is sufficient to diagnose the overwhelming majority of WP admin
 * slowness, including WooCommerce overhead.
 */
class HTP_Profiler_Engine {

    private static ?self $instance = null;
    private bool  $running     = false;
    private float $start_time  = 0.0;
    /** @var array<string,float> ms from request start */
    private array $checkpoints = [];

    private function __construct() {}

    public static function get_instance(): self {
        return self::$instance ??= new self();
    }

    // ------------------------------------------------------------------ boot

    public static function should_profile(): bool {
        $opts = get_option('htp_options', []);

        if (empty($opts['profiling_active'])) return false;

        $expires = (int)($opts['profiling_expires'] ?? 0);
        if ($expires && time() > $expires) {
            self::stop();
            return false;
        }

        $allowed_ip = trim($opts['profiling_ip'] ?? '');
        return $allowed_ip !== '' && $allowed_ip === self::client_ip();
    }

    public function start(): void {
        if ($this->running) return;
        $this->running    = true;
        $this->start_time = (float)($_SERVER['REQUEST_TIME_FLOAT'] ?? microtime(true));

        $this->mark('profiler_ready');

        add_action('init',       fn () => $this->mark('init'),       PHP_INT_MAX);
        add_action('wp_loaded',  fn () => $this->mark('wp_loaded'),  PHP_INT_MAX);
        add_action('admin_init', fn () => $this->mark('admin_init'), PHP_INT_MAX);
        add_action('wp',         fn () => $this->mark('wp'),         PHP_INT_MAX);

        register_shutdown_function([$this, 'shutdown']);
    }

    public function mark(string $label): void {
        $this->checkpoints[$label] = round((microtime(true) - $this->start_time) * 1000, 2);
    }

    // --------------------------------------------------------------- shutdown

    public function shutdown(): void {
        if (!$this->running) return;
        $this->running = false;

        $this->mark('total');
        $total_ms = $this->checkpoints['total'];

        $plugin_counts = HTP_Plugin_Mapper::get_instance()->plugin_callback_counts();

        $profile = [
            'date'           => gmdate('c'),
            'url'            => sanitize_url($_SERVER['REQUEST_URI'] ?? ''),
            'is_admin'       => is_admin(),
            'total_ms'       => $total_ms,
            'memory_mb'      => round(memory_get_peak_usage(true) / 1_048_576, 1),
            'wp_version'     => get_bloginfo('version'),
            'php_version'    => PHP_VERSION,
            'checkpoints'    => $this->checkpoints,
            'plugin_hooks'   => $plugin_counts,
            'active_plugins' => array_map(
                static fn (string $p) => basename(dirname($p)) ?: basename($p),
                (array) get_option('active_plugins', [])
            ),
            'db'             => HTP_DB_Profiler::get_instance()->get_results(),
            'woo'            => class_exists('WooCommerce')
                                    ? HTP_Woo_Profiler::get_instance()->get_results()
                                    : null,
        ];

        $this->persist($profile);
    }

    private function persist(array $data): void {
        $opts = get_option('htp_options', []);
        $key  = 'htp_scan_' . sanitize_key($opts['scan_name'] ?? 'default');
        $list = get_option($key, []);
        array_unshift($list, $data);
        update_option($key, array_slice($list, 0, 25), false);
    }

    // ----------------------------------------------------------------- utils

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
            if ($val !== '') {
                return explode(',', $val)[0];
            }
        }
        return '';
    }
}
