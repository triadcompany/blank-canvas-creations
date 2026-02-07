-- ============================================
-- INSTAGRAM MULTI-ATENDIMENTO SYSTEM
-- Execute this SQL in your Supabase SQL Editor
-- ============================================

-- 1. Tabela de conexões do Instagram
CREATE TABLE IF NOT EXISTS public.instagram_connections (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    organization_id UUID NOT NULL REFERENCES public.saas_organizations(id) ON DELETE CASCADE,
    instagram_business_account_id TEXT NOT NULL,
    page_id TEXT NOT NULL,
    page_name TEXT,
    page_access_token TEXT NOT NULL,
    instagram_username TEXT,
    profile_picture_url TEXT,
    is_active BOOLEAN DEFAULT true,
    connected_by UUID REFERENCES auth.users(id),
    created_at TIMESTAMPTZ DEFAULT now(),
    updated_at TIMESTAMPTZ DEFAULT now(),
    UNIQUE(organization_id, instagram_business_account_id)
);

-- 2. Tabela de permissões de usuários ao Instagram
CREATE TABLE IF NOT EXISTS public.instagram_user_permissions (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    connection_id UUID NOT NULL REFERENCES public.instagram_connections(id) ON DELETE CASCADE,
    user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
    can_view BOOLEAN DEFAULT true,
    can_respond BOOLEAN DEFAULT true,
    can_transfer BOOLEAN DEFAULT false,
    granted_by UUID REFERENCES auth.users(id),
    created_at TIMESTAMPTZ DEFAULT now(),
    updated_at TIMESTAMPTZ DEFAULT now(),
    UNIQUE(connection_id, user_id)
);

-- 3. Tabela de conversas do Instagram
CREATE TABLE IF NOT EXISTS public.instagram_conversations (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    organization_id UUID NOT NULL REFERENCES public.saas_organizations(id) ON DELETE CASCADE,
    connection_id UUID NOT NULL REFERENCES public.instagram_connections(id) ON DELETE CASCADE,
    instagram_conversation_id TEXT NOT NULL,
    participant_id TEXT NOT NULL,
    participant_username TEXT,
    participant_name TEXT,
    participant_profile_picture TEXT,
    assigned_to UUID REFERENCES auth.users(id),
    status TEXT DEFAULT 'open' CHECK (status IN ('open', 'pending', 'closed')),
    priority TEXT DEFAULT 'normal' CHECK (priority IN ('low', 'normal', 'high', 'urgent')),
    last_message_at TIMESTAMPTZ,
    last_message_preview TEXT,
    unread_count INTEGER DEFAULT 0,
    first_response_at TIMESTAMPTZ,
    closed_at TIMESTAMPTZ,
    closed_by UUID REFERENCES auth.users(id),
    lead_id UUID REFERENCES public.leads(id),
    created_at TIMESTAMPTZ DEFAULT now(),
    updated_at TIMESTAMPTZ DEFAULT now(),
    UNIQUE(connection_id, instagram_conversation_id)
);

-- 4. Tabela de mensagens
CREATE TABLE IF NOT EXISTS public.instagram_messages (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    conversation_id UUID NOT NULL REFERENCES public.instagram_conversations(id) ON DELETE CASCADE,
    instagram_message_id TEXT UNIQUE,
    direction TEXT NOT NULL CHECK (direction IN ('incoming', 'outgoing')),
    content TEXT NOT NULL,
    message_type TEXT DEFAULT 'text' CHECK (message_type IN ('text', 'image', 'video', 'audio', 'file', 'sticker')),
    media_url TEXT,
    sent_by UUID REFERENCES auth.users(id),
    sent_at TIMESTAMPTZ DEFAULT now(),
    delivered_at TIMESTAMPTZ,
    read_at TIMESTAMPTZ,
    is_quick_reply BOOLEAN DEFAULT false,
    quick_reply_id UUID,
    created_at TIMESTAMPTZ DEFAULT now()
);

