import React, { useMemo, useState } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Calendar as CalendarComponent } from "@/components/ui/calendar";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Badge } from "@/components/ui/badge";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Skeleton } from "@/components/ui/skeleton";
import {
  Download,
  Calendar,
  User,
  TrendingUp,
  TrendingDown,
  DollarSign,
  Users,
  Target,
  Clock,
  AlertTriangle,
  Crown,
  BarChart3,
  Filter,
  Activity,
} from "lucide-react";
import { useSupabaseLeads } from "@/hooks/useSupabaseLeads";
import { useLeadSources } from "@/hooks/useLeadSources";
import { usePipelines } from "@/hooks/usePipelines";
import {
  startOfDay, endOfDay, startOfMonth, endOfMonth,
  subDays, subMonths, isWithinInterval, parseISO, format,
  differenceInHours, differenceInDays,
} from "date-fns";
import { ptBR } from "date-fns/locale";
import jsPDF from "jspdf";
import "jspdf-autotable";
import { cn } from "@/lib/utils";
import { PageHeader } from "@/components/layout/PageHeader";
import { motion } from "framer-motion";
import {
  BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer,
  AreaChart, Area, Legend, Cell,
} from "recharts";

// ── helpers ──────────────────────────────────────────────
const fmt = (v: number) =>
  v.toLocaleString("pt-BR", { minimumFractionDigits: 0, maximumFractionDigits: 0 });
