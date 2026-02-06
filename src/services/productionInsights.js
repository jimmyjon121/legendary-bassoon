/**
 * Production Insights Service
 * 
 * Connects to APM tools (Sentry, Datadog, New Relic) to surface
 * real-world performance and error data while editing code.
 */

// Supported APM integrations
const APM_INTEGRATIONS = {
  sentry: {
    id: 'sentry',
    name: 'Sentry',
    icon: '🔴',
    configKeys: ['SENTRY_DSN', 'SENTRY_AUTH_TOKEN', 'SENTRY_ORG', 'SENTRY_PROJECT'],
    endpoints: {
      issues: '/api/0/projects/{org}/{project}/issues/',
      events: '/api/0/projects/{org}/{project}/events/',
      stats: '/api/0/projects/{org}/{project}/stats/'
    }
  },
  datadog: {
    id: 'datadog',
    name: 'Datadog',
    icon: '🟣',
    configKeys: ['DD_API_KEY', 'DD_APP_KEY', 'DD_SITE'],
    endpoints: {
      metrics: '/api/v1/query',
      events: '/api/v1/events',
      logs: '/api/v2/logs/events'
    }
  },
  newrelic: {
    id: 'newrelic',
    name: 'New Relic',
    icon: '🟢',
    configKeys: ['NEW_RELIC_API_KEY', 'NEW_RELIC_ACCOUNT_ID'],
    endpoints: {
      nrql: '/graphql',
      apm: '/v2/applications/{app_id}/metrics.json'
    }
  }
};

// Insight types
const INSIGHT_TYPES = {
  ERROR_RATE: 'error_rate',
  PERFORMANCE: 'performance',
  USAGE: 'usage',
  TREND: 'trend',
  ANOMALY: 'anomaly'
};

// Mock data for demo (real implementation would fetch from APM)
const MOCK_INSIGHTS = {
  'src/services/userService.js': {
    errorRate: 0.02,
    avgLatency: 234,
    p99Latency: 1240,
    callsPerDay: 45230,
    recentErrors: [
      { message: 'TypeError: Cannot read property of undefined', count: 12, lastSeen: Date.now() - 3600000 },
      { message: 'NetworkError: Request timeout', count: 5, lastSeen: Date.now() - 7200000 }
    ],
    hotspots: [
      { line: 45, method: 'fetchUser', latency: 890, calls: 15000 },
      { line: 78, method: 'updateProfile', latency: 456, calls: 8000 }
    ]
  },
  'src/api/orders.js': {
    errorRate: 0.005,
    avgLatency: 567,
    p99Latency: 2100,
    callsPerDay: 23450,
    recentErrors: [],
    hotspots: [
      { line: 23, method: 'processOrder', latency: 1200, calls: 5000 }
    ]
  }
};

class ProductionInsights {
  constructor() {
    this.config = {};
    this.activeIntegrations = [];
    this.cachedInsights = new Map();
    this.listeners = new Set();
    this.isConnected = false;
    this.lastSync = null;
  }

  /**
   * Configure APM integration
   */
  configure(integration, credentials) {
    const apm = APM_INTEGRATIONS[integration];
    if (!apm) {
      throw new Error(`Unknown integration: ${integration}`);
    }

    this.config[integration] = {
      ...credentials,
      enabled: true,
      configuredAt: Date.now()
    };

    if (!this.activeIntegrations.includes(integration)) {
      this.activeIntegrations.push(integration);
    }

    this.notifyListeners();
    return true;
  }

  /**
   * Check if an integration is configured
   */
  isConfigured(integration) {
    return this.config[integration]?.enabled === true;
  }

  /**
   * Get configured integrations
   */
  getConfiguredIntegrations() {
    return this.activeIntegrations.map(id => ({
      ...APM_INTEGRATIONS[id],
      configured: true,
      configuredAt: this.config[id]?.configuredAt
    }));
  }