-- 5. Tabela de respostas rápidas
CREATE TABLE IF NOT EXISTS public.instagram_quick_replies (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    organization_id UUID NOT NULL REFERENCES public.saas_organizations(id) ON DELETE CASCADE,
    title TEXT NOT NULL,
    shortcut TEXT,
    content TEXT NOT NULL,
    category TEXT,
    usage_count INTEGER DEFAULT 0,
    created_by UUID REFERENCES auth.users(id),
    created_at TIMESTAMPTZ DEFAULT now(),
    updated_at TIMESTAMPTZ DEFAULT now()
);

-- 6. Tabela de tags para conversas
CREATE TABLE IF NOT EXISTS public.instagram_conversation_tags (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    organization_id UUID NOT NULL REFERENCES public.saas_organizations(id) ON DELETE CASCADE,
    name TEXT NOT NULL,
    color TEXT DEFAULT '#6366f1',
    created_by UUID REFERENCES auth.users(id),
    created_at TIMESTAMPTZ DEFAULT now(),
    UNIQUE(organization_id, name)
);

-- 7. Tabela de relacionamento conversa-tags
CREATE TABLE IF NOT EXISTS public.instagram_conversation_tag_assignments (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    conversation_id UUID NOT NULL REFERENCES public.instagram_conversations(id) ON DELETE CASCADE,
    tag_id UUID NOT NULL REFERENCES public.instagram_conversation_tags(id) ON DELETE CASCADE,
    assigned_by UUID REFERENCES auth.users(id),
    created_at TIMESTAMPTZ DEFAULT now(),
    UNIQUE(conversation_id, tag_id)
);

-- 8. Tabela de métricas de atendimento
CREATE TABLE IF NOT EXISTS public.instagram_metrics (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    organization_id UUID NOT NULL REFERENCES public.saas_organizations(id) ON DELETE CASCADE,
    user_id UUID REFERENCES auth.users(id),
    date DATE NOT NULL DEFAULT CURRENT_DATE,
    conversations_started INTEGER DEFAULT 0,
    conversations_closed INTEGER DEFAULT 0,
    messages_sent INTEGER DEFAULT 0,
    messages_received INTEGER DEFAULT 0,
    avg_response_time_seconds INTEGER,
    first_response_count INTEGER DEFAULT 0,
    total_first_response_seconds INTEGER DEFAULT 0,
    created_at TIMESTAMPTZ DEFAULT now(),
    updated_at TIMESTAMPTZ DEFAULT now(),
    UNIQUE(organization_id, user_id, date)
);

-- 9. Configuração de distribuição automática
CREATE TABLE IF NOT EXISTS public.instagram_distribution_config (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    organization_id UUID NOT NULL REFERENCES public.saas_organizations(id) ON DELETE CASCADE UNIQUE,
    mode TEXT DEFAULT 'round_robin' CHECK (mode IN ('round_robin', 'least_busy', 'random', 'manual')),
    max_concurrent_conversations INTEGER DEFAULT 10,
    auto_assign_new BOOLEAN DEFAULT true,
    working_hours_only BOOLEAN DEFAULT false,
    working_hours_start TIME DEFAULT '09:00',
    working_hours_end TIME DEFAULT '18:00',
    created_at TIMESTAMPTZ DEFAULT now(),
    updated_at TIMESTAMPTZ DEFAULT now()
);

-- 10. Índice para último atendente (round-robin)
CREATE TABLE IF NOT EXISTS public.instagram_distribution_state (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    organization_id UUID NOT NULL REFERENCES public.saas_organizations(id) ON DELETE CASCADE UNIQUE,
    last_assigned_user_id UUID REFERENCES auth.users(id),
    updated_at TIMESTAMPTZ DEFAULT now()
);

-- ============================================
-- INDEXES para performance
-- ============================================

CREATE INDEX IF NOT EXISTS idx_instagram_conversations_org ON public.instagram_conversations(organization_id);
CREATE INDEX IF NOT EXISTS idx_instagram_conversations_assigned ON public.instagram_conversations(assigned_to);
CREATE INDEX IF NOT EXISTS idx_instagram_conversations_status ON public.instagram_conversations(status);
CREATE INDEX IF NOT EXISTS idx_instagram_conversations_last_message ON public.instagram_conversations(last_message_at DESC);
CREATE INDEX IF NOT EXISTS idx_instagram_messages_conversation ON public.instagram_messages(conversation_id);
CREATE INDEX IF NOT EXISTS idx_instagram_messages_sent_at ON public.instagram_messages(sent_at DESC);
CREATE INDEX IF NOT EXISTS idx_instagram_user_permissions_user ON public.instagram_user_permissions(user_id);

