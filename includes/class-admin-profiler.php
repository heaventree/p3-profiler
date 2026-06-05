<?php
declare(strict_types=1);

if (!defined('ABSPATH')) exit;

/**
 * WordPress wp-admin specific profiling.
 *
 * - Times total duration of key admin lifecycle hooks.
 * - Wraps admin_init / admin_menu callbacks to attribute time to individual plugins.
 * - Captures current screen context ($current_screen).
 * - Flags expired update-check transients (they trigger blocking HTTP requests).
 * - Counts enqueued JS/CSS assets per plugin.
 */
class HTP_Admin_Page_Profiler {

    private static ?self $instance = null;

    private array  $hook_totals    = [];   // hook  => ms
    private array  $plugin_timings = [];   // hook  => [plugin => ms]
    private array  $enqueued       = [];   // plugin => count
    private array  $pending_checks = [];   // labels of stale transients
    private ?array $screen_info    = null;

    /** Hooks whose total wall-clock duration we record. */
    private const TIMED_HOOKS = [
        'admin_init',
        'admin_menu',
        'current_screen',
        'add_meta_boxes',
        'wp_dashboard_setup',
        'admin_head',
        'admin_footer',
    ];

    /** Hooks where we additionally wrap each callback for per-plugin attribution. */
    private const ATTRIBUTED_HOOKS = ['admin_init', 'admin_menu'];

    private function __construct() {}

    public static function get_instance(): self {
        return self::$instance ??= new self();
    }

    public function start(): void {
        foreach (self::TIMED_HOOKS as $hook) {
            $this->time_hook_total($hook);
        }
        foreach (self::ATTRIBUTED_HOOKS as $hook) {
            $this->wrap_for_per_plugin_timing($hook);
        }
        add_action('current_screen',        [$this, 'capture_screen'],        PHP_INT_MAX);
        add_action('admin_enqueue_scripts', [$this, 'capture_enqueued'],      PHP_INT_MAX);
        add_action('admin_init',            [$this, 'detect_update_checks'],  PHP_INT_MAX);
    }

    // ------------------------------------------------------------------
    // Hook total timing
    // ------------------------------------------------------------------

    private function time_hook_total(string $hook): void {
        $start = null;
        add_action($hook, static function () use (&$start): void {
            $start = microtime(true);
        }, PHP_INT_MIN);
        add_action($hook, function () use ($hook, &$start): void {
            if ($start !== null) {
                $this->hook_totals[$hook] = round((microtime(true) - $start) * 1000, 2);
            }
        }, PHP_INT_MAX);
    }

    // ------------------------------------------------------------------
    // Per-plugin callback attribution
    //
    // Added at PHP_INT_MIN so we run before any real work starts on the hook.
    // We then iterate over callbacks registered at later priorities and replace
    // each one that belongs to an identifiable plugin with a timing wrapper.
    // WP_Hook iterates priorities in order, so our modifications to higher
    // priority buckets are already in place by the time they execute.
    // ------------------------------------------------------------------

    private function wrap_for_per_plugin_timing(string $hook): void {
        add_action($hook, function () use ($hook): void {
            global $wp_filter;
            if (!isset($wp_filter[$hook]) || !($wp_filter[$hook] instanceof WP_Hook)) return;

            $mapper = HTP_Plugin_Mapper::get_instance();

            foreach ($wp_filter[$hook]->callbacks as $priority => &$priority_cbs) {
                if ($priority === PHP_INT_MIN || $priority === PHP_INT_MAX) continue;
                foreach ($priority_cbs as &$cb) {
                    $fn = $cb['function'] ?? null;
                    if (!$fn || !is_callable($fn)) continue;
                    $plugin = $mapper->callback_to_plugin($fn);
                    if (!$plugin) continue;
                    $cb['function'] = $this->make_timed_cb($fn, $hook, $plugin);
                }
            }
        }, PHP_INT_MIN);
    }

    private function make_timed_cb(callable $fn, string $hook, string $plugin): callable {
        return function () use ($fn, $hook, $plugin) {
            $t      = microtime(true);
            $result = call_user_func_array($fn, func_get_args());
            $ms     = round((microtime(true) - $t) * 1000, 2);
            $this->plugin_timings[$hook][$plugin] =
                ($this->plugin_timings[$hook][$plugin] ?? 0.0) + $ms;
            return $result;
        };
    }

    // ------------------------------------------------------------------
    // Screen, assets, update checks
    // ------------------------------------------------------------------

    public function capture_screen(WP_Screen $screen): void {
        $this->screen_info = [
            'id'        => $screen->id,
            'base'      => $screen->base,
            'post_type' => $screen->post_type ?? '',
            'action'    => $screen->action    ?? '',
        ];
    }

    public function capture_enqueued(): void {
        global $wp_scripts, $wp_styles;
        $counts = [];

        foreach ($wp_scripts->queue ?? [] as $handle) {
            $this->tally_src($wp_scripts->registered[$handle]->src ?? '', $counts);
        }
        foreach ($wp_styles->queue ?? [] as $handle) {
            $this->tally_src($wp_styles->registered[$handle]->src ?? '', $counts);
        }

        arsort($counts);
        $this->enqueued = $counts;
    }

    private function tally_src(string $src, array &$counts): void {
        if (!$src || !str_contains($src, '/plugins/')) return;
        if (preg_match('#/plugins/([^/]+)/#', $src, $m)) {
            $counts[$m[1]] = ($counts[$m[1]] ?? 0) + 1;
        }
    }

    public function detect_update_checks(): void {
        $this->maybe_flag_stale('update_plugins', 'plugins');
        $this->maybe_flag_stale('update_themes',  'themes');
        $this->maybe_flag_stale('update_core',    'core');
    }

    private function maybe_flag_stale(string $transient, string $label): void {
        $data = get_site_transient($transient);
        if (!$data || !isset($data->last_checked) ||
            (time() - $data->last_checked) > DAY_IN_SECONDS) {
            $this->pending_checks[] = $label;
        }
    }

    // ------------------------------------------------------------------

    public function get_results(): array {
        $sorted = [];
        foreach ($this->plugin_timings as $hook => $plugins) {
            arsort($plugins);
            $sorted[$hook] = $plugins;
        }

        return [
            'hook_totals'    => $this->hook_totals,
            'plugin_timings' => $sorted,
            'enqueued'       => $this->enqueued,
            'screen'         => $this->screen_info,
            'pending_checks' => $this->pending_checks,
        ];
    }
}
