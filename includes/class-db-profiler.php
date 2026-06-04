<?php
declare(strict_types=1);

if (!defined('ABSPATH')) exit;

/**
 * Database query profiler.
 * Enables SAVEQUERIES and analyses the query log at shutdown.
 */
class HTP_DB_Profiler {

    private static ?self $instance = null;
    private bool $running = false;

    private function __construct() {}

    public static function get_instance(): self {
        return self::$instance ??= new self();
    }

    public function start(): void {
        if ($this->running) return;
        if (!defined('SAVEQUERIES')) {
            define('SAVEQUERIES', true);
        }
        $this->running = true;
    }

    public function get_results(): array {
        global $wpdb;

        if (empty($wpdb->queries)) {
            return ['total' => 0, 'total_ms' => 0.0, 'slow_threshold_ms' => 5, 'slowest' => [], 'by_table' => []];
        }

        $total_ms  = 0.0;
        $by_table  = [];
        $slowest   = [];
        $threshold = 3.0; // ms — report queries slower than this

        foreach ($wpdb->queries as [$sql, $time, $caller]) {
            $ms        = round((float) $time * 1000, 3);
            $total_ms += $ms;

            // Extract primary table name
            if (preg_match('/\b(?:FROM|INTO|UPDATE|TABLE)\s+`?(\w+)`?/i', $sql, $m)) {
                $table = $m[1];
                $by_table[$table]['count'] = ($by_table[$table]['count'] ?? 0) + 1;
                $by_table[$table]['ms']    = round(($by_table[$table]['ms'] ?? 0.0) + $ms, 3);
            }

            if ($ms >= $threshold) {
                $slowest[] = [
                    'ms'     => $ms,
                    'sql'    => substr(preg_replace('/\s+/', ' ', $sql), 0, 200),
                    'caller' => substr($caller, 0, 150),
                ];
            }
        }

        usort($slowest, static fn ($a, $b) => $b['ms'] <=> $a['ms']);
        uasort($by_table, static fn ($a, $b) => $b['ms'] <=> $a['ms']);

        return [
            'total'            => count($wpdb->queries),
            'total_ms'         => round($total_ms, 2),
            'slow_threshold_ms' => $threshold,
            'slowest'          => array_slice($slowest, 0, 15),
            'by_table'         => array_slice($by_table, 0, 15, true),
        ];
    }
}
