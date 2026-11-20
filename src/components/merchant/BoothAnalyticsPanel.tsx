import React, { useMemo, useState } from 'react';
import {
  Bar,
  BarChart,
  CartesianGrid,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts';
import {
  Award,
  BarChart3,
  Clock,
  Lock,
  Repeat,
  ShoppingBag,
  TrendingUp,
} from 'lucide-react';
import { formatIdr } from '../../lib/ledgerEngine';
import type { DemoSeedDataset, Event, Tenant } from '../../types/types';

interface BoothAnalyticsPanelProps {
  event: Event;
  tenant: Tenant;
  dataset: DemoSeedDataset;
}

interface HourlyBucket {
  hourLabel: string;
  orders: number;
  salesIdr: number;
}

export const BoothAnalyticsPanel: React.FC<BoothAnalyticsPanelProps> = ({
  event,
  tenant,
  dataset,
}) => {
  const [chartMetric, setChartMetric] = useState<'salesIdr' | 'orders'>('salesIdr');

  const analytics = useMemo(() => {
    const boothTxs = dataset.transactions.filter(
      (tx) => tx.event_id === event.id && tx.tenant_id === tenant.id
    );
    const completedTxs = boothTxs.filter((tx) => tx.status === 'completed');
    const voidedCount = boothTxs.length - completedTxs.length;

    // Strictly real actual_amount_idr (never multiplied leaderboard score)
    const totalSalesIdr = completedTxs.reduce(
      (sum, tx) => sum + tx.actual_amount_idr,
      0
    );
    const totalOrders = completedTxs.length;
    const avgOrderIdr = totalOrders > 0 ? Math.round(totalSalesIdr / totalOrders) : 0;

    // Repeat-Buyer Rate (%)
    const ordersPerBuyer = new Map<string, number>();
    for (const tx of completedTxs) {
      ordersPerBuyer.set(
        tx.participant_id,
        (ordersPerBuyer.get(tx.participant_id) ?? 0) + 1
      );
    }
    const uniqueBuyers = ordersPerBuyer.size;
    let repeatBuyers = 0;
    for (const count of ordersPerBuyer.values()) {
      if (count >= 2) repeatBuyers += 1;
    }
    const repeatBuyerRatePct =
      uniqueBuyers > 0 ? Math.round((repeatBuyers / uniqueBuyers) * 100) : 0;

    // Hourly Peak Traffic Bar Chart buckets
    const hourBucketsMap = new Map<number, HourlyBucket>();
    for (const tx of completedTxs) {
      const hour = new Date(tx.created_at).getHours();
      const existing = hourBucketsMap.get(hour) ?? {
        hourLabel: `${String(hour).padStart(2, '0')}:00`,
        orders: 0,
        salesIdr: 0,
      };
      existing.orders += 1;
      existing.salesIdr += tx.actual_amount_idr;
      hourBucketsMap.set(hour, existing);
    }

    const hourlySeries: HourlyBucket[] = Array.from(hourBucketsMap.entries())
      .sort(([hA], [hB]) => hA - hB)
      .map(([, bucket]) => bucket);

    const peakHourBucket = hourlySeries.reduce<HourlyBucket | null>(
      (best, cur) => (!best || cur.orders > best.orders ? cur : best),
      null
    );

    const uniqueStamps = dataset.stamps.filter(
      (s) =>
        s.event_id === event.id &&
        s.tenant_id === tenant.id &&
        s.stamp_type === 'booth'
    ).length;

    return {
      totalSalesIdr,
      totalOrders,
      voidedCount,
      avgOrderIdr,
      uniqueBuyers,
      repeatBuyers,
      repeatBuyerRatePct,
      uniqueStamps,
      hourlySeries,
      peakHourBucket,
    };
  }, [dataset.transactions, dataset.stamps, event.id, tenant.id]);

  return (
    <div className="space-y-6">
      {/* Scope & Truth Header */}
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div>
          <h2 className="text-lg font-bold text-white">
            {tenant.booth_name} &mdash; Event Analytics
          </h2>
          <p className="text-xs text-slate-400">
            Strictly scoped to <strong>{event.name}</strong> ({tenant.booth_number}).
          </p>
        </div>
        <span className="inline-flex items-center gap-1.5 rounded-full border border-emerald-500/35 bg-emerald-500/10 px-3 py-1 text-[11px] font-semibold text-emerald-300">
          <Lock className="h-3 w-3" />
          Real Revenue (actual_spent_idr only)
        </span>
      </div>

      {/* 4 Core KPI Cards */}
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <div className="rounded-2xl border border-slate-800 bg-slate-900/85 p-5">
          <div className="flex items-center justify-between text-xs font-semibold uppercase tracking-wider text-slate-400">
            <span>Total Event Sales</span>
            <TrendingUp className="h-4 w-4 text-emerald-400" />
          </div>
          <p className="mt-2 text-2xl font-extrabold text-emerald-300">
            {formatIdr(analytics.totalSalesIdr)}
          </p>
          <p className="mt-1 text-xs text-slate-400">
            Exact unmultiplied IDR earned at this booth
          </p>
        </div>

        <div className="rounded-2xl border border-slate-800 bg-slate-900/85 p-5">
          <div className="flex items-center justify-between text-xs font-semibold uppercase tracking-wider text-slate-400">
            <span>Total Orders</span>
            <ShoppingBag className="h-4 w-4 text-indigo-400" />
          </div>
          <p className="mt-2 text-2xl font-extrabold text-white">
            {analytics.totalOrders}
          </p>
          <p className="mt-1 text-xs text-slate-400">
            {analytics.uniqueStamps} unique stamps issued
            {analytics.voidedCount > 0 ? ` • ${analytics.voidedCount} voided` : ''}
          </p>
        </div>

        <div className="rounded-2xl border border-slate-800 bg-slate-900/85 p-5">
          <div className="flex items-center justify-between text-xs font-semibold uppercase tracking-wider text-slate-400">
            <span>Avg Transaction Size</span>
            <Award className="h-4 w-4 text-amber-400" />
          </div>
          <p className="mt-2 text-2xl font-extrabold text-amber-300">
            {formatIdr(analytics.avgOrderIdr)}
          </p>
          <p className="mt-1 text-xs text-slate-400">
            Across {analytics.uniqueBuyers} unique buyer(s)
          </p>
        </div>

        <div className="rounded-2xl border border-slate-800 bg-slate-900/85 p-5">
          <div className="flex items-center justify-between text-xs font-semibold uppercase tracking-wider text-slate-400">
            <span>Repeat-Buyer Rate</span>
            <Repeat className="h-4 w-4 text-sky-400" />
          </div>
          <p className="mt-2 text-2xl font-extrabold text-sky-300">
            {analytics.repeatBuyerRatePct}%
          </p>
          <p className="mt-1 text-xs text-slate-400">
            {analytics.repeatBuyers} of {analytics.uniqueBuyers} buyers returned
          </p>
        </div>
      </div>

      {/* Hourly Peak Traffic Recharts Bar Chart */}
      <div className="rounded-2xl border border-slate-800 bg-slate-900/85 p-6 shadow-xl">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div className="flex items-center gap-2">
            <BarChart3 className="h-5 w-5 text-indigo-400" />
            <div>
              <h3 className="text-base font-bold text-white">
                Hourly Peak Traffic
              </h3>
              {analytics.peakHourBucket && (
                <p className="flex items-center gap-1 text-xs text-slate-400">
                  <Clock className="h-3 w-3 text-amber-400" />
                  Peak hour: <strong className="text-white">{analytics.peakHourBucket.hourLabel}</strong> (
                  {analytics.peakHourBucket.orders} orders &middot;{' '}
                  {formatIdr(analytics.peakHourBucket.salesIdr)})
                </p>
              )}
            </div>
          </div>

          <div className="inline-flex rounded-xl border border-slate-700 bg-slate-950 p-0.5 text-xs">
            <button
              type="button"
              onClick={() => setChartMetric('salesIdr')}
              className={`rounded-lg px-3 py-1 font-semibold transition ${
                chartMetric === 'salesIdr'
                  ? 'bg-emerald-600 text-white'
                  : 'text-slate-400 hover:text-white'
              }`}
            >
              Sales (IDR)
            </button>
            <button
              type="button"
              onClick={() => setChartMetric('orders')}
              className={`rounded-lg px-3 py-1 font-semibold transition ${
                chartMetric === 'orders'
                  ? 'bg-indigo-600 text-white'
                  : 'text-slate-400 hover:text-white'
              }`}
            >
              Order Count
            </button>
          </div>
        </div>

        <div className="mt-6 h-72 w-full">
          {analytics.hourlySeries.length === 0 ? (
            <div className="flex h-full items-center justify-center rounded-xl border border-dashed border-slate-800 text-xs text-slate-500">
              Complete your first booth transaction to plot hourly traffic.
            </div>
          ) : (
            <ResponsiveContainer width="100%" height="100%">
              <BarChart
                data={analytics.hourlySeries}
                margin={{ top: 10, right: 12, left: 8, bottom: 4 }}
              >
                <CartesianGrid strokeDasharray="3 3" stroke="#1e293b" vertical={false} />
                <XAxis
                  dataKey="hourLabel"
                  stroke="#94a3b8"
                  fontSize={12}
                  tickLine={false}
                  axisLine={{ stroke: '#334155' }}
                />
                <YAxis
                  stroke="#94a3b8"
                  fontSize={11}
                  tickLine={false}
                  axisLine={false}
                  allowDecimals={false}
                  tickFormatter={(val: number) =>
                    chartMetric === 'salesIdr'
                      ? `${Math.round(val / 1000)}k`
                      : String(val)
                  }
                />
                <Tooltip
                  cursor={{ fill: 'rgba(148, 163, 184, 0.08)' }}
                  contentStyle={{
                    backgroundColor: '#0f172a',
                    borderColor: '#334155',
                    borderRadius: '0.75rem',
                    fontSize: '12px',
                    color: '#f8fafc',
                  }}
                  formatter={(value: unknown) => {
                    const num = typeof value === 'number' ? value : Number(value ?? 0);
                    return chartMetric === 'salesIdr'
                      ? [formatIdr(num), 'Real Sales']
                      : [`${num} orders`, 'Orders'];
                  }}
                />
                <Bar
                  dataKey={chartMetric}
                  fill={chartMetric === 'salesIdr' ? '#10b981' : '#6366f1'}
                  radius={[8, 8, 0, 0]}
                  maxBarSize={56}
                />
              </BarChart>
            </ResponsiveContainer>
          )}
        </div>
      </div>
    </div>
  );
};