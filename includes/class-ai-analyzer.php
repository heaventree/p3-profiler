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

    /**
     * @return array{analysis:string,model:string,provider:string}|WP_Error
     */
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
            'openai'    => $this->call_openai($api_key,    $model ?: 'gpt-4o-mini', $prompt),
            default     => new WP_Error('bad_provider', "Unknown AI provider: {$provider}"),
        };
    }

    private function build_prompt(array $p): string {
        $db  = $p['db']  ?? [];
        $woo = $p['woo'] ?? null;

        $plugins_line = implode(', ', $p['active_plugins'] ?? []);

        $top_hooks = array_slice($p['plugin_hooks'] ?? [], 0, 10, true);
        $hooks_text = implode("\n", array_map(
            static fn ($slug, $count) => "  {$slug}: {$count} registered callbacks",
            array_keys($top_hooks),
            $top_hooks
        ));

        $slow_queries = array_slice($db['slowest'] ?? [], 0, 6);
        $queries_text = implode("\n", array_map(
            static fn ($q) => "  [{$q['ms']}ms] {$q['sql']}",
            $slow_queries
        )) ?: '  (none above threshold)';

        $checkpoints = $p['checkpoints'] ?? [];
        $cp_text = implode("\n", array_map(
            static fn ($k, $v) => "  {$k}: {$v}ms",
            array_keys($checkpoints),
            $checkpoints
        ));

        $woo_section = '';
        if ($woo) {
            $woo_hooks = implode("\n", array_map(
                static fn ($k, $v) => "  {$k}: {$v}ms",
                array_keys($woo['hook_timings'] ?? []),
                $woo['hook_timings'] ?? []
            ));
            $woo_section = "

## WooCommerce {$woo['wc_version']}
- WC-related queries: {$woo['wc_queries']} totalling {$woo['wc_query_ms']}ms
- Hook timings:
{$woo_hooks}";
        }

        return <<<PROMPT
You are a WordPress performance expert. Analyse the profiling data below and provide specific, actionable recommendations to speed up this site.

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
{$queries_text}{$woo_section}

## Plugin Hook Registrations (highest = most hooks registered, proxy for overhead)
{$hooks_text}

## Instructions
Provide:
1. Top 3–5 specific performance problems you can identify from this data
2. Concrete fix for each (plugin to configure/deactivate, WP/WooCommerce setting to change, query to fix)
3. Separate "Quick wins" (< 10 min) from "Bigger changes"
4. If WooCommerce data is present, include WC-specific recommendations

Be direct and specific. Name actual plugin slugs and WP admin settings paths.
PROMPT;
    }

    /** @return array{analysis:string,model:string,provider:string}|WP_Error */
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
        if (!empty($body['error'])) {
            return new WP_Error('anthropic', $body['error']['message'] ?? 'Anthropic API error');
        }

        return ['analysis' => $body['content'][0]['text'] ?? '', 'model' => $model, 'provider' => 'anthropic'];
    }

    /** @return array{analysis:string,model:string,provider:string}|WP_Error */
    private function call_openai(string $key, string $model, string $prompt): array|WP_Error {
        $response = wp_remote_post('https://api.openai.com/v1/chat/completions', [
            'timeout' => 60,
            'headers' => [
                'Authorization' => "Bearer {$key}",
                'Content-Type'  => 'application/json',
            ],
            'body' => wp_json_encode([
                'model'    => $model,
                'messages' => [['role' => 'user', 'content' => $prompt]],
            ]),
        ]);

        if (is_wp_error($response)) return $response;

        $body = json_decode(wp_remote_retrieve_body($response), true);
        if (!empty($body['error'])) {
            return new WP_Error('openai', $body['error']['message'] ?? 'OpenAI error');
        }

        return ['analysis' => $body['choices'][0]['message']['content'] ?? '', 'model' => $model, 'provider' => 'openai'];
    }
}
