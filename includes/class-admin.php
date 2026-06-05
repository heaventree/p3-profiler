<?php
declare(strict_types=1);

if (!defined('ABSPATH')) exit;

/**
 * Admin controller: menu, asset loading, all AJAX handlers.
 */
class HTP_Admin {

    private static ?self $instance = null;

    private function __construct() {}

    public static function get_instance(): self {
        return self::$instance ??= new self();
    }

    public function boot(): void {
        if (!is_admin()) return;
        add_action('admin_menu',            [$this, 'add_menu']);
        add_action('admin_enqueue_scripts', [$this, 'enqueue']);
        add_action('wp_ajax_htp_start_scan',    [$this, 'ajax_start_scan']);
        add_action('wp_ajax_htp_stop_scan',     [$this, 'ajax_stop_scan']);
        add_action('wp_ajax_htp_list_scans',    [$this, 'ajax_list_scans']);
        add_action('wp_ajax_htp_get_profiles',  [$this, 'ajax_get_profiles']);
        add_action('wp_ajax_htp_ai_analyze',    [$this, 'ajax_ai_analyze']);
        add_action('wp_ajax_htp_save_settings', [$this, 'ajax_save_settings']);
        add_action('wp_ajax_htp_delete_scan',   [$this, 'ajax_delete_scan']);
    }

    public function add_menu(): void {
        add_management_page('Performance Profiler', 'Perf Profiler', 'manage_options', HTP_SLUG, [$this, 'render_page']);
    }

    public function enqueue(string $hook): void {
        if ($hook !== 'tools_page_' . HTP_SLUG) return;
        wp_enqueue_style('htp-profiler', HTP_URL . 'assets/css/profiler.css', [], HTP_VERSION);
        wp_enqueue_script('htp-profiler', HTP_URL . 'assets/js/profiler.js', [], HTP_VERSION, true);
        wp_localize_script('htp-profiler', 'HTP_Data', [
            'nonce'      => wp_create_nonce('htp_nonce'),
            'ajax'       => admin_url('admin-ajax.php'),
            'profiling'  => self::is_profiling_active(),
            'ip'         => HTP_Profiler_Engine::client_ip(),
            'opts'       => $this->safe_opts(),
            'site_url'   => get_site_url(),
            'admin_url'  => admin_url(),
            'woo_active' => class_exists('WooCommerce'),
        ]);
    }

    private function safe_opts(): array {
        $opts = get_option('htp_options', []);
        $opts['ai_api_key'] = !empty($opts['ai_api_key']) ? '••••••••' : '';
        return $opts;
    }

    public function render_page(): void {
        if (!current_user_can('manage_options')) wp_die();
        echo '<div class="wrap"><div id="htp-app"></div></div>';
    }

    public static function is_profiling_active(): bool {
        $opts    = get_option('htp_options', []);
        $expires = (int)($opts['profiling_expires'] ?? 0);
        return !empty($opts['profiling_active']) && (!$expires || time() <= $expires);
    }

    public function ajax_start_scan(): void {
        $this->verify();
        $scan_name = sanitize_key($_POST['scan_name'] ?? ('scan_' . gmdate('YmdHis')));
        $ip        = sanitize_text_field($_POST['ip'] ?? HTP_Profiler_Engine::client_ip());
        $duration  = max(300, min(14400, (int)($_POST['duration'] ?? 3600)));
        $opts      = get_option('htp_options', []);
        $opts['profiling_active']  = true;
        $opts['profiling_ip']      = $ip;
        $opts['profiling_expires'] = time() + $duration;
        $opts['scan_name']         = $scan_name;
        update_option('htp_options', $opts);
        wp_send_json_success(['scan_name' => $scan_name, 'ip' => $ip, 'expires' => $opts['profiling_expires']]);
    }

    public function ajax_stop_scan(): void {
        $this->verify();
        $scan_name = get_option('htp_options', [])['scan_name'] ?? '';
        HTP_Profiler_Engine::stop();
        wp_send_json_success(['scan_name' => $scan_name]);
    }

    public function ajax_list_scans(): void {
        $this->verify();
        global $wpdb;
        $rows  = $wpdb->get_col($wpdb->prepare(
            "SELECT option_name FROM {$wpdb->options} WHERE option_name LIKE %s",
            $wpdb->esc_like('htp_scan_') . '%'
        ));
        wp_send_json_success(array_map(static fn ($n) => substr($n, strlen('htp_scan_')), $rows));
    }

    public function ajax_get_profiles(): void {
        $this->verify();
        $scan_name = sanitize_key($_POST['scan_name'] ?? 'default');
        wp_send_json_success(get_option("htp_scan_{$scan_name}", []));
    }

    public function ajax_ai_analyze(): void {
        $this->verify();
        $scan_name = sanitize_key($_POST['scan_name'] ?? 'default');
        $index     = (int)($_POST['index'] ?? 0);
        $profiles  = get_option("htp_scan_{$scan_name}", []);
        if (!isset($profiles[$index])) { wp_send_json_error('Profile not found'); return; }
        if (!empty($profiles[$index]['ai_analysis'])) {
            wp_send_json_success(['analysis' => $profiles[$index]['ai_analysis'], 'cached' => true]);
            return;
        }
        $result = HTP_AI_Analyzer::get_instance()->analyze($profiles[$index]);
        if (is_wp_error($result)) { wp_send_json_error($result->get_error_message()); return; }
        $profiles[$index]['ai_analysis'] = $result['analysis'];
        update_option("htp_scan_{$scan_name}", $profiles, false);
        wp_send_json_success($result);
    }

    public function ajax_save_settings(): void {
        $this->verify();
        $opts = get_option('htp_options', []);
        $opts['ai_provider'] = sanitize_text_field($_POST['ai_provider'] ?? 'anthropic');
        $opts['ai_model']    = sanitize_text_field($_POST['ai_model']    ?? '');
        $raw_key = trim($_POST['ai_api_key'] ?? '');
        if ($raw_key !== '' && $raw_key !== '••••••••') {
            $opts['ai_api_key'] = sanitize_text_field($raw_key);
        }
        update_option('htp_options', $opts);
        wp_send_json_success();
    }

    public function ajax_delete_scan(): void {
        $this->verify();
        $scan_name = sanitize_key($_POST['scan_name'] ?? '');
        if ($scan_name) delete_option("htp_scan_{$scan_name}");
        wp_send_json_success();
    }

    public static function on_activate(): void {
        if (!get_option('htp_options')) {
            add_option('htp_options', [
                'profiling_active'  => false,
                'profiling_ip'      => '',
                'profiling_expires' => 0,
                'scan_name'         => '',
                'ai_provider'       => 'anthropic',
                'ai_model'          => 'claude-3-5-haiku-20241022',
                'ai_api_key'        => '',
            ]);
        }
    }

    public static function on_deactivate(): void {
        HTP_Profiler_Engine::stop();
    }

    private function verify(): void {
        check_ajax_referer('htp_nonce', 'nonce');
        if (!current_user_can('manage_options')) wp_die('Forbidden', 403);
    }
}
