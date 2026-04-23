// One-shot backfill: fetch real WhatsApp group names from Evolution API
// for all conversations where is_group=true and contact_name is the
// "Grupo (XXXX)" fallback. Updates contact_name + group_name + source.
import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.57.0";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

const EVOLUTION_BASE_URL = Deno.env.get("EVOLUTION_BASE_URL") || "";
const EVOLUTION_API_KEY = Deno.env.get("EVOLUTION_API_KEY") || "";

async function fetchGroupSubject(instanceName: string, groupJid: string): Promise<string | null> {
  try {
    const url = `${EVOLUTION_BASE_URL}/group/findGroupInfos/${instanceName}?groupJid=${encodeURIComponent(groupJid)}`;
    const res = await fetch(url, {
      method: "GET",
      headers: { "Content-Type": "application/json", apikey: EVOLUTION_API_KEY },
    });
    if (!res.ok) {
      console.warn(`[backfill] findGroupInfos ${groupJid}: ${res.status}`);
      return null;
    }
    const data = await res.json().catch(() => ({} as any));
    const node = Array.isArray(data) ? data[0] : data;
    return (node?.subject || node?.name || node?.groupSubject || null) as string | null;
  } catch (e) {
    console.error(`[backfill] fetch error for ${groupJid}:`, e);
    return null;
  }
}

async function fetchProfilePicture(instanceName: string, jid: string): Promise<string | null> {
  try {
    const res = await fetch(`${EVOLUTION_BASE_URL}/chat/fetchProfilePictureUrl/${instanceName}`, {
      method: "POST",
      headers: { "Content-Type": "application/json", apikey: EVOLUTION_API_KEY },
      body: JSON.stringify({ number: jid }),
    });
    if (!res.ok) return null;
    const data = await res.json().catch(() => ({} as any));
    return (data?.profilePictureUrl || data?.pictureUrl || data?.imgUrl || null) as string | null;
  } catch (e) {
    console.error(`[backfill] picture fetch error for ${jid}:`, e);
    return null;
  }
}

serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });

  const respond = (b: Record<string, unknown>, s = 200) =>
    new Response(JSON.stringify(b, null, 2), {
      status: s,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });

  try {
    if (!EVOLUTION_BASE_URL || !EVOLUTION_API_KEY) {
      return respond({ ok: false, error: "EVOLUTION env not set" }, 500);
    }

    const supabase = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
    );

    let body: any = {};
    try { body = await req.json(); } catch { /* no body */ }
    const organizationId: string | undefined = body?.organization_id;
    const force: boolean = !!body?.force;

    // Fetch group conversations needing repair
    let q = supabase
      .from("conversations")
      .select("id, organization_id, instance_name, contact_phone, contact_name, contact_name_source, group_name, profile_picture_url")
      .eq("is_group", true);

    if (organizationId) q = q.eq("organization_id", organizationId);
    // When not forcing, repair rows missing either the verified subject or a picture.
    if (!force) q = q.or("contact_name_source.neq.whatsapp_group,profile_picture_url.is.null");

    const { data: convs, error } = await q;
    if (error) return respond({ ok: false, error: error.message }, 500);

    const results: any[] = [];
    let updated = 0;
    let skipped = 0;

    for (const conv of convs || []) {
      const groupJid = `${conv.contact_phone}@g.us`;

      const needsSubject = force || conv.contact_name_source !== "whatsapp_group";
      const needsPicture = force || !conv.profile_picture_url;

      const [subject, pictureUrl] = await Promise.all([
        needsSubject ? fetchGroupSubject(conv.instance_name, groupJid) : Promise.resolve(null),
        needsPicture ? fetchProfilePicture(conv.instance_name, groupJid) : Promise.resolve(null),
      ]);

      const updatePayload: Record<string, unknown> = {};
      if (subject) {
        updatePayload.group_name = subject;
        updatePayload.contact_name = subject;
        updatePayload.contact_name_source = "whatsapp_group";
      }
      if (pictureUrl) {
        updatePayload.profile_picture_url = pictureUrl;
        updatePayload.profile_picture_updated_at = new Date().toISOString();
      }

      if (Object.keys(updatePayload).length === 0) {
        skipped++;
        results.push({ id: conv.id, jid: groupJid, status: "no_data" });
        continue;
      }

      const { error: updErr } = await supabase
        .from("conversations")
        .update(updatePayload)
        .eq("id", conv.id);

      if (updErr) {
        results.push({ id: conv.id, jid: groupJid, status: "update_error", error: updErr.message });
      } else {
        updated++;
        results.push({ id: conv.id, jid: groupJid, status: "updated", subject, pictureUrl });
      }
    }

    return respond({
      ok: true,
      total: convs?.length || 0,
      updated,
      skipped,
      details: results,
    });
  } catch (err) {
    console.error("[backfill] error:", err);
    return respond({ ok: false, error: String(err) }, 500);
  }
});
