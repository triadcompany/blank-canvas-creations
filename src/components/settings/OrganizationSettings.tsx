import React, { useEffect, useRef, useState } from 'react';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Button } from '@/components/ui/button';
import { Building2, Upload, Loader2, Trash2, Image as ImageIcon } from 'lucide-react';
import { useAuth } from '@/contexts/AuthContext';
import { supabase } from '@/integrations/supabase/client';
import { useToast } from '@/hooks/use-toast';
import { useQueryClient } from '@tanstack/react-query';

interface OrgRow {
  id: string;
  name: string;
  cnpj: string | null;
  logo_url: string | null;
}

function formatCnpj(raw: string): string {
  const d = raw.replace(/\D/g, '').slice(0, 14);
  if (d.length <= 2) return d;
  if (d.length <= 5) return `${d.slice(0, 2)}.${d.slice(2)}`;
  if (d.length <= 8) return `${d.slice(0, 2)}.${d.slice(2, 5)}.${d.slice(5)}`;
  if (d.length <= 12) return `${d.slice(0, 2)}.${d.slice(2, 5)}.${d.slice(5, 8)}/${d.slice(8)}`;
  return `${d.slice(0, 2)}.${d.slice(2, 5)}.${d.slice(5, 8)}/${d.slice(8, 12)}-${d.slice(12)}`;
}