const fmtCurrency = (v: number) =>
  `R$ ${v.toLocaleString("pt-BR", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
const pct = (n: number, d: number) => (d > 0 ? (n / d) * 100 : 0);

const COLORS = [
  "hsl(var(--primary))",
  "hsl(142, 76%, 36%)",
  "hsl(38, 92%, 50%)",
  "hsl(280, 65%, 60%)",
  "hsl(200, 98%, 39%)",
  "hsl(346, 77%, 49%)",
];

const containerVariants = {
  hidden: { opacity: 0 },
  visible: { opacity: 1, transition: { staggerChildren: 0.08 } },
};
const itemVariants = {
  hidden: { opacity: 0, y: 16 },
  visible: { opacity: 1, y: 0 },
};

// ── component ────────────────────────────────────────────
export default function RelatorioSupremo() {
  const { leads, stages, loading } = useSupabaseLeads();
  const { leadSources } = useLeadSources();
  const { pipelines } = usePipelines();

  const [period, setPeriod] = useState("30d");
  const [sourceFilter, setSourceFilter] = useState("todas");
  const [sellerFilter, setSellerFilter] = useState("todos");
  const [pipelineFilter, setPipelineFilter] = useState("todos");
  const [customRange, setCustomRange] = useState<{ from?: Date; to?: Date }>({});

  // ── date range ──
  const getRange = (p: string) => {
    const now = new Date();
    switch (p) {
      case "hoje": return { start: startOfDay(now), end: endOfDay(now) };
      case "7d": return { start: startOfDay(subDays(now, 6)), end: endOfDay(now) };
      case "30d": return { start: startOfDay(subDays(now, 29)), end: endOfDay(now) };
      case "custom":
        if (customRange.from && customRange.to)
          return { start: startOfDay(customRange.from), end: endOfDay(customRange.to) };
        return { start: startOfMonth(now), end: endOfDay(now) };
      default: return { start: startOfDay(subDays(now, 29)), end: endOfDay(now) };
    }
  };

  const getPreviousRange = (p: string) => {
    const { start, end } = getRange(p);
    const diff = end.getTime() - start.getTime();
    return { start: new Date(start.getTime() - diff), end: new Date(start.getTime() - 1) };
  };

  // ── source classification ──
  const classifySource = (source: string | null) => {
    if (!source) return "Outros";
    const s = source.toLowerCase();
    if (s.includes("meta") || s.includes("ads") || s.includes("facebook") || s.includes("instagram ads"))
      return "Meta Ads";
    if (s.includes("orgânico") || s.includes("organico") || s.includes("indicação") || s.includes("indicacao"))
      return "Orgânico";
    return "Outros";
  };

  // ── filter leads ──
  const filtered = useMemo(() => {
    if (loading || !leads.length) return [];
    const { start, end } = getRange(period);
    return leads.filter((l) => {
      const d = parseISO(l.created_at);
      if (!isWithinInterval(d, { start, end })) return false;
      if (sourceFilter !== "todas") {
        if (sourceFilter === "meta_ads" && classifySource(l.source) !== "Meta Ads") return false;
        if (sourceFilter === "organico" && classifySource(l.source) !== "Orgânico") return false;
      }
      if (sellerFilter !== "todos" && l.seller_name !== sellerFilter) return false;
      return true;
    });
  }, [leads, period, sourceFilter, sellerFilter, pipelineFilter, loading, customRange]);

  const previousFiltered = useMemo(() => {
    if (loading || !leads.length) return [];
    const { start, end } = getPreviousRange(period);
    return leads.filter((l) => {
      const d = parseISO(l.created_at);
      return isWithinInterval(d, { start, end });
    });
  }, [leads, period, loading, customRange]);

  // ── sale stage detection ──
  const isSaleStage = (stageName?: string) => {
    if (!stageName) return false;
    const s = stageName.toLowerCase();
    return s.includes("fechado") || s.includes("venda") || s.includes("vendido") || s.includes("ganhou");
  };
  const isLostStage = (stageName?: string) => {
    if (!stageName) return false;
    const s = stageName.toLowerCase();
    return s.includes("perdido") || s.includes("perdeu") || s.includes("lost");
  };
  const isQualifiedStage = (stageName?: string) => {
    if (!stageName) return false;
    const s = stageName.toLowerCase();
    return s.includes("qualificado") || s.includes("negociação") || s.includes("agendado") || isSaleStage(stageName);
  };

  // ── unique lists ──
  const uniqueSellers = useMemo(
    () => [...new Set(leads.map((l) => l.seller_name).filter(Boolean))].sort() as string[],
    [leads]
  );
  const uniqueSources = useMemo(() => {
    const reg = leadSources.map((s) => s.name);
    const used = [...new Set(leads.map((l) => l.source).filter(Boolean))];
    return [...new Set([...reg, ...used])].sort();
  }, [leadSources, leads]);

  // ── BLOCK 1: executive metrics ──
  const exec = useMemo(() => {
    const total = filtered.length;
    const qualified = filtered.filter((l) => isQualifiedStage(l.stage_name)).length;
    const sold = filtered.filter((l) => isSaleStage(l.stage_name));
    const salesCount = sold.length;
    const revenue = sold.reduce((a, l) => a + (l.valor_negocio || parseFloat(l.price?.replace(/[^\d,]/g, "")?.replace(",", ".") || "0") || 0), 0);
    const avgTicket = salesCount > 0 ? revenue / salesCount : 0;
    const convRate = pct(salesCount, total);

    // previous period
    const prevTotal = previousFiltered.length;
    const prevSold = previousFiltered.filter((l) => isSaleStage(l.stage_name));
    const prevRevenue = prevSold.reduce((a, l) => a + (l.valor_negocio || 0), 0);
    const prevConvRate = pct(prevSold.length, prevTotal);

    const variation = (cur: number, prev: number) =>
      prev > 0 ? ((cur - prev) / prev) * 100 : cur > 0 ? 100 : 0;

    // time metrics
    const avgFirstResponse = 0; // would need conversation data
    const avgCloseTime = sold.length > 0
      ? sold.reduce((a, l) => a + differenceInDays(new Date(), parseISO(l.created_at)), 0) / sold.length
      : 0;

    return {
      revenue, total, qualified, salesCount, convRate, avgTicket, avgCloseTime,
      avgFirstResponse,
      vRevenue: variation(revenue, prevRevenue),
      vTotal: variation(total, prevTotal),
      vSales: variation(salesCount, prevSold.length),
      vConv: convRate - prevConvRate,
    };
  }, [filtered, previousFiltered]);

  // ── BLOCK 2: by source ──
  const sourceData = useMemo(() => {
    const groups: Record<string, { leads: number; qualified: number; sales: number; revenue: number }> = {};
    filtered.forEach((l) => {
      const cat = classifySource(l.source);
      if (!groups[cat]) groups[cat] = { leads: 0, qualified: 0, sales: 0, revenue: 0 };
      groups[cat].leads++;
      if (isQualifiedStage(l.stage_name)) groups[cat].qualified++;
      if (isSaleStage(l.stage_name)) {
        groups[cat].sales++;
        groups[cat].revenue += l.valor_negocio || 0;
      }
    });
    return Object.entries(groups).map(([name, v]) => ({
      name, ...v,
      conversion: pct(v.sales, v.leads),
      avgTicket: v.sales > 0 ? v.revenue / v.sales : 0,
    })).sort((a, b) => b.revenue - a.revenue);
  }, [filtered]);

  // ── BLOCK 3: by seller ──
  const sellerData = useMemo(() => {
    const groups: Record<string, { leads: number; qualified: number; sales: number; revenue: number }> = {};
    filtered.forEach((l) => {
      const s = l.seller_name || "Não atribuído";
      if (!groups[s]) groups[s] = { leads: 0, qualified: 0, sales: 0, revenue: 0 };
      groups[s].leads++;
      if (isQualifiedStage(l.stage_name)) groups[s].qualified++;
      if (isSaleStage(l.stage_name)) {
        groups[s].sales++;
        groups[s].revenue += l.valor_negocio || 0;
      }
    });
    return Object.entries(groups)
      .map(([name, v]) => ({
        name, ...v,
        conversion: pct(v.sales, v.leads),
        avgTicket: v.sales > 0 ? v.revenue / v.sales : 0,
      }))
      .sort((a, b) => b.revenue - a.revenue);
  }, [filtered]);

  // ── BLOCK 4: funnel ──
  const funnelData = useMemo(() => {
    if (!stages.length || !filtered.length) return [];
    const sorted = [...stages].sort((a, b) => a.position - b.position);
    return sorted.map((stage, i) => {
      const count = filtered.filter((l) => l.stage_id === stage.id).length;
      const prevCount = i > 0
        ? filtered.filter((l) => l.stage_id === sorted[i - 1].id).length
        : filtered.length;
      const dropRate = prevCount > 0 ? pct(count, prevCount) : 0;
      return { name: stage.name, count, dropRate, color: stage.color || COLORS[i % COLORS.length] };
    });
  }, [stages, filtered]);

  const bottleneck = useMemo(() => {
    if (funnelData.length < 2) return null;
    let worst = funnelData[1];
    for (let i = 2; i < funnelData.length; i++) {
      if (funnelData[i].dropRate < worst.dropRate && funnelData[i].count >= 0) worst = funnelData[i];
    }
    return worst;
  }, [funnelData]);

  // ── BLOCK 5: lead quality ──
  const quality = useMemo(() => {
    const total = filtered.length || 1;
    const lost = filtered.filter((l) => isLostStage(l.stage_name)).length;
    const noReply = filtered.filter(
      (l) => !isSaleStage(l.stage_name) && !isLostStage(l.stage_name) && !l.stage_name?.toLowerCase().includes("atendimento")
    ).length;
    return {
      pctNoReply: pct(noReply, total),
      pctLost: pct(lost, total),
      pctReactivated: 0,
    };
  }, [filtered]);

  // ── BLOCK 6: revenue ──
  const revenueBySource = useMemo(
    () => sourceData.map((s) => ({ name: s.name, value: s.revenue })),
    [sourceData]
  );
  const revenueBySeller = useMemo(
    () => sellerData.map((s) => ({ name: s.name, value: s.revenue })),
    [sellerData]
  );
  const projectedRevenue = useMemo(() => {
    const { start, end } = getRange(period);
    const totalDays = differenceInDays(end, start) || 1;
    const elapsed = differenceInDays(new Date(), start) || 1;
    const dailyRate = exec.revenue / elapsed;
    return dailyRate * totalDays;
  }, [exec.revenue, period]);

  // ── PDF export ──
  const exportPDF = () => {
    const doc = new jsPDF();
    let y = 20;
    doc.setFontSize(18);
    doc.text("Relatório Supremo", 20, y);
    y += 12;
    doc.setFontSize(10);
    doc.text(`Gerado em ${format(new Date(), "dd/MM/yyyy HH:mm")}`, 20, y);
    y += 15;
    doc.setFontSize(12);
    doc.text("Visão Executiva", 20, y); y += 8;
    doc.setFontSize(10);
    doc.text(`Receita: ${fmtCurrency(exec.revenue)}`, 25, y); y += 6;
    doc.text(`Leads: ${exec.total}`, 25, y); y += 6;
    doc.text(`Vendas: ${exec.salesCount}`, 25, y); y += 6;
    doc.text(`Conversão: ${exec.convRate.toFixed(1)}%`, 25, y); y += 6;
    doc.text(`Ticket Médio: ${fmtCurrency(exec.avgTicket)}`, 25, y); y += 12;

    if (sellerData.length) {
      doc.setFontSize(12);
      doc.text("Performance por Vendedor", 20, y); y += 4;
      (doc as any).autoTable?.({
        startY: y,
        head: [["Vendedor", "Leads", "Vendas", "Receita", "Conversão"]],
        body: sellerData.map((s) => [s.name, s.leads, s.sales, fmtCurrency(s.revenue), `${s.conversion.toFixed(1)}%`]),
        theme: "striped",
        styles: { fontSize: 9 },
        headStyles: { fillColor: [59, 130, 246] },
      });
    }
    doc.save(`relatorio-supremo-${format(new Date(), "dd-MM-yyyy")}.pdf`);
  };

  // ── chart tooltip ──
  const ChartTooltip = ({ active, payload, label }: any) => {
    if (!active || !payload?.length) return null;
    return (
      <div className="bg-background/95 backdrop-blur-sm border border-border rounded-lg p-3 shadow-lg">
        <p className="font-medium text-foreground text-sm">{label}</p>
        {payload.map((p: any, i: number) => (
          <p key={i} className="text-xs" style={{ color: p.color }}>
            {p.name}: {typeof p.value === "number" && p.value > 100 ? fmtCurrency(p.value) : p.value}
          </p>
        ))}
      </div>
    );
  };

  // ── variation badge ──
  const Variation = ({ value }: { value: number }) => {
    if (value === 0) return null;
    const positive = value > 0;
    return (
      <span className={cn("inline-flex items-center text-xs font-medium gap-0.5", positive ? "text-emerald-600" : "text-red-500")}>
        {positive ? <TrendingUp className="h-3 w-3" /> : <TrendingDown className="h-3 w-3" />}
        {positive ? "+" : ""}{value.toFixed(1)}%
      </span>
    );
  };

  // ── loading state ──
  if (loading) {
    return (
      <div className="p-4 md:p-6 space-y-6 min-h-screen">
        <PageHeader title="Relatório Supremo" description="Carregando dados..." />
        <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
          {Array.from({ length: 8 }).map((_, i) => (
            <Card key={i}><CardContent className="p-6"><Skeleton className="h-16 w-full" /></CardContent></Card>
          ))}
        </div>
      </div>
    );
  }

  return (
    <div className="p-4 md:p-6 space-y-6 min-h-screen">
      {/* Header */}
      <PageHeader title="Relatório Supremo" description="Painel executivo completo para análise estratégica">
        <Button className="btn-gradient text-white font-poppins font-medium shadow-lg" onClick={exportPDF}>
          <Download className="h-4 w-4 mr-2" />
          Exportar PDF
        </Button>
      </PageHeader>

      {/* ── FILTERS ── */}
      <motion.div initial={{ opacity: 0, y: -10 }} animate={{ opacity: 1, y: 0 }}>
        <Card className="border-0 bg-gradient-to-br from-card to-card/80 shadow-lg backdrop-blur-sm">
          <CardContent className="p-4">
            <div className="flex flex-wrap items-center gap-3">
              <div className="flex items-center gap-2 bg-background/50 rounded-lg px-3 py-1">
                <Calendar className="h-4 w-4 text-primary" />
                <Select value={period} onValueChange={setPeriod}>
                  <SelectTrigger className="w-40 border-0 bg-transparent font-poppins text-sm shadow-none focus:ring-0">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="hoje">Hoje</SelectItem>
                    <SelectItem value="7d">7 dias</SelectItem>
                    <SelectItem value="30d">30 dias</SelectItem>
                    <SelectItem value="custom">Personalizado</SelectItem>
                  </SelectContent>
                </Select>
              </div>

              {period === "custom" && (
                <Popover>
                  <PopoverTrigger asChild>
                    <Button variant="outline" className="w-[260px] justify-start text-left font-poppins text-sm">
                      <Calendar className="mr-2 h-4 w-4" />
                      {customRange.from
                        ? customRange.to
                          ? `${format(customRange.from, "dd/MM/yy")} - ${format(customRange.to, "dd/MM/yy")}`
                          : format(customRange.from, "dd/MM/yyyy")
                        : "Selecionar período"}
                    </Button>
                  </PopoverTrigger>
                  <PopoverContent className="w-auto p-0" align="start">
                    <CalendarComponent
                      mode="range"
                      selected={{ from: customRange.from, to: customRange.to }}
                      onSelect={(r) => setCustomRange({ from: r?.from, to: r?.to })}
                      numberOfMonths={2}
                      initialFocus
                      className="pointer-events-auto"
                    />
                  </PopoverContent>
                </Popover>
              )}

              <div className="flex items-center gap-2 bg-background/50 rounded-lg px-3 py-1">
                <Filter className="h-4 w-4 text-primary" />
                <Select value={sourceFilter} onValueChange={setSourceFilter}>
                  <SelectTrigger className="w-36 border-0 bg-transparent font-poppins text-sm shadow-none focus:ring-0">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="todas">Todas origens</SelectItem>
                    <SelectItem value="meta_ads">Meta Ads</SelectItem>
                    <SelectItem value="organico">Orgânico</SelectItem>
                  </SelectContent>
                </Select>
              </div>

              <div className="flex items-center gap-2 bg-background/50 rounded-lg px-3 py-1">
                <User className="h-4 w-4 text-primary" />
                <Select value={sellerFilter} onValueChange={setSellerFilter}>
                  <SelectTrigger className="w-40 border-0 bg-transparent font-poppins text-sm shadow-none focus:ring-0">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="todos">Todos vendedores</SelectItem>
                    {uniqueSellers.map((s) => <SelectItem key={s} value={s}>{s}</SelectItem>)}
                  </SelectContent>
                </Select>
              </div>

              <div className="ml-auto flex items-center gap-2 bg-primary/10 rounded-full px-4 py-2">
                <Activity className="h-4 w-4 text-primary" />
                <span className="text-sm font-medium text-primary">{filtered.length} leads</span>
              </div>
            </div>
          </CardContent>
        </Card>
      </motion.div>

      {/* ── BLOCK 1: VISÃO EXECUTIVA ── */}
      <motion.div variants={containerVariants} initial="hidden" animate="visible" className="grid grid-cols-2 md:grid-cols-4 gap-4">
        {[
          { label: "Receita Total", value: fmtCurrency(exec.revenue), icon: DollarSign, variation: exec.vRevenue, color: "text-emerald-600" },
          { label: "Total de Leads", value: fmt(exec.total), icon: Users, variation: exec.vTotal, color: "text-primary" },
          { label: "Leads Qualificados", value: fmt(exec.qualified), icon: Target, variation: 0, color: "text-amber-500" },
          { label: "Vendas Fechadas", value: fmt(exec.salesCount), icon: TrendingUp, variation: exec.vSales, color: "text-emerald-600" },
          { label: "Taxa de Conversão", value: `${exec.convRate.toFixed(1)}%`, icon: Activity, variation: exec.vConv, color: "text-primary" },
          { label: "Ticket Médio", value: fmtCurrency(exec.avgTicket), icon: DollarSign, variation: 0, color: "text-amber-500" },
          { label: "Tempo Médio Resposta", value: "—", icon: Clock, variation: 0, color: "text-muted-foreground" },
          { label: "Tempo Médio Fechamento", value: exec.avgCloseTime > 0 ? `${exec.avgCloseTime.toFixed(0)}d` : "—", icon: Clock, variation: 0, color: "text-muted-foreground" },
        ].map((c, i) => (
          <motion.div key={i} variants={itemVariants}>
            <Card className="border-0 shadow-md hover:shadow-lg transition-shadow bg-card">
              <CardContent className="p-5">
                <div className="flex items-center justify-between mb-3">
                  <span className="text-xs font-poppins font-medium text-muted-foreground uppercase tracking-wide">{c.label}</span>
                  <c.icon className={cn("h-4 w-4", c.color)} />
                </div>
                <p className="text-2xl font-bold font-poppins text-foreground">{c.value}</p>
                {c.variation !== 0 && <Variation value={c.variation} />}
              </CardContent>
            </Card>
          </motion.div>
        ))}
      </motion.div>

      {/* ── BLOCK 2: PERFORMANCE POR ORIGEM ── */}
      <motion.div variants={itemVariants} initial="hidden" animate="visible">
        <Card className="border-0 shadow-md">
          <CardHeader>
            <CardTitle className="text-lg font-poppins flex items-center gap-2">
              <BarChart3 className="h-5 w-5 text-primary" />
              Performance por Origem
            </CardTitle>
          </CardHeader>
          <CardContent>
            <div className="grid md:grid-cols-2 gap-6">
              {/* table */}
              <div className="overflow-x-auto">
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead className="font-poppins">Origem</TableHead>
                      <TableHead className="font-poppins text-right">Leads</TableHead>
                      <TableHead className="font-poppins text-right">Qualif.</TableHead>
                      <TableHead className="font-poppins text-right">Vendas</TableHead>
                      <TableHead className="font-poppins text-right">Receita</TableHead>
                      <TableHead className="font-poppins text-right">Conv.</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {sourceData.length === 0 ? (
                      <TableRow><TableCell colSpan={6} className="text-center text-muted-foreground py-8">Sem dados no período</TableCell></TableRow>
                    ) : sourceData.map((s) => (
                      <TableRow key={s.name}>
                        <TableCell className="font-medium">{s.name}</TableCell>
                        <TableCell className="text-right">{s.leads}</TableCell>
                        <TableCell className="text-right">{s.qualified}</TableCell>
                        <TableCell className="text-right">{s.sales}</TableCell>
                        <TableCell className="text-right">{fmtCurrency(s.revenue)}</TableCell>
                        <TableCell className="text-right">
                          <Badge variant={s.conversion > 10 ? "default" : "secondary"} className="font-mono">
                            {s.conversion.toFixed(1)}%
                          </Badge>
                        </TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </div>
              {/* chart */}
              <div className="h-[280px]">
                <ResponsiveContainer width="100%" height="100%">
                  <BarChart data={sourceData} layout="vertical" margin={{ left: 10, right: 20 }}>
                    <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border))" />
                    <XAxis type="number" tick={{ fontSize: 11 }} />
                    <YAxis dataKey="name" type="category" width={80} tick={{ fontSize: 11 }} />
                    <Tooltip content={<ChartTooltip />} />
                    <Bar dataKey="leads" name="Leads" fill="hsl(var(--primary))" radius={[0, 4, 4, 0]} />
                    <Bar dataKey="sales" name="Vendas" fill="hsl(142, 76%, 36%)" radius={[0, 4, 4, 0]} />
                  </BarChart>
                </ResponsiveContainer>
              </div>
            </div>
          </CardContent>
        </Card>
      </motion.div>

      {/* ── BLOCK 3: PERFORMANCE POR VENDEDOR ── */}
      <motion.div variants={itemVariants} initial="hidden" animate="visible">
        <Card className="border-0 shadow-md">
          <CardHeader>
            <CardTitle className="text-lg font-poppins flex items-center gap-2">
              <Users className="h-5 w-5 text-primary" />
              Performance por Vendedor
            </CardTitle>
          </CardHeader>
          <CardContent className="overflow-x-auto">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead className="font-poppins">#</TableHead>
                  <TableHead className="font-poppins">Vendedor</TableHead>
                  <TableHead className="font-poppins text-right">Leads</TableHead>
                  <TableHead className="font-poppins text-right">Qualif.</TableHead>
                  <TableHead className="font-poppins text-right">Vendas</TableHead>
                  <TableHead className="font-poppins text-right">Receita</TableHead>
                  <TableHead className="font-poppins text-right">Conv. %</TableHead>
                  <TableHead className="font-poppins text-right">Ticket Médio</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {sellerData.length === 0 ? (
                  <TableRow><TableCell colSpan={8} className="text-center text-muted-foreground py-8">Sem dados no período</TableCell></TableRow>
                ) : sellerData.map((s, i) => (
                  <TableRow key={s.name} className={i === 0 ? "bg-primary/5" : ""}>
                    <TableCell>
                      {i === 0 ? <Crown className="h-4 w-4 text-amber-500" /> : <span className="text-muted-foreground">{i + 1}</span>}
                    </TableCell>
                    <TableCell className="font-medium">
                      {s.name}
                      {i === 0 && <Badge className="ml-2 bg-amber-500/10 text-amber-600 border-amber-500/20">Top</Badge>}
                    </TableCell>
                    <TableCell className="text-right">{s.leads}</TableCell>
                    <TableCell className="text-right">{s.qualified}</TableCell>
                    <TableCell className="text-right font-semibold">{s.sales}</TableCell>
                    <TableCell className="text-right font-semibold">{fmtCurrency(s.revenue)}</TableCell>
                    <TableCell className="text-right">
                      <Badge variant={s.conversion > 10 ? "default" : "secondary"} className="font-mono">
                        {s.conversion.toFixed(1)}%
                      </Badge>
                    </TableCell>
                    <TableCell className="text-right">{fmtCurrency(s.avgTicket)}</TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </CardContent>
        </Card>
      </motion.div>

      {/* ── BLOCK 4: FUNIL AVANÇADO ── */}
      <motion.div variants={itemVariants} initial="hidden" animate="visible">
        <Card className="border-0 shadow-md">
          <CardHeader>
            <CardTitle className="text-lg font-poppins flex items-center gap-2">
              <Target className="h-5 w-5 text-primary" />
              Funil Avançado
            </CardTitle>
          </CardHeader>
          <CardContent>
            {bottleneck && (
              <div className="mb-6 p-4 rounded-lg bg-destructive/10 border border-destructive/20 flex items-center gap-3">
                <AlertTriangle className="h-5 w-5 text-destructive flex-shrink-0" />
                <p className="text-sm font-medium text-destructive">
                  Gargalo principal identificado em: <strong>{bottleneck.name}</strong> (apenas {bottleneck.dropRate.toFixed(1)}% de conversão da etapa anterior)
                </p>
              </div>
            )}
            <div className="space-y-3">
              {funnelData.map((stage, i) => {
                const maxCount = Math.max(...funnelData.map((s) => s.count), 1);
                const widthPct = Math.max((stage.count / maxCount) * 100, 8);
                return (
                  <div key={stage.name} className="flex items-center gap-4">
                    <div className="w-32 text-sm font-medium text-foreground truncate flex-shrink-0">{stage.name}</div>
                    <div className="flex-1 h-10 bg-muted/30 rounded-lg overflow-hidden relative">
                      <motion.div
                        initial={{ width: 0 }}
                        animate={{ width: `${widthPct}%` }}
                        transition={{ duration: 0.6, delay: i * 0.08 }}
                        className="h-full rounded-lg flex items-center px-3"
                        style={{ backgroundColor: stage.color }}
                      >
                        <span className="text-sm font-bold text-white drop-shadow">{stage.count}</span>
                      </motion.div>
                    </div>
                    <div className="w-16 text-right text-xs font-mono text-muted-foreground">
                      {i > 0 ? `${stage.dropRate.toFixed(0)}%` : "—"}
                    </div>
                  </div>
                );
              })}
            </div>
          </CardContent>
        </Card>
      </motion.div>

      {/* ── BLOCK 5: QUALIDADE DE LEAD ── */}
      <motion.div variants={containerVariants} initial="hidden" animate="visible" className="grid md:grid-cols-3 gap-4">
        {[
          { label: "Leads sem Resposta", value: `${quality.pctNoReply.toFixed(1)}%`, icon: Clock, danger: quality.pctNoReply > 40 },
          { label: "Leads Perdidos", value: `${quality.pctLost.toFixed(1)}%`, icon: TrendingDown, danger: quality.pctLost > 30 },
          { label: "Leads Reativados", value: `${quality.pctReactivated.toFixed(1)}%`, icon: TrendingUp, danger: false },
        ].map((q, i) => (
          <motion.div key={i} variants={itemVariants}>
            <Card className={cn("border-0 shadow-md", q.danger && "border-l-4 border-l-destructive")}>
              <CardContent className="p-5 flex items-center gap-4">
                <div className={cn("w-12 h-12 rounded-xl flex items-center justify-center", q.danger ? "bg-destructive/10" : "bg-primary/10")}>
                  <q.icon className={cn("h-6 w-6", q.danger ? "text-destructive" : "text-primary")} />
                </div>
                <div>
                  <p className="text-xs font-poppins text-muted-foreground uppercase tracking-wide">{q.label}</p>
                  <p className="text-2xl font-bold font-poppins text-foreground">{q.value}</p>
                </div>
              </CardContent>
            </Card>
          </motion.div>
        ))}
      </motion.div>

      {/* ── BLOCK 6: RECEITA AVANÇADA ── */}
      <motion.div variants={containerVariants} initial="hidden" animate="visible" className="grid md:grid-cols-2 gap-4">
        <motion.div variants={itemVariants}>
          <Card className="border-0 shadow-md">
            <CardHeader>
              <CardTitle className="text-lg font-poppins">Receita por Origem</CardTitle>
            </CardHeader>
            <CardContent className="h-[260px]">
              <ResponsiveContainer width="100%" height="100%">
                <BarChart data={revenueBySource}>
                  <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border))" />
                  <XAxis dataKey="name" tick={{ fontSize: 11 }} />
                  <YAxis tick={{ fontSize: 11 }} />
                  <Tooltip content={<ChartTooltip />} />
                  <Bar dataKey="value" name="Receita" radius={[4, 4, 0, 0]}>
                    {revenueBySource.map((_, i) => (
                      <Cell key={i} fill={COLORS[i % COLORS.length]} />
                    ))}
                  </Bar>
                </BarChart>
              </ResponsiveContainer>
            </CardContent>
          </Card>
        </motion.div>
        <motion.div variants={itemVariants}>
          <Card className="border-0 shadow-md">
            <CardHeader>
              <CardTitle className="text-lg font-poppins">Receita por Vendedor</CardTitle>
            </CardHeader>
            <CardContent className="h-[260px]">
              <ResponsiveContainer width="100%" height="100%">
                <BarChart data={revenueBySeller}>
                  <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border))" />
                  <XAxis dataKey="name" tick={{ fontSize: 11 }} />
                  <YAxis tick={{ fontSize: 11 }} />
                  <Tooltip content={<ChartTooltip />} />
                  <Bar dataKey="value" name="Receita" radius={[4, 4, 0, 0]}>
                    {revenueBySeller.map((_, i) => (
                      <Cell key={i} fill={COLORS[i % COLORS.length]} />
                    ))}
                  </Bar>
                </BarChart>
              </ResponsiveContainer>
            </CardContent>
          </Card>
        </motion.div>
      </motion.div>

      {/* Projected revenue */}
      <motion.div variants={itemVariants} initial="hidden" animate="visible">
        <Card className="border-0 shadow-md bg-gradient-to-r from-primary/5 to-primary/10">
          <CardContent className="p-6 flex flex-col md:flex-row items-center justify-between gap-4">
            <div>
              <p className="text-xs font-poppins text-muted-foreground uppercase tracking-wide mb-1">Receita Acumulada</p>
              <p className="text-3xl font-bold font-poppins text-foreground">{fmtCurrency(exec.revenue)}</p>
            </div>
            <div className="h-px md:h-12 md:w-px w-full bg-border" />
            <div>
              <p className="text-xs font-poppins text-muted-foreground uppercase tracking-wide mb-1">Projeção no Período</p>
              <p className="text-3xl font-bold font-poppins text-primary">{fmtCurrency(projectedRevenue)}</p>
            </div>
          </CardContent>
        </Card>
      </motion.div>
    </div>
  );
}
