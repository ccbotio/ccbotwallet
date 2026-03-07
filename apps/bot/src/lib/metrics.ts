/**
 * Prometheus Metrics Service
 *
 * Production monitoring for CC Bot Wallet.
 * Exposes metrics at /metrics endpoint in Prometheus format.
 */
import {
  Registry,
  Counter,
  Histogram,
  Gauge,
  collectDefaultMetrics,
} from 'prom-client';

// Create a custom registry
export const metricsRegistry = new Registry();

// Collect default Node.js metrics (memory, CPU, event loop, etc.)
collectDefaultMetrics({
  register: metricsRegistry,
  prefix: 'ccbot_',
});

// ==================== API Metrics ====================

export const httpRequestsTotal = new Counter({
  name: 'ccbot_http_requests_total',
  help: 'Total number of HTTP requests',
  labelNames: ['method', 'route', 'status_code'],
  registers: [metricsRegistry],
});

export const httpRequestDuration = new Histogram({
  name: 'ccbot_http_request_duration_seconds',
  help: 'HTTP request duration in seconds',
  labelNames: ['method', 'route', 'status_code'],
  buckets: [0.01, 0.05, 0.1, 0.25, 0.5, 1, 2.5, 5, 10],
  registers: [metricsRegistry],
});

// ==================== Swap Metrics ====================

export const swapQuotesTotal = new Counter({
  name: 'ccbot_swap_quotes_total',
  help: 'Total swap quotes generated',
  labelNames: ['from_token', 'to_token'],
  registers: [metricsRegistry],
});

export const swapExecutionsTotal = new Counter({
  name: 'ccbot_swap_executions_total',
  help: 'Total swap executions',
  labelNames: ['from_token', 'to_token', 'status'],
  registers: [metricsRegistry],
});

export const swapVolume = new Counter({
  name: 'ccbot_swap_volume_total',
  help: 'Total swap volume in token units',
  labelNames: ['token', 'direction'],
  registers: [metricsRegistry],
});

export const swapDuration = new Histogram({
  name: 'ccbot_swap_duration_seconds',
  help: 'Swap execution duration in seconds',
  labelNames: ['from_token', 'to_token', 'status'],
  buckets: [0.5, 1, 2, 5, 10, 30, 60],
  registers: [metricsRegistry],
});

export const swapRefundsTotal = new Counter({
  name: 'ccbot_swap_refunds_total',
  help: 'Total swap refunds',
  labelNames: ['status', 'token'],
  registers: [metricsRegistry],
});

// ==================== Treasury Metrics ====================

export const treasuryBalance = new Gauge({
  name: 'ccbot_treasury_balance',
  help: 'Current treasury balance',
  labelNames: ['token'],
  registers: [metricsRegistry],
});

export const treasurySwapsTotal = new Counter({
  name: 'ccbot_treasury_swaps_total',
  help: 'Total swaps processed by treasury',
  registers: [metricsRegistry],
});

export const treasuryFeesCollected = new Counter({
  name: 'ccbot_treasury_fees_collected_total',
  help: 'Total fees collected by treasury',
  labelNames: ['token'],
  registers: [metricsRegistry],
});

// ==================== Bridge Metrics ====================

export const bridgeTransactionsTotal = new Counter({
  name: 'ccbot_bridge_transactions_total',
  help: 'Total bridge transactions',
  labelNames: ['type', 'status'],
  registers: [metricsRegistry],
});

export const bridgeVolume = new Counter({
  name: 'ccbot_bridge_volume_total',
  help: 'Total bridge volume in USDC',
  labelNames: ['type'],
  registers: [metricsRegistry],
});

export const bridgeAttestationDuration = new Histogram({
  name: 'ccbot_bridge_attestation_duration_seconds',
  help: 'Time to receive attestation',
  labelNames: ['type'],
  buckets: [30, 60, 120, 300, 600, 1800, 3600],
  registers: [metricsRegistry],
});

// ==================== Alert Metrics ====================

export const alertsSentTotal = new Counter({
  name: 'ccbot_alerts_sent_total',
  help: 'Total alerts sent',
  labelNames: ['type', 'priority'],
  registers: [metricsRegistry],
});

