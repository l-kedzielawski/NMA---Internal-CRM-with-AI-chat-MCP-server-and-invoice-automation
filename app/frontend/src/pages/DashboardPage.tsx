import { useEffect, useState } from 'react';
import { TrendingUp, DollarSign, Boxes, CalendarDays, AlertTriangle, RefreshCw, Link, Plus, Loader2 } from 'lucide-react';
import { crmApi, invoicesApi, productsApi } from '../services/api';
import {
  ResponsiveContainer,
  ComposedChart,
  CartesianGrid,
  XAxis,
  YAxis,
  Tooltip,
  Legend,
  Bar,
  Line,
} from 'recharts';
import type {
  CrmDashboardSummaryResponse,
  DashboardMonthlyComboPoint,
  DashboardSummaryResponse,
  StorageSummaryRow,
} from '../types';
import { LoadingState } from '../components/LoadingState';
import toast from 'react-hot-toast';
import { useAuth } from '../contexts/AuthContext';

interface ProductStatsRow {
  id: number;
  nazwa: string;
  sku: string | null;
  jednostka: string | null;
  times_sold: number;
  total_quantity: number;
  avg_margin: number | null;
  total_profit: number | null;
  remaining_quantity: number | null;
}

interface OrphanItem {
  id: number;
  invoice_id: number;
  lp: number;
  nazwa: string;
  ilosc: number;
  jednostka: string;
  cena_netto: number;
  wartosc_netto: number;
  cena_zakupu: number | null;
  zysk: number | null;
  marza_procent: number | null;
  numer_faktury: string;
  data_wystawienia: string;
  customer_nazwa: string;
}

