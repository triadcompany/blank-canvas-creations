import { serve } from "https://deno.land/std@0.168.0/http/server.ts"

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
}

serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders })
  }

  try {
    const { cnpj } = await req.json()

    if (!cnpj) {
      return new Response(
        JSON.stringify({ success: false, error: 'CNPJ é obrigatório' }),
        { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      )
    }

    // Remove caracteres não numéricos
    const cleanCnpj = cnpj.replace(/\D/g, '')

    if (cleanCnpj.length !== 14) {
      return new Response(
        JSON.stringify({ success: false, error: 'CNPJ deve ter 14 dígitos' }),
        { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      )
    }

    console.log('Consultando CNPJ:', cleanCnpj)

    // Usando BrasilAPI - API gratuita e sem necessidade de autenticação
    const response = await fetch(`https://brasilapi.com.br/api/cnpj/v1/${cleanCnpj}`)

    if (!response.ok) {
      if (response.status === 404) {
        return new Response(
          JSON.stringify({ success: false, error: 'CNPJ não encontrado' }),
          { status: 404, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
        )
      }
      throw new Error(`Erro na API: ${response.status}`)
    }

    const data = await response.json()

    console.log('Dados recebidos:', JSON.stringify(data, null, 2))

    // Extrair dados relevantes
    const prospect = {
      cnpj: cleanCnpj,
      company_name: data.razao_social || '',
      trade_name: data.nome_fantasia || '',
      owner_name: data.qsa?.[0]?.nome_socio || '',
      status: data.descricao_situacao_cadastral || '',
      main_activity: data.cnae_fiscal_descricao || '',
      address: [
        data.logradouro,
        data.numero,
        data.complemento,
        data.bairro
      ].filter(Boolean).join(', '),
      city: data.municipio || '',
      state: data.uf || '',
      raw_data: data
    }

    return new Response(
      JSON.stringify({ success: true, data: prospect }),
      { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    )

  } catch (error) {
    console.error('Erro ao consultar CNPJ:', error)
    return new Response(
      JSON.stringify({ success: false, error: error.message || 'Erro ao consultar CNPJ' }),
      { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    )
  }
})