-- ============================================
-- ROW LEVEL SECURITY
-- ============================================

ALTER TABLE public.instagram_connections ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.instagram_user_permissions ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.instagram_conversations ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.instagram_messages ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.instagram_quick_replies ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.instagram_conversation_tags ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.instagram_conversation_tag_assignments ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.instagram_metrics ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.instagram_distribution_config ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.instagram_distribution_state ENABLE ROW LEVEL SECURITY;

-- Policies para instagram_connections
CREATE POLICY "Users can view connections from their organization" ON public.instagram_connections
    FOR SELECT USING (organization_id = get_user_organization_id());

CREATE POLICY "Admins can manage connections" ON public.instagram_connections
    FOR ALL USING (
        organization_id = get_user_organization_id() 
        AND has_role(auth.uid(), 'admin'::app_role)
    );

-- Policies para instagram_user_permissions
CREATE POLICY "Users can view their own permissions" ON public.instagram_user_permissions
    FOR SELECT USING (user_id = auth.uid());

CREATE POLICY "Admins can manage permissions" ON public.instagram_user_permissions
    FOR ALL USING (
        EXISTS (
            SELECT 1 FROM public.instagram_connections c
            WHERE c.id = connection_id
            AND c.organization_id = get_user_organization_id()
            AND has_role(auth.uid(), 'admin'::app_role)
        )
    );

-- Policies para instagram_conversations
CREATE POLICY "Users with permission can view conversations" ON public.instagram_conversations
    FOR SELECT USING (
        organization_id = get_user_organization_id()
        AND (
            has_role(auth.uid(), 'admin'::app_role)
            OR assigned_to = auth.uid()
            OR EXISTS (
                SELECT 1 FROM public.instagram_user_permissions p
                WHERE p.connection_id = instagram_conversations.connection_id
                AND p.user_id = auth.uid()
                AND p.can_view = true
            )
        )
    );

CREATE POLICY "Users with permission can update assigned conversations" ON public.instagram_conversations
    FOR UPDATE USING (
        organization_id = get_user_organization_id()
        AND (
            has_role(auth.uid(), 'admin'::app_role)
            OR assigned_to = auth.uid()
        )
    );

-- Policies para instagram_messages
CREATE POLICY "Users can view messages from accessible conversations" ON public.instagram_messages
    FOR SELECT USING (
        EXISTS (
            SELECT 1 FROM public.instagram_conversations c
            WHERE c.id = conversation_id
            AND c.organization_id = get_user_organization_id()
            AND (
                has_role(auth.uid(), 'admin'::app_role)
                OR c.assigned_to = auth.uid()
                OR EXISTS (
                    SELECT 1 FROM public.instagram_user_permissions p
                    WHERE p.connection_id = c.connection_id
                    AND p.user_id = auth.uid()
                    AND p.can_view = true
                )
            )
        )
    );

CREATE POLICY "Users with permission can insert messages" ON public.instagram_messages
    FOR INSERT WITH CHECK (
        EXISTS (
            SELECT 1 FROM public.instagram_conversations c
            WHERE c.id = conversation_id
            AND c.organization_id = get_user_organization_id()
            AND (
                has_role(auth.uid(), 'admin'::app_role)
                OR c.assigned_to = auth.uid()
            )
        )
    );

-- Policies para quick_replies
CREATE POLICY "Users can view quick replies from their organization" ON public.instagram_quick_replies
    FOR SELECT USING (organization_id = get_user_organization_id());

CREATE POLICY "Users can manage quick replies" ON public.instagram_quick_replies
    FOR ALL USING (organization_id = get_user_organization_id());

-- Policies para tags
CREATE POLICY "Users can view tags from their organization" ON public.instagram_conversation_tags
    FOR SELECT USING (organization_id = get_user_organization_id());

CREATE POLICY "Users can manage tags" ON public.instagram_conversation_tags
    FOR ALL USING (organization_id = get_user_organization_id());