export function DashboardPage() {
  const { user } = useAuth();
  const isAdmin = user?.role === 'admin';
  const canViewCrmPulse = user?.role === 'admin' || user?.role === 'manager';
  const [stats, setStats] = useState({
    totalInvoices: 0,
    totalUnpaidInvoices: 0,
    totalNetRevenue: 0,
    totalGrossRevenue: 0,
    totalPaidRevenue: 0,
    totalOpenReceivables: 0,
    totalPaidRatio: 0,
    totalProfit: 0,
    weightedMargin: 0,
    myInvoices: 0,
    myNetRevenue: 0,
    myProfit: 0,
    myCommissionEstimated: 0,
    myCommissionActual: 0,
    myCommissionGap: 0,
    myMargin: 0,
    totalProducts: 0,
    productsWithoutPrice: 0,
    productsWithoutStock: 0,
    productsNeverSold: 0,
    productsAtRisk: 0,
  });
  const [dashboardSummary, setDashboardSummary] = useState<DashboardSummaryResponse | null>(null);
  const [monthlyDashboardSummary, setMonthlyDashboardSummary] = useState<DashboardSummaryResponse | null>(null);
  const [monthlyComboData, setMonthlyComboData] = useState<DashboardMonthlyComboPoint[]>([]);
  const [monthlyComboScopeLabel, setMonthlyComboScopeLabel] = useState<string>('My portfolio');
  const [selectedComboOwner, setSelectedComboOwner] = useState<string>('mine');
  const [crmDashboardSummary, setCrmDashboardSummary] = useState<CrmDashboardSummaryResponse | null>(null);
  const [storageRows, setStorageRows] = useState<StorageSummaryRow[]>([]);
  const [topSellingRows, setTopSellingRows] = useState<StorageSummaryRow[]>([]);
  const [riskRows, setRiskRows] = useState<StorageSummaryRow[]>([]);
  const [topProfitRows, setTopProfitRows] = useState<ProductStatsRow[]>([]);
  const [storagePeriod, setStoragePeriod] = useState<'30d' | '90d' | '365d'>('90d');
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [orphanItems, setOrphanItems] = useState<OrphanItem[]>([]);
  const [creatingProductId, setCreatingProductId] = useState<number | null>(null);
  const [creatingAllProducts, setCreatingAllProducts] = useState(false);
  const [recalcPreview, setRecalcPreview] = useState<{
    invoice_ids_count: number;
    invoices_total: number;
    invoices_negative: number;
    total_profit: number;
    item_price_mismatches: number;
    non_pln_invoices: number;
    requires_confirmation_text: string;
  } | null>(null);
  const [previewLoading, setPreviewLoading] = useState(false);
  const [runningBulkRecalc, setRunningBulkRecalc] = useState(false);

  useEffect(() => {
    loadDashboardData();
  }, [storagePeriod, canViewCrmPulse, selectedComboOwner]);

  useEffect(() => {
    const handleFocus = () => {
      loadDashboardData();
    };
    window.addEventListener('focus', handleFocus);
    return () => window.removeEventListener('focus', handleFocus);
  }, []);

  useEffect(() => {
    if (isAdmin) {
      void loadRecalculationPreview();
    }
  }, [isAdmin]);

  const loadDashboardData = async (isRefresh = false) => {
    try {
      if (isRefresh) {
        setRefreshing(true);
      } else {
        setLoading(true);
      }
      setError(null);
      const daysBack = storagePeriod === '30d' ? 30 : storagePeriod === '365d' ? 365 : 90;
      const dateFrom = new Date();
      dateFrom.setDate(dateFrom.getDate() - daysBack);
      const monthStart = new Date();
      monthStart.setDate(1);
      monthStart.setHours(0, 0, 0, 0);
      const monthEnd = new Date(monthStart.getFullYear(), monthStart.getMonth() + 1, 0);
      monthEnd.setHours(23, 59, 59, 999);
      const crmSummaryPromise = canViewCrmPulse
        ? crmApi.getDashboardSummary().catch((crmError) => {
            console.error('Error loading CRM dashboard summary:', crmError);
            return null;
          })
        : Promise.resolve(null);
      const selectedOwnerId = selectedComboOwner !== 'mine'
        ? Number(selectedComboOwner)
        : null;

      const [
        dashboardRes,
        dashboardMonthlyRes,
        monthlyComboRes,
        crmSummaryRes,
        storageRes,
        allProductsRes,
        missingPriceRes,
        productStatsRes,
        orphanRes
      ] = await Promise.all([
        invoicesApi.getDashboardSummary(),
        invoicesApi.getDashboardSummary({
          data_od: monthStart.toISOString().slice(0, 10),
          data_do: monthEnd.toISOString().slice(0, 10),
        }),
        invoicesApi.getMonthlyCombo({
          months: 12,
          ...(selectedOwnerId ? { owner_id: selectedOwnerId } : {}),
        }),
        crmSummaryPromise,
        invoicesApi.getStorageSummary({
          data_od: dateFrom.toISOString().slice(0, 10)
        }),
        productsApi.getAll(),
        productsApi.getAll({ missing_price: true }),
        productsApi.getStats(),
        invoicesApi.getOrphanItems()
      ]);

      const summaryData = dashboardRes.data;
      const monthlySummaryData = dashboardMonthlyRes.data;
      const monthlyComboTrendData = monthlyComboRes.data.data || [];
      const monthlyComboScope = monthlyComboRes.data.selected_scope;
      const crmSummaryData = crmSummaryRes?.data || null;
      const storageData = storageRes.data.data || [];
      const allProducts = allProductsRes.data || [];
      const missingPrice = missingPriceRes.data || [];
      const productStats = (productStatsRes.data || []) as ProductStatsRow[];
      const orphanItemsData = orphanRes.data.data || [];

      const totalNetRevenue = Number(summaryData.totals.sales_net || 0);
      const totalGrossRevenue = Number(summaryData.totals.sales_gross || 0);
      const totalPaidRevenue = Number(summaryData.totals.paid_total || 0);
      const totalOpenReceivables = Number(summaryData.totals.receivables_open || 0);
      const totalPaidRatio = Number(summaryData.totals.paid_ratio || 0);
      const totalProfit = Number(summaryData.totals.profit_total || 0);
      const weightedMargin = Number(summaryData.totals.margin_weighted || 0);
      const mySummary = summaryData.my_summary;
      const productsWithoutStock = allProducts.filter((p) => p.stan_magazynowy == null).length;
      const productsNeverSold = storageData.filter((row) => Number(row.sold_quantity || 0) === 0).length;
      const productsAtRisk = storageData.filter((row) => Number(row.estimated_remaining || 0) < 0).length;

      const topSelling = [...storageData]
        .filter((row) => Number(row.sold_quantity || 0) > 0)
        .sort((a, b) => Number(b.sold_quantity || 0) - Number(a.sold_quantity || 0))
        .slice(0, 8);

      const atRiskRows = [...storageData]
        .filter((row) => Number(row.estimated_remaining || 0) < 0)
        .sort((a, b) => Number(a.estimated_remaining || 0) - Number(b.estimated_remaining || 0))
        .slice(0, 8);

      const topProfit = [...productStats]
        .sort((a, b) => Number(b.total_profit || 0) - Number(a.total_profit || 0))
        .slice(0, 8);

      setStats({
        totalInvoices: Number(summaryData.totals.invoice_count || 0),
        totalUnpaidInvoices: Number(summaryData.totals.unpaid_invoice_count || 0),
        totalNetRevenue,
        totalGrossRevenue,
        totalPaidRevenue,
        totalOpenReceivables,
        totalPaidRatio,
        totalProfit,
        weightedMargin,
        myInvoices: Number(mySummary.invoice_count || 0),
        myNetRevenue: Number(mySummary.sales_net || 0),
        myProfit: Number(mySummary.profit_total || 0),
        myCommissionEstimated: Number(mySummary.commission_estimated || 0),
        myCommissionActual: Number(mySummary.commission_actual || 0),
        myCommissionGap: Number(mySummary.commission_gap || 0),
        myMargin: Number(mySummary.margin_weighted || 0),
        totalProducts: allProducts.length,
        productsWithoutPrice: missingPrice.length,
        productsWithoutStock,
        productsNeverSold,
        productsAtRisk,
      });
      setDashboardSummary(summaryData);
      setMonthlyDashboardSummary(monthlySummaryData);
      setMonthlyComboData(monthlyComboTrendData);
      setMonthlyComboScopeLabel(monthlyComboScope?.owner_label || 'My portfolio');
      setCrmDashboardSummary(crmSummaryData);
      setStorageRows(storageData);
      setTopSellingRows(topSelling);
      setRiskRows(atRiskRows);
      setTopProfitRows(topProfit);
      setOrphanItems(orphanItemsData);
    } catch (err: any) {
      console.error('Error loading dashboard data:', err);
      setError(err?.message || 'Error loading data');
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  };

  const createProductFromOrphanItem = async (itemId: number) => {
    try {
      setCreatingProductId(itemId);
      const response = await invoicesApi.createProductFromOrphanItem(itemId);
      toast.success(response.data.was_created 
        ? `Created product "${response.data.product_name}"` 
        : `Linked to existing product "${response.data.product_name}"`
      );
      setOrphanItems((current) => current.filter((item) => item.id !== itemId));
    } catch (err: any) {
      console.error('Error creating product from orphan item:', err);
      toast.error(err?.response?.data?.error || 'Failed to create product');
    } finally {
      setCreatingProductId(null);
    }
  };

  const createProductsFromAllOrphans = async () => {
    try {
      setCreatingAllProducts(true);
      const response = await invoicesApi.createProductsFromAllOrphans();
      toast.success(
        `Processed ${response.data.total_processed} items: ${response.data.created_count} created, ${response.data.linked_count} linked`
      );
      setOrphanItems([]);
    } catch (err: any) {
      console.error('Error creating products from all orphan items:', err);
      toast.error(err?.response?.data?.error || 'Failed to create products');
    } finally {
      setCreatingAllProducts(false);
    }
  };

  const loadRecalculationPreview = async () => {
    try {
      setPreviewLoading(true);
      const response = await invoicesApi.getRecalculateAllPreview();
      setRecalcPreview(response.data);
    } catch (err: any) {
      console.error('Error loading bulk recalculation preview:', err);
      toast.error(err?.response?.data?.error || 'Failed to load recalculation preview');
    } finally {
      setPreviewLoading(false);
    }
  };

  const runBulkRecalculation = async () => {
    if (!recalcPreview) {
      toast.error('Load preview first');
      return;
    }

    const requiredText = recalcPreview.requires_confirmation_text || 'RECALCULATE_ALL';
    const enteredText = window.prompt(`Type ${requiredText} to confirm full invoice recalculation:`);
    if (!enteredText) return;

    if (enteredText.trim() !== requiredText) {
      toast.error('Confirmation text does not match');
      return;
    }

    try {
      setRunningBulkRecalc(true);
      const response = await invoicesApi.recalculateAllInvoices(requiredText);
      const result = response.data;
      toast.success(
        `Done: synced ${result.recalculation.item_prices_backfilled} item prices, recalculated ${result.recalculation.invoices_recalculated} invoices`
      );
      await Promise.all([loadDashboardData(true), loadRecalculationPreview()]);
    } catch (err: any) {
      console.error('Error running bulk recalculation:', err);
      toast.error(err?.response?.data?.error || 'Failed to run recalculation');
    } finally {
      setRunningBulkRecalc(false);
    }
  };

  const mtdTotals = {
    invoiceCount: Number(monthlyDashboardSummary?.totals?.invoice_count || 0),
    unpaidInvoiceCount: Number(monthlyDashboardSummary?.totals?.unpaid_invoice_count || 0),
    salesNet: Number(monthlyDashboardSummary?.totals?.sales_net || 0),
    salesGross: Number(monthlyDashboardSummary?.totals?.sales_gross || 0),
    paidTotal: Number(monthlyDashboardSummary?.totals?.paid_total || 0),
    receivablesOpen: Number(monthlyDashboardSummary?.totals?.receivables_open || 0),
    paidRatio: Number(monthlyDashboardSummary?.totals?.paid_ratio || 0),
    profitTotal: Number(monthlyDashboardSummary?.totals?.profit_total || 0),
    marginWeighted: Number(monthlyDashboardSummary?.totals?.margin_weighted || 0),
  };

  const mtdMy = {
    invoices: Number(monthlyDashboardSummary?.my_summary?.invoice_count || 0),
    netSales: Number(monthlyDashboardSummary?.my_summary?.sales_net || 0),
    profit: Number(monthlyDashboardSummary?.my_summary?.profit_total || 0),
    margin: Number(monthlyDashboardSummary?.my_summary?.margin_weighted || 0),
    earningsEstimated: Number(monthlyDashboardSummary?.my_summary?.commission_estimated || 0),
  };

  if (loading) {
    return <LoadingState message="Loading dashboard data..." />;
  }

  if (error) {
    return (
      <div className="card bg-red-50 border-red-200">
        <h2 className="text-xl font-bold text-danger mb-2">Error</h2>
        <p className="text-danger">{error}</p>
        <button 
          onClick={() => loadDashboardData()}
          className="btn-primary mt-4"
        >
          Try Again
        </button>
      </div>
    );
  }

  const currentMonthLabel = new Intl.DateTimeFormat(undefined, {
    month: 'long',
    year: 'numeric',
  }).format(new Date());

  const formatPln = (value: number): string => `${Number(value || 0).toLocaleString('en-US', {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  })} PLN`;

  const financePulseCards = [
    {
      title: 'Invoice Overview',
      icon: DollarSign,
      color: 'bg-blue-100 text-blue-600',
      allTime: [
        { label: 'Unpaid / Total', value: `${stats.totalUnpaidInvoices} / ${stats.totalInvoices}` },
      ],
      mtd: [
        { label: 'Unpaid / Total', value: `${mtdTotals.unpaidInvoiceCount} / ${mtdTotals.invoiceCount}` },
      ],
    },
    {
      title: 'Sales',
      icon: DollarSign,
      color: 'bg-emerald-100 text-emerald-600',
      allTime: [
        { label: 'Net Sales', value: `${stats.totalNetRevenue.toFixed(2)} PLN` },
        { label: 'Brutto Sales', value: `${stats.totalGrossRevenue.toFixed(2)} PLN` },
        { label: 'My Sales', value: `${stats.myNetRevenue.toFixed(2)} PLN` },
      ],
      mtd: [
        { label: 'Net Sales', value: `${mtdTotals.salesNet.toFixed(2)} PLN` },
        { label: 'Brutto Sales', value: `${mtdTotals.salesGross.toFixed(2)} PLN` },
        { label: 'My Sales', value: `${mtdMy.netSales.toFixed(2)} PLN` },
      ],
    },
    {
      title: 'Profit',
      icon: TrendingUp,
      color: 'bg-green-100 text-green-600',
      allTime: [
        { label: 'Total Profit', value: `${stats.totalProfit.toFixed(2)} PLN` },
        { label: 'My Earnings', value: `${stats.myCommissionEstimated.toFixed(2)} PLN` },
      ],
      mtd: [
        { label: 'Total Profit', value: `${mtdTotals.profitTotal.toFixed(2)} PLN` },
        { label: 'My Earnings', value: `${mtdMy.earningsEstimated.toFixed(2)} PLN` },
      ],
    },
    {
      title: 'Margins',
      icon: TrendingUp,
      color: 'bg-indigo-100 text-indigo-600',
      allTime: [
        { label: 'Weighted Margin', value: `${stats.weightedMargin.toFixed(2)}%` },
        { label: 'My Margin', value: `${stats.myMargin.toFixed(2)}%` },
      ],
      mtd: [
        { label: 'Weighted Margin', value: `${mtdTotals.marginWeighted.toFixed(2)}%` },
        { label: 'My Margin', value: `${mtdMy.margin.toFixed(2)}%` },
      ],
    },
  ];

  const crmTeamSummary = (crmDashboardSummary?.team || []).reduce(
    (acc, member) => {
      acc.tasksDone += Number(member.tasks_completed_mtd || 0);
      acc.activities += Number(member.activities_mtd || 0);
      acc.meetings += Number(member.meetings_mtd || 0);
      acc.next7d += Number(member.tasks_next_7d || 0);
      return acc;
    },
    { tasksDone: 0, activities: 0, meetings: 0, next7d: 0 }
  );

  const crmPulseCards = crmDashboardSummary
    ? [
        {
          title: 'Pipeline Health',
          icon: CalendarDays,
          color: 'bg-cyan-100 text-cyan-700',
          current: [
            { label: 'All Leads', value: String(crmDashboardSummary.pipeline.all) },
            { label: 'In Talks', value: String(crmDashboardSummary.pipeline.talks) },
            { label: 'Won / Lost', value: `${crmDashboardSummary.pipeline.won} / ${crmDashboardSummary.pipeline.lost}` },
          ],
          mtd: [{ label: 'New Leads', value: String(crmDashboardSummary.kpis.new_leads_mtd) }],
        },
        {
          title: 'Team Output',
          icon: Boxes,
          color: 'bg-emerald-100 text-emerald-700',
          current: [{ label: 'Next 7d Tasks', value: String(crmTeamSummary.next7d) }],
          mtd: [
            { label: 'Tasks Done', value: String(crmTeamSummary.tasksDone) },
            { label: 'Activities', value: String(crmTeamSummary.activities) },
            { label: 'Meetings', value: String(crmTeamSummary.meetings) },
          ],
        },
        {
          title: 'Conversion',
          icon: TrendingUp,
          color: 'bg-blue-100 text-blue-700',
          current: [{ label: 'Win Rate (MTD)', value: `${crmDashboardSummary.kpis.win_rate_mtd.toFixed(2)}%` }],
          mtd: [
            { label: 'Won', value: String(crmDashboardSummary.kpis.won_mtd) },
            { label: 'Lost', value: String(crmDashboardSummary.kpis.lost_mtd) },
            { label: 'Win Rate', value: `${crmDashboardSummary.kpis.win_rate_mtd.toFixed(2)}%` },
          ],
        },
        {
          title: 'Risk Now',
          icon: AlertTriangle,
          color: 'bg-amber-100 text-amber-700',
          current: [
            { label: 'Overdue Tasks', value: String(crmDashboardSummary.kpis.overdue_tasks) },
            { label: 'No Next Step', value: String(crmDashboardSummary.kpis.no_next_step) },
            { label: 'Dormant 14d', value: String(crmDashboardSummary.kpis.dormant_14d) },
          ],
          mtd: [{ label: 'Period', value: crmDashboardSummary.period.label }],
        },
      ]
    : [];

  const monthlyEstimatedBySeller = new Map<string, number>();
  (monthlyDashboardSummary?.sellers || []).forEach((row) => {
    const key = row.owner_id !== null
      ? `id:${row.owner_id}`
      : `name:${String(row.owner_label || '').trim().toLowerCase()}`;
    monthlyEstimatedBySeller.set(key, Number(row.commission_estimated || 0));
  });

  const selectableOwners = Array.from(
    new Map(
      (dashboardSummary?.sellers || [])
        .filter((row) => row.owner_id !== null)
        .map((row) => [Number(row.owner_id), String(row.owner_label || `Owner #${row.owner_id}`)])
    )
  ).map(([ownerId, ownerLabel]) => ({ ownerId, ownerLabel }));

  return (
    <div>
      <div className="flex justify-between items-center mb-6">
        <h2 className="text-2xl font-bold">Dashboard</h2>
        <button
          onClick={() => loadDashboardData(true)}
          disabled={refreshing}
          className="btn-secondary flex items-center gap-2"
          title="Refresh dashboard data"
        >
          <RefreshCw size={18} className={refreshing ? 'animate-spin' : ''} />
          {refreshing ? 'Refreshing...' : 'Refresh'}
        </button>
      </div>

      {isAdmin && (
        <div className="card mb-6 border-amber-200 bg-amber-50">
          <div className="flex flex-wrap items-center justify-between gap-3 mb-3">
            <div>
              <h3 className="text-lg font-semibold">Admin Financial Repair</h3>
              <p className="text-sm text-text-muted">Safe bulk sync + recalculation across all invoices.</p>
            </div>
            <div className="flex gap-2">
              <button
                onClick={() => void loadRecalculationPreview()}
                disabled={previewLoading || runningBulkRecalc}
                className="btn-secondary"
              >
                {previewLoading ? 'Loading...' : 'Refresh Preview'}
              </button>
              <button
                onClick={() => void runBulkRecalculation()}
                disabled={previewLoading || runningBulkRecalc || !recalcPreview}
                className="btn-primary"
              >
                {runningBulkRecalc ? 'Running...' : 'Run Full Recalculation'}
              </button>
            </div>
          </div>

          {recalcPreview ? (
            <div className="grid grid-cols-2 md:grid-cols-5 gap-3 text-sm">
              <div><span className="text-text-muted">Invoices:</span> <strong>{recalcPreview.invoices_total}</strong></div>
              <div><span className="text-text-muted">Negative:</span> <strong>{recalcPreview.invoices_negative}</strong></div>
              <div><span className="text-text-muted">Mismatches:</span> <strong>{recalcPreview.item_price_mismatches}</strong></div>
              <div><span className="text-text-muted">Non-PLN:</span> <strong>{recalcPreview.non_pln_invoices}</strong></div>
              <div><span className="text-text-muted">Profit:</span> <strong>{recalcPreview.total_profit.toFixed(2)} PLN</strong></div>
            </div>
          ) : (
            <p className="text-sm text-text-muted">No preview loaded yet.</p>
          )}
        </div>
      )}
      
      <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-4 gap-4 mb-6">
        {financePulseCards.map((card) => {
          const Icon = card.icon;
          return (
            <div key={card.title} className="card">
              <div className="flex items-start justify-between gap-3 mb-3">
                <p className="text-sm font-semibold">{card.title}</p>
                <div className={`p-2.5 rounded-lg ${card.color}`}>
                  <Icon size={18} />
                </div>
              </div>

              <div className="space-y-2">
                <p className="text-[11px] uppercase tracking-wide text-text-muted">All Time</p>
                {card.allTime.map((metric) => (
                  <div key={`${card.title}-all-${metric.label}`} className="flex items-center justify-between gap-2 text-sm">
                    <span className="text-text-muted">{metric.label}</span>
                    <span className="font-semibold text-right">{metric.value}</span>
                  </div>
                ))}
              </div>

              <div className="my-3 border-t border-surface-2" />

              <div className="space-y-2">
                <p className="text-[11px] uppercase tracking-wide text-text-muted">MTD</p>
                {card.mtd.map((metric) => (
                  <div key={`${card.title}-mtd-${metric.label}`} className="flex items-center justify-between gap-2 text-sm">
                    <span className="text-text-muted">{metric.label}</span>
                    <span className="font-semibold text-right">{metric.value}</span>
                  </div>
                ))}
              </div>
            </div>
          );
        })}
      </div>

      {canViewCrmPulse && crmDashboardSummary ? (
        <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-4 gap-4 mb-8">
          {crmPulseCards.map((card) => {
            const Icon = card.icon;
            return (
              <div key={card.title} className="card">
                <div className="flex items-start justify-between gap-3 mb-3">
                  <p className="text-sm font-semibold">{card.title}</p>
                  <div className={`p-2.5 rounded-lg ${card.color}`}>
                    <Icon size={18} />
                  </div>
                </div>

                <div className="space-y-2">
                  <p className="text-[11px] uppercase tracking-wide text-text-muted">Current</p>
                  {card.current.map((metric) => (
                    <div key={`${card.title}-current-${metric.label}`} className="flex items-center justify-between gap-2 text-sm">
                      <span className="text-text-muted">{metric.label}</span>
                      <span className="font-semibold text-right">{metric.value}</span>
                    </div>
                  ))}
                </div>

                <div className="my-3 border-t border-surface-2" />

                <div className="space-y-2">
                  <p className="text-[11px] uppercase tracking-wide text-text-muted">MTD</p>
                  {card.mtd.map((metric) => (
                    <div key={`${card.title}-mtd-${metric.label}`} className="flex items-center justify-between gap-2 text-sm">
                      <span className="text-text-muted">{metric.label}</span>
                      <span className="font-semibold text-right">{metric.value}</span>
                    </div>
                  ))}
                </div>
              </div>
            );
          })}
        </div>
      ) : null}

      <p className="text-xs text-text-muted mb-6">
        Top cards combine all-time and MTD for finance, and current + MTD for CRM Pulse.
      </p>

      <div className="card mb-6">
        <div className="flex items-center justify-between mb-3 gap-2">
          <div>
            <h3 className="text-lg font-semibold">Monthly Finance Combo (12M)</h3>
            <p className="text-xs text-text-muted">
              Net Sales + {monthlyComboScopeLabel} Sales (bars) with Total Profit + {monthlyComboScopeLabel} Earnings (lines)
            </p>
          </div>
          <div className="min-w-56">
            <label className="block text-xs text-text-muted mb-1">Portfolio</label>
            <select
              className="input"
              value={selectedComboOwner}
              onChange={(event) => setSelectedComboOwner(event.target.value)}
            >
              <option value="mine">My portfolio</option>
              {selectableOwners.map((owner) => (
                <option key={`combo-owner-${owner.ownerId}`} value={String(owner.ownerId)}>
                  {owner.ownerLabel}
                </option>
              ))}
            </select>
          </div>
        </div>

        {monthlyComboData.length === 0 ? (
          <p className="text-sm text-text-muted">No monthly trend data available yet.</p>
        ) : (
          <div className="h-80 w-full">
            <ResponsiveContainer width="100%" height="100%">
              <ComposedChart data={monthlyComboData} margin={{ top: 8, right: 20, left: 6, bottom: 8 }}>
                <CartesianGrid strokeDasharray="3 3" stroke="rgba(148, 163, 184, 0.25)" />
                <XAxis dataKey="label" tick={{ fontSize: 12 }} />
                <YAxis
                  yAxisId="left"
                  tick={{ fontSize: 12 }}
                  tickFormatter={(value) => `${Math.round(Number(value || 0) / 1000)}k`}
                />
                <YAxis yAxisId="right" orientation="right" tick={{ fontSize: 12 }} tickFormatter={(value) => `${Math.round(Number(value || 0) / 1000)}k`} />
                <Tooltip
                  formatter={(value: unknown) => formatPln(Number(value || 0))}
                  labelFormatter={(label: unknown) => `Month: ${String(label || '')}`}
                />
                <Legend />
                <Bar yAxisId="left" dataKey="sales_net" name="Net Sales" fill="#2563eb" radius={[4, 4, 0, 0]} barSize={20} />
                <Bar yAxisId="left" dataKey="selected_sales_net" name={`${monthlyComboScopeLabel} Sales`} fill="#14b8a6" radius={[4, 4, 0, 0]} barSize={14} />
                <Line yAxisId="right" type="monotone" dataKey="profit_total" name="Total Profit" stroke="#16a34a" strokeWidth={2.5} dot={{ r: 2 }} />
                <Line yAxisId="right" type="monotone" dataKey="selected_earnings" name={`${monthlyComboScopeLabel} Earnings`} stroke="#f59e0b" strokeWidth={2.5} dot={{ r: 2 }} />
              </ComposedChart>
            </ResponsiveContainer>
          </div>
        )}
      </div>

      <div className="card">
        <div className="flex items-center justify-between mb-4">
          <h3 className="text-lg font-semibold">Seller Earnings (Netto Based)</h3>
          <span className="text-xs text-text-muted">Monthly estimate = monthly profit x seller commission %</span>
        </div>
        <p className="text-xs text-text-muted mb-3">
          If a product has no purchase price, profit stays at 0.00 until costs are filled in.
        </p>

        {!dashboardSummary?.my_summary?.linked_manager_name ? (
          <div className="p-3 rounded-lg border border-amber-300 bg-amber-50 text-amber-800 text-sm mb-4">
            Your user is not linked to an account manager profile yet. Link it in Team Management to see your own earnings card.
          </div>
        ) : null}

        <div className="table-container">
          <table className="table">
            <thead>
              <tr>
                <th>Seller</th>
                <th>Invoices</th>
                <th>Net Sales</th>
                <th>Profit</th>
                <th>Weighted Margin</th>
                <th>Actual Commission</th>
                <th>Estimated Earnings ({currentMonthLabel})</th>
              </tr>
            </thead>
            <tbody>
              {(dashboardSummary?.sellers || []).length === 0 ? (
                <tr>
                  <td colSpan={7} className="text-center py-6 text-text-muted">
                    No seller-linked invoices found.
                  </td>
                </tr>
              ) : (
                (dashboardSummary?.sellers || []).map((row) => {
                  const isMine = dashboardSummary?.my_summary?.linked_manager_id != null
                    && row.owner_id === dashboardSummary.my_summary.linked_manager_id;
                  const commissionActual = Number(row.commission_actual || 0);
                  const sellerKey = row.owner_id !== null
                    ? `id:${row.owner_id}`
                    : `name:${String(row.owner_label || '').trim().toLowerCase()}`;
                  const commissionEstimatedMonthly = Number(monthlyEstimatedBySeller.get(sellerKey) || 0);
                  const hasSalesWithoutProfit = Number(row.sales_net || 0) > 0 && Number(row.profit_total || 0) === 0;

                  return (
                    <tr key={`${row.owner_id ?? 'name'}-${row.owner_label}`} className={isMine ? 'seller-row-highlight' : ''}>
                      <td className="font-medium">{row.owner_label}</td>
                      <td>{row.invoice_count}</td>
                      <td>{Number(row.sales_net || 0).toFixed(2)} PLN</td>
                      <td>
                        {Number(row.profit_total || 0).toFixed(2)} PLN
                        {hasSalesWithoutProfit ? (
                          <p className="text-xs text-warning mt-1">Missing purchase prices</p>
                        ) : null}
                      </td>
                      <td>{Number(row.margin_weighted || 0).toFixed(2)}%</td>
                      <td>{commissionActual.toFixed(2)} PLN</td>
                      <td className="font-semibold">
                        {commissionEstimatedMonthly.toFixed(2)} PLN
                        {hasSalesWithoutProfit ? (
                          <p className="text-xs text-warning mt-1">Waiting for profit data</p>
                        ) : null}
                      </td>
                    </tr>
                  );
                })
              )}
            </tbody>
          </table>
        </div>
      </div>

      {canViewCrmPulse && crmDashboardSummary ? (
        <div className="card mt-6">
          <div className="flex flex-wrap items-center justify-between gap-2 mb-4">
            <h3 className="text-lg font-semibold">CRM Pulse Details</h3>
            <span className="text-xs text-text-muted">{crmDashboardSummary.period.label}</span>
          </div>

          <div className="grid grid-cols-2 md:grid-cols-5 gap-3 mb-4 text-sm">
            <div className="p-3 border border-border rounded-lg bg-surface-1">
              <p className="text-text-muted">Pipeline: All</p>
              <p className="text-lg font-semibold">{crmDashboardSummary.pipeline.all}</p>
            </div>
            <div className="p-3 border border-border rounded-lg bg-surface-1">
              <p className="text-text-muted">Cold</p>
              <p className="text-lg font-semibold">{crmDashboardSummary.pipeline.cold}</p>
            </div>
            <div className="p-3 border border-border rounded-lg bg-surface-1">
              <p className="text-text-muted">In Talks</p>
              <p className="text-lg font-semibold">{crmDashboardSummary.pipeline.talks}</p>
            </div>
            <div className="p-3 border border-border rounded-lg bg-surface-1">
              <p className="text-text-muted">Won</p>
              <p className="text-lg font-semibold text-success">{crmDashboardSummary.pipeline.won}</p>
            </div>
            <div className="p-3 border border-border rounded-lg bg-surface-1">
              <p className="text-text-muted">Lost</p>
              <p className="text-lg font-semibold text-danger">{crmDashboardSummary.pipeline.lost}</p>
            </div>
          </div>

          <div className="table-container">
            <table className="table">
              <thead>
                <tr>
                  <th>User</th>
                  <th>Role</th>
                  <th>Owned Leads</th>
                  <th>Tasks Done (MTD)</th>
                  <th>Overdue Tasks</th>
                  <th>Next 7d Tasks</th>
                  <th>Activities (MTD)</th>
                  <th>Calls / Emails / Meetings</th>
                  <th>Won (MTD)</th>
                </tr>
              </thead>
              <tbody>
                {crmDashboardSummary.team.length === 0 ? (
                  <tr>
                    <td colSpan={9} className="text-center py-6 text-text-muted">
                      No CRM team activity found for this period.
                    </td>
                  </tr>
                ) : (
                  crmDashboardSummary.team.map((member) => (
                    <tr key={member.user_id}>
                      <td className="font-medium">{member.user_name}</td>
                      <td>{member.role}</td>
                      <td>{member.leads_owned}</td>
                      <td>{member.tasks_completed_mtd}</td>
                      <td className={member.overdue_tasks_open > 0 ? 'text-danger font-semibold' : ''}>{member.overdue_tasks_open}</td>
                      <td>{member.tasks_next_7d}</td>
                      <td>{member.activities_mtd}</td>
                      <td>{member.calls_mtd} / {member.emails_mtd} / {member.meetings_mtd}</td>
                      <td className="font-semibold text-success">{member.won_mtd}</td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </div>
        </div>
      ) : null}

      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4 mt-6">
        <div className="card">
          <p className="text-sm text-text-muted mb-1">All Active Products</p>
          <p className="text-2xl font-bold">{stats.totalProducts}</p>
        </div>
        <div className="card">
          <p className="text-sm text-text-muted mb-1">Missing Purchase Price</p>
          <p className={`text-2xl font-bold ${stats.productsWithoutPrice > 0 ? 'text-danger' : 'text-success'}`}>
            {stats.productsWithoutPrice}
          </p>
        </div>
        <div className="card">
          <p className="text-sm text-text-muted mb-1">Missing Stock Level</p>
          <p className={`text-2xl font-bold ${stats.productsWithoutStock > 0 ? 'text-danger' : 'text-success'}`}>
            {stats.productsWithoutStock}
          </p>
        </div>
        <div className="card">
          <p className="text-sm text-text-muted mb-1">Stock Shortages</p>
          <p className={`text-2xl font-bold ${stats.productsAtRisk > 0 ? 'text-danger' : 'text-success'}`}>
            {stats.productsAtRisk}
          </p>
        </div>
      </div>

      <div className="card mt-6">
        <div className="flex items-center gap-2 mb-4">
          <AlertTriangle size={20} className="text-orange-500" />
          <h3 className="text-lg font-semibold">Requires Attention</h3>
        </div>
        <div className="grid grid-cols-1 md:grid-cols-3 gap-4 text-sm">
          <div className="p-3 border border-border rounded-lg bg-gray-50">
            <p className="text-text-muted">Products Without Purchase Price</p>
            <p className="text-xl font-semibold text-danger">{stats.productsWithoutPrice}</p>
          </div>
          <div className="p-3 border border-border rounded-lg bg-gray-50">
            <p className="text-text-muted">Products Without Stock Level</p>
            <p className="text-xl font-semibold text-danger">{stats.productsWithoutStock}</p>
          </div>
          <div className="p-3 border border-border rounded-lg bg-gray-50">
            <p className="text-text-muted">Products Not Sold in Period</p>
            <p className="text-xl font-semibold">{stats.productsNeverSold}</p>
          </div>
        </div>
      </div>

      {orphanItems.length > 0 && (
        <div className="card mt-6 border-orange-300 bg-orange-50">
          <div className="flex items-center justify-between mb-4">
            <div className="flex items-center gap-2">
              <Link size={20} className="text-orange-600" />
              <h3 className="text-lg font-semibold text-orange-700">Invoice Items Without Linked Products ({orphanItems.length})</h3>
            </div>
            <button
              onClick={createProductsFromAllOrphans}
              disabled={creatingAllProducts}
              className="btn-primary flex items-center gap-2 text-sm"
            >
              {creatingAllProducts ? (
                <Loader2 size={16} className="animate-spin" />
              ) : (
                <Plus size={16} />
              )}
              {creatingAllProducts ? 'Creating...' : 'Create All Products'}
            </button>
          </div>
          <p className="text-sm text-orange-600 mb-3">
            These items have no product link and are excluded from stock and profit calculations.
            Click "Create" to make a product from the item name, or use "Create All Products" to process all at once.
          </p>
          <div className="table-container max-h-64 overflow-y-auto">
            <table className="table">
              <thead>
                <tr>
                  <th>Invoice</th>
                  <th>Item Name</th>
                  <th>Qty</th>
                  <th>Net Value</th>
                  <th>Action</th>
                </tr>
              </thead>
              <tbody>
                {orphanItems.slice(0, 20).map((item) => (
                  <tr key={item.id}>
                    <td>
                      <a 
                        href={`/invoices/${item.invoice_id}`} 
                        className="text-primary hover:underline"
                      >
                        {item.numer_faktury}
                      </a>
                    </td>
                    <td className="font-medium">{item.nazwa}</td>
                    <td>{Number(item.ilosc).toFixed(3)} {item.jednostka || 'szt'}</td>
                    <td>{Number(item.wartosc_netto).toFixed(2)} PLN</td>
                    <td>
                      <button
                        onClick={() => createProductFromOrphanItem(item.id)}
                        disabled={creatingProductId === item.id}
                        className="btn-secondary text-xs flex items-center gap-1"
                      >
                        {creatingProductId === item.id ? (
                          <Loader2 size={14} className="animate-spin" />
                        ) : (
                          <Plus size={14} />
                        )}
                        {creatingProductId === item.id ? 'Creating...' : 'Create'}
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          {orphanItems.length > 20 && (
            <p className="text-sm text-orange-600 mt-2">
              And {orphanItems.length - 20} more items...
            </p>
          )}
        </div>
      )}

      <div className="card mt-6">
        <div className="flex items-center justify-between mb-4">
          <div className="flex items-center gap-2">
            <Boxes size={20} className="text-primary" />
            <h3 className="text-lg font-semibold">Stock Movement from Invoices</h3>
          </div>
          <div className="flex items-center gap-2 text-sm">
            <CalendarDays size={16} className="text-text-muted" />
            <select
              className="input w-40"
              value={storagePeriod}
              onChange={(event) => setStoragePeriod(event.target.value as '30d' | '90d' | '365d')}
            >
              <option value="30d">Last 30 days</option>
              <option value="90d">Last 90 days</option>
              <option value="365d">Last year</option>
            </select>
          </div>
        </div>

        <div className="table-container">
          <table className="table">
            <thead>
              <tr>
                <th>Product</th>
                <th>Sold</th>
                <th>Stock Level</th>
                <th>Estimated Remaining</th>
              </tr>
            </thead>
            <tbody>
              {storageRows.length === 0 ? (
                <tr>
                  <td colSpan={4} className="text-center py-8 text-text-muted">
                    No sales data in selected period.
                  </td>
                </tr>
              ) : (
                storageRows.slice(0, 12).map((row) => (
                  <tr key={row.id}>
                    <td>{row.nazwa}</td>
                    <td>{Number(row.sold_quantity || 0).toFixed(3)} {row.jednostka || 'szt'}</td>
                    <td>{row.stan_magazynowy != null ? Number(row.stan_magazynowy).toFixed(3) : '-'}</td>
                    <td className={row.estimated_remaining < 0 ? 'text-danger' : 'text-success'}>
                      {Number(row.estimated_remaining || 0).toFixed(3)} {row.jednostka || 'szt'}
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6 mt-6">
        <div className="card">
          <h3 className="text-lg font-semibold mb-4">Top Products by Sales (Period)</h3>
          <div className="table-container">
            <table className="table">
              <thead>
                <tr>
                  <th>Product</th>
                  <th>Quantity</th>
                  <th>Net Value</th>
                </tr>
              </thead>
              <tbody>
                {topSellingRows.length === 0 ? (
                  <tr>
                    <td colSpan={3} className="text-center py-6 text-text-muted">
                      No sales in selected period.
                    </td>
                  </tr>
                ) : (
                  topSellingRows.map((row) => (
                    <tr key={row.id}>
                      <td>{row.nazwa}</td>
                      <td>{Number(row.sold_quantity || 0).toFixed(3)} {row.jednostka || 'szt'}</td>
                      <td>{Number(row.sold_value_net || 0).toFixed(2)} PLN</td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </div>
        </div>

        <div className="card">
          <h3 className="text-lg font-semibold mb-4">Top Products by Profit (All Time)</h3>
          <div className="table-container">
            <table className="table">
              <thead>
                <tr>
                  <th>Product</th>
                  <th>Profit</th>
                  <th>Avg. Margin</th>
                </tr>
              </thead>
              <tbody>
                {topProfitRows.length === 0 ? (
                  <tr>
                    <td colSpan={3} className="text-center py-6 text-text-muted">
                      No profit data available.
                    </td>
                  </tr>
                ) : (
                  topProfitRows.map((row) => (
                    <tr key={row.id}>
                      <td>{row.nazwa}</td>
                      <td>{Number(row.total_profit || 0).toFixed(2)} PLN</td>
                      <td>{row.avg_margin != null ? `${Number(row.avg_margin).toFixed(2)}%` : '-'}</td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </div>
        </div>
      </div>

      <div className="card mt-6">
        <h3 className="text-lg font-semibold mb-4">Products with Shortage (Estimated)</h3>
        <div className="table-container">
          <table className="table">
            <thead>
              <tr>
                <th>Product</th>
                <th>Sold</th>
                <th>Recorded Stock</th>
                <th>Missing Quantity</th>
              </tr>
            </thead>
            <tbody>
              {riskRows.length === 0 ? (
                <tr>
                  <td colSpan={4} className="text-center py-8 text-text-muted">
                    No shortages in selected period.
                  </td>
                </tr>
              ) : (
                riskRows.map((row) => (
                  <tr key={row.id}>
                    <td>{row.nazwa}</td>
                    <td>{Number(row.sold_quantity || 0).toFixed(3)} {row.jednostka || 'szt'}</td>
                    <td>{row.stan_magazynowy != null ? Number(row.stan_magazynowy).toFixed(3) : '-'}</td>
                    <td className="text-danger font-semibold">
                      {Math.abs(Number(row.estimated_remaining || 0)).toFixed(3)} {row.jednostka || 'szt'}
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}
