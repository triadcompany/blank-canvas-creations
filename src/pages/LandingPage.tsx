import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { 
  Target, Users, TrendingUp, BarChart3, Zap, Shield, 
  ArrowRight, CheckCircle2, XCircle, Building2, Smartphone,
  Lock, Server, UserCheck, Layers, Clock, Eye, MessageSquare,
  ChevronRight, Sparkles, Play
} from "lucide-react";
import { useNavigate } from "react-router-dom";
import { motion } from "framer-motion";
import PricingSection from "@/components/landing/PricingSection";

export default function LandingPage() {
  const navigate = useNavigate();

  const problems = [
    { icon: XCircle, text: "Leads chegam e se perdem em planilhas ou WhatsApp" },
    { icon: XCircle, text: "Falta de organização gera esquecimentos e vendas perdidas" },
    { icon: XCircle, text: "Follow-ups são feitos sem padrão ou simplesmente esquecidos" },
    { icon: XCircle, text: "Sem visibilidade do que cada vendedor está fazendo" },
  ];

  const features = [
    {
      icon: Target,
      title: "Gestão de Leads",
      description: "Capture, organize e acompanhe cada lead do primeiro contato até a venda."
    },
    {
      icon: TrendingUp,
      title: "Funil de Vendas",
      description: "Visualize todas as oportunidades em um quadro intuitivo e fácil de gerenciar."
    },
    {
      icon: Clock,
      title: "Atividades e Follow-ups",
      description: "Agende tarefas, ligações e lembretes automáticos para nunca perder um contato."
    },
    {
      icon: Users,
      title: "Gestão de Equipe",
      description: "Distribua leads, acompanhe a performance e mantenha o time alinhado."
    },
    {
      icon: Eye,
      title: "Histórico Centralizado",
      description: "Todo o histórico de interações em um só lugar, acessível por toda a equipe."
    },
    {
      icon: BarChart3,
      title: "Relatórios Inteligentes",
      description: "Dashboards e métricas para decisões baseadas em dados reais."
    },
  ];

  const audiences = [
    { icon: Building2, title: "Pequenas e médias empresas", description: "Que querem crescer de forma organizada" },
    { icon: Users, title: "Times comerciais", description: "Que precisam de processos claros e eficientes" },
    { icon: Smartphone, title: "Prestadores de serviço", description: "Que vendem pelo WhatsApp ou telefone" },
    { icon: MessageSquare, title: "Negócios online", description: "Que recebem leads de múltiplos canais" },
  ];

  const differentials = [
    { icon: Zap, title: "Interface simples", description: "Sem complexidade, começa a usar em minutos" },
    { icon: Clock, title: "Rápida implementação", description: "Sem instalação, funciona no navegador" },
    { icon: Layers, title: "Multiempresa", description: "Gerencie múltiplas unidades em um só lugar" },
    { icon: UserCheck, title: "Controle de permissões", description: "Defina quem vê e edita cada informação" },
    { icon: Target, title: "Foco em produtividade", description: "Telas otimizadas para o dia a dia comercial" },
  ];

  const securities = [
    { icon: Lock, title: "Dados protegidos", description: "Criptografia de ponta a ponta" },
    { icon: UserCheck, title: "Controle de acesso", description: "Permissões granulares por usuário" },
    { icon: Shield, title: "Autenticação segura", description: "Login seguro com verificação em duas etapas" },
    { icon: Server, title: "Infraestrutura confiável", description: "Servidores com 99.9% de disponibilidade" },
  ];

  const fadeInUp = {
    initial: { opacity: 0, y: 30 },
    whileInView: { opacity: 1, y: 0 },
    viewport: { once: true },
    transition: { duration: 0.5 }
  };

  const staggerContainer = {
    initial: {},
    whileInView: { transition: { staggerChildren: 0.1 } },
    viewport: { once: true }
  };

  return (
    <div className="min-h-screen bg-background overflow-x-hidden">
      {/* Header */}
      <header className="fixed top-0 left-0 right-0 z-50 bg-background/80 backdrop-blur-lg border-b border-border/50">
        <div className="container mx-auto px-4 sm:px-6 lg:px-8">
          <div className="h-16 md:h-20 flex items-center justify-between">
            <div className="flex items-center gap-2">
              <div className="w-9 h-9 bg-gradient-to-br from-primary to-accent rounded-lg flex items-center justify-center">
                <Sparkles className="w-5 h-5 text-primary-foreground" />
              </div>
              <span className="font-bold text-xl">AutoLead</span>
            </div>
            <nav className="hidden md:flex items-center gap-8">
              <a href="#solucao" className="text-sm font-medium text-muted-foreground hover:text-foreground transition-colors">
                Solução
              </a>
              <a href="#funcionalidades" className="text-sm font-medium text-muted-foreground hover:text-foreground transition-colors">
                Funcionalidades
              </a>
              <a href="#seguranca" className="text-sm font-medium text-muted-foreground hover:text-foreground transition-colors">
                Segurança
              </a>
            </nav>
            <div className="flex items-center gap-3">
              <Button variant="ghost" onClick={() => navigate("/auth")} className="hidden sm:flex">
                Entrar
              </Button>
              <Button onClick={() => navigate("/auth")} className="font-semibold">
                Começar agora
              </Button>
            </div>
          </div>
        </div>
      </header>

      {/* Hero Section */}
      <section className="pt-32 pb-20 md:pt-40 md:pb-32 relative">
        {/* Background decorations */}
        <div className="absolute inset-0 overflow-hidden pointer-events-none">
          <div className="absolute top-20 left-1/4 w-96 h-96 bg-primary/5 rounded-full blur-3xl" />
          <div className="absolute bottom-0 right-1/4 w-80 h-80 bg-accent/5 rounded-full blur-3xl" />
        </div>

        <div className="container mx-auto px-4 sm:px-6 lg:px-8 relative">
          <motion.div 
            className="max-w-4xl mx-auto text-center"
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.6 }}
          >
            {/* Badge */}
            <motion.div 
              className="inline-flex items-center gap-2 bg-primary/10 text-primary px-4 py-2 rounded-full text-sm font-medium mb-8"
              initial={{ opacity: 0, scale: 0.9 }}
              animate={{ opacity: 1, scale: 1 }}
              transition={{ delay: 0.2 }}
            >
              <Sparkles className="w-4 h-4" />
              CRM para times que querem vender mais
            </motion.div>

            {/* Headline */}
            <h1 className="text-4xl sm:text-5xl md:text-6xl lg:text-7xl font-bold mb-6 tracking-tight">
              <span className="text-foreground">Organize suas vendas.</span>
              <br />
              <span className="bg-gradient-to-r from-primary via-accent to-primary bg-clip-text text-transparent">
                Feche mais negócios.
              </span>
            </h1>

            {/* Subheadline */}
            <p className="text-lg sm:text-xl text-muted-foreground mb-10 max-w-2xl mx-auto leading-relaxed">
              O CRM simples e poderoso para pequenas e médias empresas. 
              Gerencie leads, acompanhe o funil de vendas e aumente sua conversão — tudo em um só lugar.
            </p>

            {/* CTAs */}
            <div className="flex flex-col sm:flex-row gap-4 justify-center">
              <Button 
                size="lg" 
                onClick={() => navigate("/auth")} 
                className="h-14 px-8 text-base font-semibold shadow-lg shadow-primary/25 hover:shadow-xl hover:shadow-primary/30 transition-all hover:-translate-y-0.5"
              >
                Começar agora
                <ArrowRight className="ml-2 h-5 w-5" />
              </Button>
              <Button 
                size="lg" 
                variant="outline" 
                className="h-14 px-8 text-base font-semibold group"
              >
                <Play className="mr-2 h-5 w-5 group-hover:text-primary transition-colors" />
                Ver como funciona
              </Button>
            </div>

            {/* Trust indicators */}
            <div className="flex flex-wrap items-center justify-center gap-6 mt-12 text-sm text-muted-foreground">
              <div className="flex items-center gap-2">
                <CheckCircle2 className="h-5 w-5 text-primary" />
                <span>Teste grátis</span>
              </div>
              <div className="flex items-center gap-2">
                <CheckCircle2 className="h-5 w-5 text-primary" />
                <span>Sem cartão de crédito</span>
              </div>
              <div className="flex items-center gap-2">
                <CheckCircle2 className="h-5 w-5 text-primary" />
                <span>Pronto em minutos</span>
              </div>
            </div>
          </motion.div>
        </div>
      </section>

      {/* Problems Section */}
      <section className="py-20 md:py-28 bg-muted/30">
        <div className="container mx-auto px-4 sm:px-6 lg:px-8">
          <motion.div 
            className="max-w-3xl mx-auto text-center mb-16"
            {...fadeInUp}
          >
            <h2 className="text-3xl md:text-4xl lg:text-5xl font-bold mb-6">
              Você conhece esses problemas?
            </h2>
            <p className="text-lg text-muted-foreground">
              Se sua equipe comercial enfrenta algum desses desafios, o AutoLead foi feito para você.
            </p>
          </motion.div>

          <motion.div 
            className="grid sm:grid-cols-2 gap-4 max-w-3xl mx-auto"
            {...staggerContainer}
          >
            {problems.map((problem, index) => (
              <motion.div
                key={index}
                className="flex items-start gap-4 p-6 bg-background rounded-2xl border border-border/50 shadow-sm"
                initial={{ opacity: 0, x: index % 2 === 0 ? -20 : 20 }}
                whileInView={{ opacity: 1, x: 0 }}
                viewport={{ once: true }}
                transition={{ delay: index * 0.1 }}
              >
                <div className="p-2 bg-destructive/10 rounded-lg shrink-0">
                  <problem.icon className="h-5 w-5 text-destructive" />
                </div>
                <p className="text-foreground font-medium">{problem.text}</p>
              </motion.div>
            ))}
          </motion.div>
        </div>
      </section>

      {/* Solution Section */}
      <section id="solucao" className="py-20 md:py-28">
        <div className="container mx-auto px-4 sm:px-6 lg:px-8">
          <motion.div 
            className="max-w-3xl mx-auto text-center mb-16"
            {...fadeInUp}
          >
            <div className="inline-flex items-center gap-2 bg-primary/10 text-primary px-4 py-2 rounded-full text-sm font-medium mb-6">
              A solução
            </div>
            <h2 className="text-3xl md:text-4xl lg:text-5xl font-bold mb-6">
              Um CRM que sua equipe vai usar de verdade
            </h2>
            <p className="text-lg text-muted-foreground leading-relaxed">
              Interface intuitiva, implementação em minutos e tudo que você precisa para 
              gerenciar seu funil de vendas. Sem complicação, sem curva de aprendizado longa.
            </p>
          </motion.div>

          <motion.div 
            id="funcionalidades"
            className="grid sm:grid-cols-2 lg:grid-cols-3 gap-6"
            {...staggerContainer}
          >
            {features.map((feature, index) => (
              <motion.div
                key={index}
                initial={{ opacity: 0, y: 20 }}
                whileInView={{ opacity: 1, y: 0 }}
                viewport={{ once: true }}
                transition={{ delay: index * 0.1 }}
              >
                <Card className="h-full border-2 border-border/50 hover:border-primary/30 transition-all duration-300 hover:shadow-lg group">
                  <CardContent className="p-6">
                    <div className="w-14 h-14 bg-primary/10 rounded-2xl flex items-center justify-center mb-5 group-hover:bg-primary/20 transition-colors">
                      <feature.icon className="h-7 w-7 text-primary" />
                    </div>
                    <h3 className="text-xl font-semibold mb-3">{feature.title}</h3>
                    <p className="text-muted-foreground">{feature.description}</p>
                  </CardContent>
                </Card>
              </motion.div>
            ))}
          </motion.div>
        </div>
      </section>

      {/* For Who Section */}
      <section className="py-20 md:py-28 bg-gradient-to-b from-muted/30 to-background">
        <div className="container mx-auto px-4 sm:px-6 lg:px-8">
          <motion.div 
            className="max-w-3xl mx-auto text-center mb-16"
            {...fadeInUp}
          >
            <h2 className="text-3xl md:text-4xl lg:text-5xl font-bold mb-6">
              Para quem é o AutoLead?
            </h2>
            <p className="text-lg text-muted-foreground">
              Feito para quem precisa organizar vendas sem burocracia
            </p>
          </motion.div>

          <motion.div 
            className="grid sm:grid-cols-2 lg:grid-cols-4 gap-6 max-w-5xl mx-auto"
            {...staggerContainer}
          >
            {audiences.map((audience, index) => (
              <motion.div
                key={index}
                className="text-center p-6 rounded-2xl bg-background border border-border/50 hover:border-primary/30 transition-all duration-300 hover:shadow-lg"
                initial={{ opacity: 0, y: 20 }}
                whileInView={{ opacity: 1, y: 0 }}
                viewport={{ once: true }}
                transition={{ delay: index * 0.1 }}
              >
                <div className="w-16 h-16 bg-primary/10 rounded-2xl flex items-center justify-center mx-auto mb-4">
                  <audience.icon className="h-8 w-8 text-primary" />
                </div>
                <h3 className="font-semibold text-lg mb-2">{audience.title}</h3>
                <p className="text-sm text-muted-foreground">{audience.description}</p>
              </motion.div>
            ))}
          </motion.div>
        </div>
      </section>

      {/* Differentials Section */}
      <section className="py-20 md:py-28">
        <div className="container mx-auto px-4 sm:px-6 lg:px-8">
          <motion.div 
            className="max-w-3xl mx-auto text-center mb-16"
            {...fadeInUp}
          >
            <h2 className="text-3xl md:text-4xl lg:text-5xl font-bold mb-6">
              Por que escolher o AutoLead?
            </h2>
            <p className="text-lg text-muted-foreground">
              Diferenciais que fazem a diferença no seu dia a dia
            </p>
          </motion.div>

          <motion.div 
            className="grid sm:grid-cols-2 lg:grid-cols-5 gap-4 max-w-6xl mx-auto"
            {...staggerContainer}
          >
            {differentials.map((diff, index) => (
              <motion.div
                key={index}
                className="flex flex-col items-center text-center p-6 rounded-2xl bg-gradient-to-b from-muted/50 to-background border border-border/50"
                initial={{ opacity: 0, scale: 0.95 }}
                whileInView={{ opacity: 1, scale: 1 }}
                viewport={{ once: true }}
                transition={{ delay: index * 0.1 }}
              >
                <div className="w-12 h-12 bg-primary/10 rounded-xl flex items-center justify-center mb-4">
                  <diff.icon className="h-6 w-6 text-primary" />
                </div>
                <h3 className="font-semibold mb-2">{diff.title}</h3>
                <p className="text-sm text-muted-foreground">{diff.description}</p>
              </motion.div>
            ))}
          </motion.div>
        </div>
      </section>

      {/* Security Section */}
      <section id="seguranca" className="py-20 md:py-28 bg-foreground text-background">
        <div className="container mx-auto px-4 sm:px-6 lg:px-8">
          <motion.div 
            className="max-w-3xl mx-auto text-center mb-16"
            {...fadeInUp}
          >
            <div className="inline-flex items-center gap-2 bg-background/10 text-background px-4 py-2 rounded-full text-sm font-medium mb-6">
              <Shield className="w-4 h-4" />
              Segurança
            </div>
            <h2 className="text-3xl md:text-4xl lg:text-5xl font-bold mb-6">
              Seus dados protegidos
            </h2>
            <p className="text-lg text-background/70">
              Segurança de nível empresarial para você focar no que importa: vender
            </p>
          </motion.div>

          <motion.div 
            className="grid sm:grid-cols-2 lg:grid-cols-4 gap-6 max-w-5xl mx-auto"
            {...staggerContainer}
          >
            {securities.map((security, index) => (
              <motion.div
                key={index}
                className="text-center p-6 rounded-2xl bg-background/5 border border-background/10"
                initial={{ opacity: 0, y: 20 }}
                whileInView={{ opacity: 1, y: 0 }}
                viewport={{ once: true }}
                transition={{ delay: index * 0.1 }}
              >
                <div className="w-14 h-14 bg-background/10 rounded-2xl flex items-center justify-center mx-auto mb-4">
                  <security.icon className="h-7 w-7 text-background" />
                </div>
                <h3 className="font-semibold text-lg mb-2">{security.title}</h3>
                <p className="text-sm text-background/60">{security.description}</p>
              </motion.div>
            ))}
          </motion.div>
        </div>
      </section>

      {/* Pricing Section */}
      <PricingSection />

      {/* Final CTA Section */}
      <section className="py-24 md:py-32 relative overflow-hidden">
        {/* Background gradient */}
        <div className="absolute inset-0 bg-gradient-to-br from-primary/5 via-background to-accent/5" />
        
        <div className="container mx-auto px-4 sm:px-6 lg:px-8 relative">
          <motion.div 
            className="max-w-3xl mx-auto text-center"
            initial={{ opacity: 0, y: 30 }}
            whileInView={{ opacity: 1, y: 0 }}
            viewport={{ once: true }}
            transition={{ duration: 0.6 }}
          >
            <h2 className="text-3xl md:text-4xl lg:text-5xl font-bold mb-6">
              Pronto para organizar suas vendas?
            </h2>
            <p className="text-lg text-muted-foreground mb-10 max-w-xl mx-auto">
              Comece agora e veja como é fácil gerenciar leads e fechar mais negócios com o AutoLead.
            </p>
            <Button 
              size="lg" 
              onClick={() => navigate("/auth")} 
              className="h-14 px-10 text-base font-semibold shadow-xl shadow-primary/25 hover:shadow-2xl hover:shadow-primary/30 transition-all hover:-translate-y-1"
            >
              Criar conta gratuita
              <ChevronRight className="ml-2 h-5 w-5" />
            </Button>
            <p className="text-sm text-muted-foreground mt-6">
              Sem compromisso. Cancele quando quiser.
            </p>
          </motion.div>
        </div>
      </section>

      {/* Footer */}
      <footer className="py-12 border-t bg-muted/30">
        <div className="container mx-auto px-4 sm:px-6 lg:px-8">
          <div className="grid md:grid-cols-4 gap-8 mb-12">
            <div className="md:col-span-2">
              <div className="flex items-center gap-2 mb-4">
                <div className="w-9 h-9 bg-gradient-to-br from-primary to-accent rounded-lg flex items-center justify-center">
                  <Sparkles className="w-5 h-5 text-primary-foreground" />
                </div>
                <span className="font-bold text-xl">AutoLead</span>
              </div>
              <p className="text-muted-foreground max-w-sm">
                O CRM simples e poderoso para pequenas e médias empresas que querem vender mais.
              </p>
            </div>
            <div>
              <h3 className="font-semibold mb-4">Produto</h3>
              <ul className="space-y-3 text-sm text-muted-foreground">
                <li><a href="#funcionalidades" className="hover:text-foreground transition-colors">Funcionalidades</a></li>
                <li><a href="#seguranca" className="hover:text-foreground transition-colors">Segurança</a></li>
                <li><a href="#" className="hover:text-foreground transition-colors">Preços</a></li>
              </ul>
            </div>
            <div>
              <h3 className="font-semibold mb-4">Empresa</h3>
              <ul className="space-y-3 text-sm text-muted-foreground">
                <li><a href="#" className="hover:text-foreground transition-colors">Sobre</a></li>
                <li><a href="#" className="hover:text-foreground transition-colors">Contato</a></li>
                <li><a href="#" className="hover:text-foreground transition-colors">Blog</a></li>
              </ul>
            </div>
          </div>
          <div className="pt-8 border-t flex flex-col sm:flex-row justify-between items-center gap-4">
            <p className="text-sm text-muted-foreground">
              © {new Date().getFullYear()} AutoLead. Todos os direitos reservados.
            </p>
            <div className="flex gap-6 text-sm text-muted-foreground">
              <a href="#" className="hover:text-foreground transition-colors">Privacidade</a>
              <a href="#" className="hover:text-foreground transition-colors">Termos</a>
            </div>
          </div>
        </div>
      </footer>
    </div>
  );
}
