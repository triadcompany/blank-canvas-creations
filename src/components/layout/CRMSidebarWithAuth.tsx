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
  Zap,
  
  Crown,
  MailCheck,
  PlayCircle,
  ChevronDown,
  Inbox,
  Bot,
  Radio,
} from "lucide-react";
import { useLocation, useNavigate, NavLink } from "react-router-dom";
import { useSubscription } from "@/hooks/useSubscription";
import { useAuth } from "@/contexts/AuthContext";
import { ThemeToggle } from "@/components/theme/ThemeToggle";
import { OrgSwitcher } from "./OrgSwitcher";
import { UserOrgMenu } from "./UserOrgMenu";

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
    title: "Automações",
    url: "/automacoes",
    icon: Zap,
  },
  {
    title: "Relatórios",
    url: "/reports",
    icon: BarChart3,
  },
  {
    title: "Inbox",
    url: "/inbox",
    icon: Inbox,
  },
  {
    title: "Disparos",
    url: "/broadcasts",
    icon: Radio,
  },
];

const adminMenuItems = [
  {
    title: "Pipelines",
    url: "/pipelines",
    icon: Cog,
  },
  {
    title: "Treinar Agente IA",
    url: "/treinar-agente",
    icon: Bot,
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
  const { profile, signOut, isAdmin, userName } = useAuth();
  const { subscription, loading: subscriptionLoading } = useSubscription();
  
  

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
      <SidebarHeader className="px-3 py-4">
        <OrgSwitcher />
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

            </SidebarMenu>
          </SidebarGroupContent>
        </SidebarGroup>
      </SidebarContent>
      
      <SidebarFooter className="p-3">
        <div className="bg-muted/50 rounded-lg p-2 space-y-1">
          <UserOrgMenu onLogout={handleLogout} />
          <ThemeToggle variant="full" />
        </div>
      </SidebarFooter>
    </Sidebar>
  );
}