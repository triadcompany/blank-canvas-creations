import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Check, Users, Target, TrendingUp, BarChart3, Zap, Shield } from "lucide-react";
import { useNavigate } from "react-router-dom";
import { ContainerScroll } from "@/components/ui/container-scroll-animation";
import crmKanbanImage from "@/assets/crm-hero.jpg";

export default function LandingPage() {
  const navigate = useNavigate();

  const features = [
    {
      icon: Target,
      title: "Gestão Completa de Leads",
      description: "Organize cada cliente interessado em comprar um veículo. Nunca mais perca uma venda por desorganização."
    },
    {
      icon: Users,
      title: "Distribua Leads na Sua Equipe",
      description: "Divida automaticamente os clientes entre seus vendedores. Cada lead no vendedor certo, na hora certa."
    },
    {
      icon: TrendingUp,
      title: "Acompanhe Todo o Processo",
      description: "Visualize em qual etapa está cada negociação: primeiro contato, test-drive, proposta, financiamento ou fechamento."
    },
    {
      icon: BarChart3,
      title: "Relatórios de Vendas",
      description: "Veja quantos carros cada vendedor está vendendo, quais são os mais procurados e quanto faturou no mês."
    },
    {
      icon: Zap,
      title: "WhatsApp Integrado",
      description: "Receba notificação no WhatsApp quando chegar um novo cliente interessado. Responda rápido e venda mais."
    },
    {
      icon: Shield,
      title: "Seus Dados Seguros",
      description: "Toda sua base de clientes protegida com a mesma segurança dos bancos. Backups automáticos todos os dias."
    }
  ];

  const plans = [
    {
      name: "Loja Pequena",
      price: "R$ 147",
      period: "/mês",
      features: [
        "Até 3 vendedores",
        "500 clientes/mês",
        "Gestão de estoque básica",
        "Suporte por WhatsApp"
      ]
    },
    {
      name: "Revenda Média",
      price: "R$ 347",
      period: "/mês",
      popular: true,
      features: [
        "Até 10 vendedores",
        "Clientes ilimitados",
        "Controle completo de estoque",
        "Notificação WhatsApp",
        "Distribuição automática de leads",
        "Relatórios de vendas",
        "Suporte prioritário"
      ]
    },
    {
      name: "Grupo de Lojas",
      price: "Sob consulta",
      period: "",
      features: [
        "Vendedores ilimitados",
        "Múltiplas lojas",
        "Gestão centralizada",
        "API personalizada",
        "Treinamento da equipe",
        "Suporte 24/7"
      ]
    }
  ];

  return (
    <div className="min-h-screen bg-background">
      {/* Header */}
      <header className="border-b sticky top-0 bg-background/95 backdrop-blur supports-[backdrop-filter]:bg-background/60 z-50">
        <div className="container mx-auto px-4 h-16 flex items-center justify-between">
          <div className="flex items-center gap-2">
            <Target className="h-6 w-6 text-primary" />
            <span className="font-bold text-xl">AutoLead</span>
          </div>
          <nav className="hidden md:flex items-center gap-6">
            <a href="#features" className="text-sm font-medium hover:text-primary transition-colors">
              Recursos
            </a>
            <a href="#pricing" className="text-sm font-medium hover:text-primary transition-colors">
              Preços
            </a>
            <Button variant="ghost" onClick={() => navigate("/auth")}>
              Login
            </Button>
            <Button onClick={() => navigate("/auth")}>
              Começar Grátis
            </Button>
          </nav>
        </div>
      </header>

      {/* Hero Section */}
      <section className="py-20 md:py-32">
        <div className="container mx-auto px-4">
          <div className="max-w-4xl mx-auto text-center">
            <h1 className="text-4xl md:text-6xl font-bold mb-6 bg-gradient-to-r from-primary to-primary/60 bg-clip-text text-transparent">
              Venda Mais Carros com Menos Esforço
            </h1>
            <p className="text-xl text-muted-foreground mb-8 max-w-2xl mx-auto">
              O sistema completo para donos de lojas e revendas de veículos. Organize seus clientes, distribua leads para sua equipe e acompanhe cada venda do primeiro contato até a chave na mão.
            </p>
            <div className="flex flex-col sm:flex-row gap-4 justify-center">
              <Button size="lg" onClick={() => navigate("/auth")} className="text-lg">
                Começar Gratuitamente
              </Button>
              <Button size="lg" variant="outline" className="text-lg">
                Agendar Demo
              </Button>
            </div>
            <p className="text-sm text-muted-foreground mt-4">
              ✓ Teste grátis por 14 dias ✓ Sem compromisso
            </p>
          </div>
        </div>
      </section>

      {/* CRM Preview Section with Scroll Animation */}
      <section className="overflow-hidden bg-background">
        <ContainerScroll
          titleComponent={
            <>
              <h2 className="text-3xl md:text-5xl font-bold mb-4">
                Veja o AutoLead em ação
              </h2>
              <p className="text-xl text-muted-foreground max-w-2xl mx-auto">
                Acompanhe suas oportunidades em um quadro visual intuitivo
              </p>
            </>
          }
        >
          <img
            src={crmKanbanImage}
            alt="Quadro Kanban de Oportunidades do AutoLead CRM"
            className="mx-auto rounded-2xl object-cover h-full w-full object-top"
            draggable={false}
          />
        </ContainerScroll>
      </section>

      {/* Features Section */}
      <section id="features" className="py-20 bg-muted/50">
        <div className="container mx-auto px-4">
          <div className="text-center mb-16">
            <h2 className="text-3xl md:text-5xl font-bold mb-4">
              Tudo que sua loja precisa para vender mais
            </h2>
            <p className="text-xl text-muted-foreground max-w-2xl mx-auto">
              Feito especialmente para revendas de veículos que querem crescer e se organizar
            </p>
          </div>
          <div className="grid md:grid-cols-2 lg:grid-cols-3 gap-8">
            {features.map((feature, index) => (
              <Card key={index} className="border-2 hover:border-primary/50 transition-colors">
                <CardHeader>
                  <feature.icon className="h-12 w-12 text-primary mb-4" />
                  <CardTitle className="text-xl">{feature.title}</CardTitle>
                  <CardDescription className="text-base">
                    {feature.description}
                  </CardDescription>
                </CardHeader>
              </Card>
            ))}
          </div>
        </div>
      </section>

      {/* Pricing Section */}
      <section id="pricing" className="py-20">
        <div className="container mx-auto px-4">
          <div className="text-center mb-16">
            <h2 className="text-3xl md:text-5xl font-bold mb-4">
              Planos para lojas de todos os tamanhos
            </h2>
            <p className="text-xl text-muted-foreground max-w-2xl mx-auto">
              Do lojista solo até grandes grupos de revendas
            </p>
          </div>
          <div className="grid md:grid-cols-3 gap-8 max-w-6xl mx-auto">
            {plans.map((plan, index) => (
              <Card
                key={index}
                className={`relative ${
                  plan.popular
                    ? "border-primary border-2 shadow-lg scale-105"
                    : "border-2"
                }`}
              >
                {plan.popular && (
                  <div className="absolute -top-4 left-1/2 -translate-x-1/2">
                    <span className="bg-primary text-primary-foreground px-4 py-1 rounded-full text-sm font-semibold">
                      Mais Popular
                    </span>
                  </div>
                )}
                <CardHeader className="text-center pb-8">
                  <CardTitle className="text-2xl mb-2">{plan.name}</CardTitle>
                  <div className="mb-4">
                    <span className="text-4xl font-bold">{plan.price}</span>
                    <span className="text-muted-foreground">{plan.period}</span>
                  </div>
                  <Button
                    className="w-full"
                    variant={plan.popular ? "default" : "outline"}
                    onClick={() => navigate("/auth")}
                  >
                    Começar Agora
                  </Button>
                </CardHeader>
                <CardContent>
                  <ul className="space-y-3">
                    {plan.features.map((feature, fIndex) => (
                      <li key={fIndex} className="flex items-start gap-2">
                        <Check className="h-5 w-5 text-primary flex-shrink-0 mt-0.5" />
                        <span>{feature}</span>
                      </li>
                    ))}
                  </ul>
                </CardContent>
              </Card>
            ))}
          </div>
        </div>
      </section>

      {/* CTA Section */}
      <section className="py-20 bg-primary text-primary-foreground">
        <div className="container mx-auto px-4 text-center">
          <h2 className="text-3xl md:text-5xl font-bold mb-6">
            Pronto para vender mais carros?
          </h2>
          <p className="text-xl mb-8 max-w-2xl mx-auto opacity-90">
            Junte-se a centenas de revendas que já organizam suas vendas e vendem mais com o AutoLead
          </p>
          <Button
            size="lg"
            variant="secondary"
            className="text-lg"
            onClick={() => navigate("/auth")}
          >
            Começar Gratuitamente
          </Button>
        </div>
      </section>

      {/* Footer */}
      <footer className="py-12 border-t">
        <div className="container mx-auto px-4">
          <div className="grid md:grid-cols-4 gap-8">
            <div>
              <div className="flex items-center gap-2 mb-4">
                <Target className="h-6 w-6 text-primary" />
                <span className="font-bold text-xl">AutoLead</span>
              </div>
              <p className="text-sm text-muted-foreground">
                Sistema completo para gestão de vendas em lojas e revendas de veículos.
              </p>
            </div>
            <div>
              <h3 className="font-semibold mb-4">Produto</h3>
              <ul className="space-y-2 text-sm text-muted-foreground">
                <li><a href="#features" className="hover:text-primary">Recursos</a></li>
                <li><a href="#pricing" className="hover:text-primary">Preços</a></li>
                <li><a href="#" className="hover:text-primary">Demo</a></li>
              </ul>
            </div>
            <div>
              <h3 className="font-semibold mb-4">Empresa</h3>
              <ul className="space-y-2 text-sm text-muted-foreground">
                <li><a href="#" className="hover:text-primary">Sobre</a></li>
                <li><a href="#" className="hover:text-primary">Blog</a></li>
                <li><a href="#" className="hover:text-primary">Contato</a></li>
              </ul>
            </div>
            <div>
              <h3 className="font-semibold mb-4">Legal</h3>
              <ul className="space-y-2 text-sm text-muted-foreground">
                <li><a href="#" className="hover:text-primary">Privacidade</a></li>
                <li><a href="#" className="hover:text-primary">Termos</a></li>
              </ul>
            </div>
          </div>
          <div className="mt-8 pt-8 border-t text-center text-sm text-muted-foreground">
            © 2025 AutoLead. Todos os direitos reservados.
          </div>
        </div>
      </footer>
    </div>
  );
}
