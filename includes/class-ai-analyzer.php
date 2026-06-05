<?php
declare(strict_types=1);

if (!defined('ABSPATH')) exit;

/**
 * Sends profiling data to an AI provider and returns performance recommendations.
 * Supports Anthropic Claude and OpenAI.
 */
class HTP_AI_Analyzer {

    private static ?self $instance = null;

    private function __construct() {}

    public static function get_instance(): self {
        return self::$instance ??= new self();
    }

    public function analyze(array $profile): array|WP_Error {
        $opts     = get_option('htp_options', []);
        $provider = $opts['ai_provider'] ?? 'anthropic';
        $api_key  = trim($opts['ai_api_key'] ?? '');
        $model    = trim($opts['ai_model']   ?? '');

        if ($api_key === '') {
            return new WP_Error('no_api_key', 'No AI API key configured. Add one in Performance Profiler → Settings.');
        }

        $prompt = $this->build_prompt($profile);

        return match ($provider) {
            'anthropic' => $this->call_anthropic($api_key, $model ?: 'claude-3-5-haiku-20241022', $prompt),
            'openai'    => $this->call_openai($api_key, $model ?: 'gpt-4o-mini', $prompt),
            default     => new WP_Error('bad_provider', "Unknown AI provider: {$provider}"),
        };
    }

    private function build_prompt(array $p): string {
        $db    = $p['db']    ?? [];
        $woo   = $p['woo']   ?? null;
        $admin = $p['admin'] ?? null;

        $plugins_line = implode(', ', $p['active_plugins'] ?? []);

        $top_hooks  = array_slice($p['plugin_hooks'] ?? [], 0, 10, true);
        $hooks_text = implode("\n", array_map(
            static fn ($slug, $count) => "  {$slug}: {$count} registered callbacks",
            array_keys($top_hooks), $top_hooks
        ));

        $queries_text = implode("\n", array_map(
            static fn ($q) => "  [{$q['ms']}ms] {$q['sql']}",
            array_slice($db['slowest'] ?? [], 0, 6)
        )) ?: '  (none above threshold)';

        $cp_text = implode("\n", array_map(
            static fn ($k, $v) => "  {$k}: {$v}ms",
            array_keys($p['checkpoints'] ?? []),
            $p['checkpoints'] ?? []
        ));

        $woo_section = '';
        if ($woo) {
            $woo_hooks   = implode("\n", array_map(
                static fn ($k, $v) => "  {$k}: {$v}ms",
                array_keys($woo['hook_timings'] ?? []),
                $woo['hook_timings'] ?? []
            ));
            $hpos = $woo['hpos_enabled'] ? 'yes (HPOS custom tables)' : 'no (legacy post meta)';
            $woo_section = "\n\n## WooCommerce {$woo['wc_version']}\n" .
                "- HPOS order storage: {$hpos}\n" .
                "- WC-related queries: {$woo['wc_queries']} totalling {$woo['wc_query_ms']}ms\n" .
                "- Hook timings:\n{$woo_hooks}";
        }

        $admin_section = '';
        if ($admin) {
            $screen_str = '';
            if ($admin['screen']) {
                $s = $admin['screen'];
                $screen_str = "\n- Admin screen: {$s['id']} (base: {$s['base']}, post_type: {$s['post_type']})";
            }

            $hook_total_lines = implode("\n", array_map(
                static fn ($k, $v) => "  {$k}: {$v}ms",
                array_keys($admin['hook_totals'] ?? []),
                $admin['hook_totals'] ?? []
            ));

            // Per-plugin attribution: most important data for AI
            $plugin_timing_lines = '';
            foreach ($admin['plugin_timings'] ?? [] as $hook => $plugins) {
                $plugin_timing_lines .= "  {$hook}:\n";
                foreach ($plugins as $slug => $ms) {
                    $plugin_timing_lines .= "    {$slug}: {$ms}ms\n";
                }
            }

            $pending = implode(', ', $admin['pending_checks'] ?? []);
            $pending_warn = $pending ? "\n- SLOW REQUEST WARNING: stale update-check transients for [{$pending}] — WordPress will make blocking HTTP calls on the next admin load" : '';

            $enqueued_lines = implode("\n", array_map(
                static fn ($slug, $count) => "  {$slug}: {$count} assets",
                array_keys(array_slice($admin['enqueued'] ?? [], 0, 10, true)),
                array_slice($admin['enqueued'] ?? [], 0, 10)
            ));

            $admin_section = "\n\n## WordPress Admin Profiling{$screen_str}{$pending_warn}\n" .
                "### Hook totals\n{$hook_total_lines}\n" .
                "### Per-plugin time attribution\n{$plugin_timing_lines}" .
                "### Enqueued assets by plugin\n{$enqueued_lines}";
        }

        return <<<PROMPT
You are a WordPress performance expert. Analyse the profiling data below and provide specific, actionable recommendations.

## Environment
- WordPress {$p['wp_version']}, PHP {$p['php_version']}
- Is admin page: {$p['is_admin']}
- URL: {$p['url']}
- Total load time: {$p['total_ms']}ms | Peak memory: {$p['memory_mb']}MB

## Active Plugins
{$plugins_line}

## Timing Checkpoints (ms from request start)
{$cp_text}

## Database
- Total queries: {$db['total']} in {$db['total_ms']}ms
- Slow queries (>{$db['slow_threshold_ms']}ms):
{$queries_text}{$woo_section}{$admin_section}

## Plugin Hook Registrations (highest = most hooks registered)
{$hooks_text}

## Instructions
Provide:
1. Top 3-5 specific performance problems identifiable from this data, citing actual plugin names and ms values
2. A concrete fix for each (plugin config change, wp-admin setting, code snippet, or removal recommendation)
3. Separate "Quick wins" (under 10 min) from "Bigger changes"
4. If this is an admin page, focus on admin_init and admin_menu slowness and update-check blocking
5. If WooCommerce data is present, include WC-specific recommendations (HPOS, transient caching, query optimisation)

Be direct. Name actual plugin slugs and wp-admin settings paths.
PROMPT;
    }