  /**
   * Fetch insights for a file
   */
  async getInsightsForFile(filePath) {
    // Check cache first
    const cached = this.cachedInsights.get(filePath);
    if (cached && Date.now() - cached.fetchedAt < 300000) { // 5 min cache
      return cached.data;
    }

    // In real implementation, would fetch from APM APIs
    // For now, return mock data
    const insights = await this.fetchFromAPM(filePath);
    
    if (insights) {
      this.cachedInsights.set(filePath, {
        data: insights,
        fetchedAt: Date.now()
      });
    }

    return insights;
  }

  /**
   * Fetch data from APM (mock implementation)
   */
  async fetchFromAPM(filePath) {
    // Simulate API delay
    await new Promise(resolve => setTimeout(resolve, 100));

    // Return mock data if available
    const mockPath = Object.keys(MOCK_INSIGHTS).find(p => filePath.includes(p));
    if (mockPath) {
      return this.formatInsights(MOCK_INSIGHTS[mockPath], filePath);
    }

    // Generate random data for demo
    return this.formatInsights({
      errorRate: Math.random() * 0.05,
      avgLatency: Math.floor(Math.random() * 500) + 50,
      p99Latency: Math.floor(Math.random() * 2000) + 200,
      callsPerDay: Math.floor(Math.random() * 50000),
      recentErrors: [],
      hotspots: []
    }, filePath);
  }

  /**
   * Format raw insights data
   */
  formatInsights(raw, filePath) {
    const insights = {
      filePath,
      summary: {
        health: this.calculateHealth(raw),
        errorRate: raw.errorRate,
        errorRateFormatted: `${(raw.errorRate * 100).toFixed(2)}%`,
        avgLatency: raw.avgLatency,
        avgLatencyFormatted: `${raw.avgLatency}ms`,
        p99Latency: raw.p99Latency,
        p99LatencyFormatted: `${raw.p99Latency}ms`,
        callsPerDay: raw.callsPerDay,
        callsFormatted: this.formatNumber(raw.callsPerDay)
      },
      errors: raw.recentErrors || [],
      hotspots: raw.hotspots || [],
      recommendations: this.generateRecommendations(raw),
      trends: this.generateTrends(raw),
      fetchedAt: Date.now()
    };

    return insights;
  }

  /**
   * Calculate health score
   */
  calculateHealth(data) {
    let score = 100;

    // Error rate impact
    if (data.errorRate > 0.05) score -= 40;
    else if (data.errorRate > 0.01) score -= 20;
    else if (data.errorRate > 0.001) score -= 5;

    // Latency impact
    if (data.avgLatency > 1000) score -= 30;
    else if (data.avgLatency > 500) score -= 15;
    else if (data.avgLatency > 200) score -= 5;

    // P99 impact
    if (data.p99Latency > 5000) score -= 20;
    else if (data.p99Latency > 2000) score -= 10;

    return {
      score: Math.max(0, score),
      status: score >= 80 ? 'healthy' : score >= 60 ? 'warning' : 'critical',
      color: score >= 80 ? 'green' : score >= 60 ? 'amber' : 'red'
    };
  }

  /**
   * Generate recommendations based on data
   */
  generateRecommendations(data) {
    const recommendations = [];

    if (data.errorRate > 0.01) {
      recommendations.push({
        type: 'error_rate',
        severity: 'high',
        title: 'High Error Rate',
        description: `Error rate of ${(data.errorRate * 100).toFixed(2)}% is above threshold`,
        action: 'Review recent error patterns and add error handling'
      });
    }

    if (data.avgLatency > 200) {
      recommendations.push({
        type: 'latency',
        severity: data.avgLatency > 500 ? 'high' : 'medium',
        title: 'Elevated Latency',
        description: `Average latency of ${data.avgLatency}ms may impact UX`,
        action: 'Profile slow operations and consider caching'
      });
    }

    if (data.p99Latency > data.avgLatency * 5) {
      recommendations.push({
        type: 'variance',
        severity: 'medium',
        title: 'High Latency Variance',
        description: 'P99 significantly higher than average indicates inconsistent performance',
        action: 'Investigate outliers and timeout handling'
      });
    }

    if (data.hotspots?.length > 0) {
      const slowest = data.hotspots.reduce((a, b) => a.latency > b.latency ? a : b);
      recommendations.push({
        type: 'hotspot',
        severity: 'medium',
        title: `Performance Hotspot: ${slowest.method}`,
        description: `Line ${slowest.line} has ${slowest.latency}ms latency with ${this.formatNumber(slowest.calls)} daily calls`,
        action: 'Optimize or cache this operation'
      });
    }

    return recommendations;
  }

