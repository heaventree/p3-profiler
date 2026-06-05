<?php
declare(strict_types=1);

if (!defined('ABSPATH')) exit;

/**
 * WooCommerce-specific profiling.
 * Times known expensive WC hooks on both frontend and admin, and extracts
 * WC-related query stats from SAVEQUERIES.
 */
class HTP_Woo_Profiler {

    private static ?self $instance = null;
    private array $hook_timings  = [];
    private float $request_start = 0.0;

    /** Hooks timed on all requests. */
    private const TIMED_HOOKS = [
        'woocommerce_init',
        'woocommerce_loaded',
        'woocommerce_after_register_post_type',
        'woocommerce_after_register_taxonomy',
        'woocommerce_cart_loaded_from_session',
        'woocommerce_before_calculate_totals',
        'woocommerce_checkout_process',
    ];

    /** Admin-only hooks — only instrumented on is_admin() requests. */
    private const ADMIN_HOOKS = [
        'woocommerce_admin_order_item_headers',
        'woocommerce_before_settings_page',
    ];

    private function __construct() {}

    public static function get_instance(): self {
        return self::$instance ??= new self();
    }

    public function start(): void {
        $this->request_start = (float)($_SERVER['REQUEST_TIME_FLOAT'] ?? microtime(true));

        foreach (self::TIMED_HOOKS as $hook) {
            $this->instrument_hook($hook);
        }
        if (is_admin()) {
            foreach (self::ADMIN_HOOKS as $hook) {
                $this->instrument_hook($hook);
            }
        }
    }

    private function instrument_hook(string $hook): void {
        $start = null;
        add_action($hook, static function () use (&$start): void { $start = microtime(true); }, PHP_INT_MIN);
        add_action($hook, function () use ($hook, &$start): void {
            if ($start !== null) {
                $this->hook_timings[$hook] = round((microtime(true) - $start) * 1000, 2);
            }
        }, PHP_INT_MAX);
    }

    public function get_results(): array {
        global $wpdb;
        $wc_count = 0;
        $wc_ms    = 0.0;

        if (!empty($wpdb->queries)) {
            foreach ($wpdb->queries as [$sql, $time, $caller]) {
                if (
                    str_contains($caller, 'WC_') ||
                    str_contains($caller, 'woocommerce') ||
                    str_contains(strtolower($sql), '_wc_') ||
                    str_contains(strtolower($sql), 'woocommerce')
                ) {
                    $wc_count++;
                    $wc_ms += (float) $time * 1000;
                }
            }
        }

        // Detect HPOS (High Performance Order Storage) — WC 8.0+
        $hpos_enabled = false;
        if (class_exists('\\Automattic\\WooCommerce\\Utilities\\OrderUtil')) {
            $hpos_enabled = \Automattic\WooCommerce\Utilities\OrderUtil::custom_orders_table_usage_is_enabled();
        }

        return [
            'wc_version'   => defined('WC_VERSION') ? WC_VERSION : 'unknown',
            'hpos_enabled' => $hpos_enabled,
            'hook_timings' => $this->hook_timings,
            'wc_queries'   => $wc_count,
            'wc_query_ms'  => round($wc_ms, 2),
        ];
    }
}
