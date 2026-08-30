/**
 * GET /api/automations/trigger — appelée par Vercel Cron toutes les 15 min.
 * Relaie simplement vers la fonction Edge Supabase `run-automations`, qui
 * porte la vraie logique (accès direct à la base + rafraîchissement des
 * jetons Google). Voir supabase/functions/run-automations/index.ts.
 */
export default async function handler(req: any, res: any) {
  try {
    const secret = process.env.AUTOMATION_CRON_SECRET || '';
    if (!secret) {
      res.status(500).json({ error: 'AUTOMATION_CRON_SECRET non configuré côté Vercel.' });
      return;
    }

    // Vercel Hobby ne permet qu'un cron quotidien — cette route est donc
    // appelée par un service externe (cron-job.org, GitHub Actions...) plutôt
    // que par un cron Vercel intégré. On exige le même secret en query pour
    // ne pas laisser n'importe qui déclencher les automatisations.
    const callerSecret = req.query?.secret || req.headers['x-automation-secret'];
    if (callerSecret !== secret) {
      res.status(401).json({ error: 'unauthorized' });
      return;
    }

    const supabaseUrl = process.env.SUPABASE_URL || process.env.VITE_SUPABASE_URL;
    const response = await fetch(`${supabaseUrl}/functions/v1/run-automations`, {
      method: 'POST',
      headers: { 'x-automation-secret': secret, 'Content-Type': 'application/json' },
      body: '{}',
    });
    const data = await response.json().catch(() => ({}));
    res.status(response.ok ? 200 : 500).json(data);
  } catch (e: any) {
    res.status(500).json({ error: e?.message || 'Erreur inconnue.' });
  }
}
