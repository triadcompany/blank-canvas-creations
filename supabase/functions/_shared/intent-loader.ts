import { SupabaseClient } from "https://esm.sh/@supabase/supabase-js@2";

export interface IntentDef {
  intent_key: string;
  intent_label: string;
}

/**
 * Load intent definitions for an organization, merging:
 * 1. Global intents
 * 2. Niche intents (based on ai_agent_profiles.niche)
 * 3. Organization-specific intents
 */
export async function loadIntentDefinitions(
  supabase: SupabaseClient,
  organizationId: string,
): Promise<IntentDef[]> {
  // 1. Get org niche from ai_agent_profiles
  const { data: agentProfile } = await supabase
    .from("ai_agent_profiles")
    .select("niche")
    .eq("organization_id", organizationId)
    .eq("is_active", true)
    .order("version", { ascending: false })
    .limit(1)
    .maybeSingle();

  const niche = agentProfile?.niche || null;

  // 2. Build scope filters
  const scopeFilters: string[] = ["global"];
  const scopeIds: (string | null)[] = [null];

  if (niche) {
    scopeFilters.push("niche");
    scopeIds.push(niche);
  }

  scopeFilters.push("organization");
  scopeIds.push(organizationId);

  // 3. Query all matching intents
  const { data: intents } = await supabase
    .from("intent_definitions")
    .select("intent_key, intent_label, scope_type")
    .or(
      `and(scope_type.eq.global,scope_id.is.null),` +
      (niche ? `and(scope_type.eq.niche,scope_id.eq.${niche}),` : "") +
      `and(scope_type.eq.organization,scope_id.eq.${organizationId})`
    );

  // 4. Dedupe: org overrides niche overrides global
  const map = new Map<string, IntentDef>();
  const priority: Record<string, number> = { global: 0, niche: 1, organization: 2 };

  for (const intent of (intents || [])) {
    const existing = map.get(intent.intent_key);
    if (!existing || priority[intent.scope_type] > (priority[(existing as any)._scope] || 0)) {
      map.set(intent.intent_key, {
        intent_key: intent.intent_key,
        intent_label: intent.intent_label,
      });
      (map.get(intent.intent_key) as any)._scope = intent.scope_type;
    }
  }

  // Clean up internal property
  const result: IntentDef[] = [];
  for (const [, v] of map) {
    delete (v as any)._scope;
    result.push(v);
  }

  return result;
}

/**
 * Save conversation intelligence (upsert by conversation_id)
 */
export async function saveConversationIntelligence(
  supabase: SupabaseClient,
  data: {
    organization_id: string;
    conversation_id: string;
    last_detected_intent: string;
    intent_label?: string | null;
    confidence: number;
    sentiment: string;
    urgency_level: string;
  },
) {
  const { error } = await supabase
    .from("conversation_intelligence")
    .upsert(
      {
        organization_id: data.organization_id,
        conversation_id: data.conversation_id,
        last_detected_intent: data.last_detected_intent || "unknown",
        intent_label: data.intent_label || null,
        confidence: data.confidence || 0,
        sentiment: data.sentiment || "neutral",
        urgency_level: data.urgency_level || "low",
        updated_at: new Date().toISOString(),
      },
      { onConflict: "conversation_id" }
    );

  if (error) {
    console.error("[intent-loader] Error saving intelligence:", error);
  }
}
