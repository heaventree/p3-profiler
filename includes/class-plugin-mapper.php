<?php
declare(strict_types=1);

if (!defined('ABSPATH')) exit;

/**
 * Maps WordPress hook callbacks to the plugin slug that registered them.
 * Uses PHP Reflection — no file I/O, results are cached per request.
 */
class HTP_Plugin_Mapper {

    private static ?self $instance = null;
    /** @var array<string,string> */
    private array $file_cache = [];

    private function __construct() {}

    public static function get_instance(): self {
        return self::$instance ??= new self();
    }

    /**
     * Returns the plugin slug for a callback, or null if not a plugin callback.
     */
    public function callback_to_plugin(mixed $callback): ?string {
        $file = $this->callback_to_file($callback);
        return $file !== null ? $this->file_to_plugin($file) : null;
    }

    private function callback_to_file(mixed $cb): ?string {
        try {
            if ($cb instanceof Closure || (is_string($cb) && function_exists($cb))) {
                $r = new ReflectionFunction($cb);
                return $r->getFileName() ?: null;
            }

            if (is_array($cb) && count($cb) === 2) {
                $r = new ReflectionMethod($cb[0], $cb[1]);
                return $r->getFileName() ?: null;
            }

            if (is_object($cb) && method_exists($cb, '__invoke')) {
                $r = new ReflectionMethod($cb, '__invoke');
                return $r->getFileName() ?: null;
            }
        } catch (ReflectionException) {
            // Built-in functions or internal PHP methods have no file
        }
        return null;
    }

    private function file_to_plugin(string $file): ?string {
        $norm = wp_normalize_path($file);

        if (array_key_exists($norm, $this->file_cache)) {
            return $this->file_cache[$norm] ?: null;
        }

        $plugins_dir = wp_normalize_path(WP_PLUGIN_DIR) . '/';

        if (!str_starts_with($norm, $plugins_dir)) {
            $this->file_cache[$norm] = '';
            return null;
        }

        $relative = substr($norm, strlen($plugins_dir));
        $slug     = explode('/', $relative)[0];

        $this->file_cache[$norm] = $slug;
        return $slug;
    }

    /**
     * Walk all registered hooks and return:
     * plugin_slug => total callback count across all hooks
     */
    public function plugin_callback_counts(): array {
        global $wp_filter;
        $counts = [];

        foreach ($wp_filter as $hook_obj) {
            if (!($hook_obj instanceof WP_Hook)) continue;
            foreach ($hook_obj->callbacks as $priority_callbacks) {
                foreach ($priority_callbacks as $cb) {
                    $slug = $this->callback_to_plugin($cb['function']);
                    if ($slug !== null) {
                        $counts[$slug] = ($counts[$slug] ?? 0) + 1;
                    }
                }
            }
        }

        arsort($counts);
        return $counts;
    }

    /**
     * Walk all registered hooks and return:
     * hook_name => [plugin_slug => callback_count]
     * Useful for attributing time on slow hooks.
     */
    public function hook_to_plugins_map(): array {
        global $wp_filter;
        $map = [];

        foreach ($wp_filter as $hook => $hook_obj) {
            if (!($hook_obj instanceof WP_Hook)) continue;
            foreach ($hook_obj->callbacks as $priority_callbacks) {
                foreach ($priority_callbacks as $cb) {
                    $slug = $this->callback_to_plugin($cb['function']);
                    if ($slug !== null) {
                        $map[$hook][$slug] = ($map[$hook][$slug] ?? 0) + 1;
                    }
                }
            }
        }

        return $map;
    }
}
