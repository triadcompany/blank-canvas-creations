// Debug helper: dump raw responses from Evolution endpoints for one group JID,
// to understand why pictures aren't being saved for some groups.
import { serve } from "https://deno.land/std@0.168.0/http/server.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

const EVOLUTION_BASE_URL = Deno.env.get("EVOLUTION_BASE_URL") || "";
const EVOLUTION_API_KEY = Deno.env.get("EVOLUTION_API_KEY") || "";

serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });
  const respond = (b: unknown, s = 200) =>
    new Response(JSON.stringify(b, null, 2), {
      status: s,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });

  try {
    const body = await req.json().catch(() => ({} as any));
    const instance: string = body?.instance;
    const jid: string = body?.jid; // ex: 120363405667341274@g.us
    if (!instance || !jid) return respond({ error: "instance and jid required" }, 400);

    const out: Record<string, unknown> = { instance, jid };

    // 1) chat/fetchProfilePictureUrl
    try {
      const r = await fetch(`${EVOLUTION_BASE_URL}/chat/fetchProfilePictureUrl/${instance}`, {
        method: "POST",
        headers: { "Content-Type": "application/json", apikey: EVOLUTION_API_KEY },
        body: JSON.stringify({ number: jid }),
      });
      out.chat_status = r.status;
      out.chat_body = await r.text().catch(() => null);
    } catch (e) {
      out.chat_error = String(e);
    }

    // 2) group/findGroupInfos
    try {
      const r = await fetch(`${EVOLUTION_BASE_URL}/group/findGroupInfos/${instance}?groupJid=${encodeURIComponent(jid)}`, {
        method: "GET",
        headers: { "Content-Type": "application/json", apikey: EVOLUTION_API_KEY },
      });
      out.findGroupInfos_status = r.status;
      out.findGroupInfos_body = await r.text().catch(() => null);
    } catch (e) {
      out.findGroupInfos_error = String(e);
    }

    // 3) group/fetchAllGroups
    try {
      const r = await fetch(`${EVOLUTION_BASE_URL}/group/fetchAllGroups/${instance}?getParticipants=false`, {
        method: "GET",
        headers: { "Content-Type": "application/json", apikey: EVOLUTION_API_KEY },
      });
      out.fetchAllGroups_status = r.status;
      const txt = await r.text().catch(() => "");
      out.fetchAllGroups_preview = txt.slice(0, 500);
    } catch (e) {
      out.fetchAllGroups_error = String(e);
    }

    return respond(out);
  } catch (err) {
    return respond({ error: String(err) }, 500);
  }
});