  /**
   * Generate trend data (mock)
   */
  generateTrends(data) {
    // Generate last 7 days of mock data
    const days = 7;
    const latencyTrend = [];
    const errorTrend = [];

    for (let i = days - 1; i >= 0; i--) {
      const date = new Date();
      date.setDate(date.getDate() - i);
      
      latencyTrend.push({
        date: date.toISOString().split('T')[0],
        value: data.avgLatency + (Math.random() - 0.5) * 100
      });
      
      errorTrend.push({
        date: date.toISOString().split('T')[0],
        value: data.errorRate + (Math.random() - 0.5) * 0.01
      });
    }

    return { latencyTrend, errorTrend };
  }

  /**
   * Format large numbers
   */
  formatNumber(num) {
    if (num >= 1000000) return `${(num / 1000000).toFixed(1)}M`;
    if (num >= 1000) return `${(num / 1000).toFixed(1)}K`;
    return num.toString();
  }

  /**
   * Get function-level insights
   */
  async getFunctionInsights(filePath, functionName) {
    const fileInsights = await this.getInsightsForFile(filePath);
    if (!fileInsights) return null;

    const hotspot = fileInsights.hotspots.find(h => h.method === functionName);
    
    return {
      functionName,
      ...hotspot,
      errors: fileInsights.errors.filter(e => 
        e.message.toLowerCase().includes(functionName.toLowerCase())
      )
    };
  }

  /**
   * Search for anomalies
   */
  async detectAnomalies() {
    const anomalies = [];
    
    for (const [filePath, cached] of this.cachedInsights) {
      const insights = cached.data;
      
      // Check for sudden spikes
      if (insights.summary.errorRate > 0.05) {
        anomalies.push({
          type: 'error_spike',
          severity: 'critical',
          filePath,
          message: `High error rate detected: ${insights.summary.errorRateFormatted}`
        });
      }
      
      if (insights.summary.p99Latency > 5000) {
        anomalies.push({
          type: 'latency_spike',
          severity: 'high',
          filePath,
          message: `P99 latency spike: ${insights.summary.p99LatencyFormatted}`
        });
      }
    }

    return anomalies;
  }

  /**
   * Sync all insights
   */
  async syncAll() {
    this.lastSync = Date.now();
    // In real implementation, would refresh all cached insights
    this.notifyListeners();
  }

  /**
   * Clear cache
   */
  clearCache() {
    this.cachedInsights.clear();
    this.notifyListeners();
  }

  /**
   * Disconnect integration
   */
  disconnect(integration) {
    delete this.config[integration];
    this.activeIntegrations = this.activeIntegrations.filter(i => i !== integration);
    this.notifyListeners();
  }

  /**
   * Add listener
   */
  addListener(callback) {
    this.listeners.add(callback);
    return () => this.listeners.delete(callback);
  }

  /**
   * Notify listeners
   */
  notifyListeners() {
    const state = {
      isConnected: this.activeIntegrations.length > 0,
      integrations: this.getConfiguredIntegrations(),
      lastSync: this.lastSync
    };
    
    this.listeners.forEach(callback => {
      try {
        callback(state);
      } catch (error) {
        console.error('Production insights listener error:', error);
      }
    });
  }
}

// Singleton
let instance = null;

export function getProductionInsights() {
  if (!instance) {
    instance = new ProductionInsights();
  }
  return instance;
}

export { APM_INTEGRATIONS, INSIGHT_TYPES };
export default ProductionInsights;