-- Policies para tag assignments
CREATE POLICY "Users can view tag assignments" ON public.instagram_conversation_tag_assignments
    FOR SELECT USING (
        EXISTS (
            SELECT 1 FROM public.instagram_conversations c
            WHERE c.id = conversation_id
            AND c.organization_id = get_user_organization_id()
        )
    );

CREATE POLICY "Users can manage tag assignments" ON public.instagram_conversation_tag_assignments
    FOR ALL USING (
        EXISTS (
            SELECT 1 FROM public.instagram_conversations c
            WHERE c.id = conversation_id
            AND c.organization_id = get_user_organization_id()
        )
    );

-- Policies para metrics
CREATE POLICY "Users can view metrics from their organization" ON public.instagram_metrics
    FOR SELECT USING (organization_id = get_user_organization_id());

CREATE POLICY "System can insert/update metrics" ON public.instagram_metrics
    FOR ALL USING (organization_id = get_user_organization_id());

-- Policies para distribution config
CREATE POLICY "Users can view distribution config" ON public.instagram_distribution_config
    FOR SELECT USING (organization_id = get_user_organization_id());

CREATE POLICY "Admins can manage distribution config" ON public.instagram_distribution_config
    FOR ALL USING (
        organization_id = get_user_organization_id()
        AND has_role(auth.uid(), 'admin'::app_role)
    );

-- Policies para distribution state
CREATE POLICY "System can manage distribution state" ON public.instagram_distribution_state
    FOR ALL USING (organization_id = get_user_organization_id());

-- ============================================
-- FUNCTION: Distribuir conversa automaticamente
-- ============================================

CREATE OR REPLACE FUNCTION public.distribute_instagram_conversation(
    p_conversation_id UUID,
    p_organization_id UUID
)
RETURNS JSON
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
    v_config RECORD;
    v_last_user_id UUID;
    v_next_user_id UUID;
    v_available_users UUID[];
    v_user_conversation_counts RECORD;
BEGIN
    -- Buscar configuração de distribuição
    SELECT * INTO v_config
    FROM instagram_distribution_config
    WHERE organization_id = p_organization_id;

    -- Se não houver config, criar uma padrão
    IF v_config IS NULL THEN
        INSERT INTO instagram_distribution_config (organization_id)
        VALUES (p_organization_id)
        RETURNING * INTO v_config;
    END IF;

    -- Se distribuição manual, retornar sem atribuir
    IF v_config.mode = 'manual' THEN
        RETURN json_build_object('assigned', false, 'mode', 'manual');
    END IF;

    -- Buscar usuários disponíveis com permissão de resposta
    SELECT ARRAY_AGG(p.user_id) INTO v_available_users
    FROM instagram_user_permissions p
    JOIN instagram_connections c ON c.id = p.connection_id
    JOIN instagram_conversations conv ON conv.connection_id = c.id
    WHERE conv.id = p_conversation_id
    AND p.can_respond = true;

    IF v_available_users IS NULL OR array_length(v_available_users, 1) = 0 THEN
        RETURN json_build_object('assigned', false, 'reason', 'no_available_users');
    END IF;

    -- Distribuir baseado no modo
    CASE v_config.mode
        WHEN 'round_robin' THEN
            -- Buscar último usuário atribuído
            SELECT last_assigned_user_id INTO v_last_user_id
            FROM instagram_distribution_state
            WHERE organization_id = p_organization_id;

            -- Encontrar próximo usuário no array
            IF v_last_user_id IS NULL THEN
                v_next_user_id := v_available_users[1];
            ELSE
                FOR i IN 1..array_length(v_available_users, 1) LOOP
                    IF v_available_users[i] = v_last_user_id THEN
                        IF i = array_length(v_available_users, 1) THEN
                            v_next_user_id := v_available_users[1];
                        ELSE
                            v_next_user_id := v_available_users[i + 1];
                        END IF;
                        EXIT;
                    END IF;
                END LOOP;
                
                IF v_next_user_id IS NULL THEN
                    v_next_user_id := v_available_users[1];
                END IF;
            END IF;

            -- Atualizar estado
            INSERT INTO instagram_distribution_state (organization_id, last_assigned_user_id)
            VALUES (p_organization_id, v_next_user_id)
            ON CONFLICT (organization_id)
            DO UPDATE SET last_assigned_user_id = v_next_user_id, updated_at = now();

        WHEN 'least_busy' THEN
            -- Atribuir ao usuário com menos conversas abertas
            SELECT p.user_id INTO v_next_user_id
            FROM instagram_user_permissions p
            JOIN instagram_connections c ON c.id = p.connection_id
            JOIN instagram_conversations conv ON conv.connection_id = c.id
            WHERE conv.id = p_conversation_id
            AND p.can_respond = true
            AND p.user_id = ANY(v_available_users)
            GROUP BY p.user_id
            ORDER BY (
                SELECT COUNT(*) FROM instagram_conversations ic
                WHERE ic.assigned_to = p.user_id
                AND ic.status = 'open'
            ) ASC
            LIMIT 1;

        WHEN 'random' THEN
            v_next_user_id := v_available_users[1 + floor(random() * array_length(v_available_users, 1))::int];
    END CASE;

    -- Atribuir conversa
    IF v_next_user_id IS NOT NULL THEN
        UPDATE instagram_conversations
        SET assigned_to = v_next_user_id, updated_at = now()
        WHERE id = p_conversation_id;

        RETURN json_build_object(
            'assigned', true,
            'user_id', v_next_user_id,
            'mode', v_config.mode
        );
    END IF;

    RETURN json_build_object('assigned', false, 'reason', 'no_user_selected');