export const alertsRateLimited = new Counter({
  name: 'ccbot_alerts_rate_limited_total',
  help: 'Alerts blocked by rate limiting',
  labelNames: ['type'],
  registers: [metricsRegistry],
});

// ==================== Job Queue Metrics ====================

export const jobsProcessedTotal = new Counter({
  name: 'ccbot_jobs_processed_total',
  help: 'Total jobs processed',
  labelNames: ['queue', 'status'],
  registers: [metricsRegistry],
});

export const jobsDuration = new Histogram({
  name: 'ccbot_jobs_duration_seconds',
  help: 'Job processing duration',
  labelNames: ['queue'],
  buckets: [0.1, 0.5, 1, 5, 10, 30, 60, 300],
  registers: [metricsRegistry],
});

export const jobsActive = new Gauge({
  name: 'ccbot_jobs_active',
  help: 'Currently active jobs',
  labelNames: ['queue'],
  registers: [metricsRegistry],
});

export const jobsWaiting = new Gauge({
  name: 'ccbot_jobs_waiting',
  help: 'Jobs waiting in queue',
  labelNames: ['queue'],
  registers: [metricsRegistry],
});

// ==================== Canton Network Metrics ====================

export const cantonHealthy = new Gauge({
  name: 'ccbot_canton_healthy',
  help: 'Canton Network connection health (1=healthy, 0=unhealthy)',
  registers: [metricsRegistry],
});

export const cantonLatency = new Histogram({
  name: 'ccbot_canton_latency_seconds',
  help: 'Canton API call latency',
  labelNames: ['operation'],
  buckets: [0.05, 0.1, 0.25, 0.5, 1, 2.5, 5],
  registers: [metricsRegistry],
});

export const cantonTransfersTotal = new Counter({
  name: 'ccbot_canton_transfers_total',
  help: 'Total Canton transfers',
  labelNames: ['token', 'status'],
  registers: [metricsRegistry],
});

// ==================== User Metrics ====================

export const activeUsers = new Gauge({
  name: 'ccbot_active_users',
  help: 'Number of active users (last 24h)',
  registers: [metricsRegistry],
});

export const totalWallets = new Gauge({
  name: 'ccbot_total_wallets',
  help: 'Total number of wallets',
  registers: [metricsRegistry],
});

export const sessionsActive = new Gauge({
  name: 'ccbot_sessions_active',
  help: 'Currently active sessions',
  registers: [metricsRegistry],
});

// ==================== Helper Functions ====================

/**
 * Record API request metrics
 */
export function recordHttpRequest(
  method: string,
  route: string,
  statusCode: number,
  durationMs: number
): void {
  const labels = { method, route, status_code: String(statusCode) };
  httpRequestsTotal.inc(labels);
  httpRequestDuration.observe(labels, durationMs / 1000);
}

/**
 * Record swap metrics
 */
export function recordSwap(params: {
  fromToken: string;
  toToken: string;
  fromAmount: number;
  toAmount: number;
  status: 'completed' | 'failed' | 'refunded';
  durationMs: number;
}): void {
  const { fromToken, toToken, fromAmount, status, durationMs } = params;

  swapExecutionsTotal.inc({ from_token: fromToken, to_token: toToken, status });
  swapVolume.inc({ token: fromToken, direction: 'out' }, fromAmount);
  swapDuration.observe({ from_token: fromToken, to_token: toToken, status }, durationMs / 1000);

  if (status === 'completed') {
    treasurySwapsTotal.inc();
  }
}

/**
 * Update treasury balance metrics
 */
export function updateTreasuryBalance(ccBalance: number, usdcxBalance: number): void {
  treasuryBalance.set({ token: 'CC' }, ccBalance);
  treasuryBalance.set({ token: 'USDCx' }, usdcxBalance);
}

/**
 * Record alert metrics
 */
export function recordAlert(type: string, priority: string, sent: boolean): void {
  if (sent) {
    alertsSentTotal.inc({ type, priority });
  } else {
    alertsRateLimited.inc({ type });
  }
}

/**
 * Get all metrics in Prometheus format
 */
export async function getMetrics(): Promise<string> {
  return metricsRegistry.metrics();
}

/**
 * Get metrics content type
 */
export function getMetricsContentType(): string {
  return metricsRegistry.contentType;
}
