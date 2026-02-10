import React from "react";
import { Button } from "@/components/ui/button";
import {
  Sidebar,
  SidebarContent,
  SidebarFooter,
  SidebarGroup,
  SidebarGroupContent,
  SidebarGroupLabel,
  SidebarHeader,
  SidebarMenu,
  SidebarMenuButton,
  SidebarMenuItem,
  SidebarTrigger,
} from "@/components/ui/sidebar";
import { 
  Home, 
  Users, 
  BarChart3, 
  Settings,
  LogOut,
  User,
  List,
  Workflow,
  Cog,
  Building2,
  CalendarClock,
  MessageSquare,
  Crown,
  MailCheck,
  PlayCircle,
  ChevronDown,
} from "lucide-react";
import { useLocation, useNavigate, NavLink } from "react-router-dom";
import { useSubscription } from "@/hooks/useSubscription";
import { useAuth } from "@/contexts/AuthContext";

const menuItems = [
  {
    title: "Dashboard",
    url: "/",
    icon: Home,
  },
  {
    title: "Leads",
    url: "/leads",
    icon: List,
  },
  {
    title: "Oportunidades",
    url: "/oportunidades",
    icon: Workflow,
  },
  {
    title: "Prospecção",
    url: "/prospeccao",
    icon: Building2,
  },
  {
    title: "Mensagens",
    url: "/mensagens",
    icon: MessageSquare,
  },
  {
    title: "Follow-ups",
    url: "/follow-ups",
    icon: CalendarClock,
  },
  {
    title: "Relatórios",
    url: "/reports",
    icon: BarChart3,
  },
];

const adminMenuItems = [
  {
    title: "Pipelines",
    url: "/pipelines",
    icon: Cog,
  },
  {
    title: "Configurações",
    url: "/settings",
    icon: Settings,
  },
];