export function OrganizationSettings() {
  const { user, orgId, isAdmin } = useAuth();
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const fileRef = useRef<HTMLInputElement>(null);

  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [name, setName] = useState('');
  const [cnpj, setCnpj] = useState('');
  const [logoUrl, setLogoUrl] = useState<string | null>(null);
  const [original, setOriginal] = useState<OrgRow | null>(null);

  useEffect(() => {
    let cancelled = false;
    async function load() {
      if (!orgId) return;
      setLoading(true);
      const { data, error } = await supabase
        .from('organizations')
        .select('id, name, cnpj, logo_url')
        .eq('id', orgId)
        .maybeSingle();
      if (cancelled) return;
      if (error) {
        toast({
          title: 'Erro ao carregar organização',
          description: error.message,
          variant: 'destructive',
        });
        setLoading(false);
        return;
      }
      if (data) {
        setOriginal(data as OrgRow);
        setName(data.name || '');
        setCnpj(data.cnpj ? formatCnpj(data.cnpj) : '');
        setLogoUrl((data as any).logo_url || null);
      }
      setLoading(false);
    }
    load();
    return () => {
      cancelled = true;
    };
  }, [orgId, toast]);

  const handleLogoUpload = async (file: File) => {
    if (!orgId) return;
    if (file.size > 2 * 1024 * 1024) {
      toast({
        title: 'Arquivo muito grande',
        description: 'O logo deve ter até 2MB.',
        variant: 'destructive',
      });
      return;
    }
    setUploading(true);
    try {
      const ext = file.name.split('.').pop()?.toLowerCase() || 'png';
      const path = `${orgId}/logo-${Date.now()}.${ext}`;
      const { error: upErr } = await supabase.storage
        .from('org-logos')
        .upload(path, file, { upsert: true, contentType: file.type });
      if (upErr) throw upErr;
      const { data: pub } = supabase.storage.from('org-logos').getPublicUrl(path);
      setLogoUrl(pub.publicUrl);
      toast({ title: 'Logo carregado', description: 'Clique em Salvar para confirmar.' });
    } catch (err: any) {
      toast({
        title: 'Falha no upload',
        description: err?.message || 'Tente novamente.',
        variant: 'destructive',
      });
    } finally {
      setUploading(false);
    }
  };

  const handleSave = async () => {
    if (!user?.id) return;
    if (!name.trim()) {
      toast({ title: 'Nome obrigatório', variant: 'destructive' });
      return;
    }
    setSaving(true);
    try {
      const cnpjDigits = cnpj.replace(/\D/g, '');
      const { data, error } = await supabase.rpc('update_organization_details', {
        p_clerk_user_id: user.id,
        p_name: name.trim(),
        p_cnpj: cnpjDigits || null,
        p_logo_url: logoUrl,
      } as any);
      if (error) throw error;
      const row = Array.isArray(data) ? data[0] : data;
      if (row) {
        setOriginal({
          id: row.id,
          name: row.name,
          cnpj: row.cnpj,
          logo_url: row.logo_url,
        });
        setName(row.name || '');
        setCnpj(row.cnpj ? formatCnpj(row.cnpj) : '');
        setLogoUrl(row.logo_url || null);
      }
      toast({ title: 'Organização atualizada' });
      // Refresh org switcher list (reads from clerk_organizations)
      await queryClient.invalidateQueries();
    } catch (err: any) {
      toast({
        title: 'Erro ao salvar',
        description: err?.message || 'Tente novamente.',
        variant: 'destructive',
      });
    } finally {
      setSaving(false);
    }
  };

  const handleRemoveLogo = () => {
    setLogoUrl(null);
  };

  const dirty =
    !!original &&
    (name.trim() !== (original.name || '') ||
      cnpj.replace(/\D/g, '') !== (original.cnpj || '') ||
      (logoUrl || null) !== (original.logo_url || null));

  if (!isAdmin) {
    return (
      <Card className="card-gradient border-0">
        <CardContent className="p-8 text-center">
          <Building2 className="h-12 w-12 text-muted-foreground mx-auto mb-4" />
          <h2 className="text-xl font-poppins font-bold text-foreground mb-2">
            Acesso Restrito
          </h2>
          <p className="text-muted-foreground font-poppins">
            Apenas administradores podem editar os dados da organização.
          </p>
        </CardContent>
      </Card>
    );
  }

  return (
    <Card className="card-gradient border-0">
      <CardHeader>
        <CardTitle className="font-poppins flex items-center gap-2">
          <Building2 className="h-5 w-5 text-primary" />
          Dados da Organização
        </CardTitle>
        <CardDescription className="font-poppins">
          Atualize o nome, CNPJ e logo exibidos para sua equipe.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-6">
        {loading ? (
          <div className="flex items-center justify-center py-10">
            <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
          </div>
        ) : (
          <>
            {/* Logo */}
            <div className="space-y-3">
              <Label className="font-poppins">Logo</Label>
              <div className="flex items-center gap-4">
                <div className="w-20 h-20 rounded-lg border border-border bg-muted/40 flex items-center justify-center overflow-hidden flex-shrink-0">
                  {logoUrl ? (
                    <img
                      src={logoUrl}
                      alt="Logo da organização"
                      className="w-full h-full object-cover"
                    />
                  ) : (
                    <ImageIcon className="h-8 w-8 text-muted-foreground" />
                  )}
                </div>
                <div className="flex flex-col gap-2">
                  <input
                    ref={fileRef}
                    type="file"
                    accept="image/png,image/jpeg,image/webp,image/svg+xml"
                    className="hidden"
                    onChange={(e) => {
                      const f = e.target.files?.[0];
                      if (f) handleLogoUpload(f);
                      e.target.value = '';
                    }}
                  />
                  <div className="flex gap-2">
                    <Button
                      type="button"
                      variant="outline"
                      size="sm"
                      onClick={() => fileRef.current?.click()}
                      disabled={uploading}
                      className="font-poppins"
                    >
                      {uploading ? (
                        <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                      ) : (
                        <Upload className="h-4 w-4 mr-2" />
                      )}
                      {logoUrl ? 'Trocar logo' : 'Enviar logo'}
                    </Button>
                    {logoUrl && (
                      <Button
                        type="button"
                        variant="ghost"
                        size="sm"
                        onClick={handleRemoveLogo}
                        className="font-poppins text-destructive hover:text-destructive"
                      >
                        <Trash2 className="h-4 w-4 mr-2" />
                        Remover
                      </Button>
                    )}
                  </div>
                  <p className="text-xs text-muted-foreground font-poppins">
                    PNG, JPG, WEBP ou SVG. Máximo 2MB.
                  </p>
                </div>
              </div>
            </div>

            {/* Name */}
            <div className="space-y-2">
              <Label htmlFor="org-name" className="font-poppins">
                Nome da organização
              </Label>
              <Input
                id="org-name"
                value={name}
                onChange={(e) => setName(e.target.value)}
                placeholder="Ex: Minha Empresa LTDA"
                className="font-poppins"
                maxLength={120}
              />
            </div>

            {/* CNPJ */}
            <div className="space-y-2">
              <Label htmlFor="org-cnpj" className="font-poppins">
                CNPJ
              </Label>
              <Input
                id="org-cnpj"
                value={cnpj}
                onChange={(e) => setCnpj(formatCnpj(e.target.value))}
                placeholder="00.000.000/0000-00"
                className="font-poppins"
                inputMode="numeric"
              />
              <p className="text-xs text-muted-foreground font-poppins">
                Opcional. Apenas números são armazenados.
              </p>
            </div>

            <div className="flex justify-end pt-2">
              <Button
                onClick={handleSave}
                disabled={!dirty || saving || uploading}
                className="btn-gradient text-white font-poppins"
              >
                {saving && <Loader2 className="h-4 w-4 mr-2 animate-spin" />}
                Salvar alterações
              </Button>
            </div>
          </>
        )}
      </CardContent>
    </Card>
  );
}
