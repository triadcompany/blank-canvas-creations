import React, { useState, useRef } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { useToast } from "@/hooks/use-toast";
import { 
  User, 
  Camera, 
  Lock, 
  Save
} from "lucide-react";
import { useAuth } from "@/contexts/AuthContext";
import { supabase } from "@/integrations/supabase/client";

export function UserProfile() {
  const { profile, user, refreshProfile } = useAuth();
  const { toast } = useToast();
  const fileInputRef = useRef<HTMLInputElement>(null);
  
  const [isUpdating, setIsUpdating] = useState(false);
  const [isUploadingAvatar, setIsUploadingAvatar] = useState(false);
  const [isChangingPassword, setIsChangingPassword] = useState(false);
  
  const [formData, setFormData] = useState({
    name: profile?.name || "",
    email: user?.email || "",
    whatsapp_e164: profile?.whatsapp_e164 || "",
    currentPassword: "",
    newPassword: "",
    confirmPassword: ""
  });

  const handleInputChange = (field: keyof typeof formData, value: string) => {
    setFormData(prev => ({ ...prev, [field]: value }));
  };

  const handleUpdateProfile = async () => {
    if (!profile?.id) return;
    
    setIsUpdating(true);
    try {
      const { error } = await supabase
        .from('profiles')
        .update({ 
          name: formData.name,
          whatsapp_e164: formData.whatsapp_e164 || null
        })
        .eq('id', profile.id);

      if (error) throw error;

      await refreshProfile();
      toast({
        title: "Perfil atualizado",
        description: "Suas informações foram atualizadas com sucesso.",
      });
    } catch (error) {
      console.error('Error updating profile:', error);
      toast({
        title: "Erro",
        description: "Erro ao atualizar perfil. Tente novamente.",
        variant: "destructive",
      });
    } finally {
      setIsUpdating(false);
    }
  };

  const handleAvatarUpload = async (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    if (!file || !user?.id) return;

    if (!file.type.startsWith('image/')) {
      toast({
        title: "Erro",
        description: "Por favor, selecione apenas arquivos de imagem.",
        variant: "destructive",
      });
      return;
    }

    if (file.size > 2 * 1024 * 1024) { // 2MB limit
      toast({
        title: "Erro", 
        description: "A imagem deve ter no máximo 2MB.",
        variant: "destructive",
      });
      return;
    }

    setIsUploadingAvatar(true);
    try {
      const fileExt = file.name.split('.').pop();
      const fileName = `${user.id}/avatar.${fileExt}`;

      // Upload file to storage
      const { error: uploadError } = await supabase.storage
        .from('avatars')
        .upload(fileName, file, {
          upsert: true,
          contentType: file.type
        });

      if (uploadError) throw uploadError;

      // Get public URL
      const { data: { publicUrl } } = supabase.storage
        .from('avatars')
        .getPublicUrl(fileName);

      // Update profile with avatar URL
      const { error: updateError } = await supabase
        .from('profiles')
        .update({ avatar_url: publicUrl })
        .eq('user_id', user.id);

      if (updateError) throw updateError;

      await refreshProfile();
      toast({
        title: "Avatar atualizado",
        description: "Sua foto foi atualizada com sucesso.",
      });
    } catch (error) {
      console.error('Error uploading avatar:', error);
      toast({
        title: "Erro",
        description: "Erro ao fazer upload da imagem. Tente novamente.",
        variant: "destructive",
      });
    } finally {
      setIsUploadingAvatar(false);
    }
  };

  const handleChangePassword = async () => {
    if (formData.newPassword !== formData.confirmPassword) {
      toast({
        title: "Erro",
        description: "As senhas não coincidem.",
        variant: "destructive",
      });
      return;
    }

    if (formData.newPassword.length < 6) {
      toast({
        title: "Erro",
        description: "A nova senha deve ter pelo menos 6 caracteres.",
        variant: "destructive",
      });
      return;
    }

    setIsChangingPassword(true);
    try {
      const { error } = await supabase.auth.updateUser({
        password: formData.newPassword
      });

      if (error) throw error;

      setFormData(prev => ({
        ...prev,
        currentPassword: "",
        newPassword: "",
        confirmPassword: ""
      }));

      toast({
        title: "Senha alterada",
        description: "Sua senha foi alterada com sucesso.",
      });
    } catch (error) {
      console.error('Error changing password:', error);
      toast({
        title: "Erro",
        description: "Erro ao alterar senha. Tente novamente.",
        variant: "destructive",
      });
    } finally {
      setIsChangingPassword(false);
    }
  };

  return (
    <div className="space-y-6">
      {/* Profile Information */}
      <Card className="card-gradient border-0">
        <CardHeader>
          <CardTitle className="font-poppins font-semibold flex items-center space-x-2">
            <User className="h-5 w-5 text-primary" />
            <span>Informações Pessoais</span>
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-6">
          {/* Avatar Section */}
          <div className="flex items-center space-x-4">
            <Avatar className="w-20 h-20">
              <AvatarImage src={profile?.avatar_url} alt={profile?.name} />
              <AvatarFallback className="bg-primary text-primary-foreground text-lg font-bold">
                {profile?.name?.split(' ').map(n => n[0]).join('').substring(0, 2)}
              </AvatarFallback>
            </Avatar>
            <div className="space-y-2">
              <Button
                variant="outline"
                onClick={() => fileInputRef.current?.click()}
                disabled={isUploadingAvatar}
                className="font-poppins"
              >
                <Camera className="h-4 w-4 mr-2" />
                {isUploadingAvatar ? "Enviando..." : "Alterar Foto"}
              </Button>
              <p className="text-xs text-muted-foreground font-poppins">
                PNG, JPG até 2MB
              </p>
              <input
                ref={fileInputRef}
                type="file"
                accept="image/*"
                onChange={handleAvatarUpload}
                className="hidden"
              />
            </div>
          </div>

          {/* Name and Email */}
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <div className="space-y-2">
              <Label htmlFor="name" className="font-poppins font-medium">
                Nome Completo
              </Label>
              <Input 
                id="name"
                value={formData.name}
                onChange={(e) => handleInputChange('name', e.target.value)}
                placeholder="Seu nome completo"
                className="font-poppins"
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="email" className="font-poppins font-medium">
                E-mail
              </Label>
              <Input 
                id="email"
                value={formData.email}
                disabled
                className="font-poppins bg-muted"
              />
              <p className="text-xs text-muted-foreground font-poppins">
                Para alterar o e-mail, entre em contato com o suporte
              </p>
            </div>
          </div>

          {/* WhatsApp */}
          <div className="space-y-2">
            <Label htmlFor="whatsapp" className="font-poppins font-medium">
              WhatsApp (Formato E.164)
            </Label>
            <Input 
              id="whatsapp"
              value={formData.whatsapp_e164}
              onChange={(e) => handleInputChange('whatsapp_e164', e.target.value)}
              placeholder="+5511999999999"
              className="font-poppins font-mono"
            />
            <p className="text-xs text-muted-foreground font-poppins">
              Número com código do país para receber notificações quando um lead for atribuído (ex: +5511999999999)
            </p>
          </div>

          <Button 
            onClick={handleUpdateProfile}
            disabled={isUpdating || !formData.name.trim()}
            className="btn-gradient text-white font-poppins font-medium"
          >
            <Save className="h-4 w-4 mr-2" />
            {isUpdating ? "Salvando..." : "Salvar Alterações"}
          </Button>
        </CardContent>
      </Card>

      {/* Password Change */}
      <Card className="card-gradient border-0">
        <CardHeader>
          <CardTitle className="font-poppins font-semibold flex items-center space-x-2">
            <Lock className="h-5 w-5 text-primary" />
            <span>Alterar Senha</span>
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <div className="space-y-2">
              <Label htmlFor="newPassword" className="font-poppins font-medium">
                Nova Senha
              </Label>
              <Input 
                id="newPassword"
                type="password"
                value={formData.newPassword}
                onChange={(e) => handleInputChange('newPassword', e.target.value)}
                placeholder="Mínimo 6 caracteres"
                className="font-poppins"
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="confirmPassword" className="font-poppins font-medium">
                Confirmar Nova Senha
              </Label>
              <Input 
                id="confirmPassword"
                type="password"
                value={formData.confirmPassword}
                onChange={(e) => handleInputChange('confirmPassword', e.target.value)}
                placeholder="Confirme a nova senha"
                className="font-poppins"
              />
            </div>
          </div>

          <Button 
            onClick={handleChangePassword}
            disabled={isChangingPassword || !formData.newPassword || !formData.confirmPassword}
            className="btn-gradient text-white font-poppins font-medium"
          >
            <Lock className="h-4 w-4 mr-2" />
            {isChangingPassword ? "Alterando..." : "Alterar Senha"}
          </Button>
        </CardContent>
      </Card>
    </div>
  );
}