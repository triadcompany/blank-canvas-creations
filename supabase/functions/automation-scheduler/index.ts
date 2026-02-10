import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.57.0";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type",
};

serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
  const supabaseServiceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
  const supabase = createClient(supabaseUrl, supabaseServiceKey);

  try {
    console.log("[automation-scheduler] Checking for waiting runs...");

    // Find runs that are waiting and ready to continue
    const { data: waitingRuns, error } = await supabase
      .from("automation_runs")
      .select("id, automation_id, lead_id, organization_id, current_node_id")
      .eq("status", "waiting")
      .lte("next_run_at", new Date().toISOString())
      .limit(50);

    if (error) throw error;

    if (!waitingRuns || waitingRuns.length === 0) {
      console.log("[automation-scheduler] No runs to resume");
      return new Response(
        JSON.stringify({ message: "No runs to resume", processed: 0 }),
        { headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    console.log(`[automation-scheduler] Found ${waitingRuns.length} runs to resume`);

    let processed = 0;

    for (const run of waitingRuns) {
      try {
        // Mark as running again
        await supabase
          .from("automation_runs")
          .update({ status: "running", next_run_at: null })
          .eq("id", run.id);

        // Get remaining pending steps
        const { data: steps } = await supabase
          .from("automation_run_steps")
          .select("*")
          .eq("run_id", run.id)
          .eq("status", "pending")
          .order("created_at", { ascending: true });

        if (!steps || steps.length === 0) {
          await supabase
            .from("automation_runs")
            .update({ status: "completed", completed_at: new Date().toISOString() })
            .eq("id", run.id);
          processed++;
          continue;
        }

        // Execute steps
        for (const step of steps) {
          await supabase
            .from("automation_run_steps")
            .update({ status: "running", started_at: new Date().toISOString() })
            .eq("id", step.id);

          try {
            if (step.node_type === "delay") {
              const config = step.input_data || {};
              const amount = config.amount || 1;
              const unit = config.unit || "hours";
              const delayMs =
                unit === "minutes"
                  ? amount * 60 * 1000
                  : unit === "hours"
                  ? amount * 3600 * 1000
                  : amount * 86400 * 1000;

              const nextRunAt = new Date(Date.now() + delayMs).toISOString();

              await supabase
                .from("automation_run_steps")
                .update({ status: "completed", completed_at: new Date().toISOString(), output_data: { next_run_at: nextRunAt } })
                .eq("id", step.id);

              await supabase
                .from("automation_runs")
                .update({ status: "waiting", current_node_id: step.node_id, next_run_at: nextRunAt })
                .eq("id", run.id);

              break; // Pause again
            }

            if (step.node_type === "message") {
              const config = step.input_data || {};
              const messageText = config.text || "";

              const { data: lead } = await supabase
                .from("leads")
                .select("phone, name")
                .eq("id", run.lead_id)
                .single();

              if (lead?.phone && messageText) {
                const resolvedText = messageText
                  .replace(/\{\{lead\.name\}\}/g, lead.name || "")
                  .replace(/\{\{lead\.phone\}\}/g, lead.phone || "");

                const sent = await sendWhatsAppMessage(supabase, run.organization_id, lead.phone, resolvedText);

                await supabase
                  .from("automation_run_steps")
                  .update({
                    status: "completed",
                    completed_at: new Date().toISOString(),
                    output_data: { sent, resolved_text: resolvedText },
                  })
                  .eq("id", step.id);

                await supabase.from("automation_logs").insert({
                  automation_id: run.automation_id,
                  organization_id: run.organization_id,
                  node_id: step.node_id,
                  node_type: "message",
                  status: sent ? "success" : "warning",
                  message: sent ? `Mensagem enviada para ${lead.phone}` : `Mensagem preparada (sem provedor)`,
                  lead_id: run.lead_id,
                  metadata: { text: resolvedText },
                });
              } else {
                await supabase
                  .from("automation_run_steps")
                  .update({ status: "completed", completed_at: new Date().toISOString(), output_data: { skipped: true } })
                  .eq("id", step.id);
              }
              continue;
            }

            if (step.node_type === "action") {
              const config = step.input_data || {};
              await supabase
                .from("automation_run_steps")
                .update({ status: "completed", completed_at: new Date().toISOString(), output_data: { action: config.actionType, stub: true } })
                .eq("id", step.id);
              continue;
            }

            if (step.node_type === "condition") {
              await supabase
                .from("automation_run_steps")
                .update({ status: "completed", completed_at: new Date().toISOString(), output_data: { condition: "passed", stub: true } })
                .eq("id", step.id);
              continue;
            }

            // Unknown
            await supabase
              .from("automation_run_steps")
              .update({ status: "skipped", completed_at: new Date().toISOString() })
              .eq("id", step.id);
          } catch (stepErr) {
            console.error(`[automation-scheduler] Step ${step.id} error:`, stepErr);
            await supabase
              .from("automation_run_steps")
              .update({ status: "failed", completed_at: new Date().toISOString(), error_message: String(stepErr) })
              .eq("id", step.id);
            await supabase
              .from("automation_runs")
              .update({ status: "failed", error_message: `Step ${step.node_id} failed` })
              .eq("id", run.id);
            break;
          }
        }

        // Check if all steps done
        const { data: remaining } = await supabase
          .from("automation_run_steps")
          .select("id")
          .eq("run_id", run.id)
          .in("status", ["pending", "running"]);

        if (!remaining || remaining.length === 0) {
          const { data: currentRun } = await supabase
            .from("automation_runs")
            .select("status")
            .eq("id", run.id)
            .single();

          if (currentRun?.status === "running") {
            await supabase
              .from("automation_runs")
              .update({ status: "completed", completed_at: new Date().toISOString() })
              .eq("id", run.id);
          }
        }

        processed++;
      } catch (runErr) {
        console.error(`[automation-scheduler] Run ${run.id} error:`, runErr);
      }
    }

    return new Response(
      JSON.stringify({ message: `Processed ${processed} runs`, processed }),
      { headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  } catch (err) {
    console.error("[automation-scheduler] Error:", err);
    return new Response(
      JSON.stringify({ error: String(err) }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  }
});

async function sendWhatsAppMessage(
  supabase: any,
  organizationId: string,
  phone: string,
  text: string
): Promise<boolean> {
  try {
    const { data: integration } = await supabase
      .from("whatsapp_integrations")
      .select("api_url, api_key, instance_name")
      .eq("organization_id", organizationId)
      .eq("is_active", true)
      .maybeSingle();

    if (!integration?.api_url || !integration?.api_key || !integration?.instance_name) {
      return false;
    }

    const url = `${integration.api_url}/message/sendText/${integration.instance_name}`;
    const response = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json", apikey: integration.api_key },
      body: JSON.stringify({ number: phone, text }),
    });

    return response.ok;
  } catch {
    return false;
  }
}