    private function call_anthropic(string $key, string $model, string $prompt): array|WP_Error {
        $response = wp_remote_post('https://api.anthropic.com/v1/messages', [
            'timeout' => 60,
            'headers' => [
                'x-api-key'         => $key,
                'anthropic-version' => '2023-06-01',
                'content-type'      => 'application/json',
            ],
            'body' => wp_json_encode([
                'model'      => $model,
                'max_tokens' => 1500,
                'messages'   => [['role' => 'user', 'content' => $prompt]],
            ]),
        ]);
        if (is_wp_error($response)) return $response;
        $body = json_decode(wp_remote_retrieve_body($response), true);
        if (!empty($body['error'])) return new WP_Error('anthropic', $body['error']['message'] ?? 'Anthropic API error');
        return ['analysis' => $body['content'][0]['text'] ?? '', 'model' => $model, 'provider' => 'anthropic'];
    }

    private function call_openai(string $key, string $model, string $prompt): array|WP_Error {
        $response = wp_remote_post('https://api.openai.com/v1/chat/completions', [
            'timeout' => 60,
            'headers' => ['Authorization' => "Bearer {$key}", 'Content-Type' => 'application/json'],
            'body'    => wp_json_encode(['model' => $model, 'messages' => [['role' => 'user', 'content' => $prompt]]]),
        ]);
        if (is_wp_error($response)) return $response;
        $body = json_decode(wp_remote_retrieve_body($response), true);
        if (!empty($body['error'])) return new WP_Error('openai', $body['error']['message'] ?? 'OpenAI error');
        return ['analysis' => $body['choices'][0]['message']['content'] ?? '', 'model' => $model, 'provider' => 'openai'];
    }
}
