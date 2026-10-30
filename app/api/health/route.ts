export async function GET() {
  return Response.json({ status: "ok", aiConfigured: Boolean(process.env.AI_API_KEY || process.env.GROQ_API_KEY), githubTokenConfigured: Boolean(process.env.GITHUB_TOKEN) });
}
