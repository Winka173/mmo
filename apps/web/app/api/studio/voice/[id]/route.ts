import { VoiceStore } from "@ttm/automation";
import { getStore } from "../../../../lib/data";
import { serveFile } from "../../../../lib/serve";
export async function GET(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  if (!/^[a-f0-9-]{36}$/.test(id)) return new Response("Invalid sample", { status: 400 });
  const voices = new VoiceStore(await getStore()); const row = await voices.get(id);
  if (!row || row.state !== "ready") return new Response("Sample not ready", { status: 404 });
  return serveFile(request, voices.audio(id));
}