export function CRMSidebarWithAuth() {
  const location = useLocation();
  const navigate = useNavigate();
  const { profile, signOut, isAdmin } = useAuth();
  const { subscription, loading: subscriptionLoading } = useSubscription();
  
  const searchParams = new URLSearchParams(location.search);
  const currentTab = searchParams.get('tab');
  const isFollowupActive = location.pathname === '/settings' && (currentTab === 'templates' || currentTab === 'cadences');
  const [followupOpen, setFollowupOpen] = React.useState(isFollowupActive);

  React.useEffect(() => {
    if (isFollowupActive) setFollowupOpen(true);
  }, [isFollowupActive]);

  const getPlanLabel = () => {
    if (subscriptionLoading) return "...";
    if (!subscription?.subscribed || !subscription.plan) return "Free";
    return subscription.plan === "start" ? "Start" : "Scale";
  };

  const getPlanColor = () => {
    if (!subscription?.subscribed || !subscription.plan) return "text-muted-foreground";
    return subscription.plan === "scale" ? "text-amber-500" : "text-primary";
  };

  const handleLogout = async () => {
    await signOut();
    navigate('/auth');
  };
  
  return (
    <Sidebar className="hidden md:flex border-r border-border/40">
      <SidebarHeader className="px-4 py-6">
        <div className="flex items-center space-x-2">
          <div className="w-8 h-8 bg-gradient-to-br from-primary to-primary/80 rounded-lg flex items-center justify-center">
            <span className="text-white font-bold text-sm">CRM</span>
          </div>
          <h2 className="text-lg font-poppins font-bold text-foreground">AutoLead</h2>
        </div>
      </SidebarHeader>
      
      <SidebarContent>
        <SidebarGroup>
          <SidebarGroupLabel className="font-poppins font-medium text-xs text-muted-foreground uppercase tracking-wider">
            Menu Principal
          </SidebarGroupLabel>
          <SidebarGroupContent>
            <SidebarMenu>
              {menuItems.map((item) => (
                <SidebarMenuItem key={item.title}>
                  <SidebarMenuButton 
                    asChild 
                    isActive={location.pathname === item.url}
                    className="font-poppins"
                  >
                    <NavLink to={item.url} end>
                      <item.icon className="h-4 w-4" />
                      <span>{item.title}</span>
                    </NavLink>
                  </SidebarMenuButton>
                </SidebarMenuItem>
              ))}
            </SidebarMenu>
          </SidebarGroupContent>
        </SidebarGroup>

        {isAdmin && (
          <SidebarGroup>
            <SidebarGroupLabel className="font-poppins font-medium text-xs text-muted-foreground uppercase tracking-wider">
              Administração
            </SidebarGroupLabel>
            <SidebarGroupContent>
              <SidebarMenu>
                {adminMenuItems.map((item) => (
                  <SidebarMenuItem key={item.title}>
                    <SidebarMenuButton 
                      asChild 
                      isActive={location.pathname === item.url}
                      className="font-poppins"
                    >
                        <NavLink to={item.url} end>
                          <item.icon className="h-4 w-4" />
                          <span>{item.title}</span>
                        </NavLink>
                    </SidebarMenuButton>
                  </SidebarMenuItem>
                ))}

                {/* Follow-up collapsible group */}
                <SidebarMenuItem>
                  <button
                    onClick={() => setFollowupOpen(!followupOpen)}
                    className={`w-full flex items-center justify-between px-2 py-1.5 rounded-md text-sm transition-all duration-200 cursor-pointer ${
                      isFollowupActive
                        ? "bg-sidebar-accent text-sidebar-accent-foreground font-medium"
                        : "hover:bg-sidebar-accent hover:text-sidebar-accent-foreground"
                    }`}
                  >
                    <div className="flex items-center gap-2">
                      <MailCheck className="h-4 w-4" />
                      <span className="font-poppins">Follow-up</span>
                    </div>
                    <ChevronDown className={`h-3.5 w-3.5 transition-transform duration-200 ${followupOpen ? "rotate-180" : ""}`} />
                  </button>
                </SidebarMenuItem>

                {followupOpen && (
                  <>
                    <SidebarMenuItem>
                      <SidebarMenuButton 
                        asChild 
                        isActive={currentTab === 'templates'}
                        className="font-poppins ml-4 border-l-2 border-border"
                      >
                        <NavLink to="/settings?tab=templates">
                          <MessageSquare className="h-4 w-4" />
                          <span>Templates</span>
                        </NavLink>
                      </SidebarMenuButton>
                    </SidebarMenuItem>
                    <SidebarMenuItem>
                      <SidebarMenuButton 
                        asChild 
                        isActive={currentTab === 'cadences'}
                        className="font-poppins ml-4 border-l-2 border-border"
                      >
                        <NavLink to="/settings?tab=cadences">
                          <PlayCircle className="h-4 w-4" />
                          <span>Cadências</span>
                        </NavLink>
                      </SidebarMenuButton>
                    </SidebarMenuItem>
                  </>
                )}
              </SidebarMenu>
            </SidebarGroupContent>
          </SidebarGroup>
        )}
      </SidebarContent>
      
      <SidebarFooter className="p-4">
        <div className="bg-muted/50 rounded-lg p-3 space-y-2">
          <Button
            variant="ghost"
            size="sm"
            onClick={() => navigate('/settings')}
            className="w-full justify-start font-poppins text-sm p-2 h-auto"
          >
            <div className="flex items-center space-x-2 w-full">
              <div className="w-8 h-8 rounded-full overflow-hidden bg-primary flex items-center justify-center flex-shrink-0">
                {profile?.avatar_url ? (
                  <img 
                    src={profile.avatar_url} 
                    alt={profile?.name}
                    className="w-full h-full object-cover"
                  />
                ) : (
                  <span className="text-white font-bold text-xs">
                    {profile?.name?.split(' ').map(n => n[0]).join('').substring(0, 2)}
                  </span>
                )}
              </div>
              <div className="flex-1 min-w-0 text-left">
                <p className="text-sm font-poppins font-medium text-foreground truncate">
                  {profile?.name}
                </p>
                <div className="flex items-center gap-1.5">
                  <span className="text-xs text-muted-foreground font-poppins capitalize">
                    {isAdmin ? 'Admin' : 'Seller'}
                  </span>
                  <span className="text-xs text-muted-foreground">•</span>
                  <span className={`text-xs font-poppins font-medium flex items-center gap-0.5 ${getPlanColor()}`}>
                    {subscription?.plan === "scale" && <Crown className="h-3 w-3" />}
                    {getPlanLabel()}
                  </span>
                </div>
              </div>
            </div>
          </Button>
          <Button 
            variant="ghost" 
            size="sm" 
            onClick={handleLogout}
            className="w-full justify-start font-poppins text-xs"
          >
            <LogOut className="h-3 w-3 mr-2" />
            Sair
          </Button>
        </div>
      </SidebarFooter>
    </Sidebar>
  );
}