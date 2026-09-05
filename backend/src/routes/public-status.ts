import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { getPool } from "../db.js";
import { hashOpaqueToken } from "../security.js";
import { AppError } from "../http/errors.js";

function escapeHtml(value: string): string {
  return value.replace(/[&<>'"]/g, (character) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", "'": "&#39;", '"': "&quot;" })[character]!);
}

export async function publicStatusRoutes(app: FastifyInstance): Promise<void> {
  app.get("/:token", {
    config: { rateLimit: { max: 60, timeWindow: "15 minutes" } },
  }, async (request, reply) => {
    const params = z.object({ token: z.string().min(32).max(200) }).parse(request.params);
    const result = await getPool().query<{
      title: string;
      destination_label: string;
      expected_arrival_at: Date;
      status: string;
      last_check_in_at: Date | null;
      last_coarse_area: string | null;
      display_name: string;
    }>(
      `SELECT j.title,j.destination_label,j.expected_arrival_at,j.status,j.last_check_in_at,j.last_coarse_area,u.display_name
       FROM journeys j JOIN users u ON u.id=j.user_id WHERE j.share_token_hash=$1 AND u.deleted_at IS NULL`,
      [hashOpaqueToken(params.token)],
    );
    const row = result.rows[0];
    if (!row) throw new AppError(404, "STATUS_LINK_NOT_FOUND", "This private journey link is no longer available.");
    reply.header("Cache-Control", "no-store").type("text/html; charset=utf-8");
    return `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Turtle Maps journey</title><style>body{margin:0;background:#f6f1e9;color:#1f2924;font-family:-apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif}main{max-width:560px;margin:0 auto;padding:48px 24px}.brand{font-weight:900;letter-spacing:.08em;color:#244a3b}.card{margin-top:40px;background:#fffdf9;border:1px solid #e4dbcf;border-radius:24px;padding:28px;box-shadow:0 18px 60px #244a3b14}.status{display:inline-block;background:#b64d32;color:white;border-radius:999px;padding:8px 13px;font-size:13px;font-weight:800;text-transform:uppercase}h1{font-size:38px;line-height:1.05;margin:18px 0 8px}.muted{color:#68726c;line-height:1.5}.grid{display:grid;grid-template-columns:1fr 1fr;gap:14px;margin-top:26px}.metric{background:#eef2e8;border-radius:16px;padding:16px}.metric small{display:block;color:#68726c;margin-bottom:6px}.foot{margin-top:28px;font-size:13px;color:#68726c;line-height:1.5}</style></head><body><main><div class="brand">TURTLE MAPS</div><section class="card"><span class="status">${escapeHtml(row.status)}</span><h1>${escapeHtml(row.display_name)}'s journey</h1><p class="muted">${escapeHtml(row.title)} to ${escapeHtml(row.destination_label)}</p><div class="grid"><div class="metric"><small>Expected arrival</small><strong>${escapeHtml(row.expected_arrival_at.toLocaleString())}</strong></div><div class="metric"><small>Last check-in</small><strong>${escapeHtml(row.last_check_in_at?.toLocaleString() ?? "Not started")}</strong></div></div><p class="foot">Last known area: ${escapeHtml(row.last_coarse_area ?? "Shared after the journey starts")}. Turtle Maps deliberately does not show precise coordinates on public links.</p></section></main></body></html>`;
  });
}
