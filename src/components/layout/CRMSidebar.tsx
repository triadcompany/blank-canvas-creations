import React from "react";
import { NavLink, useLocation } from "react-router-dom";
import { useAuth } from "@/contexts/AuthContext";
import {
  LayoutDashboard,
  Users,
  Settings,
  BarChart3,
  Car,
  PlusCircle,
  Workflow,
  List,
  Cog,
  ListTodo,
  Building2,
  CalendarClock
} from "lucide-react";

import {
  Sidebar,
  SidebarContent,
  SidebarGroup,
  SidebarGroupContent,
  SidebarGroupLabel,
  SidebarMenu,
  SidebarMenuButton,
  SidebarMenuItem,
  SidebarTrigger,
  useSidebar,
} from "@/components/ui/sidebar";

const navigationItems = [
  {
    title: "Dashboard",
    url: "/",
    icon: LayoutDashboard,
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
    title: "Tarefas",
    url: "/tarefas",
    icon: ListTodo,
  },
  {
    title: "Veículos",
    url: "/vehicles",
    icon: Car,
  },
  {
    title: "Prospecção",
    url: "/prospeccao",
    icon: Building2,
  },
  {
    title: "Follow-ups",
    url: "/follow-ups",
    icon: CalendarClock,
  },
  {
    title: "Pipelines",
    url: "/pipelines",
    icon: Cog,
    adminOnly: true,
  },
  {
    title: "Relatórios",
    url: "/reports", 
    icon: BarChart3,
  },
  {
    title: "Configurações",
    url: "/settings",
    icon: Settings,
    adminOnly: true,
  },
];

export function CRMSidebar() {
  const { open } = useSidebar();
  const location = useLocation();
  const { isAdmin } = useAuth();
  const currentPath = location.pathname;

  const isActive = (path: string) => currentPath === path;
  const getNavClass = (active: boolean) =>
    active 
      ? "bg-primary text-primary-foreground font-medium" 
      : "hover:bg-accent hover:text-accent-foreground";

  return (
    <Sidebar collapsible="icon">
      <div className="p-4 border-b">
        <div className="flex items-center space-x-3">
          <div className="w-8 h-8 authority-gradient rounded-lg flex items-center justify-center">
            <Car className="h-4 w-4 text-white" />
          </div>
          {open && (
            <div>
              <h2 className="font-poppins font-bold text-lg text-foreground">AutoLead</h2>
              <p className="text-xs text-muted-foreground">Sistema de Gestão</p>
            </div>
          )}
        </div>
      </div>

      <SidebarContent className="p-2">
        <SidebarGroup>
          <SidebarGroupLabel className="text-xs font-poppins font-medium text-muted-foreground">
            {open && "NAVEGAÇÃO"}
          </SidebarGroupLabel>
          <SidebarGroupContent>
            <SidebarMenu className="space-y-1">
              {navigationItems
                .filter(item => !item.adminOnly || isAdmin)
                .map((item) => (
                <SidebarMenuItem key={item.title}>
                  <SidebarMenuButton asChild>
                    <NavLink
                      to={item.url}
                      className={`flex items-center space-x-3 px-3 py-2 rounded-lg transition-all duration-200 ${getNavClass(isActive(item.url))}`}
                    >
                      <item.icon className="h-5 w-5 flex-shrink-0" />
                      {open && (
                        <span className="font-poppins font-medium">{item.title}</span>
                      )}
                    </NavLink>
                  </SidebarMenuButton>
                </SidebarMenuItem>
              ))}
            </SidebarMenu>
          </SidebarGroupContent>
        </SidebarGroup>

        {open && (
          <div className="mt-auto p-4">
            <div className="card-gradient rounded-lg p-4">
              <div className="flex items-center space-x-3 mb-2">
                <PlusCircle className="h-5 w-5 text-primary" />
                <span className="text-sm font-poppins font-medium">Novo Lead</span>
              </div>
              <p className="text-xs text-muted-foreground mb-3">
                Cadastre rapidamente um novo lead
              </p>
              <button className="btn-gradient w-full text-white text-sm font-poppins font-medium py-2 rounded-lg">
                Adicionar Lead
              </button>
            </div>
          </div>
        )}
      </SidebarContent>

      <div className="p-2">
        <SidebarTrigger />
      </div>
    </Sidebar>
  );
}