END;
$$;

-- Permissões
GRANT EXECUTE ON FUNCTION public.distribute_instagram_conversation TO authenticated;
GRANT EXECUTE ON FUNCTION public.distribute_instagram_conversation TO service_role;

-- ============================================
-- TRIGGER: Atualizar conversa quando mensagem é inserida
-- ============================================

CREATE OR REPLACE FUNCTION public.update_conversation_on_message()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
BEGIN
    UPDATE instagram_conversations
    SET 
        last_message_at = NEW.sent_at,
        last_message_preview = LEFT(NEW.content, 100),
        unread_count = CASE 
            WHEN NEW.direction = 'incoming' THEN unread_count + 1 
            ELSE 0 
        END,
        first_response_at = CASE 
            WHEN first_response_at IS NULL AND NEW.direction = 'outgoing' THEN NEW.sent_at
            ELSE first_response_at
        END,
        updated_at = now()
    WHERE id = NEW.conversation_id;
    
    RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trigger_update_conversation_on_message ON public.instagram_messages;
CREATE TRIGGER trigger_update_conversation_on_message
    AFTER INSERT ON public.instagram_messages
    FOR EACH ROW
    EXECUTE FUNCTION public.update_conversation_on_message();

-- ============================================
-- Grants para as novas tabelas
-- ============================================

GRANT ALL ON public.instagram_connections TO authenticated;
GRANT ALL ON public.instagram_user_permissions TO authenticated;
GRANT ALL ON public.instagram_conversations TO authenticated;
GRANT ALL ON public.instagram_messages TO authenticated;
GRANT ALL ON public.instagram_quick_replies TO authenticated;
GRANT ALL ON public.instagram_conversation_tags TO authenticated;
GRANT ALL ON public.instagram_conversation_tag_assignments TO authenticated;
GRANT ALL ON public.instagram_metrics TO authenticated;
GRANT ALL ON public.instagram_distribution_config TO authenticated;
GRANT ALL ON public.instagram_distribution_state TO authenticated;

GRANT ALL ON public.instagram_connections TO service_role;
GRANT ALL ON public.instagram_user_permissions TO service_role;
GRANT ALL ON public.instagram_conversations TO service_role;
GRANT ALL ON public.instagram_messages TO service_role;
GRANT ALL ON public.instagram_quick_replies TO service_role;
GRANT ALL ON public.instagram_conversation_tags TO service_role;
GRANT ALL ON public.instagram_conversation_tag_assignments TO service_role;
GRANT ALL ON public.instagram_metrics TO service_role;
GRANT ALL ON public.instagram_distribution_config TO service_role;
GRANT ALL ON public.instagram_distribution_state TO service_role;
