<?php
declare(strict_types=1);

if (!defined('ABSPATH')) exit;

/**
 * WooCommerce-specific profiling.
 * Times known expensive WC hooks and extracts WC-related query stats.
 */
class HTP_Woo_Profiler {

    private static ?self $instance = null;
    private array $hook_timings  = [];
    private float $request_start = 0.0;

    private const TIMED_HOOKS = [
        'woocommerce_init',
        'woocommerce_loaded',
        'woocommerce_after_register_post_type',
        'woocommerce_cart_loaded_from_session',
        'woocommerce_before_calculate_totals',
        'woocommerce_checkout_process',
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

        return [
            'wc_version'   => defined('WC_VERSION') ? WC_VERSION : 'unknown',
            'hook_timings' => $this->hook_timings,
            'wc_queries'   => $wc_count,
            'wc_query_ms'  => round($wc_ms, 2),
        ];
    }
}
