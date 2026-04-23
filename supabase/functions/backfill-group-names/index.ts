// One-shot backfill: fetch real WhatsApp group names AND profile pictures from
// Evolution API. Uses `chat/fetchProfilePictureUrl` per group, with a single
// `group/fetchAllGroups` lookup per instance as a fallback (provides both
// `subject` and `pictureUrl`, and works on Evolution versions that 404 on
// `findGroupInfos`).
import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.57.0";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

const EVOLUTION_BASE_URL = Deno.env.get("EVOLUTION_BASE_URL") || "";
const EVOLUTION_API_KEY = Deno.env.get("EVOLUTION_API_KEY") || "";

type GroupInfo = { subject: string | null; pictureUrl: string | null };

// Fetches every group of an instance once and indexes by JID → {subject, pictureUrl}.
async function fetchAllGroupsMap(instanceName: string): Promise<Map<string, GroupInfo>> {
  const map = new Map<string, GroupInfo>();
  try {
    const url = `${EVOLUTION_BASE_URL}/group/fetchAllGroups/${instanceName}?getParticipants=false`;
    const res = await fetch(url, {
      method: "GET",
      headers: { "Content-Type": "application/json", apikey: EVOLUTION_API_KEY },
    });
    if (!res.ok) {
      console.warn(`[backfill] fetchAllGroups ${instanceName}: ${res.status}`);
      return map;
    }
    const data = await res.json().catch(() => [] as any);
    const list = Array.isArray(data) ? data : (data?.groups || []);
    for (const g of list) {
      const jid: string | undefined = g?.id || g?.groupJid || g?.remoteJid;
      if (!jid) continue;
      map.set(jid, {
        subject: g?.subject || g?.name || g?.groupSubject || null,
        pictureUrl: g?.pictureUrl || g?.profilePictureUrl || g?.profilePicUrl || null,
      });
    }
  } catch (e) {
    console.error(`[backfill] fetchAllGroups error for ${instanceName}:`, e);
  }
  return map;
}

async function fetchProfilePictureViaChat(instanceName: string, jid: string): Promise<string | null> {
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
    if (!force) q = q.or("contact_name_source.neq.whatsapp_group,profile_picture_url.is.null");

    const { data: convs, error } = await q;
    if (error) return respond({ ok: false, error: error.message }, 500);

    // Group by instance and prefetch the full group list once per instance.
    const instanceGroups = new Map<string, Map<string, GroupInfo>>();
    const instances = Array.from(new Set((convs || []).map((c: any) => c.instance_name).filter(Boolean)));
    await Promise.all(instances.map(async (inst) => {
      instanceGroups.set(inst, await fetchAllGroupsMap(inst));
    }));

    const results: any[] = [];
    let updated = 0;
    let skipped = 0;

    for (const conv of convs || []) {
      const groupJid = `${conv.contact_phone}@g.us`;
      const groupMap = instanceGroups.get(conv.instance_name) || new Map();
      const groupInfo = groupMap.get(groupJid) || { subject: null, pictureUrl: null };

      const needsSubject = force || conv.contact_name_source !== "whatsapp_group";
      const needsPicture = force || !conv.profile_picture_url;

      let subject: string | null = needsSubject ? groupInfo.subject : null;
      let pictureUrl: string | null = needsPicture ? groupInfo.pictureUrl : null;

      // If fetchAllGroups didn't have the picture, try the per-chat endpoint as a fallback.
      if (needsPicture && !pictureUrl) {
        pictureUrl = await fetchProfilePictureViaChat(conv.instance_name, groupJid);
      }

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
      instances_checked: instances.length,
      updated,
      skipped,
      details: results,
    });
  } catch (err) {
    console.error("[backfill] error:", err);
    return respond({ ok: false, error: String(err) }, 500);
  }
});
