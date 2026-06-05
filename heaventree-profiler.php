<?php
/**
 * Plugin Name: Heaventree Performance Profiler
 * Plugin URI:  https://heaventree.ie
 * Description: Identifies which WordPress plugins slow down your site. Includes WooCommerce-specific profiling and AI-powered recommendations. PHP 8.2 & WP 6.x compatible.
 * Author:      Heaventree
 * Version:     2.0.1
 * Requires at least: 6.0
 * Requires PHP: 8.0
 * Text Domain: heaventree-profiler
 * License:     GPL-2.0+
 */

declare(strict_types=1);

if (!defined('ABSPATH')) exit;

define('HTP_VERSION', '2.0.1');
define('HTP_PATH',    plugin_dir_path(__FILE__));
define('HTP_URL',     plugin_dir_url(__FILE__));
define('HTP_SLUG',    'heaventree-profiler');

require_once HTP_PATH . 'includes/class-plugin-mapper.php';
require_once HTP_PATH . 'includes/class-profiler-engine.php';
require_once HTP_PATH . 'includes/class-db-profiler.php';
require_once HTP_PATH . 'includes/class-woo-profiler.php';
require_once HTP_PATH . 'includes/class-ai-analyzer.php';
require_once HTP_PATH . 'includes/class-admin.php';

add_action('plugins_loaded', static function (): void {
    HTP_Admin::get_instance()->boot();

    if (HTP_Profiler_Engine::should_profile()) {
        HTP_Profiler_Engine::get_instance()->start();
        HTP_DB_Profiler::get_instance()->start();

        if (class_exists('WooCommerce')) {
            HTP_Woo_Profiler::get_instance()->start();
        }
    }
}, 1);

register_activation_hook(__FILE__,   [HTP_Admin::class, 'on_activate']);
register_deactivation_hook(__FILE__, [HTP_Admin::class, 'on_deactivate']);
