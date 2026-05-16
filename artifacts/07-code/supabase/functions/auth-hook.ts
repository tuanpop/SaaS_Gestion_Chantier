// Supabase Edge Function — custom_access_token_hook
// Type : Supabase Auth Hook (JWT custom claims)
// Déclenchement : à chaque génération de JWT (connexion, refresh)
//
// Objectif : injecter organisation_id + role dans le JWT
// Ces claims sont utilisés par les policies RLS (auth.jwt() ->> 'organisation_id')
//
// Note : la logique principale est implémentée en PostgreSQL function dans
// supabase/migrations/001_initial_schema.sql (custom_access_token_hook PG function).
// Ce fichier Deno est la version Edge Function alternative si nécessaire.
// En priorité, utiliser la PG function (config.toml § auth.hook.custom_access_token).
//
// Items sécurité : S-02, I-01

import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'

interface CustomAccessTokenEvent {
  user_id: string
  claims: {
    sub: string
    email?: string
    app_metadata?: Record<string, unknown>
    [key: string]: unknown
  }
}

// Deno.serve requis pour les Supabase Edge Functions
Deno.serve(async (req: Request) => {
  try {
    const event: CustomAccessTokenEvent = await req.json()

    // Le client admin bypass RLS pour lire la table users avant que les claims existent
    // SUPABASE_URL et SUPABASE_SERVICE_ROLE_KEY sont injectées automatiquement par Supabase
    const supabaseAdmin = createClient(
      Deno.env.get('SUPABASE_URL') ?? '',
      Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? '',
      {
        auth: {
          autoRefreshToken: false,
          persistSession: false,
        },
      },
    )

    // Récupérer organisation_id et role depuis la table users
    const { data: user, error } = await supabaseAdmin
      .from('users')
      .select('organisation_id, role')
      .eq('id', event.user_id)
      .single()

    if (error || !user) {
      // Si l'utilisateur n'est pas encore dans la table users (ex: signup en cours),
      // retourner les claims sans modification.
      return new Response(
        JSON.stringify({ claims: event.claims }),
        {
          headers: { 'Content-Type': 'application/json' },
          status: 200,
        },
      )
    }

    // Injecter organisation_id + role dans app_metadata
    // app_metadata est signé dans le JWT et accessible via auth.jwt() ->> 'organisation_id'
    const updatedClaims = {
      ...event.claims,
      app_metadata: {
        ...(event.claims.app_metadata ?? {}),
        organisation_id: user.organisation_id,
        role: user.role,
      },
    }

    return new Response(
      JSON.stringify({ claims: updatedClaims }),
      {
        headers: { 'Content-Type': 'application/json' },
        status: 200,
      },
    )
  } catch (err) {
    // Retourner les claims inchangés en cas d'erreur pour ne pas bloquer la connexion
    // L'incident sera visible dans les logs Supabase
    console.error('auth-hook error:', err instanceof Error ? err.message : String(err))

    // Tenter de retourner les claims originaux
    try {
      const body: CustomAccessTokenEvent = await new Request(req.url, {
        method: req.method,
        headers: req.headers,
        body: req.body,
      }).json()
      return new Response(
        JSON.stringify({ claims: body.claims }),
        {
          headers: { 'Content-Type': 'application/json' },
          status: 200,
        },
      )
    } catch {
      return new Response(
        JSON.stringify({ error: 'Internal error in auth hook' }),
        {
          headers: { 'Content-Type': 'application/json' },
          status: 500,
        },
      )
    }
  }
})
