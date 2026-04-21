// Updates the current user's profile (name and/or avatar) using the service
// role to bypass Supabase RLS for Clerk-authenticated sessions.
//
// Accepts multipart/form-data with:
//   - clerk_user_id (required)
//   - name (optional) → updates users_profile.full_name
//   - file (optional) → uploaded to the `avatars` bucket and saved as avatar_url
//
// Returns the resolved fields so the client can refresh its UI.
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.0";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type, x-clerk-user-id",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    const admin = createClient(supabaseUrl, serviceKey);

    const contentType = req.headers.get("content-type") || "";
    let clerkUserId = "";
    let name: string | null = null;
    let file: File | null = null;

    if (contentType.includes("multipart/form-data")) {
      const form = await req.formData();
      clerkUserId = (form.get("clerk_user_id") as string) || "";
      const rawName = form.get("name");
      if (typeof rawName === "string") name = rawName.trim();
      const rawFile = form.get("file");
      if (rawFile && rawFile instanceof File && rawFile.size > 0) file = rawFile;
    } else {
      const body = await req.json().catch(() => ({}));
      clerkUserId = body?.clerk_user_id || "";
      if (typeof body?.name === "string") name = body.name.trim();
    }

    if (!clerkUserId) {
      return new Response(
        JSON.stringify({ error: "Missing clerk_user_id" }),
        { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } },
      );
    }

    if (!name && !file) {
      return new Response(
        JSON.stringify({ error: "Nothing to update (provide name and/or file)" }),
        { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } },
      );
    }

    // Locate the user record by clerk_user_id
    const { data: userRow, error: userErr } = await admin
      .from("users_profile")
      .select("id, full_name, avatar_url")
      .eq("clerk_user_id", clerkUserId)
      .maybeSingle();

    if (userErr) {
      return new Response(JSON.stringify({ error: userErr.message }), {
        status: 500,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    if (!userRow) {
      return new Response(JSON.stringify({ error: "User profile not found" }), {
        status: 404,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    let avatarPublicUrl: string | null = null;

    // Upload avatar if provided
    if (file) {
      if (file.size > 2 * 1024 * 1024) {
        return new Response(JSON.stringify({ error: "File too large (max 2MB)" }), {
          status: 400,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }

      // Ensure bucket exists (idempotent)
      await admin.storage
        .createBucket("avatars", { public: true })
        .catch(() => {});

      const ext = (file.name.split(".").pop() || "png").toLowerCase();
      // Folder name = clerkUserId so the path is stable and deterministic
      const path = `${clerkUserId}/avatar-${Date.now()}.${ext}`;
      const buf = new Uint8Array(await file.arrayBuffer());

      const { error: upErr } = await admin.storage
        .from("avatars")
        .upload(path, buf, { upsert: true, contentType: file.type || "image/png" });

      if (upErr) {
        return new Response(JSON.stringify({ error: upErr.message }), {
          status: 500,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }

      const { data: pub } = admin.storage.from("avatars").getPublicUrl(path);
      avatarPublicUrl = pub.publicUrl;
    }

    // Build update payload
    const updates: Record<string, unknown> = {
      updated_at: new Date().toISOString(),
    };
    if (name) updates.full_name = name;
    if (avatarPublicUrl) updates.avatar_url = avatarPublicUrl;

    const { data: updated, error: updErr } = await admin
      .from("users_profile")
      .update(updates)
      .eq("clerk_user_id", clerkUserId)
      .select("id, full_name, avatar_url")
      .maybeSingle();

    if (updErr) {
      return new Response(JSON.stringify({ error: updErr.message }), {
        status: 500,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // Best-effort sync to public.profiles (if a row exists for this user)
    try {
      await admin
        .from("profiles")
        .update({
          ...(name ? { name } : {}),
          ...(avatarPublicUrl ? { avatar_url: avatarPublicUrl } : {}),
          updated_at: new Date().toISOString(),
        })
        .eq("clerk_user_id", clerkUserId);
    } catch (e) {
      console.warn("profiles sync failed (non-fatal):", e);
    }

    return new Response(
      JSON.stringify({
        ok: true,
        full_name: updated?.full_name ?? name ?? userRow.full_name,
        avatar_url: updated?.avatar_url ?? avatarPublicUrl ?? userRow.avatar_url,
      }),
      { headers: { ...corsHeaders, "Content-Type": "application/json" } },
    );
  } catch (e: any) {
    return new Response(JSON.stringify({ error: e?.message || "Unknown error" }), {
      status: 500,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
